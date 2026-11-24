'use server';
import { revalidatePath } from 'next/cache';
import { getContext } from '@/lib/context';
import { fail, guard, ok, str, type ActionResult } from '@/lib/actions';
import { MAINT_KEY, cleanMaint, isMaintKey, loadMaint, type MaintConfig } from '@/lib/maintenance';

async function owner() {
  const ctx = await getContext();
  if (!ctx.orgId || !(ctx.isOwner || ctx.isPlatformAdmin)) throw new Error('Solo el propietario puede usar el centro de mantención.');
  return { ctx, orgId: ctx.orgId };
}
async function save(ctx: Awaited<ReturnType<typeof getContext>>, orgId: string, cfg: MaintConfig) {
  const value = cleanMaint(cfg);
  const { data: ex } = await ctx.supabase.from('organization_settings').select('id').eq('organization_id', orgId).eq('key', MAINT_KEY).maybeSingle();
  const { error } = ex
    ? await ctx.supabase.from('organization_settings').update({ value, updated_by: ctx.user.id }).eq('id', ex.id)
    : await ctx.supabase.from('organization_settings').insert({ organization_id: orgId, key: MAINT_KEY, value, description: 'Mantención de la plataforma', updated_by: ctx.user.id });
  if (error) throw new Error(error.message);
  revalidatePath('/app', 'layout');
}
/** «2026-11-25T10:00» (hora de Chile) → ISO */
const local = (v: string | null) => {
  if (!v) return null;
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})$/.exec(v);
  if (!m) return null;
  const guess = new Date(`${m[1]}T${m[2]}:00-03:00`);
  const off = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Santiago', timeZoneName: 'longOffset' }).formatToParts(guess).find((p) => p.type === 'timeZoneName')?.value.replace('GMT', '') || '-03:00';
  return new Date(`${m[1]}T${m[2]}:00${off}`).toISOString();
};

/** 🛠 Toda la plataforma en mantención (o volver a abrirla). */
export async function setGlobalMaintenance(fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const { ctx, orgId } = await owner();
    const cfg = await loadMaint(ctx.supabase, orgId);
    const on = fd.get('on') === '1';
    cfg.global = { on, message: str(fd, 'message') ?? '', from: local(str(fd, 'from')), until: local(str(fd, 'until')) };
    await save(ctx, orgId, cfg);
    return ok(on ? 'La plataforma quedó en mantención: los usuarios ven el aviso; usted sigue entrando.' : 'Listo: la plataforma volvió a estar disponible para todos.');
  });
}

/** Poner en mantención opciones del menú, sistemas o áreas elegidos. */
export async function setItemsMaintenance(fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const { ctx, orgId } = await owner();
    const keys = fd.getAll('keys').map(String).filter(isMaintKey).slice(0, 200);
    if (!keys.length) return fail('Elija al menos una opción, sistema o área.');
    const labels = new Map(fd.getAll('labels').map(String).map((x) => { const i = x.indexOf('|'); return [x.slice(0, i), x.slice(i + 1)] as [string, string]; }));
    const cfg = await loadMaint(ctx.supabase, orgId);
    const item = { message: str(fd, 'message') ?? '', from: local(str(fd, 'from')), until: local(str(fd, 'until')) };
    for (const k of keys) cfg.items[k] = { ...item, label: labels.get(k) ?? '' };
    await save(ctx, orgId, cfg);
    return ok(`${keys.length} en mantención. Los usuarios ven el aviso; usted sigue entrando para trabajar.`);
  });
}

/** Terminar la mantención de una opción, sistema o área (o de todas). */
export async function endMaintenance(fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const { ctx, orgId } = await owner();
    const cfg = await loadMaint(ctx.supabase, orgId);
    const k = str(fd, 'key');
    if (k === '*') { cfg.items = {}; cfg.global.on = false; }
    else if (k && cfg.items[k]) delete cfg.items[k];
    else return fail('No estaba en mantención.');
    await save(ctx, orgId, cfg);
    return ok(k === '*' ? 'Se terminó toda la mantención: todo está disponible.' : 'Mantención terminada: ya está disponible.');
  });
}
