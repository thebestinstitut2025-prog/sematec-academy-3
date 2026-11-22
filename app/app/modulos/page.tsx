import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getContext, requireOrg } from '@/lib/context';
import { PageHeader, Card, Empty, Badge } from '@/components/ui';
import { ActionForm, Field, TextArea } from '@/components/forms';
import { FEATURE_LIST, FIELD_TYPES, type CustomModule } from '@/lib/modules';
import { LOCKED, baseNav, type MenuCustom } from '@/lib/nav-items';
import { defaultAreas, defaultPlace, loadAreas, type AreaDef } from '@/lib/areas';
import { FieldsEditor } from './fields-editor';
import { WorkflowEditor } from './workflow-editor';
import { AreasEditor } from './areas-editor';
import { deleteModule, deleteTemplate, duplicateModule, importModules, moveModule, saveAreas, saveAsTemplate, saveMenu, saveModule, toggleModule, applyTemplate } from './actions';

export const metadata = { title: 'Módulos y menú' };
const ICONS = ['🧩', '📋', '📦', '🚚', '🧾', '🛠', '📅', '🏷', '📞', '🧪', '🏆', '💡', '🔧', '🗂', '📌', '🧹', '🍽', '🚌', '🎫', '❤'];
type Role = { code: string; name: string };

function ModuleFields({ m, roles, areas }: { m?: CustomModule; roles: Role[]; areas: AreaDef[] }) {
  const pick = (name: string, sel: string[]) => (
    <div className="grid max-h-48 grid-cols-2 gap-1 overflow-y-auto rounded-lg border border-slate-200 p-2 text-xs">
      {roles.map((r) => <label key={r.code} className="flex items-center gap-1"><input type="checkbox" name={name} value={r.code} defaultChecked={sel.includes(r.code)} /> {r.name}</label>)}
    </div>);
  return (
    <>
      {m && <input type="hidden" name="id" value={m.id} />}
      <div className="grid gap-3 sm:grid-cols-[1fr_auto_auto]">
        <Field label="Nombre del módulo" name="name" required defaultValue={m?.name} placeholder="Ej.: Préstamo de equipos" />
        <label className="block"><span className="label">Ícono</span>
          <select name="icon" defaultValue={m?.icon ?? '🧩'} className="input text-lg">{ICONS.map((i) => <option key={i} value={i}>{i}</option>)}</select></label>
        <label className="block"><span className="label">Código (4 letras)</span>
          <input name="code_prefix" defaultValue={m?.code_prefix} maxLength={4} pattern="[A-Za-z]{4}" placeholder="Auto" className="input w-24 uppercase" title="Los registros reciben un código automático: 4 letras + 6 números" /></label>
      </div>
      <TextArea label="Descripción (opcional)" name="description" defaultValue={m?.description} rows={2} />
      <label className="block"><span className="label">🗂 Área</span>
        <select name="area" defaultValue={m?.area ?? ''} className="input" data-testid="area-modulo">
          <option value="">Módulos propios de la institución</option>
          {areas.filter((a) => a.key !== 'otros').map((a) => <option key={a.key} value={a.key}>{a.icon} {a.title}{a.hidden ? ' (oculta)' : ''}</option>)}
        </select></label>
      <FieldsEditor initial={m?.fields} />
      <WorkflowEditor initial={m?.workflow} />
      <div><p className="label">⚙ Funciones</p><input type="hidden" name="has_features" value="1" />
        <div className="grid gap-1 text-sm sm:grid-cols-2">{FEATURE_LIST.map(([k, l]) => (
          <label key={k} className="flex items-start gap-2"><input type="checkbox" name={`feat_${k}`} className="mt-1" defaultChecked={!!(m?.features as any)?.[k]} data-testid={`funcion-${k}`} /> {l}</label>))}</div></div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div><p className="label">👁 Quién lo ve <span className="font-normal text-slate-500">(sin marcar = todos)</span></p>{pick('view_roles', m?.view_roles ?? [])}</div>
        <div><p className="label">✏ Quién agrega y edita <span className="font-normal text-slate-500">(el propietario siempre)</span></p>{pick('edit_roles', m?.edit_roles ?? [])}</div>
      </div>
      <div className="flex flex-wrap gap-4 text-sm">
        <label className="flex items-center gap-2"><input type="checkbox" name="show_in_menu" defaultChecked={m?.show_in_menu ?? true} /> Mostrar en el menú</label>
        <label className="flex items-center gap-2"><input type="hidden" name="active" value="off" /><input type="checkbox" name="active" value="on" defaultChecked={m?.active ?? true} /> Activo (disponible)</label>
      </div>
    </>
  );
}

const TABS = [['modulos', '🧩 Módulos y sistemas'], ['areas', '🗂 Áreas'], ['plantillas', '📦 Plantillas y copias'], ['menu', '☰ Menú']] as const;

export default async function Page({ searchParams }: { searchParams: Promise<{ t?: string; q?: string; a?: string }> }) {
  const { t: tab0, q = '', a: areaFilter = '' } = await searchParams;
  const tab = TABS.some(([k]) => k === tab0) ? tab0! : 'modulos';
  const ctx = await getContext();
  const orgId = requireOrg(ctx);
  if (!ctx.isOwner) redirect('/app');
  const [{ data: mods }, { data: roles }, { data: menu }, { data: counts }, cfg, { data: tplRow }] = await Promise.all([
    ctx.supabase.from('custom_modules').select('*').eq('organization_id', orgId).order('name'),
    ctx.supabase.from('roles').select('code, name, organization_id').order('name'),
    ctx.supabase.from('organization_settings').select('value').eq('organization_id', orgId).eq('key', 'menu.custom').maybeSingle(),
    ctx.supabase.from('custom_records').select('module_id').eq('organization_id', orgId).limit(20000),
    loadAreas(ctx.supabase, orgId),
    ctx.supabase.from('organization_settings').select('value').eq('organization_id', orgId).eq('key', 'modules.templates').maybeSingle(),
  ]);
  const roleList = ((roles ?? []) as any[]).filter((r) => !r.organization_id || r.organization_id === orgId) as Role[];
  const roleName = new Map(roleList.map((r) => [r.code, r.name]));
  const n = new Map<string, number>(); (counts ?? []).forEach((c: any) => n.set(c.module_id, (n.get(c.module_id) ?? 0) + 1));
  const custom = (menu?.value ?? {}) as MenuCustom;
  const nav = baseNav(ctx);
  const typeName = new Map<string, string>(FIELD_TYPES as unknown as [string, string][]);
  const all = (mods ?? []) as CustomModule[];
  const areaOf = new Map(cfg.areas.map((x) => [x.key, x]));
  const norm = (x: string) => x.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const list = all.filter((m) => (!q || norm(`${m.name} ${m.description ?? ''}`).includes(norm(q))) && (!areaFilter || (m.area ?? 'otros') === areaFilter));
  const perArea: Record<string, number> = {}; for (const m of all) { const k = m.area && areaOf.has(m.area) ? m.area : 'otros'; perArea[k] = (perArea[k] ?? 0) + 1; }
  const templates = (Array.isArray((tplRow?.value as any)?.items) ? (tplRow!.value as any).items : []) as { id: string; name: string; icon: string; description: string | null; fields: unknown[]; workflow: unknown[]; saved_at: string }[];
  return (
    <>
      <PageHeader title="🧩 Módulos, sistemas y áreas" subtitle="Cree, edite, elimine y reutilice áreas, módulos y sistemas — sin tocar el código" />
      <nav className="mb-6 flex flex-wrap gap-2" aria-label="Secciones">{TABS.map(([k, l]) => (
        <Link key={k} href={`/app/modulos?t=${k}`} className={k === tab ? 'btn-primary' : 'btn-secondary'} data-testid={`pestana-${k}`}>{l}</Link>))}</nav>

      {tab === 'modulos' && <div className="grid gap-6 xl:grid-cols-[1fr_1.2fr]">
        <Card title="➕ Nuevo módulo o sistema">
          <p className="mb-3 text-sm text-slate-600">Ejemplos: «Préstamo de equipos», «Reclamos», «Visitas», «Mantenciones», «Proveedores». Cada registro recibe un código automático (4 letras + 6 números).</p>
          <ActionForm action={saveModule} submitLabel="Crear módulo" resetOnSuccess={false}><ModuleFields roles={roleList} areas={cfg.areas} /></ActionForm>
        </Card>
        <Card title={`Módulos y sistemas (${all.length})`}>
          <form className="mb-3 flex flex-wrap gap-2" action="/app/modulos">
            <input type="hidden" name="t" value="modulos" />
            <input name="q" defaultValue={q} placeholder="🔎 Buscar por nombre" className="input min-w-[10rem] flex-1" data-testid="buscar-modulo" />
            <select name="a" defaultValue={areaFilter} className="input w-auto" aria-label="Filtrar por área"><option value="">Todas las áreas</option>
              {cfg.areas.map((x) => <option key={x.key} value={x.key}>{x.icon} {x.title} ({perArea[x.key] ?? 0})</option>)}</select>
            <button className="btn-secondary">Filtrar</button>
          </form>
          {list.length ? <ul className="divide-y divide-slate-100" data-testid="lista-modulos">{list.map((m) => {
            const ar = m.area && areaOf.get(m.area);
            return (
            <li key={m.id} className="py-3 text-sm" data-testid="modulo">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-base"><span className="mr-1">{m.icon}</span><b>{m.name}</b> <Badge color={m.active ? 'green' : 'gray'}>{m.active ? 'Disponible' : 'Desactivado'}</Badge> {!m.show_in_menu && <Badge color="gray">Fuera del menú</Badge>}</span>
                <Link className="link" href={`/app/m/${m.slug}`}>Abrir ({n.get(m.id) ?? 0} registros) →</Link>
              </div>
              <p className="mt-1 text-xs text-slate-500">🗂 {ar ? `${ar.icon} ${ar.title}` : 'Módulos propios'} · Código {m.code_prefix}000001 · {m.fields.length} campos{m.workflow?.length ? ` · Estados: ${m.workflow.map((w) => w.label).join(' → ')}` : ''}</p>
              <p className="text-xs text-slate-500">Campos: {m.fields.map((f) => `${f.label} (${typeName.get(f.type) ?? f.type}${f.required ? ', obligatorio' : ''})`).join(' · ')}</p>
              <p className="text-xs text-slate-500">👁 {m.view_roles.length ? m.view_roles.map((r) => roleName.get(r) ?? r).join(', ') : 'Todos'} · ✏ {m.edit_roles.length ? m.edit_roles.map((r) => roleName.get(r) ?? r).join(', ') : 'Solo el propietario'}</p>
              <div className="mt-2 flex flex-wrap items-center gap-3">
                <details className="w-full"><summary className="link cursor-pointer text-xs" data-testid="editar-modulo">✏ Editar todo (nombre, área, campos, estados, funciones, permisos)</summary>
                  <div className="mt-2 rounded-xl border border-slate-200 p-3"><ActionForm action={saveModule} submitLabel="Guardar cambios" resetOnSuccess={false}><ModuleFields m={m} roles={roleList} areas={cfg.areas} /></ActionForm></div></details>
                <ActionForm action={moveModule} inline submitLabel="Mover" submitClass="text-xs link">
                  <input type="hidden" name="id" value={m.id} />
                  <select name="area" defaultValue={m.area ?? ''} className="input w-auto py-0.5 text-xs" aria-label="Mover a otra área" data-testid="mover-area">
                    <option value="">🧩 Módulos propios</option>{cfg.areas.filter((x) => x.key !== 'otros').map((x) => <option key={x.key} value={x.key}>{x.icon} {x.title}</option>)}</select>
                </ActionForm>
                <ActionForm action={toggleModule} inline submitLabel={m.active ? '⏸ Desactivar' : '▶ Activar'} submitClass="text-xs link"><input type="hidden" name="id" value={m.id} /><input type="hidden" name="on" value={m.active ? '0' : '1'} /></ActionForm>
                <ActionForm action={duplicateModule} inline submitLabel="📄 Duplicar" submitClass="text-xs link"><input type="hidden" name="id" value={m.id} /></ActionForm>
                <ActionForm action={saveAsTemplate} inline submitLabel="💾 Guardar como plantilla" submitClass="text-xs link"><input type="hidden" name="id" value={m.id} /></ActionForm>
                <a className="text-xs link" href={`/app/modulos/exportar?id=${m.id}`} download data-testid="exportar-modulo">⬇ Exportar</a>
                <ActionForm action={deleteModule} inline submitLabel="🗑 Eliminar" submitClass="text-xs text-red-600 hover:underline" confirm={`¿Eliminar el módulo «${m.name}» y sus ${n.get(m.id) ?? 0} registro(s)? Si solo quiere ocultarlo, use «Desactivar».`}><input type="hidden" name="id" value={m.id} /></ActionForm>
              </div>
            </li>); })}</ul> : <Empty>{all.length ? 'Ningún módulo coincide con la búsqueda.' : 'Aún no hay módulos. Cree el primero con el formulario o active sistemas desde «Sistemas → Catálogo».'}</Empty>}
        </Card>
      </div>}

      {tab === 'areas' && <Card title="🗂 Áreas de la plataforma">
        <p className="mb-3 text-sm text-slate-600">Las áreas ordenan el <Link className="link" href="/app/mapa">Mapa</Link> y los <Link className="link" href="/app/sistemas">Sistemas</Link>. Cambie nombres, íconos, colores y orden; cree áreas nuevas; oculte o elimine las que no use. Nada se pierde: lo de un área oculta o eliminada pasa a «Módulos propios».</p>
        <ActionForm action={saveAreas} submitLabel="Guardar áreas" resetOnSuccess={false}>
          <AreasEditor initial={cfg.areas} place={cfg.place} defaults={defaultAreas()} defaultPlace={defaultPlace()} counts={perArea}
            options={nav.filter((i) => !i.href.startsWith('/app/m/')).map((i) => ({ href: i.href, label: i.label, icon: i.icon ?? '•' }))} />
        </ActionForm>
      </Card>}

      {tab === 'plantillas' && <div className="grid gap-6 xl:grid-cols-2">
        <Card title={`📦 Plantillas guardadas (${templates.length})`}>
          <p className="mb-3 text-sm text-slate-600">Guarde cualquier módulo como plantilla (botón «💾 Guardar como plantilla») y cree módulos iguales con un clic: mismos campos, estados, funciones y permisos, sin registros.</p>
          {templates.length ? <ul className="divide-y divide-slate-100" data-testid="lista-plantillas">{templates.map((t) => (
            <li key={t.id} className="py-3 text-sm" data-testid="plantilla">
              <b>{t.icon} {t.name}</b> <span className="text-xs text-slate-500">· {t.fields.length} campos{t.workflow.length ? ` · ${t.workflow.length} estados` : ''}</span>
              {t.description && <p className="text-xs text-slate-500">{t.description}</p>}
              <div className="mt-2 flex flex-wrap items-end gap-2">
                <ActionForm action={applyTemplate} inline submitLabel="➕ Crear módulo desde esta plantilla" submitClass="btn-primary btn-sm">
                  <input type="hidden" name="tpl" value={t.id} /><input name="name" placeholder={`Nombre (opcional): ${t.name}`} className="input w-56 py-1 text-sm" aria-label="Nombre del nuevo módulo" />
                </ActionForm>
                <ActionForm action={deleteTemplate} inline submitLabel="🗑" submitClass="btn-secondary btn-sm" confirm={`¿Eliminar la plantilla «${t.name}»?`}><input type="hidden" name="tpl" value={t.id} /></ActionForm>
              </div>
            </li>))}</ul> : <Empty>Aún no hay plantillas.</Empty>}
        </Card>
        <div className="space-y-6">
          <Card title="⬇ Exportar para reutilizar en otra institución">
            <p className="mb-3 text-sm text-slate-600">Descarga un archivo con la estructura de todos sus módulos y sus áreas (sin registros ni datos personales). Impórtelo en otra institución o guárdelo como respaldo.</p>
            <a className="btn-primary" href="/app/modulos/exportar" download data-testid="exportar-todo">⬇ Exportar todos los módulos ({all.length})</a>
          </Card>
          <Card title="⬆ Importar módulos">
            <ActionForm action={importModules} submitLabel="⬆ Importar" resetOnSuccess>
              <label className="block"><span className="label">Archivo .json exportado desde «Módulos y menú»</span>
                <input type="file" name="file" accept="application/json,.json" required className="block w-full text-sm" data-testid="archivo-importar" /></label>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="with_areas" defaultChecked /> Importar también las áreas propias del archivo</label>
              <p className="text-xs text-slate-500">Los módulos se crean como nuevos (si el nombre ya existe, se agrega un número). No se borra ni se cambia nada de lo que ya tiene.</p>
            </ActionForm>
          </Card>
        </div>
      </div>}

      {tab === 'menu' && <Card title="☰ Personalizar el menú">
        <p className="mb-3 text-sm text-slate-600">Cambie el nombre de cualquier opción u ocúltela para todos. Las opciones ocultas siguen funcionando para quien tenga el enlace y el permiso. Para cambiar en qué área aparece cada opción, use la pestaña «🗂 Áreas».</p>
        <ActionForm action={saveMenu} submitLabel="Guardar menú" resetOnSuccess={false}>
          <table className="w-full text-sm" data-testid="menu-personalizar">
            <thead><tr className="text-left text-xs text-slate-500"><th className="py-1">Opción</th><th>Nombre en el menú</th><th className="text-center">Ocultar</th></tr></thead>
            <tbody>{nav.map((i) => (
              <tr key={i.href} className="border-t border-slate-100">
                <td className="py-1 pr-2 text-xs text-slate-500">{i.icon} {i.label}</td>
                <td className="py-1 pr-2"><input name={`label:${i.href}`} defaultValue={custom.labels?.[i.href] ?? ''} placeholder={i.label} maxLength={40} className="input py-1 text-sm" aria-label={`Nombre para ${i.label}`} /></td>
                <td className="text-center">{LOCKED.has(i.href) ? <span className="text-xs text-slate-400">—</span>
                  : <input type="checkbox" name="hide" value={i.href} defaultChecked={custom.hidden?.includes(i.href)} aria-label={`Ocultar ${i.label}`} />}</td>
              </tr>))}</tbody>
          </table>
        </ActionForm>
      </Card>}
    </>
  );
}
