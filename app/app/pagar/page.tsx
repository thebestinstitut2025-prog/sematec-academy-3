import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getContext } from '@/lib/context';
import { PageHeader, Card, Badge, Empty, Stat } from '@/components/ui';
import { PayInstallments } from '@/components/pay-installments';
import { availableProviders } from '@/lib/payments';
import { myStudents } from '@/lib/receipt-access';
import { loadPayConfig } from '@/lib/pay-config';
import { listAttachments } from '@/lib/attachments';
import { AttachmentList } from '@/components/attachment-list';
import { fmtDate, fmtDateTime, fmtMoney } from '@/lib/format';
import { payInstallments, submitTransfer } from './actions';

export const metadata = { title: 'Pagar' };
export const dynamic = 'force-dynamic';

/** 💳 Todo lo que debe pagar (el estudiante o los pupilos del apoderado): tarjeta, banco o transferencia con comprobante. */
export default async function Page({ searchParams }: { searchParams: Promise<{ pago?: string }> }) {
  const { pago } = await searchParams;
  const ctx = await getContext();
  const studs = await myStudents(ctx.supabase, ctx.user.id);
  if (!studs.length) redirect('/app');
  const cfg = await loadPayConfig(ctx.orgId);
  const data = await Promise.all(studs.map(async (s) => {
    const { data: inst } = s.mine
      ? await ctx.supabase.from('installment_balances').select('installment_id, number, concept, due_on, outstanding, currency, days_overdue')
          .eq('student_id', s.id).gt('outstanding', 0).eq('cancelled', false).order('due_on').limit(60)
      : await ctx.supabase.rpc('guardian_installments', { p_student: s.id });
    const { data: proofs } = await ctx.supabase.from('transfer_proofs').select('*').eq('student_id', s.id).order('created_at', { ascending: false }).limit(10);
    return { s, inst: ((inst ?? []) as any[]).map((i) => ({ ...i, outstanding: Number(i.outstanding), days_overdue: Number(i.days_overdue ?? 0) })), proofs: (proofs ?? []) as any[] };
  }));
  const files = await listAttachments(ctx, 'transfer_proof', data.flatMap((d) => d.proofs.map((p) => p.id)));
  const all = data.flatMap((d) => d.inst);
  const cur = all[0]?.currency ?? 'CLP';
  const total = all.reduce((a, i) => a + i.outstanding, 0);
  const overdue = all.filter((i) => i.days_overdue > 0).reduce((a, i) => a + i.outstanding, 0);
  const pendingProofs = data.flatMap((d) => d.proofs).filter((p) => p.status === 'pending');
  return (
    <>
      <PageHeader title="💳 Pagar" subtitle="Todo lo que tiene pendiente: pague con tarjeta (débito, crédito o prepago), desde su banco o por transferencia subiendo el comprobante."
        actions={<Link className="btn-secondary" href="/app/boletas">🧾 Mis boletas</Link>} />
      {pago === 'ok' && <p className="mb-4 rounded-xl bg-emerald-50 p-3 text-sm text-emerald-800">✓ Pago recibido. Su boleta llegará a su correo y también está en «Mis boletas».</p>}
      <div className="mb-6 grid gap-3 sm:grid-cols-3" data-testid="resumen-deuda">
        <Stat label="Total pendiente" value={fmtMoney(total, cur)} />
        <Stat label="Vencido" value={fmtMoney(overdue, cur)} hint={overdue > 0 ? '⚠ Pague lo antes posible' : 'Al día ✓'} />
        <Stat label="Transferencias en revisión" value={pendingProofs.length} hint={pendingProofs.length ? 'Finanzas las está revisando' : undefined} />
      </div>
      <div className="space-y-6">
        {data.map(({ s, inst, proofs }) => (
          <Card key={s.id} title={`${s.name}${s.mine ? ' (yo)' : ''}`} actions={inst.some((i) => i.days_overdue > 0) ? <Badge color="red">Con deuda vencida</Badge> : inst.length ? <Badge color="amber">Pendiente</Badge> : <Badge color="green">Al día ✓</Badge>}>
            {inst.length === 0 ? <Empty>No tiene cuotas pendientes. ¡Gracias por estar al día!</Empty> : (
              <PayInstallments studentId={s.id} items={inst} providers={availableProviders(inst[0].currency)} action={payInstallments}
                transfer={cfg.transfer ? { info: cfg.bank_info } : null} transferAction={submitTransfer} org={ctx.orgId ?? undefined} office={cfg.office ? cfg.office_info || 'en caja, en horario de atención' : null} />)}
            {proofs.length > 0 && (
              <div className="mt-4 border-t border-slate-100 pt-3" data-testid="mis-transferencias">
                <p className="mb-2 text-sm font-bold">🏦 Mis transferencias informadas</p>
                <ul className="space-y-2">{proofs.map((p) => (
                  <li key={p.id} className="rounded-lg border border-slate-200 p-2 text-sm" data-testid="transferencia">
                    <div className="flex flex-wrap items-center gap-2"><b>{fmtMoney(p.amount, p.currency)}</b><span className="text-xs text-slate-500">informada {fmtDateTime(p.created_at)}{p.transferred_on ? ` · transferida ${fmtDate(p.transferred_on)}` : ''}</span>
                      {p.status === 'pending' ? <Badge color="amber">⏳ En revisión</Badge> : p.status === 'approved' ? <Badge color="green">✓ Confirmada</Badge> : <Badge color="red">✕ Rechazada</Badge>}
                      {p.payment_id && <Link className="link ml-auto text-xs" href={`/app/finanzas/boleta/${p.payment_id}`}>🧾 Ver boleta</Link>}</div>
                    {p.status === 'rejected' && <p className="mt-1 text-xs text-red-700">Motivo: {p.reject_reason}. Puede volver a informarla con el comprobante correcto.</p>}
                    <AttachmentList items={files[p.id]} />
                  </li>))}</ul>
              </div>)}
          </Card>))}
      </div>
    </>
  );
}
