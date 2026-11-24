import Link from 'next/link';
import { getContext, can, requirePerm, requireOrg } from '@/lib/context';
import { PageHeader, Card, Empty, Badge } from '@/components/ui';
import { ActionForm } from '@/components/forms';
import { fmtDate, fmtDateTime, fmtMoney } from '@/lib/format';
import { listAttachments } from '@/lib/attachments';
import { AttachmentList } from '@/components/attachment-list';
import { loadPayConfig } from '@/lib/pay-config';
import { FinanceTabs } from '../tabs';
import { reviewTransfer, savePayConfig } from '../actions';

export const metadata = { title: 'Transferencias' };
export const dynamic = 'force-dynamic';

/** 🏦 Transferencias informadas con comprobante: se revisan antes de confirmar el pago. */
export default async function Page({ searchParams }: { searchParams: Promise<{ ver?: string }> }) {
  const { ver = 'pending' } = await searchParams;
  const ctx = await getContext();
  requirePerm(ctx, 'finance.view');
  const orgId = requireOrg(ctx);
  const status = ['pending', 'approved', 'rejected'].includes(ver) ? ver : 'pending';
  const [{ data: rows }, { count: pend }, cfg] = await Promise.all([
    ctx.supabase.from('transfer_proofs').select('*, students(id, first_names, last_names, email)').eq('organization_id', orgId).eq('status', status).order('created_at', { ascending: status !== 'pending' ? false : true }).limit(200),
    ctx.supabase.from('transfer_proofs').select('id', { count: 'exact', head: true }).eq('organization_id', orgId).eq('status', 'pending'),
    loadPayConfig(orgId),
  ]);
  const list = (rows ?? []) as any[];
  const files = await listAttachments(ctx, 'transfer_proof', list.map((r) => r.id));
  const instIds = [...new Set(list.flatMap((r) => r.installment_ids as string[]))];
  const { data: insts } = instIds.length ? await ctx.supabase.from('installment_balances').select('installment_id, number, concept, due_on, outstanding').in('installment_id', instIds) : { data: [] as any[] };
  const instOf = new Map((insts ?? []).map((i: any) => [i.installment_id, i]));
  const canReview = can(ctx, 'finance.create');
  return (
    <>
      <PageHeader title="Finanzas" subtitle="Transferencias con comprobante: revise y confirme. Al confirmar, se registra el pago y la boleta llega por correo." />
      <FinanceTabs current="transferencias" />
      <div className="mb-4 flex flex-wrap gap-2">
        {[['pending', `⏳ Por revisar (${pend ?? 0})`], ['approved', '✓ Confirmadas'], ['rejected', '✕ Rechazadas']].map(([k, l]) => (
          <Link key={k} href={`/app/finanzas/transferencias?ver=${k}`} className={status === k ? 'btn-primary btn-sm' : 'btn-secondary btn-sm'}>{l}</Link>))}
      </div>
      <div className="grid gap-6 xl:grid-cols-3">
        <div className="space-y-4 xl:col-span-2" data-testid="lista-transferencias">
          {!list.length && <Card><Empty>{status === 'pending' ? 'No hay transferencias por revisar. 🎉' : 'Sin registros.'}</Empty></Card>}
          {list.map((t) => (
            <Card key={t.id} title={`${t.students?.first_names} ${t.students?.last_names} · ${fmtMoney(t.amount, t.currency)}`}
              actions={t.status === 'pending' ? <Badge color="amber">⏳ Por revisar</Badge> : t.status === 'approved' ? <Badge color="green">✓ Confirmada</Badge> : <Badge color="red">✕ Rechazada</Badge>}>
              <div data-testid="transferencia-revisar">
                <p className="text-sm text-slate-600">Informada {fmtDateTime(t.created_at)}{t.transferred_on && ` · transferida el ${fmtDate(t.transferred_on)}`}{t.bank && ` · ${t.bank}`}{t.operation && ` · op. ${t.operation}`}</p>
                {t.note && <p className="mt-1 text-sm">💬 {t.note}</p>}
                <ul className="mt-2 text-sm">{(t.installment_ids as string[]).map((id) => { const i = instOf.get(id); return (
                  <li key={id}>• {i ? `Cuota ${i.number}${i.concept ? ` · ${i.concept}` : ''} · vence ${fmtDate(i.due_on)} · saldo ${fmtMoney(i.outstanding, t.currency)}` : 'Cuota'}</li>); })}</ul>
                <div className="mt-2 flex flex-wrap gap-2">{(files[t.id] ?? []).filter((a) => a.mime.startsWith('image/')).map((a) => (
                  <a key={a.id} href={`/api/adjunto/${a.id}`} target="_blank" rel="noopener noreferrer"><img src={`/api/adjunto/${a.id}`} alt="Comprobante" className="max-h-64 rounded-lg border" data-testid="foto-comprobante" /></a>))}</div>
                <AttachmentList items={(files[t.id] ?? []).filter((a) => !a.mime.startsWith('image/'))} />
                {t.status === 'rejected' && <p className="mt-2 text-sm text-red-700">Motivo: {t.reject_reason}</p>}
                {t.payment_id && <Link className="link mt-2 inline-block text-sm" href={`/app/finanzas/boleta/${t.payment_id}`}>🧾 Ver boleta</Link>}
                {t.status === 'pending' && canReview && (
                  <div className="mt-3 flex flex-wrap items-start gap-2 border-t border-slate-100 pt-3">
                    <ActionForm action={reviewTransfer} inline submitLabel={`✓ Confirmar ${fmtMoney(t.amount, t.currency)}`} submitClass="btn-primary" confirm="¿Confirmar que el dinero llegó a la cuenta? Se registrará el pago y se enviará la boleta.">
                      <input type="hidden" name="id" value={t.id} /><input type="hidden" name="decision" value="approve" /></ActionForm>
                    <ActionForm action={reviewTransfer} inline submitLabel="✕ Rechazar" submitClass="btn-secondary">
                      <input type="hidden" name="id" value={t.id} /><input type="hidden" name="decision" value="reject" />
                      <input name="reason" required minLength={3} maxLength={500} className="input" placeholder="Motivo (no llegó, monto distinto…)" data-testid="motivo-rechazo" /></ActionForm>
                  </div>)}
              </div>
            </Card>))}
        </div>
        <Card title="🏦 Datos para pagar" id="datos-pago">
          {(can(ctx, 'finance.admin') || can(ctx, 'settings.admin')) ? (
            <ActionForm action={savePayConfig} submitLabel="Guardar" resetOnSuccess={false}>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="transfer" defaultChecked={cfg.transfer} data-testid="activar-transferencia" /> Aceptar transferencias con comprobante</label>
              <label className="block text-sm"><span className="label">Datos de la cuenta</span>
                <textarea name="bank_info" rows={6} maxLength={1500} defaultValue={cfg.bank_info} className="input w-full" data-testid="datos-cuenta"
                  placeholder={'Banco: …\nTipo de cuenta: Cuenta corriente\nN° de cuenta: …\nRUT: …\nNombre: …\nCorreo: pagos@…'} /></label>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="office" defaultChecked={cfg.office} /> También se puede pagar en la oficina</label>
              <label className="block text-sm"><span className="label">Dirección y horario de la oficina</span>
                <input name="office_info" maxLength={1000} defaultValue={cfg.office_info} className="input w-full" placeholder="Av. … · lunes a viernes 9:00 a 18:00" /></label>
              <p className="text-xs text-slate-500">💳 El pago con tarjeta se activa conectando Mercado Pago, Webpay, Flow, Stripe o Fintoc en «Sitio web → Pagos».</p>
            </ActionForm>) : <p className="whitespace-pre-line text-sm">{cfg.bank_info || 'Sin datos.'}</p>}
        </Card>
      </div>
    </>
  );
}
