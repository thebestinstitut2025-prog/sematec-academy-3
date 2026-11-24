import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getContext } from '@/lib/context';
import { loadSection } from '@/lib/aula';
import { fmtDateTime } from '@/lib/format';
import { Card } from '@/components/ui';
import { BLANK, correctText, givenText, themeOf } from '@/lib/quiz';

/** 🔍 Revisión del estudiante: su respuesta, el puntaje, la correcta (al cerrar) y la retroalimentación. */
export default async function Page({ params, searchParams }: { params: Promise<{ id: string; qid: string }>; searchParams: Promise<{ intento?: string }> }) {
  const { id, qid } = await params;
  const { intento = '' } = await searchParams;
  const ctx = await getContext();
  const { student } = await loadSection(ctx, id);
  if (!student || !/^[0-9a-f-]{36}$/i.test(intento)) notFound();
  const [{ data: q }, { data: t }, { data: rows, error }] = await Promise.all([
    ctx.supabase.from('quizzes').select('title, theme, closes_at, show_results, pass_pct').eq('id', qid).maybeSingle(),
    ctx.supabase.from('quiz_attempts').select('id, quiz_id, submitted_at, score, max_score, grade, needs_review').eq('id', intento).maybeSingle(),
    ctx.supabase.rpc('quiz_review', { p_attempt: intento }),
  ]);
  if (!q || !t || t.quiz_id !== qid || !t.submitted_at) notFound();
  const th = themeOf(q.theme);
  const closed = new Date(q.closes_at) <= new Date();
  const pct = Number(t.max_score) > 0 ? Math.round((Number(t.score) / Number(t.max_score)) * 100) : 0;
  return (
    <>
      <Link href={`/app/aula/${id}/examen/${qid}/rendir`} className="link text-sm">← Volver al examen</Link>
      <div className="card mt-3 overflow-hidden">
        <div className={`bg-gradient-to-r ${th.grad} px-6 py-6 text-white`}>
          <p className="text-sm opacity-80">🔍 Revisión · enviado {fmtDateTime(t.submitted_at)}</p>
          <h1 className="text-2xl font-bold">{q.title}</h1>
          {q.show_results && <p className="mt-2 text-lg font-bold" data-testid="puntaje-revision">{t.score} de {t.max_score} puntos ({pct}%){t.grade != null && ` · nota ${t.grade}`}</p>}
          {q.show_results && <div className="mt-2 h-2 max-w-sm overflow-hidden rounded-full bg-white/30"><div className="h-full bg-white" style={{ width: `${pct}%` }} /></div>}
          {q.pass_pct && q.show_results && <p className="mt-2 text-sm">{pct >= q.pass_pct ? '✅ Aprobado' : `📘 Para aprobar se necesita ${q.pass_pct}%`}</p>}
        </div>
        {t.needs_review && <p className="bg-amber-50 px-6 py-2 text-sm text-amber-900">📝 Algunas respuestas las está corrigiendo el profesor: el puntaje puede cambiar.</p>}
        {!closed && <p className="bg-slate-50 px-6 py-2 text-sm text-slate-600">Las respuestas correctas se muestran cuando cierre el examen ({fmtDateTime(q.closes_at)}).</p>}
      </div>
      {error || !q.show_results ? <Card className="mt-4"><p className="text-sm text-slate-500">El profesor no habilitó la revisión de este examen.</p></Card> : (
        <div className="mt-4 space-y-3">{((rows ?? []) as any[]).map((r, i) => {
          const earned = r.earned == null ? null : Number(r.earned), max = Number(r.points);
          const state = earned == null ? 'pend' : earned >= max ? 'ok' : earned > 0 ? 'part' : 'bad';
          const color = { ok: 'border-emerald-300 bg-emerald-50/40', part: 'border-amber-300 bg-amber-50/40', bad: 'border-red-300 bg-red-50/40', pend: 'border-slate-200' }[state];
          return (
            <div key={r.question_id} className={`card card-pad border-2 ${color}`} data-testid="revision-pregunta">
              <div className="flex flex-wrap items-start gap-2">
                <p className="flex-1 whitespace-pre-line font-semibold">{i + 1}. {r.kind === 'completar' ? String(r.prompt).split(BLANK).join(' ____ ') : r.prompt}</p>
                <span className="rounded-full bg-white px-3 py-1 text-sm font-bold shadow-sm">{state === 'ok' ? '✅' : state === 'part' ? '🟡' : state === 'bad' ? '❌' : '📝'} {earned == null ? 'Por corregir' : `${earned} / ${max}`}</span>
              </div>
              <p className="mt-2 text-sm"><span className="text-slate-500">Su respuesta:</span> <span className="whitespace-pre-line">{givenText(r, r.given)}</span></p>
              {(r.correct || r.answer) && r.kind !== 'desarrollo' && <p className="mt-1 text-sm text-emerald-800"><span className="text-slate-500">Respuesta correcta:</span> {correctText(r, r.correct, r.answer)}</p>}
              {r.feedback && <p className="mt-2 rounded-lg bg-blue-50 p-2 text-sm text-blue-900" data-testid="retroalimentacion">💬 {r.feedback}</p>}
              {r.comment && <p className="mt-2 rounded-lg bg-violet-50 p-2 text-sm text-violet-900">👩‍🏫 Profesor: {r.comment}</p>}
            </div>);
        })}</div>)}
    </>
  );
}
