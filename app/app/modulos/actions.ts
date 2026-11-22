'use server';
import { revalidatePath } from 'next/cache';
import { getContext, requireOrg } from '@/lib/context';
import { fail, guard, ok, reqStr, str, ValidationError, type ActionResult } from '@/lib/actions';
import { blueprintOf, cleanFeatures, cleanFields, cleanWorkflow, FEATURE_LIST, prefixOf, slugify, type CustomModule, type ModuleBlueprint } from '@/lib/modules';
import { AREAS_KEY, isCustomKey, loadAreas, mergeAreas } from '@/lib/areas';
import { LOCKED, baseNav } from '@/lib/nav-items';

const refresh = () => revalidatePath('/app', 'layout');
const roles = (fd: FormData, k: string) => fd.getAll(k).map(String).filter((r) => /^[a-z_]{2,40}$/.test(r)).slice(0, 30);

async function owner() {
  const ctx = await getContext();
  const orgId = requireOrg(ctx);
  if (!ctx.isOwner) throw new ValidationError('Solo el propietario puede crear o editar módulos y el menú.');
  return { ctx, orgId };
}

/** Slug libre para un módulo nuevo. */
async function freeSlug(ctx: Awaited<ReturnType<typeof getContext>>, orgId: string, name: string) {
  let base = slugify(name) || 'modulo';
  if (base.length < 2) base = `${base}-m`;
  const { data: taken } = await ctx.supabase.from('custom_modules').select('slug').eq('organization_id', orgId).like('slug', `${base.slice(0, 36)}%`);
  const used = new Set((taken ?? []).map((t: any) => t.slug));
  let slug = base;
  for (let n = 2; used.has(slug); n++) slug = `${base.slice(0, 36)}-${n}`;
  return slug;
}

/** Crea un módulo a partir de una estructura (duplicar, plantilla o importación). */
async function createFromBlueprint(ctx: Awaited<ReturnType<typeof getContext>>, orgId: string, bp: ModuleBlueprint, opts: { active?: boolean } = {}) {
  if (!bp.fields.length) throw new ValidationError(`«${bp.name}» no tiene campos.`);
  const cfg = await loadAreas(ctx.supabase, orgId);
  const area = bp.area && cfg.areas.some((a) => a.key === bp.area) ? bp.area : null;
  const slug = await freeSlug(ctx, orgId, bp.name);
  const { data, error } = await ctx.supabase.from('custom_modules').insert({
    organization_id: orgId, slug, name: bp.name, icon: bp.icon, description: bp.description,
    code_prefix: /^[A-Z]{4}$/.test(bp.code_prefix) ? bp.code_prefix : prefixOf(bp.name), fields: bp.fields,
    workflow: bp.workflow, features: bp.features, area, view_roles: bp.view_roles, edit_roles: bp.edit_roles,
    show_in_menu: true, active: opts.active ?? true,
  }).select('id, slug').single();
  if (error) throw new ValidationError(error.message);
  return data as { id: string; slug: string };
}

/** 🧩 Crea o edita un módulo: nombre, ícono, área, campos, estados, funciones, quién lo ve y quién lo edita. */
export async function saveModule(fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const { ctx, orgId } = await owner();
    const id = str(fd, 'id');
    const name = reqStr(fd, 'name', 'Nombre').replace(/[<>]/g, '').slice(0, 80);
    let fields, workflow;
    try { fields = cleanFields(JSON.parse(String(fd.get('fields') ?? '[]'))); } catch { throw new ValidationError('Los campos no son válidos.'); }
    if (!fields.length) throw new ValidationError('Agregue al menos un campo (por ejemplo «Nombre»).');
    try { workflow = cleanWorkflow(JSON.parse(String(fd.get('workflow') ?? '[]'))); } catch { throw new ValidationError('Los estados no son válidos.'); }
    const cfg = await loadAreas(ctx.supabase, orgId);
    const areaIn = str(fd, 'area');
    const area = areaIn && cfg.areas.some((a) => a.key === areaIn) ? areaIn : null;
    const prefix = (str(fd, 'code_prefix') ?? '').toUpperCase().replace(/[^A-Z]/g, '');
    const feat: Record<string, unknown> = {};
    for (const [k] of FEATURE_LIST) if (fd.get(`feat_${k}`) === 'on') feat[k] = true;
    const row: Record<string, unknown> = {
      name, icon: (str(fd, 'icon') ?? '🧩').slice(0, 8), description: str(fd, 'description')?.slice(0, 500) ?? null,
      code_prefix: prefix.length === 4 ? prefix : prefixOf(name), fields, area,
      view_roles: roles(fd, 'view_roles'), edit_roles: roles(fd, 'edit_roles'),
      show_in_menu: fd.get('show_in_menu') === 'on', active: fd.getAll('active').includes('on'),
    };
    if (fd.get('has_workflow') === '1') row.workflow = workflow;
    if (id) {
      const { data: cur } = await ctx.supabase.from('custom_modules').select('features, workflow').eq('id', id).eq('organization_id', orgId).maybeSingle();
      if (!cur) return fail('Módulo no encontrado.');
      // Conserva ajustes que no se editan aquí (totales, fecha principal, vista pública)
      const keep = cleanFeatures(cur.features); for (const [k] of FEATURE_LIST) delete keep[k];
      if (fd.get('has_features') === '1') row.features = { ...keep, ...feat };
      // No se puede quitar un estado que todavía tiene registros
      if (row.workflow) {
        const now = new Set((row.workflow as { key: string }[]).map((w) => w.key));
        const gone = ((cur.workflow ?? []) as { key: string; label: string }[]).filter((w) => !now.has(w.key));
        for (const g of gone) {
          const { count } = await ctx.supabase.from('custom_records').select('id', { count: 'exact', head: true }).eq('module_id', id).eq('status', g.key);
          if (count) return fail(`El estado «${g.label}» tiene ${count} registro(s): cámbielos de estado antes de quitarlo.`);
        }
      }
      const { error } = await ctx.supabase.from('custom_modules').update(row).eq('id', id).eq('organization_id', orgId);
      if (error) return fail(error);
      refresh(); return ok(`Módulo «${name}» actualizado.`);
    }
    row.features = feat;
    const slug = await freeSlug(ctx, orgId, name);
    const { error } = await ctx.supabase.from('custom_modules').insert({ ...row, slug, organization_id: orgId });
    if (error) return fail(error);
    refresh(); return ok(`Módulo «${name}» creado: ya aparece en el menú.`, { slug });
  });
}

/** 📄 Duplica un módulo (misma estructura, sin registros). */
export async function duplicateModule(fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const { ctx, orgId } = await owner();
    const { data: m } = await ctx.supabase.from('custom_modules').select('*').eq('id', reqStr(fd, 'id', 'Módulo')).eq('organization_id', orgId).maybeSingle();
    if (!m) return fail('Módulo no encontrado.');
    const bp = blueprintOf(m); bp.name = `${bp.name} (copia)`.slice(0, 80);
    const r = await createFromBlueprint(ctx, orgId, bp);
    refresh(); return ok(`Se creó «${bp.name}» con los mismos campos, estados y permisos (sin registros).`, { slug: r.slug });
  });
}

// ---------- 📦 Plantillas reutilizables ----------
const TPL_KEY = 'modules.templates';
type Tpl = ModuleBlueprint & { id: string; saved_at: string };
async function readTemplates(ctx: Awaited<ReturnType<typeof getContext>>, orgId: string) {
  const { data } = await ctx.supabase.from('organization_settings').select('id, value').eq('organization_id', orgId).eq('key', TPL_KEY).maybeSingle();
  const list = Array.isArray((data?.value as any)?.items) ? ((data!.value as any).items as Tpl[]) : [];
  return { rowId: data?.id as string | undefined, list };
}
async function writeSetting(ctx: Awaited<ReturnType<typeof getContext>>, orgId: string, key: string, value: unknown, description: string) {
  const { data: existing } = await ctx.supabase.from('organization_settings').select('id').eq('organization_id', orgId).eq('key', key).maybeSingle();
  const { error } = existing
    ? await ctx.supabase.from('organization_settings').update({ value, updated_by: ctx.user.id }).eq('id', existing.id)
    : await ctx.supabase.from('organization_settings').insert({ organization_id: orgId, key, value, description, updated_by: ctx.user.id });
  if (error) throw new ValidationError(error.message);
}

export async function saveAsTemplate(fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const { ctx, orgId } = await owner();
    const { data: m } = await ctx.supabase.from('custom_modules').select('*').eq('id', reqStr(fd, 'id', 'Módulo')).eq('organization_id', orgId).maybeSingle();
    if (!m) return fail('Módulo no encontrado.');
    const { list } = await readTemplates(ctx, orgId);
    if (list.length >= 60) return fail('Ya tiene 60 plantillas: elimine alguna antes de guardar otra.');
    const tpl: Tpl = { ...blueprintOf(m), id: crypto.randomUUID(), saved_at: new Date().toISOString() };
    await writeSetting(ctx, orgId, TPL_KEY, { items: [tpl, ...list] }, 'Plantillas de módulos');
    revalidatePath('/app/modulos');
    return ok(`«${tpl.name}» quedó guardado como plantilla: úsela para crear módulos iguales cuando quiera.`);
  });
}

export async function applyTemplate(fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const { ctx, orgId } = await owner();
    const { list } = await readTemplates(ctx, orgId);
    const t = list.find((x) => x.id === reqStr(fd, 'tpl', 'Plantilla'));
    if (!t) return fail('La plantilla ya no existe.');
    const bp = blueprintOf(t);
    const name = str(fd, 'name')?.replace(/[<>]/g, '').slice(0, 80); if (name) bp.name = name;
    const r = await createFromBlueprint(ctx, orgId, bp);
    refresh(); return ok(`Módulo «${bp.name}» creado desde la plantilla.`, { slug: r.slug });
  });
}

export async function deleteTemplate(fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const { ctx, orgId } = await owner();
    const { list } = await readTemplates(ctx, orgId);
    const id = reqStr(fd, 'tpl', 'Plantilla');
    await writeSetting(ctx, orgId, TPL_KEY, { items: list.filter((x) => x.id !== id) }, 'Plantillas de módulos');
    revalidatePath('/app/modulos');
    return ok('Plantilla eliminada (los módulos creados con ella no cambian).');
  });
}

/** ⬆ Importa módulos (y áreas) desde un archivo exportado de esta u otra institución. */
export async function importModules(fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const { ctx, orgId } = await owner();
    const file = fd.get('file');
    if (!(file instanceof File) || !file.size) return fail('Elija el archivo .json exportado.');
    if (file.size > 2 * 1024 * 1024) return fail('El archivo es demasiado grande (máx. 2 MB).');
    let pkg: any;
    try { pkg = JSON.parse(await file.text()); } catch { return fail('El archivo no es un paquete válido (.json exportado desde «Módulos y menú»).'); }
    if (pkg?.formato !== 'sematec.modulos' || !Array.isArray(pkg.modulos)) return fail('El archivo no es un paquete de módulos de la plataforma.');
    if (pkg.modulos.length > 150) return fail('El paquete trae demasiados módulos (máx. 150).');
    // Áreas propias del paquete que la institución todavía no tiene
    let areasAdded = 0;
    if (fd.get('with_areas') === 'on' && pkg.areas) {
      const cur = await loadAreas(ctx.supabase, orgId);
      const inc = mergeAreas(pkg.areas);
      const have = new Set(cur.areas.map((a) => a.key));
      const add = inc.areas.filter((a) => a.kind === 'propia' && !have.has(a.key));
      if (add.length) { await writeSetting(ctx, orgId, AREAS_KEY, { areas: [...cur.areas, ...add], place: cur.place }, 'Áreas de la plataforma'); areasAdded = add.length; }
    }
    let n = 0; const errs: string[] = [];
    for (const raw of pkg.modulos) {
      try { await createFromBlueprint(ctx, orgId, blueprintOf(raw)); n++; } catch (e) { errs.push(`${String(raw?.name ?? '?').slice(0, 40)}: ${(e as Error).message}`); }
    }
    refresh();
    if (!n) return fail(`No se importó ningún módulo. ${errs.slice(0, 3).join(' · ')}`);
    return ok(`Se importaron ${n} módulo(s)${areasAdded ? ` y ${areasAdded} área(s)` : ''}.${errs.length ? ` No se pudieron ${errs.length}: ${errs.slice(0, 3).join(' · ')}` : ''}`);
  });
}

// ---------- 🗂 Áreas ----------
export async function saveAreas(fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const { ctx, orgId } = await owner();
    let raw: any;
    try { raw = JSON.parse(String(fd.get('config') ?? '{}')); } catch { return fail('Datos de áreas no válidos.'); }
    // Las áreas nuevas llegan con clave «nueva»: se les da una clave propia
    if (Array.isArray(raw?.areas)) for (const a of raw.areas) if (a && (a.new || !a.key)) a.key = `x_${crypto.randomUUID().replace(/-/g, '').slice(0, 10)}`;
    const before = await loadAreas(ctx.supabase, orgId);
    const cfg = mergeAreas(raw);
    const otros = cfg.areas.find((a) => a.key === 'otros'); if (otros) otros.hidden = false;
    // Áreas propias borradas: sus sistemas pasan a «Módulos propios»
    const now = new Set(cfg.areas.map((a) => a.key));
    const gone = before.areas.filter((a) => a.kind === 'propia' && !now.has(a.key)).map((a) => a.key);
    if (gone.length) await ctx.supabase.from('custom_modules').update({ area: null }).eq('organization_id', orgId).in('area', gone);
    await writeSetting(ctx, orgId, AREAS_KEY, cfg, 'Áreas de la plataforma');
    refresh();
    return ok(`Áreas guardadas (${cfg.areas.filter((a) => !a.hidden).length} visibles${gone.length ? `, ${gone.length} eliminada(s): sus sistemas pasaron a «Módulos propios»` : ''}).`);
  });
}

/** Mueve un módulo a otra área. */
export async function moveModule(fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const { ctx, orgId } = await owner();
    const cfg = await loadAreas(ctx.supabase, orgId);
    const k = str(fd, 'area');
    const area = k && cfg.areas.some((a) => a.key === k) ? k : null;
    const { error } = await ctx.supabase.from('custom_modules').update({ area }).eq('id', reqStr(fd, 'id', 'Módulo')).eq('organization_id', orgId);
    if (error) return fail(error);
    refresh(); return ok('Módulo movido de área.');
  });
}

/** Activa o desactiva un módulo (sus registros se conservan). */
export async function toggleModule(fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const { ctx, orgId } = await owner();
    const on = fd.get('on') === '1';
    const { error } = await ctx.supabase.from('custom_modules').update({ active: on }).eq('id', reqStr(fd, 'id', 'Módulo')).eq('organization_id', orgId);
    if (error) return fail(error);
    refresh(); return ok(on ? 'Módulo activado.' : 'Módulo desactivado: no aparece, pero sus registros se conservan.');
  });
}

export async function deleteModule(fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const { ctx, orgId } = await owner();
    const { data, error } = await ctx.supabase.from('custom_modules').delete().eq('id', reqStr(fd, 'id', 'Módulo')).eq('organization_id', orgId).select('name');
    if (error) return fail(error);
    if (!data?.length) return fail('Módulo no encontrado.');
    refresh(); return ok(`Módulo «${data[0].name}» eliminado (puede deshacerlo con ↶).`);
  });
}

/** ☰ Personaliza el menú: cambiar nombres y ocultar opciones. */
export async function saveMenu(fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const { ctx, orgId } = await owner();
    const hrefs = new Set(baseNav(ctx).map((i) => i.href));
    const hidden = fd.getAll('hide').map(String).filter((h) => hrefs.has(h) && !LOCKED.has(h));
    const labels: Record<string, string> = {};
    for (const h of hrefs) {
      const v = String(fd.get(`label:${h}`) ?? '').replace(/[<>]/g, '').trim().slice(0, 40);
      if (v) labels[h] = v;
    }
    const value = { hidden, labels };
    const { data: existing } = await ctx.supabase.from('organization_settings').select('id').eq('organization_id', orgId).eq('key', 'menu.custom').maybeSingle();
    const { error } = existing
      ? await ctx.supabase.from('organization_settings').update({ value, updated_by: ctx.user.id }).eq('id', existing.id)
      : await ctx.supabase.from('organization_settings').insert({ organization_id: orgId, key: 'menu.custom', value, description: 'Menú personalizado', updated_by: ctx.user.id });
    if (error) return fail(error);
    refresh(); return ok('Menú actualizado.');
  });
}

// ---------- Registros de un módulo ----------
async function moduleFor(fd: FormData) {
  const ctx = await getContext();
  const orgId = requireOrg(ctx);
  const { data: m } = await ctx.supabase.from('custom_modules').select('*').eq('id', reqStr(fd, 'module_id', 'Módulo')).eq('organization_id', orgId).maybeSingle();
  if (!m) throw new ValidationError('Módulo no encontrado.');
  return { ctx, orgId, m: m as CustomModule };
}

function dataFrom(fd: FormData, m: CustomModule) {
  const data: Record<string, unknown> = {};
  for (const f of m.fields) {
    const raw = fd.get(`f_${f.key}`);
    if (f.type === 'checkbox') { data[f.key] = raw === 'on'; continue; }
    const v = typeof raw === 'string' ? raw.trim().slice(0, f.type === 'textarea' ? 5000 : 500) : '';
    if (!v) { if (f.required) throw new ValidationError(`Complete el campo «${f.label}».`); data[f.key] = null; continue; }
    if (f.type === 'number' || f.type === 'money') {
      const n = Number(v.replace(/\./g, '').replace(',', '.'));
      if (!Number.isFinite(n)) throw new ValidationError(`«${f.label}» debe ser un número.`);
      data[f.key] = String(n);
    } else data[f.key] = v;
  }
  return data;
}

export async function saveRecord(fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const { ctx, orgId, m } = await moduleFor(fd);
    const data = dataFrom(fd, m);
    const id = str(fd, 'id');
    const q = id
      ? ctx.supabase.from('custom_records').update({ data }).eq('id', id).eq('module_id', m.id).select('code').single()
      : ctx.supabase.from('custom_records').insert({ organization_id: orgId, module_id: m.id, data }).select('code').single();
    const { data: r, error } = await q;
    if (error) return fail(error);
    revalidatePath(`/app/m/${m.slug}`);
    return ok(id ? `Registro ${r.code} actualizado.` : `Registro creado con el código ${r.code}.`);
  });
}

export async function deleteRecord(fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const { ctx, m } = await moduleFor(fd);
    const { data, error } = await ctx.supabase.from('custom_records').delete().eq('id', reqStr(fd, 'id', 'Registro')).eq('module_id', m.id).select('id');
    if (error) return fail(error);
    if (!data?.length) return fail('No tiene permiso para eliminar este registro.');
    revalidatePath(`/app/m/${m.slug}`);
    return ok('Registro eliminado (puede deshacerlo con ↶).');
  });
}
