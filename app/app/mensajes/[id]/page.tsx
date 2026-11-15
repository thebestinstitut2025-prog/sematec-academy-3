import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getContext } from '@/lib/context';
import { PageHeader, Card } from '@/components/ui';
import { ActionForm, TextArea, EmailCopy } from '@/components/forms';
import { AttachFiles } from '@/components/attach-files';
import { AttachmentList } from '@/components/attachment-list';
import { listAttachments } from '@/lib/attachments';
import { fmtDateTime } from '@/lib/format';
import { sendMessage } from '../actions';

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await getContext();
  const { data: m } = await ctx.supabase.from('messages')
    .select('*').eq('id', id).maybeSingle();
  if (!m) notFound();
  if (m.recipient_id === ctx.user.id && !m.read_at)
    await ctx.supabase.from('messages').update({ read_at: new Date().toISOString() }).eq('id', id);
  const other = m.sender_id === ctx.user.id ? m.recipient_id : m.sender_id;
  const files = await listAttachments(ctx, 'message', [m.id]);
  return (
    <>
      <PageHeader title={m.subject} subtitle={`De ${m.sender_name} para ${m.recipient_name} · ${fmtDateTime(m.created_at)}`} />
      <Link href="/app/mensajes" className="link text-sm">← Volver a mensajes</Link>
      <Card className="mt-4"><p className="whitespace-pre-line text-sm">{m.body}</p>
        {files[m.id]?.length ? <div className="mt-3 border-t border-slate-100 pt-3"><p className="text-xs font-semibold text-slate-500">📎 Archivos adjuntos</p><AttachmentList items={files[m.id]} /></div> : null}</Card>
      <Card title="Responder" className="mt-6">
        <ActionForm action={sendMessage} offline={{ key: 'mensaje', label: 'Respuesta a mensaje' }} submitLabel="Enviar respuesta">
          <input type="hidden" name="recipient_id" value={other} />
          <input type="hidden" name="parent_id" value={m.id} />
          <input type="hidden" name="subject" value={m.subject.startsWith('Re: ') ? m.subject : `Re: ${m.subject}`} />
          <TextArea label="Mensaje" name="body" required rows={4} />
          <AttachFiles org={m.organization_id} />
        <EmailCopy /></ActionForm>
      </Card>
    </>
  );
}
