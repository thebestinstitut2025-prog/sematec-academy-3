'use server';
/** ✅ Exámenes y tareas «pro»: preguntas de todo tipo, imagen, corrección del profesor, duplicar, importar y rúbricas. */
import { revalidatePath } from 'next/cache';
import { getContext } from '@/lib/context';
import { fail, guard, num, ok, reqStr, str, type ActionResult } from '@/lib/actions';
import { attachTo, readAttachmentIds } from '@/lib/attachments';
import { parseQuestion } from '@/lib/quiz';

const back = (s: string) => revalidatePath(`/app/aula/${s}`, 'layout');

/** Crea o actualiza una pregunta (cualquier tipo) con su clave e imagen. */
export async function saveQuestion(fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const ctx = await getContext(); const section = reqStr(fd, 'section_id', 'sección');
    const ids = readAttachmentIds(fd);
    if (!Array.isArray(ids)) return fail(ids.error);
    let p; try { p = parseQuestion(reqStr(fd, 'kind', 'Tipo'), String(fd.get('prompt') ?? ''), String(fd.get('options') ?? ''), { value: str(fd, 'num_value'), tol: str(fd, 'num_tol') }); }
    catch (e) { return fail((e as Error).message); }
    const points = num(fd, 'points') ?? 1;
    if (points <= 0 || points > 1000) return fail('Los puntos deben ser mayores que 0.');
    const row = { kind: p.kind, prompt: p.prompt, options: p.options, choices: p.choices, points, position: num(fd, 'position') ?? 0, feedback: str(fd, 'feedback')?.slice(0, 2000) ?? null };
    const id = str(fd, 'id');
    let qid: string;
    if (id) {
      const { error, count } = await ctx.supabase.from('quiz_questions').update(row, { count: 'exact' }).eq('id', id);
      if (error) return fail(error); if (!count) return fail('No tiene permiso para modificarla (o ya fue eliminada).');
      const { error: e2 } = await ctx.supabase.from('quiz_answer_keys').upsert({ question_id: id, correct: p.correct, answer: p.answer }, { onConflict: 'question_id' });
      if (e2) return fail(e2);
      qid = id;
    } else {
      const { data, error } = await ctx.supabase.from('quiz_questions').insert({ ...row, organization_id: ctx.orgId, quiz_id: reqStr(fd, 'quiz_id', 'examen') }).select('id').single();
      if (error) return fail(error);
      const { error: e2 } = await ctx.supabase.from('quiz_answer_keys').insert({ question_id: data.id, correct: p.correct, answer: p.answer });
      if (e2) { await ctx.supabase.from('quiz_questions').delete().eq('id', data.id); return fail(e2); }
      qid = data.id;
    }
    const err = await attachTo(ctx, 'quiz_question', qid, ids);
    back(section);
    if (err) return fail(`La pregunta se guardó, pero la imagen no: ${err}`);
    return ok(id ? 'Pregunta actualizada. Los intentos ya enviados conservan su puntaje.' : 'Pregunta agregada.');
  });
}

/** El profesor asigna puntaje (y comentario) a una respuesta: desarrollo o ajuste manual. */
export async function gradeQuizQuestion(fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const ctx = await getContext();
    const { data, error } = await ctx.supabase.rpc('grade_quiz_question', {
      p_attempt: reqStr(fd, 'attempt_id', 'intento'), p_question: reqStr(fd, 'question_id', 'pregunta'),
      p_points: num(fd, 'points'), p_comment: str(fd, 'comment'),
    });
    if (error) return fail(error);
    back(reqStr(fd, 'section_id', 'sección'));
    const r = data as { score: number; max: number; grade: number | null; review: boolean };
    return ok(`Guardado. Puntaje: ${r.score} de ${r.max}${r.grade != null ? ` · nota ${r.grade}` : ''}${r.review ? ' · aún faltan preguntas por corregir' : ''}.`);
  });
}

export async function duplicateQuiz(fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const ctx = await getContext(); const section = reqStr(fd, 'section_id', 'sección');
    const { data, error } = await ctx.supabase.rpc('duplicate_quiz', { p_quiz: reqStr(fd, 'quiz_id', 'examen'), p_section: str(fd, 'to_section') });
    if (error) return fail(error);
    back(section);
    return ok('Examen duplicado como borrador (con todas sus preguntas). Revise las fechas y publíquelo.', data);
  });
}

export async function importQuestions(fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const ctx = await getContext(); const section = reqStr(fd, 'section_id', 'sección');
    const { data, error } = await ctx.supabase.rpc('copy_quiz_questions', { p_from: reqStr(fd, 'from_quiz', 'Examen de origen'), p_to: reqStr(fd, 'quiz_id', 'examen') });
    if (error) return fail(error);
    back(section);
    return ok(`${data} pregunta(s) importada(s) con sus respuestas.`);
  });
}

export async function gradeWithRubric(fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const ctx = await getContext();
    const n = Math.min(15, Number(fd.get('n') ?? 0) || 0);
    const scores = Array.from({ length: n }, (_, i) => String(fd.get(`r${i}`) ?? '').trim().replace(',', '.'));
    if (scores.some((s) => s === '')) return fail('Ponga un puntaje en cada criterio de la rúbrica.');
    const { data, error } = await ctx.supabase.rpc('grade_with_rubric', { p_submission: reqStr(fd, 'submission_id', 'entrega'), p_scores: scores, p_feedback: str(fd, 'feedback') });
    if (error) return fail(error);
    back(reqStr(fd, 'section_id', 'sección'));
    return ok(data != null ? `Calificada con rúbrica. Nota en el libro de clases: ${data}.` : 'Calificada con rúbrica.');
  });
}
