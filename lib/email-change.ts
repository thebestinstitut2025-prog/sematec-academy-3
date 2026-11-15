import 'server-only';
import { createHash, randomBytes } from 'node:crypto';
import { createAdminClient } from '@/lib/supabase/admin';
import { env } from '@/lib/env';
import { mailEnabled, mailLayout, sendMail } from '@/lib/mailer';

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const sha = (t: string) => createHash('sha256').update(t).digest('hex');

/** Envía al correo NUEVO el enlace para confirmar el cambio (vence en 24 h) y avisa al correo anterior. */
export async function requestEmailChange(userId: string, oldEmail: string, newEmail: string, name: string | null, org: string | null):
  Promise<{ ok: true } | { ok: false; error: string }> {
  if (!mailEnabled()) return { ok: false, error: 'El envío de correos no está configurado: pida a la administración que cambie su correo en Usuarios.' };
  const admin = createAdminClient();
  const { data: taken } = await admin.from('profiles').select('id').ilike('email', newEmail).neq('id', userId).limit(1);
  if (taken?.length) return { ok: false, error: 'Ese correo ya es la cuenta de otra persona.' };
  const token = randomBytes(32).toString('base64url');
  await admin.from('email_change_requests').update({ used_at: new Date().toISOString() }).eq('user_id', userId).is('used_at', null);
  const { error } = await admin.from('email_change_requests').insert({ user_id: userId, new_email: newEmail, token_hash: sha(token), expires_at: new Date(Date.now() + 24 * 3600e3).toISOString() });
  if (error) return { ok: false, error: /email_change_requests/.test(error.message) ? 'Falta instalar la actualización «Cuenta correo» en Actualizar base de datos.' : error.message };
  const link = `${env.siteUrl()}/cuenta/confirmar-correo?t=${token}`;
  const { data: site } = await admin.from('site_settings').select('site_name').limit(1).maybeSingle();
  const brand = site?.site_name ?? 'SEMATEC ACADEMY';
  const hi = name ? `Hola ${name.split(' ')[0]},` : 'Hola,';
  try {
    await sendMail(newEmail, `${brand}: confirme su nuevo correo`,
    mailLayout(brand, 'Confirme su nuevo correo', `<p>${hi}</p><p>Pidió usar este correo para entrar a ${brand}. Toque el botón para confirmarlo (el enlace vence en 24 horas). Desde entonces entrará con este correo y la misma contraseña.</p>`,
      { href: link, label: 'Confirmar mi nuevo correo' }),
    `${hi}\n\nPara confirmar su nuevo correo de acceso abra este enlace (vence en 24 horas):\n${link}\n\nSi usted no lo pidió, ignore este correo.`, undefined, { org, kind: 'cuenta' });
  } catch (e) {
    return { ok: false, error: `No se pudo enviar el correo de confirmación: ${(e as Error).message}` };
  }
  if (oldEmail) {
    await sendMail(oldEmail, `${brand}: pidieron cambiar su correo de acceso`,
      mailLayout(brand, 'Cambio de correo solicitado', `<p>${hi}</p><p>Se pidió cambiar el correo de acceso de su cuenta a <b>${newEmail.replace(/[<>&"]/g, '')}</b>. Si fue usted, no haga nada. Si no fue usted, cambie su contraseña y avise a la institución.</p>`),
      `${hi}\n\nSe pidió cambiar el correo de acceso de su cuenta a ${newEmail}. Si no fue usted, cambie su contraseña y avise a la institución.`, undefined, { org, kind: 'cuenta' }).catch(() => {});
  }
  return { ok: true };
}

/** Confirma el cambio con el token del enlace. */
export async function confirmEmailChange(token: string): Promise<{ ok: true; email: string } | { ok: false; error: string }> {
  if (!token || token.length > 100) return { ok: false, error: 'enlace' };
  const admin = createAdminClient();
  const { data: r } = await admin.from('email_change_requests').select('id, user_id, new_email, expires_at, used_at').eq('token_hash', sha(token)).maybeSingle();
  if (!r || r.used_at || new Date(r.expires_at) < new Date()) return { ok: false, error: 'enlace' };
  await admin.from('email_change_requests').update({ used_at: new Date().toISOString() }).eq('id', r.id);
  const { data: taken } = await admin.from('profiles').select('id').ilike('email', r.new_email).neq('id', r.user_id).limit(1);
  if (taken?.length) return { ok: false, error: 'ocupado' };
  const { error } = await admin.auth.admin.updateUserById(r.user_id, { email: r.new_email, email_confirm: true });
  if (error) return { ok: false, error: 'ocupado' };
  return { ok: true, email: r.new_email };
}
