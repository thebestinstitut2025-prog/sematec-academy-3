import { getContext, requireOrg } from '@/lib/context';
import { PageHeader, Card } from '@/components/ui';
import { ActionForm, SelectField } from '@/components/forms';
import { ContactsList } from './contacts-list';
import { setContactVisibility } from './actions';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Contactos' };

/** 📇 Contactos: llamar, WhatsApp (chat, llamada o video), SMS, correo y mensajes, a uno o a varios. */
export default async function Page() {
  const ctx = await getContext();
  const orgId = requireOrg(ctx);
  const [{ data, error }, { data: grp }, { data: me }] = await Promise.all([
    ctx.supabase.rpc('my_contacts', { p_org: orgId }),
    ctx.supabase.from('people_groups').select('id, name, people_group_members(user_id)').eq('owner_id', ctx.user.id).order('name'),
    ctx.supabase.from('profiles').select('preferences, phone').eq('id', ctx.user.id).maybeSingle(),
  ]);
  const groups = ((grp ?? []) as any[]).map((g) => ({ id: g.id, name: g.name, members: (g.people_group_members ?? []).map((m: any) => m.user_id) }));
  const vis = ((me?.preferences as any)?.contact_visibility as string | undefined) ?? 'personal';
  return (
    <>
      <PageHeader title="📇 Contactos" subtitle="Llame, escriba por WhatsApp (chat, llamada o video), SMS, correo o mensaje — desde el celular o el computador" />
      <div className="grid gap-6 xl:grid-cols-[1fr_20rem]">
        <Card title={`Mis contactos (${(data ?? []).length})`}>
          {error ? <p className="text-sm text-red-700">{/my_contacts/.test(error.message) ? 'Falta instalar la actualización «Contactos y apps» en Actualizar base de datos.' : error.message}</p>
            : <ContactsList contacts={(data ?? []) as any[]} groups={groups} />}
        </Card>
        <div className="space-y-6">
          <Card title="🔒 Mi privacidad">
            <p className="mb-2 text-sm text-slate-600">¿Quién puede ver su teléfono{me?.phone ? ` (${me.phone})` : ''} y su correo?</p>
            <ActionForm action={setContactVisibility} submitLabel="Guardar" resetOnSuccess={false}>
              <SelectField label="Mostrarlos a" name="vis" defaultValue={vis} options={[
                { value: 'personal', label: 'Solo personal y profesores' }, { value: 'contactos', label: 'Todos mis contactos' }, { value: 'nadie', label: 'Nadie (solo mensajes)' }]} />
            </ActionForm>
            {!me?.phone && <p className="mt-2 text-xs text-slate-500">Agregue su teléfono en <a className="link" href="/app/perfil">Mi cuenta</a> para que lo puedan llamar o escribir por WhatsApp.</p>}
          </Card>
          <Card title="💡 Consejos">
            <ul className="list-disc space-y-1 pl-5 text-sm text-slate-600">
              <li>🟢 WhatsApp abre el chat: desde ahí puede llamar o hacer videollamada.</li>
              <li>📧 Marque varias personas y use «Correo a los elegidos».</li>
              <li>👥 Filtre por sus grupos (se crean en Archivos → Mis grupos).</li>
            </ul>
          </Card>
        </div>
      </div>
    </>
  );
}
