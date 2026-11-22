/**
 * 🗂 Áreas de la plataforma, editables sin código.
 * Una sola lista ordenada que agrupa las opciones base (Gestión académica, Finanzas…),
 * las áreas de los sistemas (Bienestar, Operaciones…) y las áreas propias que cree la institución.
 * Se guarda en organization_settings («areas.custom»).
 */
import { MAP_GROUPS } from '@/lib/platform-map';
import { AREAS } from '@/lib/systems-catalog';

export type AreaKind = 'base' | 'sistemas' | 'propia';
export type AreaDef = { key: string; title: string; icon: string; color: string; text: string; hidden?: boolean; kind: AreaKind };
export type AreasConfig = { areas: AreaDef[]; place: Record<string, string> };
export const AREAS_KEY = 'areas.custom';

/** Colores disponibles (clases completas para que el diseño las incluya). */
export const AREA_COLORS: { value: string; name: string }[] = [
  { value: 'from-blue-700 to-indigo-500', name: 'Azul' },
  { value: 'from-sky-700 to-cyan-500', name: 'Celeste' },
  { value: 'from-emerald-700 to-teal-500', name: 'Verde agua' },
  { value: 'from-emerald-700 to-lime-500', name: 'Verde' },
  { value: 'from-lime-700 to-green-500', name: 'Lima' },
  { value: 'from-amber-600 to-orange-500', name: 'Naranjo' },
  { value: 'from-orange-700 to-amber-500', name: 'Ámbar' },
  { value: 'from-rose-700 to-pink-500', name: 'Rosado' },
  { value: 'from-rose-800 to-fuchsia-500', name: 'Fucsia' },
  { value: 'from-red-700 to-rose-500', name: 'Rojo' },
  { value: 'from-violet-700 to-fuchsia-500', name: 'Violeta' },
  { value: 'from-indigo-700 to-sky-500', name: 'Índigo' },
  { value: 'from-slate-700 to-slate-500', name: 'Gris' },
  { value: 'from-zinc-800 to-zinc-600', name: 'Negro' },
];
const COLOR_SET = new Set(AREA_COLORS.map((c) => c.value));
export const AREA_ICONS = ['🏛', '🎓', '💬', '💼', '💳', '🧾', '🛡', '👤', '💚', '🛠', '⚖', '🧩', '📚', '🏥', '⚽', '🎨', '🔬', '🌎', '🏢', '🚚', '📦', '🍽', '🎵', '⭐', '📣', '🤝', '🧪', '🗂'];

/** Áreas de fábrica, en su orden original. */
export function defaultAreas(): AreaDef[] {
  return [
    ...MAP_GROUPS.map((g) => ({ key: g.key, title: g.title, icon: g.icon, color: g.color, text: '', kind: 'base' as const })),
    ...Object.entries(AREAS).map(([key, a]) => ({ key, title: a.title, icon: a.icon, color: a.color, text: a.text, kind: 'sistemas' as const })),
    { key: 'otros', title: 'Módulos propios de la institución', icon: '🧩', color: 'from-lime-700 to-green-500', text: '', kind: 'sistemas' as const },
  ];
}

/** Área a la que pertenece cada opción base del menú, de fábrica. */
export function defaultPlace(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const g of MAP_GROUPS) for (const h of g.hrefs) out[h] = g.key;
  return out;
}

const clean = (s: unknown, max: number) => String(s ?? '').replace(/[<>]/g, '').trim().slice(0, max);
export const isCustomKey = (k: string) => /^x_[a-z0-9]{4,16}$/.test(k);

/** Une lo guardado con las áreas de fábrica (las nuevas de fábrica aparecen al final). Valida todo. */
export function mergeAreas(saved: unknown): AreasConfig {
  const defs = defaultAreas();
  const byKey = new Map(defs.map((d) => [d.key, d]));
  const out: AreaDef[] = []; const seen = new Set<string>();
  const raw = (saved && typeof saved === 'object' ? (saved as { areas?: unknown }).areas : null);
  if (Array.isArray(raw)) {
    for (const a of raw.slice(0, 80)) {
      const key = clean(a?.key, 24);
      if (!key || seen.has(key)) continue;
      const base = byKey.get(key);
      if (!base && !isCustomKey(key)) continue;
      const title = clean(a?.title, 60) || base?.title || 'Área';
      const icon = clean(a?.icon, 8) || base?.icon || '🗂';
      const color = COLOR_SET.has(a?.color) ? a.color : base?.color ?? AREA_COLORS[0].value;
      out.push({ key, title, icon, color, text: clean(a?.text, 200), hidden: !!a?.hidden, kind: base?.kind ?? 'propia' });
      seen.add(key);
    }
  }
  for (const d of defs) if (!seen.has(d.key)) out.push(d);
  const place: Record<string, string> = {};
  const p = saved && typeof saved === 'object' ? (saved as { place?: unknown }).place : null;
  if (p && typeof p === 'object') {
    const keys = new Set(out.map((a) => a.key));
    for (const [h, k] of Object.entries(p as Record<string, unknown>)) if (/^\/app[a-z0-9/_-]*$/.test(h) && typeof k === 'string' && keys.has(k)) place[h] = k;
  }
  return { areas: out, place };
}

/** Lee la configuración de áreas de la institución. */
export async function loadAreas(supabase: { from: (t: string) => any }, orgId: string | null): Promise<AreasConfig> {
  if (!orgId) return mergeAreas(null);
  const { data } = await supabase.from('organization_settings').select('value').eq('organization_id', orgId).eq('key', AREAS_KEY).maybeSingle();
  return mergeAreas(data?.value ?? null);
}

/** Área de una opción base del menú (la elegida por la institución o la de fábrica). */
export function areaOfHref(cfg: AreasConfig, href: string): string | null {
  return cfg.place[href] ?? defaultPlace()[href] ?? null;
}
