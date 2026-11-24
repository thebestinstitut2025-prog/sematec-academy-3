'use client';
import { useMemo, useState, useTransition } from 'react';
import { fmtDate, fmtMoney } from '@/lib/format';
import { AttachFiles } from '@/components/attach-files';

const CARDS = ['Visa', 'Mastercard', 'American Express', 'Diners', 'Redcompra', 'Magna', 'Prepago'];
const TRANSFER = '__transfer';

type Inst = { installment_id: string; number: number; concept?: string; due_on: string; outstanding: number | string; currency: string; days_overdue: number };
type Provider = { id: string; label: string; description: string; banks?: { id: string; name: string }[] };
type Result = { ok: boolean; message?: string; error?: string; data?: any };

/** Pagar cuotas en línea con tarjeta de crédito/débito o desde el banco. */
export function PayInstallments({ studentId, items, providers, action, transfer, transferAction, org, office }: {
  studentId: string; items: Inst[]; providers: Provider[]; action: (fd: FormData) => Promise<Result>;
  transfer?: { info: string } | null; transferAction?: (fd: FormData) => Promise<Result>; org?: string; office?: string | null;
}) {
  const [sel, setSel] = useState<string[]>(() => items.filter((i) => i.days_overdue > 0).map((i) => i.installment_id).slice(0, 12)
    .concat(items.some((i) => i.days_overdue > 0) ? [] : items.slice(0, 1).map((i) => i.installment_id)));
  const canTransfer = !!(transfer && transferAction && org);
  const [provider, setProvider] = useState(providers[0]?.id ?? (canTransfer ? TRANSFER : ''));
  const [files, setFiles] = useState<{ ids: string[]; pending: boolean }>({ ids: [], pending: false });
  const [formKey, setFormKey] = useState(0);
  const [res, setRes] = useState<Result | null>(null);
  const [pending, start] = useTransition();
  const total = useMemo(() => items.filter((i) => sel.includes(i.installment_id)).reduce((a, i) => a + Number(i.outstanding), 0), [sel, items]);
  const currency = items[0]?.currency ?? 'CLP';
  const banks = providers.find((p) => p.id === provider)?.banks;
  if (!items.length) return null;
  if (!providers.length && !canTransfer) return <p className="mt-3 rounded-lg bg-slate-50 p-3 text-xs text-slate-600">El pago en línea aún no está habilitado por la institución. Pague en caja{office ? `: ${office}` : ''}.</p>;
  const isTransfer = provider === TRANSFER;

  return (
    <form className="mt-4 space-y-4 border-t border-slate-100 pt-4" onSubmit={(e) => {
      e.preventDefault();
      const fd = new FormData(e.currentTarget);
      setRes(null);
      if (isTransfer && files.pending) { setRes({ ok: false, error: 'Espere a que termine de subir el comprobante.' }); return; }
      start(async () => {
        try {
          if (isTransfer) { const r = await transferAction!(fd); setRes(r); if (r.ok) { setFormKey((k) => k + 1); setFiles({ ids: [], pending: false }); } return; }
          const r = await action(fd); setRes(r);
          if (r.ok && r.data) {
            const red = r.data as { method: 'GET' | 'POST'; url: string; fields?: Record<string, string> };
            if (red.method === 'GET') { window.location.href = red.url; return; }
            const f = document.createElement('form'); f.method = 'POST'; f.action = red.url;
            Object.entries(red.fields ?? {}).forEach(([k, v]) => { const i = document.createElement('input'); i.type = 'hidden'; i.name = k; i.value = v; f.appendChild(i); });
            document.body.appendChild(f); f.submit();
          }
        } catch { setRes({ ok: false, error: 'Sin conexión: no se realizó ningún cobro. Reintente con internet.' }); }
      });
    }}>
      <input type="hidden" name="student_id" value={studentId} />
      <p className="text-sm font-bold">💳 Pagar en línea</p>
      <ul className="space-y-1">
        {items.map((i) => (
          <li key={i.installment_id}>
            <label className="flex cursor-pointer items-center justify-between gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm has-[:checked]:border-brand-600 has-[:checked]:bg-brand-50">
              <span className="flex items-center gap-2">
                <input type="checkbox" name="inst" value={i.installment_id} checked={sel.includes(i.installment_id)}
                  onChange={(e) => setSel((s) => e.target.checked ? [...s, i.installment_id] : s.filter((x) => x !== i.installment_id))} />
                Cuota {i.number}{i.concept ? ` · ${i.concept}` : ''} · vence {fmtDate(i.due_on)}
                {i.days_overdue > 0 && <span className="rounded bg-red-100 px-1.5 text-xs font-semibold text-red-700">vencida</span>}
              </span>
              <b>{fmtMoney(i.outstanding, i.currency)}</b>
            </label>
          </li>))}
      </ul>
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">¿Cómo quiere pagar?</p>
      <div className="grid gap-2 sm:grid-cols-2" data-testid="medios-pago">
        {canTransfer && (
          <label className="flex cursor-pointer items-start gap-2 rounded-xl border border-slate-300 p-3 text-sm has-[:checked]:border-brand-600 has-[:checked]:bg-brand-50">
            <input type="radio" name="provider" value={TRANSFER} checked={isTransfer} onChange={() => setProvider(TRANSFER)} className="mt-1" data-testid="pagar-transferencia" />
            <span><b>🏦 Transferencia bancaria</b><br /><span className="text-xs text-slate-600">Transfiera y suba el comprobante. Finanzas lo confirma y le llega la boleta.</span></span>
          </label>)}
        {providers.map((p) => (
          <label key={p.id} className="flex cursor-pointer items-start gap-2 rounded-xl border border-slate-300 p-3 text-sm has-[:checked]:border-brand-600 has-[:checked]:bg-brand-50">
            <input type="radio" name="provider" value={p.id} checked={provider === p.id} onChange={() => setProvider(p.id)} className="mt-1" />
            <span><b>{p.banks ? '🏦 ' : '💳 '}{p.label}</b><br /><span className="text-xs text-slate-600">{p.description}</span>
              {!p.banks && <span className="mt-1 flex flex-wrap gap-1">{CARDS.map((c) => <span key={c} className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-600">{c}</span>)}</span>}</span>
          </label>))}
      </div>
      {banks && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {banks.map((b) => (
            <label key={b.id} className="flex cursor-pointer items-center justify-center rounded-lg border border-slate-300 px-2 py-2 text-center text-xs font-semibold has-[:checked]:border-brand-600 has-[:checked]:bg-brand-50">
              <input type="radio" name="bank" value={b.id} required className="sr-only" />{b.name}
            </label>))}
        </div>)}
      {isTransfer ? (
        <div className="space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-3" key={formKey} data-testid="form-transferencia">
          {transfer?.info ? <div className="rounded-lg bg-white p-3 text-sm"><p className="mb-1 font-semibold">1️⃣ Transfiera a esta cuenta</p><p className="whitespace-pre-line" data-testid="datos-banco">{transfer.info}</p>
            <p className="mt-1 text-xs text-slate-500">Monto a transferir: <b>{fmtMoney(total, currency)}</b></p></div>
            : <p className="text-sm text-amber-800">La institución aún no publica sus datos bancarios. Consulte en la oficina.</p>}
          <p className="text-sm font-semibold">2️⃣ Cuéntenos su transferencia y suba el comprobante</p>
          <div className="grid gap-2 sm:grid-cols-2">
            <label className="text-sm"><span className="label">Monto transferido</span><input name="amount" inputMode="numeric" required defaultValue={Math.round(total)} key={total} className="input w-full" data-testid="monto-transferencia" /></label>
            <label className="text-sm"><span className="label">Fecha de la transferencia</span><input type="date" name="date" required defaultValue={new Date().toISOString().slice(0, 10)} className="input w-full" /></label>
            <label className="text-sm"><span className="label">Banco de origen</span><input name="bank_from" maxLength={120} className="input w-full" placeholder="Banco Estado, Santander…" /></label>
            <label className="text-sm"><span className="label">N° de operación (opcional)</span><input name="operation" maxLength={80} className="input w-full" /></label>
          </div>
          <AttachFiles org={org!} max={5} label="📎 Comprobante (foto o PDF) — obligatorio" onChange={(ids, p) => setFiles({ ids, pending: p })} />
          <label className="block text-sm"><span className="label">Comentario (opcional)</span><input name="note" maxLength={500} className="input w-full" /></label>
          <button className="btn-primary w-full" disabled={pending || !sel.length || !files.ids.length || files.pending} data-testid="enviar-comprobante">
            {pending ? 'Enviando…' : files.ids.length ? `📤 Enviar comprobante de ${fmtMoney(total, currency)}` : 'Suba el comprobante para enviar'}</button>
          <p className="text-center text-xs text-slate-500">Las cuotas quedan pagadas cuando finanzas confirma la transferencia. Le avisaremos por correo con su boleta.</p>
        </div>
      ) : <>
      <button className="btn-primary w-full" disabled={pending || !sel.length || res?.ok}>
        {pending || res?.ok ? 'Conectando con el pago seguro…' : `Pagar ${fmtMoney(total, currency)}`}
      </button>
      <p className="text-center text-xs text-slate-500">🔒 Los datos de su tarjeta o la clave de su banco se ingresan solo en la página del banco o del medio de pago. Al pagar, la boleta le llega al correo.</p></>}
      {office && <p className="text-center text-xs text-slate-500">🏢 También puede pagar en la oficina: {office}</p>}
      {res && !res.ok && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">✕ {res.error}</p>}
      {res?.ok && isTransfer && <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800" data-testid="transferencia-enviada">✓ {res.message}</p>}
    </form>
  );
}
