/**
 * 🛠 Mantención: toda la plataforma, o solo algunas opciones del menú, sistemas o áreas.
 * Se guarda en organization_settings («maintenance»). El propietario y quien administra la
 * configuración siguen entrando para trabajar; los demás ven un aviso con el mensaje y la hora.
 */
export const MAINT_KEY = 'maintenance';
export type MaintItem = { message?: string; from?: string | null; until?: string | null; label?: string };
export type MaintConfig = { global: MaintItem & { on: boolean }; items: Record<string, MaintItem> };

const clean = (s: unknown, n: number) => String(s ?? '').replace(/[<>]/g, '').trim().slice(0, n);
const iso = (s: unknown) => (typeof s === 'string' && !Number.isNaN(Date.parse(s)) ? new Date(s).toISOString() : null);
export const isMaintKey = (k: string) => /^\/app(\/[a-z0-9_-]+)+$/.test(k) || /^area:[a-z0-9_]{2,24}$/.test(k);

export function cleanMaint(raw: unknown): MaintConfig {
  const r = (raw && typeof raw === 'object' ? raw : {}) as { global?: any; items?: any };
  const items: Record<string, MaintItem> = {};
  if (r.items && typeof r.items === 'object') {
    for (const [k, v] of Object.entries(r.items).slice(0, 300)) {
      if (!isMaintKey(k)) continue;
      const x = (v ?? {}) as any;
      items[k] = { message: clean(x.message, 300), from: iso(x.from), until: iso(x.until), label: clean(x.label, 80) };
    }
  }
  const g = r.global ?? {};
  return { global: { on: g.on === true, message: clean(g.message, 300), from: iso(g.from), until: iso(g.until) }, items };
}

/** ¿Está vigente ahora? (si tiene «desde», empieza a esa hora; si tiene «hasta», termina sola). */
export function isActive(i: MaintItem | undefined, now = Date.now()) {
  if (!i) return false;
  if (i.from && Date.parse(i.from) > now) return false;
  if (i.until && Date.parse(i.until) <= now) return false;
  return true;
}

export async function loadMaint(supabase: { from: (t: string) => any }, orgId: string | null): Promise<MaintConfig> {
  if (!orgId) return cleanMaint(null);
  const { data } = await supabase.from('organization_settings').select('value').eq('organization_id', orgId).eq('key', MAINT_KEY).maybeSingle();
  return cleanMaint(data?.value ?? null);
}

/** Rutas que nunca se bloquean (para poder salir, ver su cuenta o arreglar). */
const ALWAYS = ['/app/perfil', '/app/mantencion', '/app/actualizar'];

/**
 * ¿Esta página está en mantención? Devuelve el aviso a mostrar o null.
 * hrefs: opciones del menú (para saber a cuál pertenece la ruta); areaOf: área de cada opción.
 */
export function maintFor(cfg: MaintConfig, path: string, hrefs: string[], areaOf: (href: string) => string | null): (MaintItem & { what: string }) | null {
  if (!path.startsWith('/app') || ALWAYS.some((a) => path === a || path.startsWith(`${a}/`))) return null;
  if (cfg.global.on && isActive(cfg.global)) return { ...cfg.global, what: 'La plataforma' };
  // Opción del menú más específica que contiene esta ruta
  const href = hrefs.filter((h) => h !== '/app' && (path === h || path.startsWith(`${h}/`))).sort((a, b) => b.length - a.length)[0];
  for (const [k, v] of Object.entries(cfg.items)) {
    if (!k.startsWith('/app') || !isActive(v)) continue;
    if (path === k || path.startsWith(`${k}/`)) return { ...v, what: v.label || 'Esta sección' };
  }
  if (href) {
    const area = areaOf(href);
    const a = area ? cfg.items[`area:${area}`] : undefined;
    if (a && isActive(a)) return { ...a, what: a.label || 'Esta área' };
  }
  return null;
}

/** ¿Una opción del menú está en mantención? (para marcarla con 🛠) */
export function hrefInMaint(cfg: MaintConfig, href: string, area: string | null) {
  if (cfg.global.on && isActive(cfg.global)) return false;   // con todo en mantención no se marca cada opción
  if (isActive(cfg.items[href])) return true;
  return !!(area && isActive(cfg.items[`area:${area}`]));
}

export const canBypassMaint = (ctx: { isOwner?: boolean; isPlatformAdmin?: boolean; permissions?: Set<string> | string[] }) =>
  !!(ctx.isOwner || ctx.isPlatformAdmin);
