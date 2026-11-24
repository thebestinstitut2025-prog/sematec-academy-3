'use server';
import { revalidatePath } from 'next/cache';
import { emailReceipt } from '@/lib/receipt-access';
import { getContext, can } from '@/lib/context';
import { createAdminClient } from '@/lib/supabase/admin';
import { mailEnabled, mailLayout, sendMail } from '@/lib/mailer';
import { env } from '@/lib/env';
import { fmtMoney } from '@/lib/format';
import { PAY_KEY } from '@/lib/pay-config';
import { fail, guard, num, ok, reqStr, str, ValidationError, type ActionResult } from '@/lib/actions';

const escapeHtml = (x: string) => x.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const refresh = () => revalidatePath('/app/finanzas', 'layout');

export async function createCharge(fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const ctx = await getContext();
    const { error } = await ctx.supabase.rpc('create_charge', {
      p_student: reqStr(fd, 'student_id', 'Estudiante'), p_concept: reqStr(fd, 'concept', 'Concepto'), p_gross: num(fd, 'amount'),
      p_currency: reqStr(fd, 'currency', 'Moneda').toUpperCase(), p_installments: num(fd, 'installments') ?? 1,
      p_first_due: reqStr(fd, 'first_due', 'Primer vencimiento'), p_benefit: str(fd, 'benefit_id'), p_description: str(fd, 'description'),
    });
    if (error) return fail(error);
    refresh();
    return ok('Cargo y cuotas generados.');
  });
}

export async function cancelCharge(fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const ctx = await getContext();
    const { error } = await ctx.supabase.rpc('cancel_charge', { p_charge: reqStr(fd, 'id', 'id'), p_reason: reqStr(fd, 'reason', 'Motivo') });
    if (error) return fail(error);
    refresh();
    return ok('Cargo anulado.');
  });
}

export async function registerPayment(fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const ctx = await getContext();
    const { data, error } = await ctx.supabase.rpc('register_payment', {
      p_student: reqStr(fd, 'student_id', 'Estudiante'), p_amount: num(fd, 'amount'), p_currency: reqStr(fd, 'currency', 'Moneda').toUpperCase(),
      p_method: reqStr(fd, 'method', 'Medio de pago'), p_provider: str(fd, 'provider'), p_external_reference: str(fd, 'external_reference'),
      p_notes: str(fd, 'notes'),
    });
    if (error) return fail(error);
    const { data: p } = await ctx.supabase.from('payments').select('receipt_number').eq('id', data).single();
    refresh();
    // 🧾 La boleta le llega sola al estudiante por correo (si el correo está configurado y no se desmarcó)
    const mail = fd.has('send_receipt') && !fd.getAll('send_receipt').includes('on') ? null : await emailReceipt(String(data));
    return ok(`Pago registrado. Comprobante N° ${p?.receipt_number} (boleta)${mail ? (mail.ok ? ` ${mail.text}` : ` (no se envió por correo: ${mail.text})`) : ''}. En la lista, toque 🧾 para verla, descargarla o reenviarla.`);
  });
}

export async function voidPayment(fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const ctx = await getContext();
    const { error } = await ctx.supabase.rpc('void_payment', { p_payment: reqStr(fd, 'id', 'id'), p_reason: reqStr(fd, 'reason', 'Motivo') });
    if (error) return fail(error);
    refresh();
    return ok('Pago anulado; se generaron los asientos de reverso.');
  });
}

export async function refundPayment(fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const ctx = await getContext();
    const { error } = await ctx.supabase.rpc('refund_payment', {
      p_payment: reqStr(fd, 'id', 'id'), p_amount: num(fd, 'amount'), p_method: reqStr(fd, 'method', 'Medio'), p_reason: reqStr(fd, 'reason', 'Motivo'),
    });
    if (error) return fail(error);
    refresh();
    return ok('Reembolso registrado.');
  });
}

export async function createBenefit(fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const ctx = await getContext();
    const kind = reqStr(fd, 'kind', 'Tipo');
    const value = num(fd, 'value');
    const { error } = await ctx.supabase.from('benefits').insert({
      organization_id: ctx.orgId, code: reqStr(fd, 'code', 'Código').toUpperCase(), name: reqStr(fd, 'name', 'Nombre'),
      percent_off: kind === 'percent' ? value : null, amount_off: kind === 'amount' ? value : null,
    });
    if (error) return fail(error);
    refresh();
    return ok('Beneficio creado.');
  });
}

function expenseRow(fd: FormData) {
  const amount = num(fd, 'amount');
  if (!amount || amount <= 0) throw new ValidationError('Ingrese un monto mayor a cero.');
  return {
    spent_on: reqStr(fd, 'spent_on', 'Fecha'), category: reqStr(fd, 'category', 'Categoría'), description: reqStr(fd, 'description', 'Descripción'),
    supplier: str(fd, 'supplier'), document_number: str(fd, 'document_number'), amount, currency: reqStr(fd, 'currency', 'Moneda').toUpperCase(),
    program_id: str(fd, 'program_id'), section_id: str(fd, 'section_id'), campus_id: str(fd, 'campus_id'), notes: str(fd, 'notes'),
  };
}

/** 💸 Registra un gasto (sueldos, arriendo, materiales…), opcionalmente asociado a un programa o sección. */
export async function createExpense(fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const ctx = await getContext();
    if (!ctx.orgId) return fail('Seleccione una institución.');
    const { error } = await ctx.supabase.from('expenses').insert({ ...expenseRow(fd), organization_id: ctx.orgId });
    if (error) return fail(error);
    refresh();
    return ok('Gasto registrado.');
  });
}

export async function updateExpense(fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const ctx = await getContext();
    const { error, count } = await ctx.supabase.from('expenses').update(expenseRow(fd), { count: 'exact' }).eq('id', reqStr(fd, 'id', 'id'));
    if (error) return fail(error);
    if (!count) return fail('No tiene permiso para editar gastos.');
    refresh();
    return ok('Gasto actualizado.');
  });
}

export async function deleteExpense(fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const ctx = await getContext();
    const { error, count } = await ctx.supabase.from('expenses').delete({ count: 'exact' }).eq('id', reqStr(fd, 'id', 'id'));
    if (error) return fail(error);
    if (!count) return fail('No tiene permiso para eliminar gastos.');
    refresh();
    return ok('Gasto eliminado (puede deshacerlo con «↶ Deshacer»).');
  });
}

/** 🏦 Revisar una transferencia informada: confirmar (registra el pago y envía la boleta) o rechazar con motivo. */
export async function reviewTransfer(fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const ctx = await getContext();
    const id = reqStr(fd, 'id', 'comprobante');
    const approve = fd.get('decision') === 'approve';
    const reason = str(fd, 'reason');
    const { data, error } = await ctx.supabase.rpc('review_transfer_proof', { p_proof: id, p_approve: approve, p_reason: reason });
    if (error) return fail(error);
    refresh(); revalidatePath('/app/pagar');
    const admin = createAdminClient();
    const { data: t } = await admin.from('transfer_proofs').select('amount, currency, created_by, student_id, students(email, first_names), profiles:created_by(email)').eq('id', id).single();
    const payer = ((t as any)?.profiles?.email as string | undefined)?.toLowerCase();
    if (approve) {
      const mail = await emailReceipt(String(data));
      // Si lo informó el apoderado, también le llega a él
      if (payer && payer !== String((t as any)?.students?.email ?? '').toLowerCase()) await emailReceipt(String(data), payer);
      const { data: p } = await ctx.supabase.from('payments').select('receipt_number').eq('id', data).single();
      return ok(`Transferencia confirmada ✓. Pago registrado con boleta N° ${p?.receipt_number}${mail.ok ? ` (${mail.text})` : ` (boleta no enviada por correo: ${mail.text})`}.`);
    }
    if (payer && mailEnabled()) {
      const name = (t as any)?.students?.first_names ?? '';
      await sendMail(payer, 'Transferencia no confirmada', mailLayout('Pagos', 'Su transferencia no pudo confirmarse',
        `<p>Hola:</p><p>Revisamos la transferencia informada${name ? ` para ${name}` : ''} por <b>${fmtMoney(Number(t?.amount), String(t?.currency))}</b> y no pudimos confirmarla.</p><p><b>Motivo:</b> ${escapeHtml(reason ?? '')}</p><p>Puede volver a informarla con el comprobante correcto en «Pagar».</p>`,
        { href: `${env.siteUrl()}/app/pagar`, label: 'Ir a Pagar' }), `Su transferencia no pudo confirmarse. Motivo: ${reason}`).catch(() => {});
    }
    return ok('Transferencia rechazada. Se avisó por correo a quien la informó.');
  });
}

/** Datos para transferir y pagar en oficina (los ve quien debe pagar). */
export async function savePayConfig(fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const ctx = await getContext();
    if (!(can(ctx, 'finance.admin') || can(ctx, 'settings.admin'))) return fail('No tiene permisos (finance.admin).');
    const value = { transfer: fd.get('transfer') === 'on', bank_info: (str(fd, 'bank_info') ?? '').slice(0, 1500), office: fd.get('office') === 'on', office_info: (str(fd, 'office_info') ?? '').slice(0, 1000) };
    if (value.transfer && value.bank_info.length < 10) return fail('Escriba los datos de la cuenta: banco, tipo de cuenta, número, RUT, nombre y correo.');
    const { data: ex } = await ctx.supabase.from('organization_settings').select('id').eq('organization_id', ctx.orgId!).eq('key', PAY_KEY).maybeSingle();
    const { error } = ex
      ? await ctx.supabase.from('organization_settings').update({ value, updated_by: ctx.user.id }).eq('id', ex.id)
      : await ctx.supabase.from('organization_settings').insert({ organization_id: ctx.orgId, key: PAY_KEY, value, description: 'Datos de pago', updated_by: ctx.user.id });
    if (error) return fail(error);
    refresh(); revalidatePath('/app/pagar');
    return ok('Datos de pago guardados. Ya aparecen en «Pagar» para estudiantes y apoderados.');
  });
}
