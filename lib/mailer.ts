import 'server-only';
import nodemailer from 'nodemailer';

/**
 * Correo saliente propio (SMTP): recuperación de contraseña y avisos.
 * Variables en Vercel: SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS y SMTP_FROM
 * (p. ej., Gmail con «contraseña de aplicación», Brevo, Resend u Outlook).
 */
/** Configuración efectiva: con solo SMTP_USER y SMTP_PASS de Gmail ya funciona (servidor, puerto y remitente se completan solos). */
export function mailConfig() {
  const user = (process.env.SMTP_USER ?? '').trim();
  const gmail = /@(gmail|googlemail)\.com$/i.test(user);
  const host = (process.env.SMTP_HOST ?? '').trim() || (gmail ? 'smtp.gmail.com' : '');
  const port = Number(process.env.SMTP_PORT || (host === 'smtp.gmail.com' ? 465 : 587));
  const from = (process.env.SMTP_FROM ?? '').trim() || (user ? `SEMATEC ACADEMY <${user}>` : '');
  return { host, port, user, from, hasPass: !!(process.env.SMTP_PASS ?? '').trim() };
}
export const mailEnabled = () => { const c = mailConfig(); return !!c.host && !!c.from; };

export type MailMeta = { org?: string | null; kind?: string; by?: string | null };

// Correos con enlaces de acceso: nunca se guarda su contenido (el enlace da entrada a la cuenta)
const SECRET_KINDS = new Set(['recuperar', 'cuenta', 'acceso', 'invitacion', 'mfa']);
/** Guarda en el registro de correos si se envió o por qué falló, con su contenido para poder reenviarlo. */
async function logMail(to: string, subject: string, status: 'sent' | 'failed' | 'off', error: string | null, meta?: MailMeta, body?: { html: string; text: string; files?: boolean }) {
  try {
    const { createAdminClient } = await import('@/lib/supabase/admin');
    const keep = body && !SECRET_KINDS.has(meta?.kind ?? '') && !body.files;
    await createAdminClient().from('mail_log').insert({
      organization_id: meta?.org ?? null, to_email: to.slice(0, 254), subject: subject.slice(0, 300), kind: meta?.kind ?? 'general', status,
      error: error?.slice(0, 500) ?? null, sent_by: meta?.by ?? null,
      ...(keep ? { html: body!.html.slice(0, 200000), text_body: body!.text.slice(0, 50000) } : {}),
    });
  } catch { /* el registro nunca impide enviar */ }
}

export async function sendMail(to: string, subject: string, html: string, text: string, attachments?: { filename: string; content: Buffer | Uint8Array; contentType?: string }[], meta?: MailMeta) {
  const c = mailConfig();
  const body = { html, text, files: !!attachments?.length };
  if (!c.host || !c.from) { await logMail(to, subject, 'off', 'Correo no configurado', meta, body); throw new Error('El correo no está configurado: en Vercel agregue SMTP_USER (su Gmail) y SMTP_PASS (contraseña de aplicación) y haga «Redeploy».'); }
  if (!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(to)) throw new Error('El correo del destinatario no es válido.');
  const port = c.port;
  const local = /^(localhost|127\.0\.0\.1)$/.test(c.host);
  const t = nodemailer.createTransport({
    host: c.host, port, secure: port === 465,
    // Google muestra la contraseña de aplicación en grupos («abcd efgh ijkl mnop»): se quitan los espacios
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER.trim(), pass: (process.env.SMTP_PASS ?? '').replace(/\s+/g, '') } : undefined,
    ignoreTLS: local, requireTLS: !local && port !== 465,
    connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 20000,
  });
  try {
    await t.sendMail({ from: c.from, to, subject, html, text, attachments: attachments?.map((a) => ({ ...a, content: Buffer.from(a.content) })) });
  } catch (e) {
    const msg = mailErrorText(e);
    await logMail(to, subject, 'failed', msg, meta, body);
    throw new Error(msg);
  }
  await logMail(to, subject, 'sent', null, meta, body);
}

/**
 * 📨 Reenvía los correos que quedaron pendientes (no se pudieron enviar) de los últimos 14 días.
 * Si el correo sigue fallando se detiene en el primero (no gasta intentos).
 */
export async function resendPending(org?: string | null, limit = 50): Promise<{ sent: number; failed: number; left: number; error?: string }> {
  const { createAdminClient } = await import('@/lib/supabase/admin');
  const admin = createAdminClient();
  const since = new Date(Date.now() - 14 * 86400e3).toISOString();
  let q = admin.from('mail_log').select('id, to_email, subject, html, text_body, attempts').in('status', ['failed', 'off'])
    .is('resent_at', null).not('html', 'is', null).gte('created_at', since).lt('attempts', 6).order('created_at').limit(limit);
  if (org) q = q.or(`organization_id.eq.${org},organization_id.is.null`);
  const { data } = await q;
  const c = mailConfig();
  let sent = 0; let failed = 0; let error: string | undefined;
  if (c.host && c.from) {
    const t = nodemailer.createTransport({
      host: c.host, port: c.port, secure: c.port === 465,
      auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER.trim(), pass: (process.env.SMTP_PASS ?? '').replace(/\s+/g, '') } : undefined,
      ignoreTLS: /^(localhost|127\.0\.0\.1)$/.test(c.host), requireTLS: !/^(localhost|127\.0\.0\.1)$/.test(c.host) && c.port !== 465,
      connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 20000,
    });
    for (const m of data ?? []) {
      try {
        await t.sendMail({ from: c.from, to: m.to_email, subject: m.subject, html: m.html!, text: m.text_body ?? '' });
        await admin.from('mail_log').update({ status: 'sent', error: null, resent_at: new Date().toISOString(), attempts: (m.attempts ?? 1) + 1 }).eq('id', m.id);
        sent++;
      } catch (e) {
        error = mailErrorText(e); failed++;
        await admin.from('mail_log').update({ error, attempts: (m.attempts ?? 1) + 1 }).eq('id', m.id);
        break;
      }
    }
  } else error = 'El correo no está configurado.';
  const { count } = await (org ? admin.from('mail_log').select('id', { count: 'exact', head: true }).or(`organization_id.eq.${org},organization_id.is.null`)
    : admin.from('mail_log').select('id', { count: 'exact', head: true }))
    .in('status', ['failed', 'off']).is('resent_at', null).not('html', 'is', null).gte('created_at', since).lt('attempts', 6);
  return { sent, failed, left: count ?? 0, error };
}

/** Traduce los errores del servidor de correo a instrucciones claras. */
export function mailErrorText(e: unknown) {
  const m = (e as Error)?.message ?? String(e);
  if (/535|BadCredentials|Username and Password not accepted|Invalid login|EAUTH/i.test(m))
    return 'El servidor de correo rechazó el usuario o la clave. Revise en Vercel: SMTP_USER debe ser el correo completo de Gmail y SMTP_PASS la «contraseña de aplicación» de 16 letras creada en ESA misma cuenta de Google (no la contraseña normal de Gmail). Después haga «Redeploy».';
  if (/534|Application-specific password required/i.test(m))
    return 'Gmail exige una «contraseña de aplicación»: créela en myaccount.google.com → Seguridad → Contraseñas de aplicaciones y póngala en SMTP_PASS (Vercel). Después haga «Redeploy».';
  if (/ENOTFOUND|EDNS|getaddrinfo/i.test(m)) return 'No se encontró el servidor de correo: revise SMTP_HOST en Vercel (para Gmail: smtp.gmail.com).';
  if (/ETIMEDOUT|ECONNREFUSED|ESOCKET|timeout/i.test(m)) return 'No se pudo conectar con el servidor de correo: revise SMTP_PORT en Vercel (para Gmail: 465).';
  if (/\b55[03]\b.*sender|sender address|Sender address/i.test(m)) return 'El servidor rechazó el remitente: SMTP_FROM debe usar el mismo correo que SMTP_USER, por ejemplo «SEMATEC ACADEMY <sucorreo@gmail.com>».';
  return `No se pudo enviar el correo: ${m}`;
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

/** Plantilla simple y legible en cualquier correo. */
export function mailLayout(site: string, title: string, bodyHtml: string, button?: { href: string; label: string }) {
  return `<!doctype html><html lang="es"><body style="margin:0;background:#f1f5f9;font-family:Arial,Helvetica,sans-serif;color:#0f172a">
<div style="max-width:560px;margin:24px auto;background:#fff;border-radius:12px;padding:28px">
<p style="margin:0 0 16px;font-weight:bold;color:#1d4ed8">${esc(site)}</p>
<h1 style="font-size:20px;margin:0 0 12px">${esc(title)}</h1>
${bodyHtml}
${button ? `<p style="margin:24px 0"><a href="${esc(button.href)}" style="background:#1d4ed8;color:#fff;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:bold;display:inline-block">${esc(button.label)}</a></p>
<p style="font-size:12px;color:#64748b">Si el botón no funciona, copie este enlace en su navegador:<br>${esc(button.href)}</p>` : ''}
<p style="font-size:12px;color:#64748b;margin-top:24px">Si usted no pidió este correo, ignórelo: su cuenta sigue segura.</p>
</div></body></html>`;
}
