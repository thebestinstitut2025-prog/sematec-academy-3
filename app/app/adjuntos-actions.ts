'use server';
import { revalidatePath } from 'next/cache';
import { getContext } from '@/lib/context';
import { fail, guard, ok, reqStr, str, type ActionResult } from '@/lib/actions';
import { attachTo, readAttachmentIds } from '@/lib/attachments';

/** 🗑 Quita un adjunto propio (el archivo sigue en «Mis archivos»). */
export async function detachFile(fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const ctx = await getContext();
    const { error } = await ctx.supabase.rpc('detach_file', { p_id: reqStr(fd, 'id', 'Adjunto') });
    if (error) return fail(error);
    const p = str(fd, 'path'); if (p?.startsWith('/app/')) revalidatePath(p);
    return ok('Archivo quitado.');
  });
}

/** 📎 Entregar archivos de una evaluación con enlace (Google Forms, etc.). */
export async function attachExternalEval(fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const ctx = await getContext();
    const ids = readAttachmentIds(fd);
    if (!Array.isArray(ids)) return fail(ids.error);
    if (!ids.length) return fail('Elija al menos un archivo.');
    const err = await attachTo(ctx, 'external_eval', reqStr(fd, 'evaluation_id', 'Evaluación'), ids);
    if (err) return fail(err);
    const p = str(fd, 'path'); if (p?.startsWith('/app/')) revalidatePath(p);
    return ok(`${ids.length} archivo(s) entregado(s) al profesor.`);
  });
}
