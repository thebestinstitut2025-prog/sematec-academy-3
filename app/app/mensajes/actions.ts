'use server';
import { revalidatePath } from 'next/cache';
import { getContext } from '@/lib/context';
import { fail, guard, ok, reqStr, str, type ActionResult } from '@/lib/actions';
import { mailSummary, nameOf, noticeToUsers } from '@/lib/notify';
import { attachTo, readAttachmentIds } from '@/lib/attachments';

export async function sendMessage(fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const ctx = await getContext();
    const to = reqStr(fd, 'recipient_id', 'Destinatario'); const subject = reqStr(fd, 'subject', 'Asunto'); const body = reqStr(fd, 'body', 'Mensaje');
    const ids = readAttachmentIds(fd);
    if (!Array.isArray(ids)) return fail(ids.error);
    const { data, error } = await ctx.supabase.from('messages').insert({
      organization_id: ctx.orgId, recipient_id: to, parent_id: str(fd, 'parent_id'), subject, body,
    }).select('id').single();
    if (error) return fail(error.code === '42501' ? 'No puede enviar mensajes a esa persona.' : error);
    const attErr = await attachTo(ctx, 'message', data.id, ids);
    let mail = attErr ? ` ⚠ Los archivos no se adjuntaron: ${attErr}` : ids.length ? ` Con ${ids.length} archivo(s).` : '';
    if (fd.get('send_email') === 'on') {
      const from = await nameOf(ctx.user.id);
      mail += mailSummary(await noticeToUsers([to], { org: ctx.orgId, kind: 'mensaje', by: ctx.user.id, subject: `mensaje de ${from}: ${subject}`,
        title: subject, text: `${from} le escribió:\n\n${body}${ids.length ? `\n\n📎 ${ids.length} archivo(s) adjunto(s): ábralos en la plataforma.` : ''}`, link: { path: `/app/mensajes/${data.id}`, label: 'Responder en la plataforma' } }));
    }
    revalidatePath('/app/mensajes');
    return ok(`Mensaje enviado.${mail}`);
  });
}
