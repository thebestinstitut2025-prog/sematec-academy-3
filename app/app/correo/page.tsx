import { getContext, requireOrg } from '@/lib/context';
import { PageHeader, Card, Empty } from '@/components/ui';
import { ActionForm, Field, TextArea } from '@/components/forms';
import { AttachFiles } from '@/components/attach-files';
import { mailEnabled } from '@/lib/mailer';
import { fmtDateTime } from '@/lib/format';
import { composeMail } from './actions';

export const metadata = { title: 'Correo' };

export default async function Page({ searchParams }: { searchParams: Promise<{ para?: string; asunto?: string }> }) {
  const ctx = await getContext();
  const orgId = requireOrg(ctx);
  const sp = await searchParams;
  const { data: sent } = await ctx.supabase.from('mail_log').select('id, created_at, to_email, subject, status, error, resent_at')
    .eq('sent_by', ctx.user.id).eq('kind', 'correo').order('created_at', { ascending: false }).limit(100);
  return (
    <>
      <PageHeader title="✉ Correo" subtitle="Escriba correos a cualquier dirección, dentro o fuera de la plataforma" />
      {!mailEnabled() && <p className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-800">⚠ El correo de la plataforma no está configurado: avise a la administración.</p>}
      <Card title="Escribir correo" className="mb-6">
        <ActionForm action={composeMail} submitLabel="📨 Enviar correo">
          <Field label="Para (uno o varios correos, separados por coma)" name="to" required defaultValue={sp.para ?? ''} placeholder="persona@gmail.com, otra@empresa.cl" data-testid="correo-para" />
          <Field label="Asunto" name="subject" required defaultValue={sp.asunto ?? ''} />
          <TextArea label="Mensaje" name="body" required rows={8} />
          <AttachFiles org={orgId} max={10} label="📎 Adjuntar archivos (hasta 20 MB en total)" />
          <p className="text-xs text-slate-500">El correo sale de la cuenta de la institución con su nombre («{ctx.profile?.full_name ?? 'Usted'} vía …»). Si le responden, la respuesta llega a <b>{ctx.user.email}</b>.</p>
        </ActionForm>
      </Card>
      <Card title={`📤 Mis correos enviados (${sent?.length ?? 0})`}>
        {sent?.length ? (
          <div className="overflow-x-auto"><table className="table text-sm" data-testid="mis-correos"><thead><tr><th>Fecha</th><th>Para</th><th>Asunto</th><th>Estado</th></tr></thead>
            <tbody>{sent.map((m: any) => (
              <tr key={m.id}><td className="whitespace-nowrap">{fmtDateTime(m.created_at)}</td><td>{m.to_email}</td><td>{m.subject}</td>
                <td>{m.status === 'sent' ? <span className="text-emerald-700">✓ {m.resent_at ? 'Reenviado' : 'Enviado'}</span>
                  : <span className="text-amber-700" title={m.error ?? ''}>⏳ Pendiente (se enviará cuando el correo funcione)</span>}</td></tr>))}</tbody></table></div>
        ) : <Empty>Todavía no ha enviado correos.</Empty>}
      </Card>
    </>
  );
}
