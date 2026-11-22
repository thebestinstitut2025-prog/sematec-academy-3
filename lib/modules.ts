/** Creador de módulos sin código: tipos de campo y utilidades compartidas. */
export const FIELD_TYPES = [
  ['text', 'Texto corto'], ['textarea', 'Texto largo'], ['number', 'Número'], ['money', 'Monto ($)'], ['date', 'Fecha'],
  ['email', 'Correo'], ['phone', 'Teléfono'], ['select', 'Lista de opciones'], ['checkbox', 'Sí / No'],
] as const;
export type FieldType = (typeof FIELD_TYPES)[number][0];
export type ModField = { key: string; label: string; type: FieldType; required?: boolean; options?: string[]; list?: boolean };
export type CustomModule = {
  id: string; slug: string; name: string; icon: string; description: string | null; code_prefix: string;
  fields: ModField[]; view_roles: string[]; edit_roles: string[]; show_in_menu: boolean; active: boolean;
  area?: string | null; catalog_key?: string | null;
  workflow?: { key: string; label: string; color: string; final?: boolean }[];
  features?: { self_service?: boolean; assignee?: boolean; due?: boolean; files?: boolean; notify?: boolean; amount?: string; date?: string; public_view?: boolean };
};

export const slugify = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
export const keyOf = (s: string) => slugify(s).replace(/-/g, '_').slice(0, 30) || 'campo';
/** Prefijo de 4 letras para los códigos automáticos (ej.: «Préstamos» → PRES). */
export const prefixOf = (s: string) => (s.normalize('NFD').replace(/[^A-Za-z]/g, '').toUpperCase() + 'XXXX').slice(0, 4);

/** Valida y limpia la lista de campos que llega del diseñador. */
export function cleanFields(raw: unknown): ModField[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const types = new Set(FIELD_TYPES.map(([t]) => t));
  const out: ModField[] = [];
  for (const f of raw.slice(0, 40)) {
    const label = String(f?.label ?? '').replace(/[<>]/g, '').trim().slice(0, 60);
    if (!label) continue;
    let key = keyOf(String(f?.key || label));
    while (seen.has(key)) key = `${key}_2`;
    seen.add(key);
    const type = (types.has(f?.type) ? f.type : 'text') as FieldType;
    const options = type === 'select'
      ? [...new Set(String(Array.isArray(f?.options) ? f.options.join(',') : f?.options ?? '').split(',').map((o) => o.replace(/[<>]/g, '').trim().slice(0, 60)).filter(Boolean))].slice(0, 50)
      : undefined;
    out.push({ key, label, type, required: !!f?.required, list: f?.list !== false, ...(options ? { options } : {}) });
  }
  return out;
}

export function showValue(f: ModField, v: unknown): string {
  if (v === null || v === undefined || v === '') return '';
  if (f.type === 'checkbox') return v === true || v === 'true' ? 'Sí' : 'No';
  if (f.type === 'money') return `$${Number(v).toLocaleString('es-CL')}`;
  if (f.type === 'date') { const [y, m, d] = String(v).split('-'); return d ? `${d}-${m}-${y}` : String(v); }
  return String(v);
}

// ---------- Estados (flujo) y funciones de un sistema ----------
export const WF_COLORS = [['blue', 'Azul'], ['amber', 'Amarillo'], ['green', 'Verde'], ['red', 'Rojo'], ['violet', 'Violeta'], ['slate', 'Gris']] as const;
export type WfStep = { key: string; label: string; color: string; final?: boolean };

/** Valida el flujo de estados: máx. 12, nombres únicos, colores permitidos. Los nombres nuevos reciben su clave. */
export function cleanWorkflow(raw: unknown): WfStep[] {
  if (!Array.isArray(raw)) return [];
  const colors = new Set(WF_COLORS.map(([c]) => c));
  const seen = new Set<string>(); const out: WfStep[] = [];
  for (const s of raw.slice(0, 12)) {
    const label = String(s?.label ?? '').replace(/[<>]/g, '').trim().slice(0, 40);
    if (!label) continue;
    let key = keyOf(String(s?.key || label)).slice(0, 30);
    while (seen.has(key)) key = `${key}_2`;
    seen.add(key);
    out.push({ key, label, color: colors.has(s?.color) ? s.color : 'blue', ...(s?.final ? { final: true } : {}) });
  }
  return out;
}

export const FEATURE_LIST = [
  ['assignee', '👤 Responsable de cada registro'], ['due', '📅 Fecha límite'], ['files', '📎 Archivos adjuntos'],
  ['notify', '✉ Aviso por correo al cambiar de estado'], ['self_service', '🙋 Autoservicio: cualquier persona de la institución envía solicitudes y ve solo las suyas'],
] as const;

/** Estructura reutilizable de un módulo (sin registros): para duplicar, plantillas y exportar. */
export type ModuleBlueprint = {
  name: string; icon: string; description: string | null; code_prefix: string; fields: ModField[];
  workflow: WfStep[]; features: Record<string, unknown>; area: string | null; view_roles: string[]; edit_roles: string[];
};

export function blueprintOf(m: Partial<CustomModule> & Record<string, any>): ModuleBlueprint {
  return {
    name: String(m.name ?? 'Módulo').slice(0, 80), icon: String(m.icon ?? '🧩').slice(0, 8), description: m.description ?? null,
    code_prefix: String(m.code_prefix ?? ''), fields: cleanFields(m.fields), workflow: cleanWorkflow(m.workflow),
    features: cleanFeatures(m.features), area: typeof m.area === 'string' ? m.area.slice(0, 24) : null,
    view_roles: Array.isArray(m.view_roles) ? m.view_roles.filter((r: unknown) => typeof r === 'string' && /^[a-z_]{2,40}$/.test(r)).slice(0, 30) : [],
    edit_roles: Array.isArray(m.edit_roles) ? m.edit_roles.filter((r: unknown) => typeof r === 'string' && /^[a-z_]{2,40}$/.test(r)).slice(0, 30) : [],
  };
}

export function cleanFeatures(raw: unknown): Record<string, unknown> {
  const f = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [k] of FEATURE_LIST) if (f[k] === true) out[k] = true;
  for (const k of ['amount', 'date'] as const) if (typeof f[k] === 'string' && /^[a-z0-9_]{1,30}$/.test(f[k] as string)) out[k] = f[k];
  if (f.public_view === true) out.public_view = true;
  return out;
}
