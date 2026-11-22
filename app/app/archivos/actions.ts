'use server';
import { revalidatePath } from 'next/cache';
import { getContext } from '@/lib/context';
import { createAdminClient } from '@/lib/supabase/admin';
import { fail, guard, ok, reqStr, str, type ActionResult } from '@/lib/actions';
import { headers } from 'next/headers';
import { env } from '@/lib/env';
import { applyAccess, cleanEmails, cleanIds, sendToEmails } from '@/lib/file-share';

const id = (fd: FormData) => { const v = reqStr(fd, 'id', 'archivo'); if (!/^[0-9a-f-]{36}$/i.test(v)) throw new Error('Archivo inválido'); return v; };

/** 🗑 Eliminar: deja de verse, pero el propietario lo ve en el historial. */
export async function deleteFile(fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const ctx = await getContext();
    const { error } = await ctx.supabase.rpc('delete_user_file', { p_id: id(fd) });
    if (error) return fail(error);
    revalidatePath('/app/archivos');
    return ok('Archivo eliminado. (El propietario de la institución conserva el historial.)');
  });
}

export async function restoreFile(fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const ctx = await getContext();
    const { error } = await ctx.supabase.rpc('restore_user_file', { p_id: id(fd) });
    if (error) return fail(error);
    revalidatePath('/app/archivos');
    return ok('Archivo restaurado: su dueño vuelve a verlo.');
  });
}

/** ✖ Eliminar definitivamente (solo propietario): borra el registro y el archivo del almacenamiento. */
export async function purgeFile(fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const ctx = await getContext();
    if (!ctx.isOwner) return fail('Solo el propietario puede eliminar definitivamente.');
    const { data: path, error } = await ctx.supabase.rpc('purge_user_file', { p_id: id(fd) });
    if (error) return fail(error);
    const rm = await createAdminClient().storage.from('user-files').remove([String(path)]);
    revalidatePath('/app/archivos');
    return ok(rm.error ? `Registro eliminado; el archivo no se pudo borrar del almacenamiento (${rm.error.message}).` : 'Eliminado definitivamente.');
  });
}

// ---------- 📂 Carpetas ----------
const uuid = (v: string | null) => (v && /^[0-9a-f-]{36}$/i.test(v) ? v : null);
const folderName = (fd: FormData) => {
  const n = reqStr(fd, 'name', 'Nombre de la carpeta').replace(/[\\/<>]/g, '-').replace(/\s+/g, ' ').trim().slice(0, 80);
  if (!n) throw new Error('Escriba el nombre de la carpeta.');
  return n;
};
const dupMsg = (e: { code?: string; message: string }) => (e.code === '23505' ? 'Ya existe una carpeta con ese nombre aquí.' : e.message);

export async function createFolder(fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const ctx = await getContext();
    if (!ctx.orgId) return fail('Sin institución.');
    const color = String(fd.get('color') ?? 'amber');
    const { error } = await ctx.supabase.from('file_folders').insert({
      organization_id: ctx.orgId, owner_id: ctx.user.id, parent_id: uuid(String(fd.get('parent_id') ?? '')), name: folderName(fd),
      color: ['amber', 'blue', 'green', 'red', 'purple', 'slate'].includes(color) ? color : 'amber',
    });
    if (error) return fail(dupMsg(error));
    revalidatePath('/app/archivos');
    return ok('Carpeta creada.');
  });
}

export async function renameFolder(fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const ctx = await getContext();
    const { data, error } = await ctx.supabase.from('file_folders').update({ name: folderName(fd) }).eq('id', id(fd)).eq('owner_id', ctx.user.id).select('id');
    if (error) return fail(dupMsg(error));
    if (!data?.length) return fail('Solo puede cambiar sus propias carpetas.');
    revalidatePath('/app/archivos');
    return ok('Carpeta renombrada.');
  });
}

/** Elimina la carpeta (y sus subcarpetas). Los archivos NO se borran: vuelven a «Mis archivos». */
export async function deleteFolder(fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const ctx = await getContext();
    const { data, error } = await ctx.supabase.from('file_folders').delete().eq('id', id(fd)).eq('owner_id', ctx.user.id).select('id');
    if (error) return fail(error);
    if (!data?.length) return fail('Solo puede eliminar sus propias carpetas.');
    revalidatePath('/app/archivos');
    return ok('Carpeta eliminada. Sus archivos quedaron en «Mis archivos».');
  });
}

export async function moveFile(fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const ctx = await getContext();
    const { error } = await ctx.supabase.rpc('move_user_file', { p_id: id(fd), p_folder: uuid(String(fd.get('folder_id') ?? '')) });
    if (error) return fail(error);
    revalidatePath('/app/archivos');
    return ok('Archivo movido.');
  });
}

export async function renameFile(fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const ctx = await getContext();
    const { error } = await ctx.supabase.rpc('rename_user_file', { p_id: id(fd), p_name: reqStr(fd, 'name', 'Nombre') });
    if (error) return fail(error);
    revalidatePath('/app/archivos');
    return ok('Nombre cambiado.');
  });
}

// ---------- 👤 Quién puede verlo ----------
/** Cambia quién puede ver un archivo: privado, público, personas, grupos, curso, personal o institución. */
export async function setFileAccess(fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const ctx = await getContext();
    const fid = id(fd);
    const vis = reqStr(fd, 'visibility', 'Quién lo puede ver');
    const token = await applyAccess(ctx.supabase, fid, { visibility: vis, section: str(fd, 'section'), users: cleanIds(fd.getAll('users')), groups: cleanIds(fd.getAll('groups')) });
    revalidatePath('/app/archivos'); revalidatePath(`/app/archivos/abrir/${fid}`);
    return ok(token ? `Listo: ahora es público. Cualquiera con el enlace lo puede ver: ${env.siteUrl()}/archivo/${token}` : 'Listo: se actualizó quién lo puede ver.', { token });
  });
}

/** ✉ Envía el archivo a personas nuevas (sin cuenta) por correo: enlace válido 30 días. */
export async function shareByEmail(fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const ctx = await getContext();
    const fid = id(fd);
    const mails = cleanEmails(str(fd, 'emails'));
    if (!mails.length) return fail('Escriba al menos un correo válido.');
    const { data: f } = await ctx.supabase.from('user_files').select('id, name, organization_id').eq('id', fid).maybeSingle();
    if (!f) return fail('Archivo no encontrado.');
    const origin = (await headers()).get('origin') ?? env.siteUrl();
    const r = await sendToEmails(ctx.supabase, { id: f.id, name: f.name, org: f.organization_id }, mails, ctx.user.id, origin, str(fd, 'note'));
    if (!r.sent) return fail(`No se pudo enviar. ${r.errors.join(' · ')}`);
    return ok(`Enviado a ${r.sent} correo(s). Podrán verlo sin cuenta durante 30 días.${r.errors.length ? ` No se pudo a: ${r.errors.join(' · ')}` : ''}`);
  });
}

/** 🔗 Guarda un enlace (YouTube, Drive, cualquier página) como un archivo más. */
export async function addLink(fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const ctx = await getContext();
    if (!ctx.orgId) return fail('Elija una institución.');
    let url = reqStr(fd, 'url', 'Enlace').trim();
    if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
    url = url.replace(/^http:\/\//i, 'https://');
    try { const u = new URL(url); if (!u.hostname.includes('.')) throw new Error(); } catch { return fail('El enlace no es válido. Copie el enlace completo (https://…).'); }
    if (url.length > 2000 || /[\s<>"]/.test(url)) return fail('El enlace no es válido.');
    const name = (str(fd, 'name') ?? new URL(url).hostname).replace(/[<>]/g, '').slice(0, 200);
    const { data, error } = await ctx.supabase.rpc('register_user_link', { p_org: ctx.orgId, p_name: name, p_url: url, p_description: str(fd, 'description') });
    if (error) return fail(/register_user_link/.test(error.message) ? 'Falta instalar la actualización «Archivos compartir» en Actualizar base de datos.' : error);
    const vis = str(fd, 'visibility') ?? 'private';
    const u = cleanIds(fd.getAll('users')), g = cleanIds(fd.getAll('groups'));
    if (vis !== 'private' || u.length || g.length) await applyAccess(ctx.supabase, data as string, { visibility: vis, section: str(fd, 'section'), users: u, groups: g });
    const folder = str(fd, 'folder');
    if (folder && /^[0-9a-f-]{36}$/i.test(folder)) await ctx.supabase.rpc('move_user_file', { p_id: data, p_folder: folder });
    revalidatePath('/app/archivos');
    return ok(`Enlace «${name}» guardado.`);
  });
}

/** Enlace temporal (2 horas) para abrir el archivo en una app: PowerPoint, Word, Excel… */
export async function openLink(fileId: string): Promise<{ url?: string; error?: string }> {
  if (!/^[0-9a-f-]{36}$/i.test(fileId)) return { error: 'Archivo inválido' };
  const ctx = await getContext();
  const { data: f } = await ctx.supabase.from('user_files').select('name').eq('id', fileId).maybeSingle();
  if (!f) return { error: 'Archivo no encontrado' };
  const { data, error } = await ctx.supabase.rpc('create_file_token', { p_file: fileId, p_kind: 'open' });
  if (error) return { error: /create_file_token/.test(error.message) ? 'Falta instalar la actualización «Archivos compartir».' : error.message };
  const origin = (await headers()).get('origin') ?? env.siteUrl();
  return { url: `${origin}/archivo/${data}/raw/${encodeURIComponent(f.name)}` };
}

// ---------- 👥 Grupos de personas ----------
export async function saveGroup(fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const ctx = await getContext();
    if (!ctx.orgId) return fail('Elija una institución.');
    const name = reqStr(fd, 'name', 'Nombre del grupo').replace(/[<>]/g, '').slice(0, 80);
    const members = cleanIds(fd.getAll('members'));
    let gid = str(fd, 'group_id');
    if (gid) {
      const { error } = await ctx.supabase.from('people_groups').update({ name }).eq('id', gid).eq('owner_id', ctx.user.id);
      if (error) return fail(error);
      await ctx.supabase.from('people_group_members').delete().eq('group_id', gid);
    } else {
      const { data, error } = await ctx.supabase.from('people_groups').insert({ organization_id: ctx.orgId, owner_id: ctx.user.id, name }).select('id').single();
      if (error) return fail(/people_groups/.test(error.message) ? 'Falta instalar la actualización «Archivos compartir» en Actualizar base de datos.' : error);
      gid = data.id as string;
    }
    if (members.length) {
      const { error } = await ctx.supabase.from('people_group_members').insert(members.map((u) => ({ group_id: gid, user_id: u })));
      if (error) return fail(error);
    }
    revalidatePath('/app/archivos');
    return ok(`Grupo «${name}» guardado con ${members.length} persona(s).`);
  });
}

export async function deleteGroup(fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const ctx = await getContext();
    const { data, error } = await ctx.supabase.from('people_groups').delete().eq('id', reqStr(fd, 'group_id', 'Grupo')).eq('owner_id', ctx.user.id).select('name');
    if (error) return fail(error);
    if (!data?.length) return fail('Grupo no encontrado.');
    revalidatePath('/app/archivos');
    return ok(`Grupo «${data[0].name}» eliminado (los archivos compartidos con él dejan de verse para sus miembros).`);
  });
}
