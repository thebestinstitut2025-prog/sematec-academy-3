'use server';
import { revalidatePath } from 'next/cache';
import { getContext } from '@/lib/context';
import { fail, guard, num, ok, reqStr, str, type ActionResult } from '@/lib/actions';
import { cleanIds } from '@/lib/file-share';
import { APP_PRESETS } from '@/lib/app-presets';

const VIS = ['private', 'people', 'section', 'students', 'staff', 'org'];
const NEEDS = 'Falta instalar la actualización «Contactos y apps» en Actualizar base de datos.';

function cleanUrl(raw: string): string {
  let u = raw.trim();
  if (/^(tel:|mailto:|sms:|whatsapp:)/i.test(u)) {
    u = u.replace(/\s+/g, '');
    if (/[<>"']/.test(u) || u.length < 6) throw new Error('Enlace no válido.');
    return u.slice(0, 2000);
  }
  if (!/^https?:\/\//i.test(u)) u = `https://${u}`;
  u = u.replace(/^http:\/\//i, 'https://');
  const x = new URL(u); if (!x.hostname.includes('.') || /[\s<>"]/.test(u)) throw new Error('Enlace no válido.');
  return u.slice(0, 2000);
}

/** 📱 Agrega o edita un acceso rápido (app o enlace) y elige quién lo ve. */
export async function saveAppLink(fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const ctx = await getContext();
    if (!ctx.orgId) return fail('Elija una institución.');
    const preset = APP_PRESETS.find((p) => p.key === str(fd, 'preset'));
    let url: string;
    try { url = cleanUrl(str(fd, 'url') ?? preset?.url ?? ''); } catch { return fail('El enlace no es válido. Copie el enlace completo (https://…), o use tel:, mailto: o sms:.'); }
    const title = (str(fd, 'title') ?? preset?.title ?? new URL(url.startsWith('http') ? url : 'https://x.y').hostname).replace(/[<>]/g, '').slice(0, 80);
    const vis = VIS.includes(str(fd, 'visibility') ?? '') ? str(fd, 'visibility')! : 'private';
    const row = {
      title, url, icon: (str(fd, 'icon') ?? preset?.icon ?? '🔗').slice(0, 8), description: str(fd, 'description')?.slice(0, 300) ?? null,
      visibility: vis, section_id: vis === 'section' ? str(fd, 'section') : null,
      users: vis === 'people' ? cleanIds(fd.getAll('users')) : [], groups: vis === 'people' ? cleanIds(fd.getAll('groups')) : [], position: num(fd, 'position') ?? 0,
    };
    if (vis === 'section' && !row.section_id) return fail('Elija el curso.');
    const id = str(fd, 'id');
    const { error } = id
      ? await ctx.supabase.from('app_links').update(row).eq('id', id)
      : await ctx.supabase.from('app_links').insert({ ...row, organization_id: ctx.orgId, owner_id: ctx.user.id });
    if (error) return fail(/app_links/.test(error.message) && /does not exist|schema cache/.test(error.message) ? NEEDS
      : /row-level security/.test(error.message) ? 'Solo profesores y personal pueden publicar accesos para la institución, los estudiantes o el personal.' : error);
    revalidatePath('/app/apps');
    return ok(id ? `«${title}» actualizado.` : `«${title}» agregado.`);
  });
}

export async function deleteAppLink(fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const ctx = await getContext();
    const { data, error } = await ctx.supabase.from('app_links').delete().eq('id', reqStr(fd, 'id', 'Acceso')).select('title');
    if (error) return fail(error);
    if (!data?.length) return fail('No se pudo eliminar (solo quien lo creó o el propietario).');
    revalidatePath('/app/apps');
    return ok(`«${data[0].title}» eliminado.`);
  });
}
