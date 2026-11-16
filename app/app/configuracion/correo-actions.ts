'use server';
import { can, getContext } from '@/lib/context';
import { mailEnabled, mailLayout, sendMail } from '@/lib/mailer';
import { env } from '@/lib/env';
import { fail, guard, ok, type ActionResult } from '@/lib/actions';

/** ✉ Envía un correo de prueba al propietario y muestra el error exacto si falla. */
/** 🔑 Prueba real de «¿Olvidó su contraseña?» con la cuenta de quien la ejecuta: muestra la causa exacta si falla. */
export async function testRecoveryMail(): Promise<ActionResult> {
  return guard(async () => {
    const ctx = await getContext();
    if (!ctx.isOwner && !ctx.isPlatformAdmin && !can(ctx, 'settings.admin')) return fail('Solo la administración puede probar el correo.');
    const to = ctx.user.email ?? '';
    if (!mailEnabled()) return fail('El correo de la plataforma no está configurado: en Vercel agregue SMTP_USER (su Gmail) y SMTP_PASS (contraseña de aplicación) y haga «Redeploy».');
    try {
      const { sendRecoveryLink } = await import('@/lib/recovery');
      const r = await sendRecoveryLink(to);
      if (r === 'sent') return ok(`Funciona: se envió un enlace de recuperación a ${to}. Revise su bandeja (y «Spam»). Si lo usa, cambiará su contraseña.`);
      return fail(r === 'no_account' ? 'No se encontró su cuenta por correo: revise que la actualización de base de datos «Recuperar todos correos» esté instalada.' : 'Su cuenta no está activa.');
    } catch (e) { return fail((e as Error).message); }
  });
}

export async function sendTestMail(fd?: FormData): Promise<ActionResult> {
  try {
    const ctx = await getContext();
    if (!ctx.isOwner && !ctx.isPlatformAdmin) return { ok: false, error: 'Solo el propietario puede probar el correo.' };
    const custom = String(fd?.get('to') ?? '').trim().toLowerCase();
    const to = custom || (ctx.user.email ?? '');
    if (!to) return { ok: false, error: 'Su cuenta no tiene correo.' };
    await sendMail(to, 'Prueba de correo de la plataforma',
      mailLayout('SEMATEC ACADEMY', '✓ El correo funciona', `<p>Este es un correo de prueba. Los enlaces de los correos apuntan a <b>${env.siteUrl()}</b>.</p>`),
      `El correo funciona. Los enlaces apuntan a ${env.siteUrl()}.`, undefined, { org: ctx.orgId, kind: 'prueba', by: ctx.user.id });
    return { ok: true, message: `Correo de prueba enviado a ${to}. Revise su bandeja (y «Spam»).` };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

/** 🩺 ¿Por qué esta persona no puede recuperar su contraseña? Muestra la causa exacta (y, si se pide, envía el enlace). */
export async function diagnoseRecovery(fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const ctx = await getContext();
    if (!ctx.isOwner && !ctx.isPlatformAdmin && !can(ctx, 'settings.admin') && !can(ctx, 'users.edit')) return fail('Solo la administración puede revisar esto.');
    const id = String(fd.get('identifier') ?? '').trim().slice(0, 254);
    if (id.length < 5) return fail('Escriba el correo o el RUT de la persona.');
    const { createAdminClient } = await import('@/lib/supabase/admin');
    const admin = createAdminClient();
    const lines: string[] = [];
    const mailOn = mailEnabled();
    lines.push(mailOn ? '📧 Correo de la plataforma: configurado.' : '✕ El correo de la plataforma NO está configurado (SMTP_USER / SMTP_PASS en Vercel): ningún enlace puede llegar.');
    const { data: acc, error: e1 } = await admin.rpc('find_account', { p_identifier: id });
    if (e1) return fail(`Falta instalar actualizaciones de base de datos («Recuperar todos correos»): ${e1.message}`);
    const a = (acc as { user_id: string; email: string; status: string; login_email: string; send_to: string; organization_id: string | null }[] | null)?.[0];
    if (a) {
      const { canRecover } = await import('@/lib/recovery');
      const okRec = await canRecover(a.user_id);
      lines.push(`✓ Tiene cuenta: entra con ${a.login_email ?? a.email}.`);
      lines.push(okRec ? `✓ La cuenta está activa: el enlace se envía a ${a.send_to ?? a.email}.` : `✕ La cuenta está «${a.status}»: no puede recuperar. Reactívela en Usuarios.`);
      if (!a.organization_id) lines.push('⚠ La cuenta no tiene acceso activo a ninguna institución (rol): al entrar no verá nada. Dele su rol en Usuarios.');
    } else {
      const { data: f, error: e2 } = await admin.rpc('find_unlinked_person', { p_identifier: id });
      const p = (f as { kind: string; full_name: string; email: string }[] | null)?.[0];
      if (e2) lines.push('⚠ Falta instalar la actualización «Recuperar fichas sin cuenta».');
      else if (p) lines.push(`✓ No tiene cuenta, pero su ficha de ${p.kind === 'teacher' ? 'profesor' : 'estudiante'} (${p.full_name}) tiene el correo ${p.email}: al pedir «¿Olvidó su contraseña?» se crea su cuenta y le llega el enlace.`);
      else {
        const q = id.includes('@') ? id.toLowerCase() : null;
        const { data: inact } = q ? await admin.from('students').select('status').ilike('email', q).limit(1) : { data: null };
        lines.push(inact?.length ? `✕ Su ficha de estudiante está «${inact[0].status}» (no activa): actívela en Estudiantes.`
          : '✕ Ese correo o RUT no está registrado en ninguna cuenta ni ficha activa. Revise que esté bien escrito en la ficha del estudiante.');
      }
    }
    const to = id.includes('@') ? id.toLowerCase() : (a?.send_to ?? null);
    if (to) {
      const { data: logs } = await admin.from('mail_log').select('status, error, kind, created_at').ilike('to_email', to).order('created_at', { ascending: false }).limit(3);
      for (const l of logs ?? []) lines.push(`✉ ${new Date(l.created_at).toLocaleString('es-CL')} · ${l.kind ?? 'correo'} · ${l.status === 'sent' ? 'enviado' : l.status === 'failed' ? `FALLÓ: ${l.error ?? ''}` : l.status}`);
      if (!logs?.length) lines.push('ℹ No hay correos enviados a esa dirección todavía.');
    }
    if (fd.get('send') === 'on' && mailOn) {
      try {
        if (a) { const { sendRecoveryTo } = await import('@/lib/recovery'); const r = await sendRecoveryTo(a as never); lines.push(r === 'sent' ? '📨 Enlace enviado ahora.' : `✕ No se envió (${r}).`); }
        else { const { activateFromFicha } = await import('@/lib/recovery'); const r = await activateFromFicha(id); lines.push(r === 'sent' ? '📨 Cuenta activada y enlace enviado ahora.' : '✕ No se envió: no hay cuenta ni ficha.'); }
      } catch (e) { lines.push(`✕ Error al enviar: ${(e as Error).message}`); }
    }
    return ok(lines.join('\n'));
  });
}
