'use server';
import { revalidatePath } from 'next/cache';
import { getContext } from '@/lib/context';
import { fail, guard, ok, reqStr, str, type ActionResult } from '@/lib/actions';

const STATUSES = ['present', 'absent', 'late', 'excused'];
const NEEDS = 'Falta instalar la actualización «Planillas de asistencia» en Actualizar base de datos.';
const UUID = /^[0-9a-f-]{36}$/i;
const refresh = (section?: string | null) => { if (section) revalidatePath(`/app/secciones/${section}`); revalidatePath('/app/asistencia'); };
const errMsg = (e: { message: string }) => (/attendance_sheet|clear_attendance|delete_class_session/.test(e.message) && /exist|schema cache|function/.test(e.message) ? NEEDS : e.message);

/** Diseño de una planilla: solo valores conocidos. */
function cleanDesign(raw: unknown) {
  const d = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const pick = (k: string, ok: string[], def: string) => (typeof d[k] === 'string' && ok.includes(d[k] as string) ? d[k] : def);
  return {
    theme: pick('theme', ['azul', 'verde', 'morado', 'naranjo', 'rosado', 'gris', 'turquesa', 'rojo'], 'azul'),
    font: pick('font', ['sm', 'md', 'lg'], 'md'), density: pick('density', ['compacta', 'normal', 'amplia'], 'normal'),
    symbols: pick('symbols', ['letras', 'iconos', 'palabras'], 'letras'), header: pick('header', ['fecha', 'fecha_tema', 'numero'], 'fecha'),
    stripes: d.stripes !== false, grid: d.grid !== false, code: d.code === true, pct: d.pct !== false, totals: d.totals !== false,
    colTotals: d.colTotals !== false, highlightLow: d.highlightLow !== false, title: typeof d.title === 'string' ? d.title.replace(/[<>]/g, '').slice(0, 120) : '',
  };
}
function cleanExtra(raw: unknown) {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  return raw.slice(0, 20).map((c: any, i: number) => {
    const label = String(c?.label ?? '').replace(/[<>]/g, '').trim().slice(0, 40);
    let key = String(c?.key ?? '').toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 30) || `col_${i + 1}`;
    while (seen.has(key)) key = `${key}_${i}`; seen.add(key);
    return { key, label: label || `Columna ${i + 1}`, type: ['texto', 'numero', 'check'].includes(c?.type) ? c.type : 'texto' };
  });
}

// ---------- Tablas ----------
export async function createSheet(fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const ctx = await getContext();
    const section = reqStr(fd, 'section_id', 'Sección');
    const { data: s } = await ctx.supabase.from('sections').select('organization_id').eq('id', section).maybeSingle();
    if (!s) return fail('Sección no encontrada.');
    const copy = str(fd, 'copy_from');
    let design = cleanDesign({ theme: str(fd, 'theme') ?? 'azul' }); let extra: unknown[] = [];
    if (copy && UUID.test(copy)) {
      const { data: src } = await ctx.supabase.from('attendance_sheets').select('design, extra_cols').eq('id', copy).maybeSingle();
      if (src) { design = cleanDesign(src.design); extra = cleanExtra(src.extra_cols); }
    }
    const { data, error } = await ctx.supabase.from('attendance_sheets').insert({
      organization_id: s.organization_id, section_id: section, name: reqStr(fd, 'name', 'Nombre de la tabla').replace(/[<>]/g, '').slice(0, 80),
      from_date: str(fd, 'from_date'), to_date: str(fd, 'to_date'), design, extra_cols: extra, created_by: ctx.user.id,
    }).select('id').single();
    if (error) return fail(errMsg(error));
    refresh(section);
    return ok('Tabla creada.', { id: data.id });
  });
}

export async function updateSheet(fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const ctx = await getContext();
    const id = reqStr(fd, 'sheet_id', 'Tabla');
    const row: Record<string, unknown> = {};
    if (fd.has('name')) row.name = reqStr(fd, 'name', 'Nombre').replace(/[<>]/g, '').slice(0, 80);
    if (fd.has('from_date')) row.from_date = str(fd, 'from_date');
    if (fd.has('to_date')) row.to_date = str(fd, 'to_date');
    try {
      if (fd.has('design')) row.design = cleanDesign(JSON.parse(String(fd.get('design'))));
      if (fd.has('extra_cols')) row.extra_cols = cleanExtra(JSON.parse(String(fd.get('extra_cols'))));
    } catch { return fail('Datos de diseño no válidos.'); }
    const { data, error } = await ctx.supabase.from('attendance_sheets').update(row).eq('id', id).select('section_id');
    if (error) return fail(errMsg(error));
    if (!data?.length) return fail('No tiene permiso para cambiar esta tabla (o el acta está cerrada).');
    refresh(data[0].section_id);
    return ok('Tabla guardada.');
  });
}

export async function deleteSheet(fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const ctx = await getContext();
    const { data, error } = await ctx.supabase.from('attendance_sheets').delete().eq('id', reqStr(fd, 'sheet_id', 'Tabla')).select('section_id, name');
    if (error) return fail(errMsg(error));
    if (!data?.length) return fail('No se pudo eliminar la tabla.');
    refresh(data[0].section_id);
    return ok(`Tabla «${data[0].name}» eliminada. La asistencia de las clases se conserva en el libro de clases.`);
  });
}

// ---------- Celdas ----------
/** Marca una celda de asistencia (P, A, T, J) o la deja vacía. */
export async function setAttendanceCell(session: string, student: string, status: string | null): Promise<{ ok: boolean; error?: string }> {
  if (!UUID.test(session) || !UUID.test(student)) return { ok: false, error: 'Datos inválidos' };
  const ctx = await getContext();
  if (!status) {
    const { error } = await ctx.supabase.rpc('clear_attendance', { p_session: session, p_student: student });
    return error ? { ok: false, error: errMsg(error) } : { ok: true };
  }
  if (!STATUSES.includes(status)) return { ok: false, error: 'Estado inválido' };
  const { data: cs } = await ctx.supabase.from('class_sessions').select('organization_id').eq('id', session).maybeSingle();
  if (!cs) return { ok: false, error: 'Clase no encontrada' };
  const { error } = await ctx.supabase.from('attendance_records').upsert(
    { organization_id: cs.organization_id, class_session_id: session, student_id: student, status, recorded_by: ctx.user.id, recorded_at: new Date().toISOString() },
    { onConflict: 'class_session_id,student_id' });
  return error ? { ok: false, error: error.message } : { ok: true };
}

/** Marca toda una columna (clase) con el mismo estado. */
export async function setAttendanceColumn(session: string, students: string[], status: string): Promise<{ ok: boolean; error?: string }> {
  if (!UUID.test(session) || !STATUSES.includes(status)) return { ok: false, error: 'Datos inválidos' };
  const ctx = await getContext();
  const { data: cs } = await ctx.supabase.from('class_sessions').select('organization_id').eq('id', session).maybeSingle();
  if (!cs) return { ok: false, error: 'Clase no encontrada' };
  const rows = students.filter((s) => UUID.test(s)).slice(0, 500).map((s) => ({ organization_id: cs.organization_id, class_session_id: session, student_id: s, status, recorded_by: ctx.user.id }));
  const { error } = await ctx.supabase.from('attendance_records').upsert(rows, { onConflict: 'class_session_id,student_id' });
  if (!error) await ctx.supabase.rpc('teacher_class_mark', { p_session: session, p_action: 'held' });
  return error ? { ok: false, error: error.message } : { ok: true };
}

/** Celda de una columna propia (observación, número o ✓). */
export async function setSheetCell(sheet: string, student: string, key: string, value: string): Promise<{ ok: boolean; error?: string }> {
  if (!UUID.test(sheet) || !UUID.test(student) || !/^[a-z0-9_]{1,30}$/.test(key)) return { ok: false, error: 'Datos inválidos' };
  const ctx = await getContext();
  const v = value.replace(/[<>]/g, '').slice(0, 500);
  const { error } = v
    ? await ctx.supabase.from('attendance_sheet_cells').upsert({ sheet_id: sheet, student_id: student, col_key: key, value: v, updated_by: ctx.user.id, updated_at: new Date().toISOString() })
    : await ctx.supabase.from('attendance_sheet_cells').delete().eq('sheet_id', sheet).eq('student_id', student).eq('col_key', key);
  return error ? { ok: false, error: errMsg(error) } : { ok: true };
}

// ---------- Columnas (clases) ----------
export async function addSheetColumn(fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const ctx = await getContext();
    const section = reqStr(fd, 'section_id', 'Sección');
    const date = reqStr(fd, 'date', 'Fecha');
    const start = str(fd, 'start') ?? '08:00', end = str(fd, 'end') ?? '09:30';
    if (end <= start) return fail('La hora de término debe ser posterior a la de inicio.');
    const { data: s } = await ctx.supabase.from('sections').select('organization_id').eq('id', section).maybeSingle();
    if (!s) return fail('Sección no encontrada.');
    const tz = str(fd, 'tz_offset') ?? '-03:00';
    const { error } = await ctx.supabase.from('class_sessions').insert({
      organization_id: s.organization_id, section_id: section, starts_at: `${date}T${start}:00${tz}`, ends_at: `${date}T${end}:00${tz}`, topic: str(fd, 'topic'),
    });
    if (error) return fail(/duplicate|unique/.test(error.message) ? 'Ya hay una clase en esa fecha y hora.' : error);
    refresh(section);
    return ok('Columna (clase) agregada.');
  });
}

export async function editSheetColumn(fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const ctx = await getContext();
    const id = reqStr(fd, 'session_id', 'Clase');
    const row: Record<string, unknown> = { topic: str(fd, 'topic') };
    const date = str(fd, 'date');
    if (date) { const tz = str(fd, 'tz_offset') ?? '-03:00'; row.starts_at = `${date}T${str(fd, 'start') ?? '08:00'}:00${tz}`; row.ends_at = `${date}T${str(fd, 'end') ?? '09:30'}:00${tz}`; }
    const { data, error } = await ctx.supabase.from('class_sessions').update(row).eq('id', id).select('section_id');
    if (error) return fail(error);
    if (!data?.length) return fail('No tiene permiso para cambiar esta clase.');
    refresh(data[0].section_id);
    return ok('Columna actualizada.');
  });
}

export async function deleteSheetColumn(fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const ctx = await getContext();
    const { data, error } = await ctx.supabase.rpc('delete_class_session', { p_session: reqStr(fd, 'session_id', 'Clase') });
    if (error) return fail(errMsg(error));
    refresh(str(fd, 'section_id'));
    return ok(`Columna eliminada (${data ?? 0} registro(s) de asistencia borrados).`);
  });
}
