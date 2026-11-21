'use server';
/**
 * ✏ Editar y 🗑 eliminar en el aula: unidades, contenidos, tareas, exámenes (y sus preguntas),
 * evaluaciones con enlace, evaluaciones del libro de notas y mensajes del foro.
 * Los permisos los aplica la base de datos (solo el profesor de la sala o quien administra notas).
 */
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { getContext } from '@/lib/context';
import { fail, guard, num, ok, reqStr, str, ValidationError, type ActionResult } from '@/lib/actions';
import { localToIso } from '@/lib/lms';
import { attachMaterial } from '@/lib/attachments';

const back = (s: string) => revalidatePath(`/app/aula/${s}`, 'layout');
const NO_PERM = 'No tiene permiso para modificarlo (o ya fue eliminado).';

function iso(fd: FormData, k: string, label: string) {
  try { return localToIso(reqStr(fd, k, label)); } catch (e) { if (e instanceof ValidationError) throw e; throw new ValidationError(`La fecha «${label}» no es válida.`); }
}
function dates(fd: FormData, a: string, b: string, la: string, lb: string) {
  const x = iso(fd, a, la), y = iso(fd, b, lb);
  if (new Date(y) <= new Date(x)) throw new ValidationError('La fecha de cierre debe ser posterior a la de apertura.');
  return [x, y] as const;
}

// ---------- Unidades y contenidos ----------
export async function updateUnit(fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const ctx = await getContext(); const section = reqStr(fd, 'section_id', 'sección');
    const { error, count } = await ctx.supabase.from('course_units').update({
      title: reqStr(fd, 'title', 'Título').slice(0, 200), description: str(fd, 'description'), position: num(fd, 'position') ?? 0,
      published: fd.get('published') === 'on',
    }, { count: 'exact' }).eq('id', reqStr(fd, 'id', 'unidad'));
    if (error) return fail(error); if (!count) return fail(NO_PERM);
    back(section); return ok('Unidad actualizada.');
  });
}

export async function updateContent(fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const ctx = await getContext(); const section = reqStr(fd, 'section_id', 'sección');
    const id = reqStr(fd, 'id', 'contenido');
    const { data: cur } = await ctx.supabase.from('course_contents').select('kind').eq('id', id).maybeSingle();
    if (!cur) return fail(NO_PERM);
    const url = str(fd, 'url');
    if (cur.kind === 'video' || cur.kind === 'enlace') {
      if (!url) return fail('Escriba el enlace (https://…).');
      if (!url.startsWith('https://')) return fail('El enlace debe comenzar con https://');
    }
    const { error, count } = await ctx.supabase.from('course_contents').update({
      title: reqStr(fd, 'title', 'Título').slice(0, 200), body: str(fd, 'body'), unit_id: str(fd, 'unit_id'), position: num(fd, 'position') ?? 0,
      published: fd.get('published') === 'on', ...(cur.kind === 'video' || cur.kind === 'enlace' ? { url } : {}),
    }, { count: 'exact' }).eq('id', id);
    if (error) return fail(error); if (!count) return fail(NO_PERM);
    const m = await attachMaterial(ctx, fd, 'content', id);
    back(section);
    if (m.error) return fail(`Se guardaron los cambios, pero los archivos no: ${m.error}`);
    return ok(`Contenido actualizado${m.n ? ` con ${m.n} archivo(s) nuevo(s)` : ''}.`);
  });
}

// ---------- Tareas ----------
export async function updateAssignment(fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const ctx = await getContext(); const section = reqStr(fd, 'section_id', 'sección');
    const max = num(fd, 'max_score') ?? 100;
    if (max <= 0) return fail('El puntaje máximo debe ser mayor que 0.');
    const id = reqStr(fd, 'id', 'tarea');
    const { data: top } = await ctx.supabase.from('submissions').select('score').eq('assignment_id', id).not('score', 'is', null).order('score', { ascending: false }).limit(1);
    if (top?.[0] && Number(top[0].score) > max) return fail(`Ya hay entregas calificadas con ${top[0].score} puntos: el puntaje máximo no puede ser menor.`);
    const { error, count } = await ctx.supabase.from('assignments').update({
      title: reqStr(fd, 'title', 'Título').slice(0, 200), instructions: str(fd, 'instructions'),
      due_at: iso(fd, 'due_at', 'Fecha de entrega'), max_score: max,
      allow_late: fd.get('allow_late') === 'on', assessment_id: str(fd, 'assessment_id'), published: fd.get('published') === 'on',
    }, { count: 'exact' }).eq('id', id);
    if (error) return fail(error); if (!count) return fail(NO_PERM);
    const m = await attachMaterial(ctx, fd, 'assignment', id);
    back(section);
    if (m.error) return fail(`Se guardaron los cambios, pero los archivos no: ${m.error}`);
    return ok(`Tarea actualizada${m.n ? ` con ${m.n} archivo(s) nuevo(s)` : ''}.`);
  });
}

export async function deleteAssignment(fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const ctx = await getContext(); const section = reqStr(fd, 'section_id', 'sección');
    const { data, error } = await ctx.supabase.rpc('delete_assignment', { p_id: reqStr(fd, 'id', 'tarea') });
    if (error) return fail(error);
    const r = data as { title: string; submissions: number };
    back(section);
    return ok(`Tarea «${r.title}» eliminada${r.submissions ? ` junto con ${r.submissions} entrega(s)` : ''}. Las notas que ya pasaron al libro se conservan.`);
  });
}

// ---------- Exámenes ----------
export async function updateQuiz(fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const ctx = await getContext(); const section = reqStr(fd, 'section_id', 'sección');
    const [opens, closes] = dates(fd, 'opens_at', 'closes_at', 'Apertura', 'Cierre');
    const id = reqStr(fd, 'id', 'examen');
    const tl = num(fd, 'time_limit_min'), att = num(fd, 'max_attempts') ?? 1;
    if (tl != null && (tl < 1 || tl > 600)) return fail('El tiempo límite debe estar entre 1 y 600 minutos (o vacío).');
    if (att < 1 || att > 10) return fail('Los intentos permitidos deben estar entre 1 y 10.');
    const { error, count } = await ctx.supabase.from('quizzes').update({
      title: reqStr(fd, 'title', 'Título').slice(0, 200), instructions: str(fd, 'instructions'), opens_at: opens, closes_at: closes,
      time_limit_min: tl, max_attempts: att, show_results: fd.get('show_results') === 'on', assessment_id: str(fd, 'assessment_id'),
    }, { count: 'exact' }).eq('id', id);
    if (error) return fail(error); if (!count) return fail(NO_PERM);
    const m = await attachMaterial(ctx, fd, 'quiz', id);
    back(section);
    if (m.error) return fail(`Se guardaron los cambios, pero los archivos no: ${m.error}`);
    return ok(`Examen actualizado${m.n ? ` con ${m.n} archivo(s) nuevo(s)` : ''}.`);
  });
}

export async function deleteQuiz(fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const ctx = await getContext(); const section = reqStr(fd, 'section_id', 'sección');
    const { data, error } = await ctx.supabase.rpc('delete_quiz', { p_id: reqStr(fd, 'id', 'examen') });
    if (error) return fail(error);
    const r = data as { title: string; attempts: number };
    back(section);
    return ok(`Examen «${r.title}» eliminado${r.attempts ? ` junto con ${r.attempts} intento(s)` : ''}. Las notas que ya pasaron al libro se conservan.`);
  });
}

/** Opciones una por línea; las correctas comienzan con «*». */
function parseOptions(kind: string, raw: string) {
  let lines = raw.split('\n').map((l) => l.trim()).filter(Boolean);
  if (kind === 'vf') lines = [(lines[0] ?? '').startsWith('*') ? '*Verdadero' : 'Verdadero', (lines[0] ?? '').startsWith('*') ? 'Falso' : '*Falso'];
  if (lines.length < 2 || lines.length > 8) throw new Error('Escriba entre 2 y 8 opciones, una por línea.');
  const correct = lines.map((l, i) => (l.startsWith('*') ? i : -1)).filter((i) => i >= 0);
  if (!correct.length) throw new Error('Marque la(s) respuesta(s) correcta(s) con * al inicio de la línea.');
  if (kind === 'unica' && correct.length !== 1) throw new Error('En selección única debe haber exactamente una correcta.');
  return { options: lines.map((l) => l.replace(/^\*\s*/, '')), correct };
}

export async function updateQuestion(fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const ctx = await getContext(); const section = reqStr(fd, 'section_id', 'sección');
    const kind = reqStr(fd, 'kind', 'Tipo');
    if (!['unica', 'multiple', 'vf'].includes(kind)) return fail('Tipo de pregunta inválido.');
    let parsed; try { parsed = parseOptions(kind, reqStr(fd, 'options', 'Opciones')); } catch (e) { return fail((e as Error).message); }
    const points = num(fd, 'points') ?? 1;
    if (points <= 0) return fail('Los puntos deben ser mayores que 0.');
    const id = reqStr(fd, 'id', 'pregunta');
    const { error, count } = await ctx.supabase.from('quiz_questions').update({
      kind, prompt: reqStr(fd, 'prompt', 'Pregunta').slice(0, 4000), options: parsed.options, points, position: num(fd, 'position') ?? 0,
    }, { count: 'exact' }).eq('id', id);
    if (error) return fail(error); if (!count) return fail(NO_PERM);
    const { error: e2 } = await ctx.supabase.from('quiz_answer_keys').upsert({ question_id: id, correct: parsed.correct }, { onConflict: 'question_id' });
    if (e2) return fail(e2);
    back(section); return ok('Pregunta actualizada. Los intentos ya enviados conservan su puntaje.');
  });
}

// ---------- Evaluaciones con enlace ----------
export async function updateExternalEval(fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const ctx = await getContext(); const section = reqStr(fd, 'section_id', 'sección');
    // El enlace es opcional al editar: vacío = se mantiene el actual (los estudiantes nunca lo ven directo)
    let link: { url: string; provider: string } | null = null;
    let url = str(fd, 'url')?.trim() ?? '';
    if (url) {
      if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
      url = url.replace(/^http:\/\//i, 'https://');
      try { const u = new URL(url); if (!u.hostname.includes('.')) throw new Error(); } catch { return fail('El enlace no es válido. Copie el enlace completo (https://…).'); }
      if (url.length > 2000 || /[\s<>"]/.test(url)) return fail('El enlace no es válido.');
      const h = new URL(url).hostname.toLowerCase();
      const provider = /(^|\.)forms\.gle$/.test(h) || (/docs\.google\.com$/.test(h) && url.includes('/forms/')) ? 'google_forms'
        : /(drive|docs)\.google\.com$/.test(h) ? 'google_drive' : /forms\.(office|microsoft)\.com$/.test(h) ? 'microsoft_forms'
        : /(onedrive\.live\.com|1drv\.ms|sharepoint\.com)$/.test(h) ? 'onedrive' : 'otro';
      link = { url, provider };
    }
    const [opens, closes] = dates(fd, 'opens_at', 'closes_at', 'Apertura', 'Cierre');
    const id = reqStr(fd, 'id', 'evaluación');
    const { error, count } = await ctx.supabase.from('external_evaluations').update({
      title: reqStr(fd, 'title', 'Título').slice(0, 160), instructions: str(fd, 'instructions')?.slice(0, 4000) ?? null,
      ...(link ?? {}), opens_at: opens, closes_at: closes, assessment_id: str(fd, 'assessment_id'), published: fd.get('published') === 'on',
    }, { count: 'exact' }).eq('id', id);
    if (error) return fail(error); if (!count) return fail(NO_PERM);
    const m = await attachMaterial(ctx, fd, 'eval_material', id);
    back(section);
    if (m.error) return fail(`Se guardaron los cambios, pero los archivos no: ${m.error}`);
    return ok(`Evaluación actualizada${link ? ' (con el nuevo enlace)' : ''}${m.n ? ` con ${m.n} archivo(s) nuevo(s)` : ''}.`);
  });
}

// ---------- Evaluaciones del libro de notas ----------
export async function updateAssessment(fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const ctx = await getContext(); const section = reqStr(fd, 'section_id', 'sección');
    const w = num(fd, 'weight_pct');
    if (w == null || w <= 0 || w > 100) return fail('La ponderación debe estar entre 0,5 y 100 %.');
    const { error, count } = await ctx.supabase.from('assessments').update({
      name: reqStr(fd, 'name', 'Nombre').slice(0, 120), weight_pct: w, due_on: str(fd, 'due_on'), published: fd.get('published') === 'on',
    }, { count: 'exact' }).eq('id', reqStr(fd, 'id', 'evaluación'));
    if (error) return fail(error.code === '23505' ? 'Ya existe otra evaluación con ese nombre en esta sala.' : error);
    if (!count) return fail(NO_PERM);
    back(section); revalidatePath(`/app/secciones/${section}`);
    return ok('Evaluación actualizada.');
  });
}

export async function deleteAssessment(fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const ctx = await getContext(); const section = reqStr(fd, 'section_id', 'sección');
    const { data, error } = await ctx.supabase.rpc('delete_assessment', { p_id: reqStr(fd, 'id', 'evaluación') });
    if (error) return fail(error);
    back(section); revalidatePath(`/app/secciones/${section}`);
    return ok(`Evaluación «${(data as { name: string }).name}» eliminada.`);
  });
}

// ---------- Foro ----------
export async function deleteThread(fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const ctx = await getContext(); const section = reqStr(fd, 'section_id', 'sección');
    const { data, error } = await ctx.supabase.from('forum_threads').delete().eq('id', reqStr(fd, 'thread_id', 'tema')).select('id');
    if (error) return fail(error); if (!data?.length) return fail(NO_PERM);
    back(section);
    if (fd.get('go') === '1' && /^[0-9a-f-]{36}$/i.test(section)) redirect(`/app/aula/${section}?t=foro`);
    return ok('Tema eliminado.');
  });
}

export async function deletePost(fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const ctx = await getContext(); const section = reqStr(fd, 'section_id', 'sección');
    const { data, error } = await ctx.supabase.from('forum_posts').delete().eq('id', reqStr(fd, 'id', 'mensaje')).select('id');
    if (error) return fail(error); if (!data?.length) return fail(NO_PERM);
    back(section); return ok('Mensaje eliminado.');
  });
}
