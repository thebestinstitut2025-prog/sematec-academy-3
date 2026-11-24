'use server';
import { revalidatePath } from 'next/cache';
import { attachMaterial, attachTo, readAttachmentIds } from '@/lib/attachments';
import { getContext } from '@/lib/context';
import { cleanAnswers, parseRubric, themeKey } from '@/lib/quiz';
import { quizProFields } from './editar-actions';
import { saveQuestion } from './examen-pro-actions';
import { fail, guard, num, ok, reqStr, str, ValidationError, type ActionResult } from '@/lib/actions';
import { localToIso, saveLmsFile } from '@/lib/lms';

const back = (s: string) => revalidatePath(`/app/aula/${s}`, 'layout');

// ---------- Contenidos ----------
export async function addUnit(fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const ctx = await getContext(); const section = reqStr(fd, 'section_id', 'sección');
    const { error } = await ctx.supabase.from('course_units').insert({
      organization_id: ctx.orgId, section_id: section, title: reqStr(fd, 'title', 'Título'), description: str(fd, 'description'), position: num(fd, 'position') ?? 0,
    });
    if (error) return fail(error);
    back(section); return ok('Unidad creada.');
  });
}

export async function addContent(fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const ctx = await getContext(); const section = reqStr(fd, 'section_id', 'sección');
    if (fd.get('attachments_pending') === '1') return fail('Espere a que terminen de subir los archivos y vuelva a pulsar el botón.');
    const kind = reqStr(fd, 'kind', 'Tipo');
    const file = kind === 'archivo' ? await saveLmsFile(ctx, fd.get('file') as File, section, 'content') : null;
    if (kind === 'archivo' && !file) return fail('Seleccione el archivo.');
    const url = str(fd, 'url');
    if (url && !url.startsWith('https://')) return fail('El enlace debe comenzar con https://');
    const { data, error } = await ctx.supabase.from('course_contents').insert({
      organization_id: ctx.orgId, section_id: section, unit_id: str(fd, 'unit_id'), kind, title: reqStr(fd, 'title', 'Título'),
      body: str(fd, 'body'), url: kind === 'video' || kind === 'enlace' ? url : null, file_id: file, position: num(fd, 'position') ?? 0,
    }).select('id').single();
    if (error) return fail(error);
    const m = await attachMaterial(ctx, fd, 'content', data.id);
    back(section);
    if (m.error) return fail(`El contenido se publicó, pero los archivos no: ${m.error}`);
    return ok(`Contenido publicado${m.n ? ` con ${m.n} archivo(s)` : ''}.`);
  });
}

export async function deleteContent(fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const ctx = await getContext();
    const table = fd.get('what') === 'unit' ? 'course_units' : 'course_contents';
    const { error, count } = await ctx.supabase.from(table).delete({ count: 'exact' }).eq('id', reqStr(fd, 'id', 'id'));
    if (error) return fail(error); if (!count) return fail('No autorizado.');
    back(reqStr(fd, 'section_id', 'sección')); return ok('Eliminado.');
  });
}

// ---------- Tareas ----------
export async function createAssignment(fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const ctx = await getContext(); const section = reqStr(fd, 'section_id', 'sección');
    if (fd.get('attachments_pending') === '1') return fail('Espere a que terminen de subir los archivos y vuelva a pulsar el botón.');
    const { data, error } = await ctx.supabase.from('assignments').insert({
      organization_id: ctx.orgId, section_id: section, title: reqStr(fd, 'title', 'Título'), instructions: str(fd, 'instructions'),
      due_at: localToIso(reqStr(fd, 'due_at', 'Fecha de entrega')), max_score: num(fd, 'max_score') ?? 100,
      allow_late: !!fd.get('allow_late'), assessment_id: str(fd, 'assessment_id'),
      theme: themeKey(fd.get('theme')), rubric: rubricOf(fd),
    }).select('id').single();
    if (error) return fail(error);
    const m = await attachMaterial(ctx, fd, 'assignment', data.id);
    back(section);
    if (m.error) return fail(`La tarea se publicó, pero los archivos no: ${m.error}`);
    return ok(`Tarea publicada${m.n ? ` con ${m.n} archivo(s)` : ''}.`);
  });
}

export async function submitAssignment(fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const ctx = await getContext(); const section = reqStr(fd, 'section_id', 'sección');
    const ids = readAttachmentIds(fd);
    if (!Array.isArray(ids)) return fail(ids.error);
    const file = await saveLmsFile(ctx, fd.get('file') as File, section, 'submission');
    const body = str(fd, 'body'); const url = str(fd, 'url');
    const assignment = reqStr(fd, 'assignment_id', 'tarea');
    const { data: prev } = await ctx.supabase.from('submissions').select('id').eq('assignment_id', assignment).eq('student_id', ctx.studentId ?? '').maybeSingle();
    const hadFiles = prev ? ((await ctx.supabase.from('attachments').select('id', { count: 'exact', head: true }).eq('entity_type', 'submission').eq('entity_id', prev.id)).count ?? 0) > 0 : false;
    if (!file && !body && !url && !ids.length && !hadFiles) return fail('Escriba una respuesta, agregue un enlace o adjunte un archivo.');
    const { data: sid, error } = await ctx.supabase.rpc('submit_assignment', { p_assignment: assignment, p_body: body, p_url: url, p_file: file });
    if (error) return fail(error);
    const err = await attachTo(ctx, 'submission', String(sid), ids);
    if (err) return fail(`La respuesta se guardó, pero los archivos no: ${err}`);
    back(section); return ok(`Entrega recibida${ids.length ? ` con ${ids.length} archivo(s)` : ''}.`);
  });
}

export async function gradeSubmission(fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const ctx = await getContext();
    const { data, error } = await ctx.supabase.rpc('grade_submission', {
      p_submission: reqStr(fd, 'submission_id', 'entrega'), p_score: num(fd, 'score'), p_feedback: str(fd, 'feedback'),
    });
    if (error) return fail(error);
    back(reqStr(fd, 'section_id', 'sección'));
    return ok(data != null ? `Calificada. Nota en el libro de clases: ${data}.` : 'Calificada.');
  });
}

// ---------- Exámenes ----------
export async function createQuiz(fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const ctx = await getContext(); const section = reqStr(fd, 'section_id', 'sección');
    if (fd.get('attachments_pending') === '1') return fail('Espere a que terminen de subir los archivos y vuelva a pulsar el botón.');
    const { data, error } = await ctx.supabase.from('quizzes').insert({
      organization_id: ctx.orgId, section_id: section, title: reqStr(fd, 'title', 'Título'), instructions: str(fd, 'instructions'),
      opens_at: localToIso(reqStr(fd, 'opens_at', 'Apertura')), closes_at: localToIso(reqStr(fd, 'closes_at', 'Cierre')),
      time_limit_min: num(fd, 'time_limit_min'), max_attempts: num(fd, 'max_attempts') ?? 1,
      show_results: !!fd.get('show_results'), assessment_id: str(fd, 'assessment_id'),
      ...(await quizProFields(fd)),
    }).select('id').single();
    if (error) return fail(error);
    const m = await attachMaterial(ctx, fd, 'quiz', data.id);
    back(section);
    if (m.error) return fail(`El examen se creó, pero los archivos no: ${m.error}`);
    return ok(`Examen creado${m.n ? ` con ${m.n} archivo(s)` : ''}. Agregue las preguntas y luego publíquelo.`, data.id);
  });
}

/** Agregar pregunta (cualquier tipo: única, múltiple, V/F, corta, numérica, completar, ordenar, unir, desarrollo). */
export async function addQuestion(fd: FormData): Promise<ActionResult> {
  fd.delete('id');
  return saveQuestion(fd);
}

export async function deleteQuestion(fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const ctx = await getContext();
    const { error } = await ctx.supabase.from('quiz_questions').delete().eq('id', reqStr(fd, 'id', 'id'));
    if (error) return fail(error);
    back(reqStr(fd, 'section_id', 'sección')); return ok('Pregunta eliminada.');
  });
}

export async function publishQuiz(fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const ctx = await getContext();
    const pub = fd.get('published') === '1';
    const { error, count } = await ctx.supabase.from('quizzes').update({ published: pub }, { count: 'exact' }).eq('id', reqStr(fd, 'quiz_id', 'examen'));
    if (error) return fail(error); if (!count) return fail('No autorizado.');
    back(reqStr(fd, 'section_id', 'sección')); return ok(pub ? 'Examen publicado.' : 'Examen oculto.');
  });
}

export async function startQuiz(fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const ctx = await getContext();
    const { data, error } = await ctx.supabase.rpc('start_quiz', { p_quiz: reqStr(fd, 'quiz_id', 'examen') });
    if (error) return fail(error);
    return ok('Examen iniciado.', data);
  });
}

export async function submitQuiz(attemptId: string, answers: Record<string, unknown>, files: string[] = []): Promise<ActionResult> {
  return guard(async () => {
    const ctx = await getContext();
    const ids = (Array.isArray(files) ? files : []).filter((x) => typeof x === 'string' && /^[0-9a-f-]{36}$/i.test(x)).slice(0, 20);
    const err = await attachTo(ctx, 'quiz_attempt', attemptId, ids);
    if (err) return fail(`No se pudieron adjuntar los archivos: ${err}`);
    const { data, error } = await ctx.supabase.rpc('submit_quiz', { p_attempt: attemptId, p_answers: cleanAnswers(answers) });
    if (error) return fail(error);
    const r = data as { score: number; max: number; grade: number | null; show: boolean; review?: boolean; pass?: boolean | null };
    if (!r.show) return ok('Examen enviado.', r);
    return ok(`Examen enviado. Puntaje: ${r.score} de ${r.max}${r.grade != null ? ` · Nota ${r.grade}` : ''}.${r.review ? ' Algunas respuestas las corrige el profesor: el puntaje puede subir.' : ''}`, r);
  });
}

// ---------- Foro ----------
export async function createThread(fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const ctx = await getContext(); const section = reqStr(fd, 'section_id', 'sección');
    const { error } = await ctx.supabase.from('forum_threads').insert({
      organization_id: ctx.orgId, section_id: section, title: reqStr(fd, 'title', 'Título'), body: reqStr(fd, 'body', 'Mensaje'), pinned: !!fd.get('pinned'),
    });
    if (error) return fail(error.code === '42501' ? 'No puede publicar en este foro.' : error);
    back(section); return ok('Tema publicado.');
  });
}

export async function replyThread(fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const ctx = await getContext();
    const { error } = await ctx.supabase.from('forum_posts').insert({ organization_id: ctx.orgId, thread_id: reqStr(fd, 'thread_id', 'tema'), body: reqStr(fd, 'body', 'Mensaje') });
    if (error) return fail(error.code === '42501' ? 'El tema está cerrado.' : error);
    back(reqStr(fd, 'section_id', 'sección')); return ok('Respuesta publicada.');
  });
}

export async function moderateThread(fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const ctx = await getContext();
    const field = reqStr(fd, 'field', 'campo') === 'pinned' ? 'pinned' : 'locked';
    const { error, count } = await ctx.supabase.from('forum_threads').update({ [field]: fd.get('value') === '1' }, { count: 'exact' }).eq('id', reqStr(fd, 'thread_id', 'tema'));
    if (error) return fail(error); if (!count) return fail('No autorizado.');
    back(reqStr(fd, 'section_id', 'sección')); return ok('Actualizado.');
  });
}

/** Proveedor del enlace (para mostrar el ícono correcto). */
function providerOf(url: string) {
  const h = new URL(url).hostname.toLowerCase();
  if (/(^|\.)forms\.gle$/.test(h) || (/docs\.google\.com$/.test(h) && url.includes('/forms/'))) return 'google_forms';
  if (/(drive|docs)\.google\.com$/.test(h)) return 'google_drive';
  if (/forms\.(office|microsoft)\.com$/.test(h)) return 'microsoft_forms';
  if (/(onedrive\.live\.com|1drv\.ms|sharepoint\.com)$/.test(h)) return 'onedrive';
  return 'otro';
}

/** 🔗 Evaluación con enlace externo (Google Forms, Drive, Microsoft Forms…): el enlace se entrega solo mientras está abierta. */
export async function createExternalEval(fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const ctx = await getContext(); const section = reqStr(fd, 'section_id', 'sección');
    if (fd.get('attachments_pending') === '1') return fail('Espere a que terminen de subir los archivos y vuelva a pulsar el botón.');
    let url = reqStr(fd, 'url', 'Enlace').trim();
    if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
    url = url.replace(/^http:\/\//i, 'https://');
    try { const u = new URL(url); if (!u.hostname.includes('.')) throw new Error(); } catch { return fail('El enlace no es válido. Copie el enlace completo (https://…).'); }
    if (url.length > 2000 || /[\s<>"]/.test(url)) return fail('El enlace no es válido.');
    const opens = localToIso(reqStr(fd, 'opens_at', 'Apertura')), closes = localToIso(reqStr(fd, 'closes_at', 'Cierre'));
    if (new Date(closes) <= new Date(opens)) return fail('La fecha de cierre debe ser posterior a la de apertura.');
    const { data, error } = await ctx.supabase.from('external_evaluations').insert({
      organization_id: ctx.orgId, section_id: section, title: reqStr(fd, 'title', 'Título').slice(0, 160), instructions: str(fd, 'instructions')?.slice(0, 4000) ?? null,
      url, provider: providerOf(url), opens_at: opens, closes_at: closes, assessment_id: str(fd, 'assessment_id'),
    }).select('id').single();
    if (error) return fail(error);
    const m = await attachMaterial(ctx, fd, 'eval_material', data.id);
    back(section);
    if (m.error) return fail(`La evaluación se creó, pero los archivos no: ${m.error}`);
    return ok(`Evaluación creada${m.n ? ` con ${m.n} archivo(s)` : ''}. Los estudiantes verán el botón «Entrar» solo mientras esté abierta.`);
  });
}

export async function deleteExternalEval(fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const ctx = await getContext(); const section = reqStr(fd, 'section_id', 'sección');
    const { data, error } = await ctx.supabase.from('external_evaluations').delete().eq('id', reqStr(fd, 'id', 'evaluación')).select('id');
    if (error) return fail(error);
    if (!data?.length) return fail('No tiene permiso para eliminarla.');
    back(section); return ok('Evaluación eliminada (puede deshacerlo con ↶).');
  });
}

function rubricOf(fd: FormData) {
  try { return parseRubric(str(fd, 'rubric')); } catch (e) { throw new ValidationError((e as Error).message); }
}
