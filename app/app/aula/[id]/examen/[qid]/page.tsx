import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getContext } from '@/lib/context';
import { loadSection } from '@/lib/aula';
import { PageHeader, Card, Badge, Empty } from '@/components/ui';
import { ActionForm } from '@/components/forms';
import { fmtDateTime } from '@/lib/format';
import { AttachmentList } from '@/components/attachment-list';
import { listAttachments } from '@/lib/attachments';
import { addQuestion, deleteQuestion, publishQuiz } from '../../../actions';
import { updateQuestion } from '../../../editar-actions';
import { duplicateQuiz, gradeQuizQuestion, importQuestions } from '../../../examen-pro-actions';
import { EditBox } from '@/components/edit-box';
import { QuestionFields } from '@/components/question-fields';
import { BLANK, KIND_LABEL, correctText, givenText, themeOf, toTeacherText } from '@/lib/quiz';

export default async function Page({ params }: { params: Promise<{ id: string; qid: string }> }) {
  const { id, qid } = await params;
  const ctx = await getContext();
  const { s: sec, manager } = await loadSection(ctx, id);
  if (!manager) notFound();
  const [{ data: q }, { data: qs }, { data: att }, { data: others }] = await Promise.all([
    ctx.supabase.from('quizzes').select('*').eq('id', qid).maybeSingle(),
    ctx.supabase.from('quiz_questions').select('*').eq('quiz_id', qid).order('position').order('id'),
    ctx.supabase.from('quiz_attempts').select('*, students(first_names, last_names)').eq('quiz_id', qid).order('started_at'),
    ctx.supabase.from('quizzes').select('id, title, sections(code)').neq('id', qid).order('created_at', { ascending: false }).limit(200),
  ]);
  if (!q) notFound();
  const qids = (qs ?? []).map((x: any) => x.id);
  const [{ data: keys }, files, imgs] = await Promise.all([
    qids.length ? ctx.supabase.from('quiz_answer_keys').select('*').in('question_id', qids) : Promise.resolve({ data: [] as any[] }),
    listAttachments(ctx, 'quiz_attempt', (att ?? []).map((t: any) => t.id)),
    listAttachments(ctx, 'quiz_question', qids),
  ]);
  const keyOf = (x: any) => (keys ?? []).find((k: any) => k.question_id === x.id) ?? { correct: [], answer: null };
  const total = (qs ?? []).reduce((n: number, x: any) => n + Number(x.points), 0);
  const sent = (att ?? []).filter((t: any) => t.submitted_at);
  const toReview = sent.filter((t: any) => t.needs_review).length;
  const avg = sent.length ? sent.reduce((n: number, t: any) => n + Number(t.score), 0) / sent.length : 0;
  const th = themeOf(q.theme);
  const hidden = <><input type="hidden" name="section_id" value={id} /><input type="hidden" name="quiz_id" value={qid} /></>;
  // 📊 % de logro por pregunta
  const stat = (x: any) => {
    const ds = sent.map((t: any) => t.detail?.[x.id]).filter((d: any) => d && d.pts != null);
    return ds.length ? Math.round((ds.reduce((n: number, d: any) => n + Number(d.pts) / Number(d.max || 1), 0) / ds.length) * 100) : null;
  };
  return (
    <>
      <PageHeader title={q.title} subtitle={`${fmtDateTime(q.opens_at)} → ${fmtDateTime(q.closes_at)} · ${qs?.length ?? 0} preguntas · ${total} puntos`}
        actions={<div className="flex flex-wrap gap-2">
          <Link className="btn-secondary btn-sm" href={`/app/aula/${id}/examen/${qid}/rendir`}>👁 Vista previa</Link>
          <ActionForm action={duplicateQuiz} inline submitLabel="📋 Duplicar" submitClass="btn-secondary btn-sm">{hidden}</ActionForm>
          <ActionForm action={publishQuiz} inline submitLabel={q.published ? 'Ocultar' : 'Publicar examen'} submitClass={q.published ? 'btn-secondary btn-sm' : 'btn-primary btn-sm'}>{hidden}<input type="hidden" name="published" value={q.published ? '0' : '1'} /></ActionForm>
        </div>} />
      <Link href={`/app/aula/${id}?t=examenes`} className="link text-sm">← Exámenes</Link>
      <div className={`mt-3 rounded-2xl bg-gradient-to-r ${th.grad} px-5 py-4 text-white`} data-testid="resumen-examen">
        <div className="flex flex-wrap gap-2 text-sm">
          <span className="rounded-full bg-white/20 px-3 py-1">{q.published ? '🟢 Publicado' : '📝 Borrador'}</span>
          {q.shuffle_questions && <span className="rounded-full bg-white/20 px-3 py-1">🔀 Preguntas al azar</span>}
          {q.shuffle_options && <span className="rounded-full bg-white/20 px-3 py-1">🔀 Opciones al azar</span>}
          {q.one_per_page && <span className="rounded-full bg-white/20 px-3 py-1">📄 Una por página</span>}
          {q.pass_pct && <span className="rounded-full bg-white/20 px-3 py-1">🎯 Aprueba con {q.pass_pct}%</span>}
          <span className="rounded-full bg-white/20 px-3 py-1">👥 {sent.length} enviado(s) · promedio {avg.toFixed(1)} / {total}</span>
          {toReview > 0 && <span className="rounded-full bg-amber-400 px-3 py-1 font-bold text-amber-950" data-testid="por-corregir">📝 {toReview} por corregir</span>}
        </div>
        <p className="mt-2 text-xs opacity-80">Portada, orden al azar, una por página y % para aprobar se cambian en «✏ Editar examen» (pestaña Exámenes).</p>
      </div>

      <div className="mt-4 grid gap-6 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          {(qs ?? []).map((x: any, i: number) => {
            const k = keyOf(x); const ok: number[] = k.correct ?? [];
            const tt = toTeacherText(x, ok, k.answer);
            const p = stat(x);
            return (
              <Card key={x.id} title={`${i + 1}. ${x.kind === 'completar' ? String(x.prompt).split(BLANK).join(' ____ ') : x.prompt}`}
                actions={<ActionForm action={deleteQuestion} inline submitLabel="🗑" submitClass="btn-secondary btn-sm" confirm="¿Eliminar la pregunta?">{hidden}<input type="hidden" name="id" value={x.id} /></ActionForm>}>
                <div data-testid="pregunta-profesor">
                  <p className="mb-2 flex flex-wrap items-center gap-2 text-xs"><Badge color="blue">{KIND_LABEL[x.kind] ?? x.kind}</Badge><span className="text-slate-500">{x.points} pt</span>
                    {p != null && <span className={`font-semibold ${p >= 70 ? 'text-emerald-700' : p >= 40 ? 'text-amber-700' : 'text-red-700'}`} data-testid="logro">📊 {p}% de logro</span>}</p>
                  {imgs[x.id]?.length ? <div className="mb-2 flex flex-wrap gap-2">{imgs[x.id].map((a) => a.mime.startsWith('image/')
                    ? <img key={a.id} src={`/api/adjunto/${a.id}`} alt={a.name} className="max-h-40 rounded-lg border" data-testid="imagen-pregunta" />
                    : null)}<AttachmentList items={imgs[x.id].filter((a) => !a.mime.startsWith('image/'))} canRemove path={`/app/aula/${id}/examen/${qid}`} /></div> : null}
                  {['unica', 'multiple', 'vf'].includes(x.kind)
                    ? <ul className="text-sm">{(x.options as string[]).map((o, j) => <li key={j} className={ok.includes(j) ? 'font-bold text-emerald-700' : ''}>{ok.includes(j) ? '✔' : '○'} {o}</li>)}</ul>
                    : <p className="text-sm text-emerald-800" data-testid="respuesta-correcta">✓ {correctText(x, ok, k.answer)}</p>}
                  {x.feedback && <p className="mt-2 rounded-lg bg-blue-50 p-2 text-xs text-blue-900">💬 {x.feedback}</p>}
                </div>
                <EditBox label="✏ Editar pregunta" testid="editar-pregunta">
                  <ActionForm action={updateQuestion} submitLabel="Guardar cambios" resetOnSuccess={false}>{hidden}<input type="hidden" name="id" value={x.id} />
                    <QuestionFields org={sec.organization_id} d={{ kind: x.kind, prompt: tt.prompt, text: tt.text, value: tt.value, tol: tt.tol, feedback: x.feedback, points: String(x.points), position: String(x.position ?? i + 1) }} />
                    {sent.length > 0 && <p className="text-xs text-amber-700">Ya hay intentos enviados: conservan el puntaje con que se corrigieron.</p>}
                  </ActionForm></EditBox>
              </Card>);
          })}
          <Card title="Agregar pregunta">
            <ActionForm action={addQuestion} submitLabel="Agregar">{hidden}
              <QuestionFields org={sec.organization_id} d={{ position: String((qs?.length ?? 0) + 1) }} />
            </ActionForm>
          </Card>
          {(others ?? []).length > 0 && (
            <Card title="📥 Importar preguntas de otro examen">
              <ActionForm action={importQuestions} submitLabel="Importar preguntas" confirm="¿Copiar todas las preguntas de ese examen (con sus respuestas) al final de este?">{hidden}
                <select name="from_quiz" required className="input w-full" data-testid="importar-desde"><option value="">Elija el examen…</option>
                  {(others ?? []).map((o: any) => <option key={o.id} value={o.id}>{o.title}{o.sections?.code ? ` · ${o.sections.code}` : ''}</option>)}</select>
                <p className="text-xs text-slate-500">Así reutiliza sus preguntas como un banco: se copian con su respuesta, retroalimentación y puntaje.</p>
              </ActionForm>
            </Card>)}
        </div>

        <Card title={`Resultados (${att?.length ?? 0})`}>
          {att?.length ? <div className="space-y-2" data-testid="resultados">{att.map((t: any) => (
            <details key={t.id} className="rounded-xl border border-slate-200" data-testid="intento" open={t.needs_review}>
              <summary className="flex cursor-pointer flex-wrap items-center gap-2 p-2 text-sm">
                <span className="flex-1 font-semibold">{t.students?.last_names}, {t.students?.first_names}</span>
                {t.submitted_at ? <b>{t.score}/{t.max_score}{t.grade != null && ` · ${t.grade}`}</b> : <Badge color="amber">En curso</Badge>}
                {t.needs_review && <Badge color="amber">📝 Corregir</Badge>}
              </summary>
              {t.submitted_at && <div className="space-y-2 border-t border-slate-100 p-2 text-xs">
                {(qs ?? []).map((x: any, i: number) => {
                  const d = t.detail?.[x.id];
                  const given = t.answers?.[x.id];
                  return (
                    <div key={x.id} className="rounded-lg bg-slate-50 p-2">
                      <p className="font-semibold">{i + 1}. {KIND_LABEL[x.kind]?.split(' ').slice(1).join(' ')} · {d?.pts == null ? <span className="text-amber-700">por corregir</span> : `${d.pts}/${x.points}`}</p>
                      <p className="mt-0.5 whitespace-pre-line text-slate-700">{givenText(x, given)}</p>
                      {(x.kind === 'desarrollo' || d?.manual) && (
                        <ActionForm action={gradeQuizQuestion} submitLabel={d?.manual ? 'Actualizar' : 'Guardar puntaje'} submitClass="btn-primary btn-sm" resetOnSuccess={false} className="mt-1 space-y-1">
                          <input type="hidden" name="section_id" value={id} /><input type="hidden" name="attempt_id" value={t.id} /><input type="hidden" name="question_id" value={x.id} />
                          <div className="flex gap-1"><input name="points" type="number" step="0.5" min={0} max={Number(x.points)} required defaultValue={d?.pts ?? ''} className="input w-20" aria-label="Puntaje" data-testid="puntaje-manual" />
                            <input name="comment" defaultValue={d?.comment ?? ''} className="input flex-1" placeholder="Comentario para el estudiante" /></div>
                        </ActionForm>)}
                    </div>);
                })}
                <AttachmentList items={files[t.id]} />
              </div>}
            </details>))}</div> : <Empty>Nadie ha rendido aún.</Empty>}
        </Card>
      </div>
    </>
  );
}
