import Link from 'next/link';
import { getContext } from '@/lib/context';
import { PageHeader, Card, Badge } from '@/components/ui';
import { ActionForm, Field, Grid, SelectField } from '@/components/forms';
import { DOC_TYPES } from '@/lib/identity';
import { changePassword, signOutEverywhere } from '@/app/login/actions';
import { changeMyEmail, removeAvatar, updateMyLocale, updateProfile, uploadAvatar } from './actions';

export const metadata = { title: 'Mi cuenta' };

export default async function Page({ searchParams }: { searchParams: Promise<{ correo?: string }> }) {
  const ctx = await getContext();
  const { correo } = await searchParams;
  const p = ctx.profile;
  return (
    <>
      <PageHeader title="Mi cuenta" subtitle={`${ctx.user.email ?? ''}${p?.user_code ? ` · Código ${p.user_code}` : ''}`} />
      {(!p?.full_name || !p?.id_document_number) && (
        <p className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800" data-testid="falta-identidad">
          🪪 Complete su <b>nombre y RUT</b>: se registran en cada venta, compra o cambio que haga en SEMATEC VENTA, y le permiten entrar al sistema con su RUT.</p>)}
      {correo === 'ok' && <p className="mb-4 rounded-xl bg-emerald-50 p-3 text-sm text-emerald-800" data-testid="correo-cambiado">✓ Su correo de acceso ahora es <b>{ctx.user.email}</b>. Use ese correo y la misma contraseña para entrar.</p>}
      {correo === 'enlace' && <p className="mb-4 rounded-xl bg-amber-50 p-3 text-sm text-amber-900">El enlace para cambiar el correo ya se usó o venció. Pídalo de nuevo abajo.</p>}
      {correo === 'ocupado' && <p className="mb-4 rounded-xl bg-red-50 p-3 text-sm text-red-700">No se pudo cambiar el correo: ya es la cuenta de otra persona.</p>}
      <div className="grid gap-6 xl:grid-cols-2">
        <Card title="Foto de perfil">
          <div className="flex items-center gap-5">
            {p?.avatar_asset_id
              // eslint-disable-next-line @next/next/no-img-element
              ? <img src={`/media/${p.avatar_asset_id}`} alt="Foto de perfil" className="h-24 w-24 rounded-full object-cover" />
              : <span className="grid h-24 w-24 place-items-center rounded-full bg-brand-50 text-3xl font-bold text-brand-700">{(p?.full_name || '?')[0]}</span>}
            <ActionForm action={uploadAvatar} submitLabel="Subir foto">
              <input type="file" name="file" accept="image/png,image/jpeg,image/webp" required className="text-sm" />
              <p className="text-xs text-slate-500">PNG, JPG o WebP, máximo 3 MB.</p>
            </ActionForm>
            {p?.avatar_asset_id && <ActionForm action={removeAvatar} inline submitLabel="🗑 Quitar foto" submitClass="btn-secondary btn-sm" confirm="¿Quitar su foto de perfil?" />}
          </div>
        </Card>
        <Card title="🪪 Datos personales e identificación">
          {p?.user_code && <p className="mb-3 text-sm">Su código de usuario: <Badge color="blue">{p.user_code}</Badge></p>}
          <ActionForm action={updateProfile} submitLabel="Guardar" resetOnSuccess={false}>
            <Grid><Field label="Nombre completo" name="full_name" required defaultValue={p?.full_name} />
              <SelectField label="Documento" name="id_document_type" required defaultValue={p?.id_document_type ?? 'RUN'} options={DOC_TYPES.map(([value, label]) => ({ value, label }))} />
              <Field label="RUT o N° de pasaporte" name="id_document_number" required defaultValue={p?.id_document_number} placeholder="12.345.678-5" />
              <Field label="Teléfono" name="phone" defaultValue={p?.phone} />
              <Field label="Zona horaria" name="timezone" required defaultValue={p?.timezone} /></Grid>
          </ActionForm>
        </Card>
        <Card title="📧 Correo de acceso">
          <p className="mb-3 text-sm text-slate-600">Hoy entra con <b>{ctx.user.email}</b>. Para cambiarlo, escriba el nuevo correo y su contraseña actual: le enviaremos un enlace al correo nuevo para confirmarlo.</p>
          <ActionForm action={changeMyEmail} submitLabel="Enviar enlace de confirmación" cancel>
            <Grid><Field label="Nuevo correo" name="new_email" type="email" required autoComplete="email" />
              <Field label="Contraseña actual" name="current_password" type="password" required autoComplete="current-password" /></Grid>
          </ActionForm>
        </Card>
        <Card title="⚙ Preferencias">
          <ActionForm action={updateMyLocale} submitLabel="Guardar idioma" resetOnSuccess={false}>
            <SelectField label="Idioma" name="preferred_locale" required defaultValue={p?.preferred_locale ?? 'es'}
              options={[{ value: 'es', label: 'Español' }, { value: 'en', label: 'English' }, { value: 'fr', label: 'Français' }, { value: 'pt', label: 'Português' }, { value: 'ht', label: 'Kreyòl ayisyen' }]} />
          </ActionForm>
          <ul className="mt-4 space-y-1 text-sm">
            <li><Link className="link" href="/app/configuracion">🏠 Mi configuración: página de inicio, colores y tarjetas</Link></li>
            {ctx.studentId && <li><Link className="link" href="/app/mi">🎓 Mi portal de estudiante</Link></li>}
            <li><Link className="link" href="/app/archivos">📁 Mis archivos</Link></li>
          </ul>
        </Card>
        <Card title="Seguridad">
          <p className="mb-3 text-sm">Verificación en dos pasos: {ctx.hasMfaFactor ? <Badge color="green">Activada</Badge> : <Badge color="amber">No configurada</Badge>}
            {!ctx.hasMfaFactor && <Link className="link ml-2" href="/mfa">Configurar ahora</Link>}</p>
          <ActionForm action={changePassword} submitLabel="Cambiar contraseña">
            <Grid><Field label="Nueva contraseña" name="password" type="password" required autoComplete="new-password" />
              <Field label="Repetir" name="confirm" type="password" required autoComplete="new-password" /></Grid>
          </ActionForm>
          <form action={signOutEverywhere} className="mt-5 border-t border-slate-100 pt-4">
            <p className="mb-2 text-sm text-slate-600">¿Perdió un dispositivo? Cierre todas sus sesiones activas.</p>
            <button className="btn-secondary">Cerrar sesión en todos los dispositivos</button>
          </form>
        </Card>
      </div>
    </>
  );
}
