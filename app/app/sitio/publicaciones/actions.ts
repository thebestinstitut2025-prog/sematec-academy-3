'use server';
import { revalidatePath } from 'next/cache';
import { getContext, requirePerm } from '@/lib/context';
import { fail, guard, ok, reqStr, str, type ActionResult } from '@/lib/actions';
import { readAttachmentIds } from '@/lib/attachments';
import { POST_KINDS } from '@/lib/site-posts';

const refresh = () => { revalidatePath('/app/sitio/publicaciones'); revalidatePath('/publicaciones'); revalidatePath('/'); };

function fields(fd: FormData) {
  const kind = str(fd, 'kind') ?? 'noticia';
  if (!POST_KINDS[kind]) throw new Error('Tipo no válido.');
  const video = (str(fd, 'video_url') ?? '').trim();
  if (video && !/^https:\/\//i.test(video)) throw new Error('El enlace del video debe empezar con https://');
  const when = str(fd, 'published_at');
  return {
    kind, title: reqStr(fd, 'title', 'Título').slice(0, 160), body: (str(fd, 'body') ?? '').slice(0, 20000) || null,
    video_url: video || null, published: fd.get('published') === 'on', pinned: fd.get('pinned') === 'on',
    ...(when ? { published_at: new Date(when).toISOString() } : {}),
  };
}

async function addMedia(ctx: Awaited<ReturnType<typeof getContext>>, post: string, org: string, ids: string[]) {
  if (!ids.length) return null;
  const { count } = await ctx.supabase.from('site_post_media').select('id', { count: 'exact', head: true }).eq('post_id', post);
  const { error } = await ctx.supabase.from('site_post_media').insert(ids.map((file_id, i) => ({ organization_id: org, post_id: post, file_id, position: (count ?? 0) + i })));
  return error ? error.message : null;
}

/** 📰 Nueva publicación: noticia, fotos, video, mensaje o evento. */
export async function createPost(fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const ctx = await getContext(); requirePerm(ctx, 'settings.admin');
    const ids = readAttachmentIds(fd); if (!Array.isArray(ids)) return fail(ids.error);
    let f; try { f = fields(fd); } catch (e) { return fail((e as Error).message); }
    if (!f.body && !ids.length && !f.video_url) return fail('Agregue un texto, fotos, un video o un enlace de video.');
    const { data, error } = await ctx.supabase.from('site_posts').insert({ ...f, organization_id: ctx.orgId! }).select('id').single();
    if (error) return fail(/site_posts/.test(error.message) ? 'Falta instalar la actualización «Publicaciones sitio» en Actualizar base de datos.' : error);
    const e2 = await addMedia(ctx, data.id, ctx.orgId!, ids);
    refresh();
    if (e2) return fail(`La publicación se creó, pero los archivos no se agregaron: ${e2}`);
    return ok(f.published ? 'Publicada: ya aparece en el sitio web.' : 'Guardada como borrador (no visible en el sitio).');
  });
}

/** ✏ Editar una publicación (y agregar más fotos o videos). */
export async function updatePost(fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const ctx = await getContext(); requirePerm(ctx, 'settings.admin');
    const id = reqStr(fd, 'id', 'Publicación');
    const ids = readAttachmentIds(fd); if (!Array.isArray(ids)) return fail(ids.error);
    let f; try { f = fields(fd); } catch (e) { return fail((e as Error).message); }
    const { error, count } = await ctx.supabase.from('site_posts').update(f, { count: 'exact' }).eq('id', id);
    if (error) return fail(error); if (!count) return fail('Publicación no encontrada.');
    const e2 = await addMedia(ctx, id, ctx.orgId!, ids);
    refresh();
    return e2 ? fail(`Cambios guardados, pero los archivos no: ${e2}`) : ok('Publicación actualizada.');
  });
}

/** 👁 Publicar / ocultar · 📌 fijar arriba. */
export async function togglePost(fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const ctx = await getContext(); requirePerm(ctx, 'settings.admin');
    const id = reqStr(fd, 'id', 'Publicación'); const what = str(fd, 'what');
    const patch = what === 'pin' ? { pinned: fd.get('value') === '1' } : { published: fd.get('value') === '1' };
    const { error } = await ctx.supabase.from('site_posts').update(patch).eq('id', id);
    if (error) return fail(error);
    refresh();
    return ok(what === 'pin' ? (patch as { pinned: boolean }).pinned ? 'Fijada arriba.' : 'Ya no está fijada.' : (patch as { published: boolean }).published ? 'Publicada en el sitio.' : 'Oculta del sitio.');
  });
}

/** 🗑 Eliminar una publicación (las fotos y videos siguen en «Mis archivos»). */
export async function deletePost(fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const ctx = await getContext(); requirePerm(ctx, 'settings.admin');
    const { error, count } = await ctx.supabase.from('site_posts').delete({ count: 'exact' }).eq('id', reqStr(fd, 'id', 'Publicación'));
    if (error) return fail(error); if (!count) return fail('Publicación no encontrada.');
    refresh();
    return ok('Publicación eliminada del sitio.');
  });
}

/** Quitar una foto o video de la publicación. */
export async function removePostMedia(fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const ctx = await getContext(); requirePerm(ctx, 'settings.admin');
    const { error } = await ctx.supabase.from('site_post_media').delete().eq('id', reqStr(fd, 'id', 'Archivo'));
    if (error) return fail(error);
    refresh();
    return ok('Archivo quitado de la publicación.');
  });
}
