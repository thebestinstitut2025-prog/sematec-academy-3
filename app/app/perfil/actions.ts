'use server';
import { revalidatePath } from 'next/cache';
import { getContext } from '@/lib/context';
import { fail, guard, ok, reqStr, str, type ActionResult } from '@/lib/actions';
import { checkDocument } from '@/lib/identity';

export async function updateProfile(fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const ctx = await getContext();
    const doc = checkDocument(str(fd, 'id_document_type') ?? 'RUN', str(fd, 'id_document_number'), true);
    if (!doc.ok) return fail(doc.error);
    const { error } = await ctx.supabase.rpc('update_my_identity', {
      p_full_name: reqStr(fd, 'full_name', 'Nombre'), p_doc_type: doc.type ?? 'RUN', p_doc_number: doc.number ?? '', p_phone: str(fd, 'phone'),
    });
    if (error) return fail(error);
    const tz = str(fd, 'timezone');
    if (tz) await ctx.supabase.from('profiles').update({ timezone: tz }).eq('id', ctx.user.id);
    revalidatePath('/app', 'layout');
    return ok('Datos guardados. Ya puede entrar al sistema con su correo o con su RUT.');
  });
}

export async function uploadAvatar(fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const ctx = await getContext();
    const { saveImage } = await import('@/lib/media');
    const r = await saveImage(fd.get('file') as File, { kind: 'avatar', organizationId: ctx.orgId, userId: ctx.user.id, isPublic: false });
    if (r.error) return fail(r.error);
    const { error } = await ctx.supabase.from('profiles').update({ avatar_asset_id: r.id }).eq('id', ctx.user.id);
    if (error) return fail(error);
    revalidatePath('/app', 'layout');
    return ok('Foto de perfil actualizada.');
  });
}

/** 📧 Cambiar el correo de acceso: pide la contraseña actual y envía un enlace de confirmación al correo nuevo. */
export async function changeMyEmail(fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const ctx = await getContext();
    const { EMAIL_RE, requestEmailChange } = await import('@/lib/email-change');
    const email = (str(fd, 'new_email') ?? '').trim().toLowerCase();
    if (!EMAIL_RE.test(email) || email.length > 120) return fail('Escriba un correo válido.');
    if (email === (ctx.user.email ?? '').toLowerCase()) return fail('Ese ya es su correo de acceso.');
    const { data: okPw, error } = await ctx.supabase.rpc('verify_my_password', { p_password: str(fd, 'current_password') ?? '' });
    if (error) return fail(/verify_my_password/.test(error.message) ? 'Falta instalar la actualización «Cuenta correo» en Actualizar base de datos.' : error.message);
    if (!okPw) return fail('La contraseña actual no es correcta.');
    const r = await requestEmailChange(ctx.user.id, ctx.user.email ?? '', email, ctx.profile?.full_name ?? null, ctx.orgId);
    if (!r.ok) return fail(r.error);
    return ok(`Le enviamos un enlace a ${email}. Ábralo para confirmar (vence en 24 horas). Hasta entonces siga entrando con ${ctx.user.email}.`);
  });
}

/** 🗑 Quitar la foto de perfil. */
export async function removeAvatar(): Promise<ActionResult> {
  return guard(async () => {
    const ctx = await getContext();
    const { error } = await ctx.supabase.from('profiles').update({ avatar_asset_id: null }).eq('id', ctx.user.id);
    if (error) return fail(error);
    revalidatePath('/app', 'layout');
    return ok('Foto de perfil quitada.');
  });
}

/** 🌐 Idioma preferido de la cuenta. */
export async function updateMyLocale(fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const ctx = await getContext();
    const loc = str(fd, 'preferred_locale') ?? 'es';
    if (!['es', 'en', 'fr', 'pt', 'ht'].includes(loc)) return fail('Idioma no válido.');
    const { error } = await ctx.supabase.from('profiles').update({ preferred_locale: loc }).eq('id', ctx.user.id);
    if (error) return fail(error);
    revalidatePath('/app', 'layout');
    return ok('Idioma guardado.');
  });
}
