import { getContext, requireOrg } from '@/lib/context';
import { PageHeader, Card, Empty, Badge } from '@/components/ui';
import { ActionForm } from '@/components/forms';
import { FileAccessFields } from '@/components/file-access-form';
import { EditBox } from '@/components/edit-box';
import { sharingOptions } from '@/lib/file-people';
import { APP_PRESETS, APP_VIS } from '@/lib/app-presets';
import { saveAppLink, deleteAppLink } from './actions';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Apps y accesos' };

type L = { id: string; title: string; url: string; icon: string; description: string | null; visibility: string; section_id: string | null; users: string[]; groups: string[]; owner_id: string; position: number };
const VIS = Object.fromEntries(APP_VIS);

function Fields({ l, share }: { l?: L; share: Awaited<ReturnType<typeof sharingOptions>> }) {
  return (
    <>
      {!l && <label className="block"><span className="label">App conocida (opcional)</span>
        <select name="preset" className="input" defaultValue="" data-testid="app-conocida"><option value="">— Otra app o enlace —</option>
          {APP_PRESETS.map((p) => <option key={p.key} value={p.key}>{p.icon} {p.title}</option>)}</select></label>}
      <div className="grid gap-3 sm:grid-cols-[5rem_1fr]">
        <label className="block"><span className="label">Ícono</span><input name="icon" maxLength={8} defaultValue={l?.icon} placeholder="🔗" className="input text-center text-lg" /></label>
        <label className="block"><span className="label">Nombre</span><input name="title" maxLength={80} defaultValue={l?.title} placeholder="Ej.: Canal de YouTube del curso" className="input" /></label>
      </div>
      <label className="block"><span className="label">Enlace {l ? '' : '(si eligió una app conocida, puede dejarlo vacío)'}</span>
        <input name="url" defaultValue={l?.url} placeholder="https://…  ·  tel:+569…  ·  mailto:…" className="input" data-testid="url-app" /></label>
      <label className="block"><span className="label">Descripción (opcional)</span><input name="description" maxLength={300} defaultValue={l?.description ?? ''} className="input" /></label>
      <FileAccessFields people={share.people} groups={share.groups} sections={share.sections} options={APP_VIS} extraPeople={false}
        initial={l ? { visibility: l.visibility, section: l.section_id, users: l.users, groups: l.groups } : undefined} />
    </>
  );
}

/** 📱 Apps y accesos rápidos: YouTube, Meet, Zoom, WhatsApp o cualquier enlace, para usted o para quien elija. */
export default async function Page() {
  const ctx = await getContext();
  requireOrg(ctx);
  const [{ data, error }, share] = await Promise.all([
    ctx.supabase.from('app_links').select('*').eq('organization_id', ctx.orgId!).order('position').order('created_at'),
    sharingOptions(ctx),
  ]);
  const links = (data ?? []) as L[];
  const mine = links.filter((l) => l.owner_id === ctx.user.id);
  const others = links.filter((l) => l.owner_id !== ctx.user.id);
  const Tile = ({ l }: { l: L }) => (
    <div className="card flex flex-col p-3" data-testid="acceso">
      <a href={l.url} target={l.url.startsWith('http') ? '_blank' : undefined} rel="noopener noreferrer" className="flex items-center gap-3 rounded-lg p-1 hover:bg-slate-50" data-testid="abrir-acceso">
        <span className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-brand-50 text-2xl">{l.icon}</span>
        <span className="min-w-0"><b className="block truncate">{l.title}</b>{l.description && <span className="block truncate text-xs text-slate-500">{l.description}</span>}</span>
      </a>
      {(l.owner_id === ctx.user.id || ctx.isOwner) && (
        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs"><Badge color="gray">{VIS[l.visibility] ?? l.visibility}</Badge>
          <EditBox label="✏ Editar" className="w-full"><ActionForm action={saveAppLink} submitLabel="Guardar" resetOnSuccess={false}><input type="hidden" name="id" value={l.id} /><Fields l={l} share={share} /></ActionForm></EditBox>
          <ActionForm action={deleteAppLink} inline submitLabel="🗑 Eliminar" submitClass="text-xs text-red-600 hover:underline" confirm={`¿Eliminar «${l.title}»?`}><input type="hidden" name="id" value={l.id} /></ActionForm>
        </div>)}
    </div>
  );
  return (
    <>
      <PageHeader title="📱 Apps y accesos" subtitle="Abra YouTube, Meet, Zoom, WhatsApp o cualquier enlace con un toque, desde el celular o el computador. Usted elige quién ve cada acceso." />
      {error && <p className="mb-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">Falta instalar la actualización «Contactos y apps» en Actualizar base de datos.</p>}
      <div className="grid gap-6 xl:grid-cols-[1fr_24rem]">
        <div className="space-y-6">
          {others.length > 0 && <Card title={`🏛 Compartidos conmigo (${others.length})`}><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" data-testid="accesos-compartidos">{others.map((l) => <Tile key={l.id} l={l} />)}</div></Card>}
          <Card title={`⭐ Mis accesos (${mine.length})`}>
            {mine.length ? <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" data-testid="mis-accesos">{mine.map((l) => <Tile key={l.id} l={l} />)}</div> : <Empty>Agregue su primer acceso con el formulario.</Empty>}
          </Card>
        </div>
        <Card title="➕ Agregar app o enlace">
          <ActionForm action={saveAppLink} submitLabel="Agregar"><Fields share={share} /></ActionForm>
        </Card>
      </div>
    </>
  );
}
