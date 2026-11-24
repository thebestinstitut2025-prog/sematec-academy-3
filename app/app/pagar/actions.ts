'use server';
import { getContext } from '@/lib/context';
import { explain, type ActionResult } from '@/lib/actions';
import { startPayment } from '@/lib/payments';
import { createAdminClient } from '@/lib/supabase/admin';
import type { ProviderId } from '@/lib/payments/types';
import { readAttachmentIds } from '@/lib/attachments';
import { revalidatePath } from 'next/cache';

/** Pago en línea de cuotas (estudiante o apoderado): crea el pedido y redirige al pago seguro. */
export async function payInstallments(fd: FormData): Promise<ActionResult> {
  const ctx = await getContext();
  const provider = String(fd.get('provider') ?? '') as ProviderId;
  const ids = fd.getAll('inst').map(String).filter((x) => /^[0-9a-f-]{36}$/.test(x));
  if (!ids.length) return { ok: false, error: 'Marque las cuotas que desea pagar.' };
  const { data, error } = await ctx.supabase.rpc('create_installments_order', {
    p_student: String(fd.get('student_id') ?? ''), p_installments: ids, p_provider: provider,
  });
  if (error) return { ok: false, error: explain(error) };
  const o = data as { order_id: string; order_number: number; amount: number; currency: string; title: string };
  try {
    const start = await startPayment(provider, {
      id: o.order_id, number: o.order_number, amount: Number(o.amount), currency: o.currency, title: o.title,
      email: ctx.user.email ?? '', name: ctx.profile?.full_name ?? '', bank: String(fd.get('bank') ?? '') || undefined,
    });
    return { ok: true, message: 'Redirigiendo al pago seguro…', data: start.redirect };
  } catch (e) {
    console.error(e);
    await createAdminClient().rpc('mark_order_result', { p_order: o.order_id, p_provider: provider, p_reference: null, p_paid: false, p_amount: 0, p_currency: o.currency, p_status: 'start_error', p_payload: { error: String(e) } });
    return { ok: false, error: 'No fue posible conectar con el medio de pago. No se realizó ningún cobro; intente nuevamente o elija otro medio.' };
  }
}

/** 🏦 Informar una transferencia con su comprobante: queda «en revisión» hasta que finanzas la confirme. */
export async function submitTransfer(fd: FormData): Promise<ActionResult> {
  const ctx = await getContext();
  const ids = fd.getAll('inst').map(String).filter((x) => /^[0-9a-f-]{36}$/.test(x));
  if (!ids.length) return { ok: false, error: 'Marque las cuotas que pagó.' };
  const files = readAttachmentIds(fd);
  if (!Array.isArray(files)) return { ok: false, error: files.error };
  if (!files.length) return { ok: false, error: 'Suba la foto o el PDF del comprobante antes de enviar.' };
  const amount = Number(String(fd.get('amount') ?? '').replace(/\./g, '').replace(',', '.'));
  const date = String(fd.get('date') ?? '');
  const { error } = await ctx.supabase.rpc('submit_transfer_proof', {
    p_student: String(fd.get('student_id') ?? ''), p_installments: ids, p_amount: Number.isFinite(amount) ? amount : null,
    p_bank: String(fd.get('bank_from') ?? '').slice(0, 120), p_operation: String(fd.get('operation') ?? '').slice(0, 80),
    p_date: /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null, p_note: String(fd.get('note') ?? '').slice(0, 1000), p_files: files,
  });
  if (error) return { ok: false, error: explain(error) };
  revalidatePath('/app', 'layout');
  return { ok: true, message: 'Comprobante enviado ✓. Finanzas lo revisará y, al confirmarlo, las cuotas quedarán pagadas y le llegará la boleta por correo.' };
}
