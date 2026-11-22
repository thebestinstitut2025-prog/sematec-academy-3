import { getContext } from '@/lib/context';
import { buildNav } from '@/lib/nav-items';
import { PageHeader } from '@/components/ui';
import { MAP_DESC } from '@/lib/platform-map';
import { areaOfHref, loadAreas } from '@/lib/areas';
import { MapView } from './map-view';

export const metadata = { title: 'Mapa de la plataforma' };
export const dynamic = 'force-dynamic';

/** 🗺 Todos los sistemas de la plataforma a los que la persona tiene acceso, ordenados por área. */
export default async function Page() {
  const ctx = await getContext();
  const items = (await buildNav(ctx)).filter((i) => i.href !== '/app/mapa');
  const { data: sysRows } = ctx.orgId ? await ctx.supabase.rpc('my_systems', { p_org: ctx.orgId }) : { data: [] };
  const systems = (sysRows ?? []) as { slug: string; name: string; icon: string; area: string | null; description: string | null }[];
  const cfg = await loadAreas(ctx.supabase, ctx.orgId);
  const visible = new Set(cfg.areas.filter((a) => !a.hidden || a.key === 'otros').map((a) => a.key));
  const eff = (k: string | null | undefined) => (k && visible.has(k) ? k : 'otros');   // área oculta o borrada → «otros»
  const clean = (l: string) => l.replace(/ · 📨 \d+$/, '');
  const sysHrefs = new Set(systems.map((x) => `/app/m/${x.slug}`));
  const baseItems = items.filter((i) => !sysHrefs.has(i.href));
  // Cada área (en el orden y con el nombre que eligió la institución) junta opciones base y sistemas
  const groups = cfg.areas.filter((a) => visible.has(a.key)).map((a) => ({
    key: a.key, title: a.title, icon: a.icon, color: a.color,
    items: [
      ...baseItems.filter((i) => eff(areaOfHref(cfg, i.href)) === a.key).map((i) => ({ href: i.href, label: clean(i.label), icon: i.icon, desc: MAP_DESC[i.href] ?? 'Módulo de la institución' })),
      ...systems.filter((x) => eff(x.area) === a.key).map((x) => ({ href: `/app/m/${x.slug}`, label: x.name, icon: x.icon, desc: x.description ?? '' })),
    ],
  }));
  const all = groups.filter((g) => g.items.length);
  const total = all.reduce((n, g) => n + g.items.length, 0);
  return (
    <div>
      <PageHeader title="🗺 Mapa de la plataforma" subtitle={`${total} sistemas en ${all.length} áreas, según sus permisos. Busque o entre directamente a cualquiera.`} />
      <MapView groups={all} />
    </div>
  );
}
