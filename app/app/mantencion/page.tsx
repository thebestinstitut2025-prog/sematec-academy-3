import { redirect } from 'next/navigation';
import { getContext } from '@/lib/context';
import { PageHeader, Card, Badge, Stat } from '@/components/ui';
import { ActionForm } from '@/components/forms';
import { fmtDateTime } from '@/lib/format';
import { buildNav } from '@/lib/nav-items';
import { areaOfHref, loadAreas } from '@/lib/areas';
import { isActive, loadMaint, type MaintItem } from '@/lib/maintenance';
import { MIGRATIONS } from '@/lib/setup/sql.generated';
import { endMaintenance, setGlobalMaintenance, setItemsMaintenance } from './actions';

export const dynamic = 'force-dynamic';

const size = (b: number) => (b > 1e9 ? `${(b / 1e9).toFixed(2)} GB` : b > 1e6 ? `${(b / 1e6).toFixed(1)} MB` : `${Math.round(b / 1e3)} KB`);
const state = (i: MaintItem & { on?: boolean }) =>
  i.until && Date.parse(i.until) <= Date.now() ? <Badge color="gray">Terminó sola</Badge>
    : i.from && Date.parse(i.from) > Date.now() ? <Badge color="blue">Programada · {fmtDateTime(i.from)}</Badge>
      : <Badge color="amber">🛠 En mantención</Badge>;

function When() {
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      <label className="text-sm">Desde (opcional)<input type="datetime-local" name="from" className="input mt-1 w-full" /></label>
      <label className="text-sm">Hasta (opcional; se abre sola)<input type="datetime-local" name="until" className="input mt-1 w-full" /></label>
    </div>
  );
}

export default async function MantencionPage() {
  const ctx = await getContext();
  if (!ctx.orgId || !(ctx.isOwner || ctx.isPlatformAdmin)) redirect('/app');
  const orgId = ctx.orgId;
  const since = new Date(Date.now() - 7 * 864e5).toISOString();
  const [maint, areasCfg, nav, { data: mods }, mig, mailFail, mailOk, files, students, teachers, sections] = await Promise.all([
    loadMaint(ctx.supabase, orgId), loadAreas(ctx.supabase, orgId), buildNav(ctx),
    ctx.supabase.from('custom_modules').select('slug, name, icon, area').eq('organization_id', orgId).order('name'),
    ctx.supabase.rpc('installed_migrations'),
    ctx.supabase.from('mail_log').select('id', { count: 'exact', head: true }).eq('organization_id', orgId).eq('status', 'failed').gte('created_at', since),
    ctx.supabase.from('mail_log').select('id', { count: 'exact', head: true }).eq('organization_id', orgId).eq('status', 'sent').gte('created_at', since),
    ctx.supabase.from('user_files').select('size_bytes').eq('organization_id', orgId).limit(20000),
    ctx.supabase.from('students').select('id', { count: 'exact', head: true }).eq('organization_id', orgId),
    ctx.supabase.from('teachers').select('id', { count: 'exact', head: true }).eq('organization_id', orgId),
    ctx.supabase.from('sections').select('id', { count: 'exact', head: true }).eq('organization_id', orgId),
  ]);
  const pending = mig.error ? null : MIGRATIONS.filter((m) => !new Set((mig.data ?? []) as string[]).has(m.version));
  const used = ((files.data ?? []) as { size_bytes: number }[]).reduce((a, f) => a + Number(f.size_bytes || 0), 0);

  // Opciones agrupadas por área (incluye los sistemas creados sin código)
  const modArea = new Map((mods ?? []).map((m: any) => [m.slug as string, (m.area as string) || 'otros']));
  const areaOf = (h: string) => (h.startsWith('/app/m/') ? modArea.get(h.slice(7)) ?? 'otros' : areaOfHref(areasCfg, h));
  const options = nav.filter((i) => i.href !== '/app' && i.href !== '/app/perfil' && i.href !== '/app/mantencion' && i.href !== '/app/actualizar');
  for (const m of (mods ?? []) as any[]) if (!options.some((o) => o.href === `/app/m/${m.slug}`)) options.push({ href: `/app/m/${m.slug}`, label: m.name, icon: m.icon || '🧩' });
  const groups = [...areasCfg.areas.map((a) => ({ key: a.key, title: a.title, icon: a.icon })), { key: 'otros', title: 'Otros', icon: '📁' }]
    .map((a) => ({ ...a, items: options.filter((o) => (areaOf(o.href) ?? 'otros') === a.key) }))
    .filter((g) => g.items.length);
  const label = (k: string) => maint.items[k]?.label || (k.startsWith('area:') ? `Área ${groups.find((g) => `area:${g.key}` === k)?.title ?? k.slice(5)}` : options.find((o) => o.href === k)?.label ?? k);
  const current = Object.entries(maint.items);
  const g = maint.global;
  const globalOn = g.on && isActive(g);

  return (
    <div>
      <PageHeader title="🛠 Centro de mantención" subtitle="Ponga en mantención toda la plataforma, un módulo, un sistema o un área, con su aviso y horario. Usted sigue entrando para trabajar; los demás ven el aviso." />

      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4" data-testid="estado-plataforma">
        <Stat label="Mejoras de la base" value={pending === null ? '—' : pending.length === 0 ? '✓ Al día' : `${pending.length} pendiente${pending.length > 1 ? 's' : ''}`} href={ctx.isPlatformAdmin ? '/app/actualizar' : undefined} hint={pending?.length ? 'Instálelas en «Actualizar sistema»' : undefined} />
        <Stat label="Correos (7 días)" value={`${mailOk.count ?? 0} enviados`} hint={mailFail.count ? `⚠ ${mailFail.count} con error` : 'Sin errores'} href="/app/configuracion" />
        <Stat label="Archivos guardados" value={size(used)} hint={`${files.data?.length ?? 0} archivos`} href="/app/archivos" />
        <Stat label="Comunidad" value={`${students.count ?? 0} estudiantes`} hint={`${teachers.count ?? 0} profesores · ${sections.count ?? 0} secciones`} />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="🌐 Toda la plataforma">
          <p className="mb-3 text-sm">
            Estado: {globalOn ? <Badge color="amber">🛠 En mantención</Badge> : g.on ? state(g) : <Badge color="green">✓ Disponible para todos</Badge>}
            {g.on && g.until && <span className="ml-2 text-xs text-slate-500">hasta {fmtDateTime(g.until)}</span>}
          </p>
          {g.on ? (
            <ActionForm action={setGlobalMaintenance} submitLabel="✓ Terminar mantención y abrir para todos" submitClass="btn-primary">
              <input type="hidden" name="on" value="0" />
            </ActionForm>
          ) : (
            <ActionForm action={setGlobalMaintenance} submitLabel="🛠 Poner toda la plataforma en mantención" submitClass="btn-danger" confirm="¿Poner toda la plataforma en mantención? Los usuarios verán el aviso (pueden entrar a «Mi cuenta»).">
              <input type="hidden" name="on" value="1" />
              <label className="text-sm">Aviso para los usuarios<textarea name="message" rows={2} maxLength={300} className="input mt-1 w-full" data-testid="mensaje-global" placeholder="Estamos mejorando la plataforma. Volvemos a las 14:00." /></label>
              <When />
            </ActionForm>
          )}
        </Card>

        <Card title="📋 En mantención ahora" actions={current.length > 0 ? (
          <ActionForm action={endMaintenance} inline submitLabel="Terminar todo" submitClass="btn-secondary text-xs" confirm="¿Terminar toda la mantención?"><input type="hidden" name="key" value="*" /></ActionForm>
        ) : undefined}>
          {current.length === 0 ? <p className="text-sm text-slate-500" data-testid="nada-en-mantencion">Nada en mantención: todo está disponible.</p> : (
            <ul className="divide-y" data-testid="lista-mantencion">
              {current.map(([k, v]) => (
                <li key={k} className="flex flex-wrap items-center gap-2 py-2 text-sm" data-testid="item-mantencion">
                  <span className="font-semibold">{k.startsWith('area:') ? '🗂' : '🧩'} {label(k)}</span> {state(v)}
                  {v.until && <span className="text-xs text-slate-500">hasta {fmtDateTime(v.until)}</span>}
                  {v.message && <span className="w-full text-xs text-slate-500">«{v.message}»</span>}
                  <span className="ml-auto"><ActionForm action={endMaintenance} inline submitLabel="✓ Terminar" submitClass="btn-secondary text-xs"><input type="hidden" name="key" value={k} /></ActionForm></span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card title="🧩 Mantención por área, módulo o sistema" className="mt-6">
        <ActionForm action={setItemsMaintenance} submitLabel="🛠 Poner en mantención lo elegido" resetOnSuccess>
          <p className="text-sm text-slate-600">Marque un área completa o solo algunas opciones. Lo que quede en mantención aparece con 🛠 en el menú.</p>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3" data-testid="opciones-mantencion">
            {groups.map((gr) => (
              <fieldset key={gr.key} className="rounded-xl border p-3">
                <label className="flex items-center gap-2 font-semibold">
                  <input type="checkbox" name="keys" value={`area:${gr.key}`} data-testid={`area-${gr.key}`} /> {gr.icon} {gr.title} <span className="text-xs font-normal text-slate-500">(área completa)</span>
                  <input type="hidden" name="labels" value={`area:${gr.key}|Área ${gr.title}`} />
                </label>
                <div className="mt-2 space-y-1 pl-6">
                  {gr.items.map((o) => (
                    <label key={o.href} className="flex items-center gap-2 text-sm">
                      <input type="checkbox" name="keys" value={o.href} data-testid={`opcion-${o.href.replace(/\//g, '_')}`} /> {o.icon} {o.label.replace(' · 🛠', '')}
                      {isActive(maint.items[o.href]) && <Badge color="amber">🛠</Badge>}
                      <input type="hidden" name="labels" value={`${o.href}|${o.label.replace(' · 🛠', '')}`} />
                    </label>
                  ))}
                </div>
              </fieldset>
            ))}
          </div>
          <label className="text-sm">Aviso para los usuarios<textarea name="message" rows={2} maxLength={300} className="input mt-1 w-full" data-testid="mensaje-items" placeholder="Estamos actualizando esta sección. Vuelve pronto." /></label>
          <When />
        </ActionForm>
      </Card>

      <Card title="⚡ Agregar, eliminar o arreglar (sin tocar código)" className="mt-6">
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3" data-testid="accesos-mantencion">
          {[
            ['/app/modulos?t=areas', '🗂 Áreas', 'Crear, renombrar, ocultar o eliminar áreas'],
            ['/app/modulos', '🧩 Módulos y sistemas', 'Crear, duplicar, importar o eliminar sistemas'],
            ['/app/modulos?t=plantillas', '📦 Plantillas', 'Sistemas listos para reutilizar'],
            ['/app/modulos?t=menu', '☰ Menú', 'Nombres, orden y opciones ocultas'],
            ['/app/papelera', '🗑 Papelera', 'Restaurar lo eliminado'],
            ['/app/auditoria', '📜 Auditoría', 'Quién cambió qué y cuándo'],
            ['/app/ciberseguridad', '🛡 Ciberseguridad', 'Sesiones, alertas e incidentes'],
            ['/app/configuracion', '⚙ Configuración', 'Correo, datos de la institución y más'],
            ...(ctx.isPlatformAdmin ? [['/app/actualizar', '⬆ Actualizar sistema', 'Instalar mejoras de la base de datos']] : []),
          ].map(([href, t, d]) => (
            <a key={href} href={href} className="rounded-xl border p-3 hover:bg-slate-50">
              <p className="font-semibold">{t}</p><p className="text-xs text-slate-500">{d}</p>
            </a>
          ))}
        </div>
      </Card>
    </div>
  );
}
