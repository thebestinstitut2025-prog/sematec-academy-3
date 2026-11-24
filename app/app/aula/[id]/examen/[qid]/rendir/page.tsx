import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getContext } from '@/lib/context';
import { loadSection } from '@/lib/aula';
import { fmtDateTime } from '@/lib/format';
import { Card } from '@/components/ui';
import { QuizRunner, StartQuiz, type RunnerQ } from './runner';
import { AttachmentList } from '@/components/attachment-list';
import { listAttachments } from '@/lib/attachments';
import { themeOf } from '@/lib/quiz';

const COLS = 'id, prompt, kind, options, choices, points';

/** Portada del examen: color, datos y botón para entrar. */
function Cover({ q, n, pts, extra, children }: { q: any; n: number; pts: number; extra?: React.ReactNode; children?: React.ReactNode }) {
  const th = themeOf(q.theme);
  return (
    <div className="card overflow-hidden" data-testid="portada-examen">
      <div className={`bg-gradient-to-r ${th.grad} px-6 py-8 text-white`}>
        <p className="text-sm font-semibold uppercase tracking-wider opacity-80">✅ Examen en línea</p>
        <h1 className="mt-1 text-2xl font-bold sm:text-3xl">{q.title}</h1>
        <div className="mt-4 flex flex-wrap gap-2 text-sm">
          <span className="rounded-full bg-white/20 px-3 py-1">❓ {n} pregunta{n === 1 ? '' : 's'}</span>
          <span className="rounded-full bg-white/20 px-3 py-1">⭐ {pts} puntos</span>
          <span className="rounded-full bg-white/20 px-3 py-1">⏱ {q.time_limit_min ? `${q.time_limit_min} minutos` : 'Sin tiempo límite'}</span>
          <span className="rounded-full bg-white/20 px-3 py-1">🔁 {q.max_attempts} intento{q.max_attempts > 1 ? 's' : ''}</span>
          {q.pass_pct && <span className="rounded-full bg-white/20 px-3 py-1">🎯 Aprueba con {q.pass_pct}%</span>}
          <span className="rounded-full bg-white/20 px-3 py-1">📅 Cierra {fmtDateTime(q.closes_at)}</span>
        </div>
      </div>
      <div className="p-6">{extra}{children}</div>
    </div>
  );
}

export default async function Page({ params }: { params: Promise<{ id: string; qid: string }> }) {
  const { id, qid } = await params;
  const ctx = await getContext();
  const { s: sec, student, manager } = await loadSection(ctx, id);
  if (!student && !manager) notFound();
  const withImages = async (qs: any[]): Promise<RunnerQ[]> => {
    const imgs = await listAttachments(ctx, 'quiz_question', qs.map((x) => x.id));
    return qs.map((x) => ({ ...x, points: Number(x.points), images: (imgs[x.id] ?? []).map((a) => ({ id: a.id, name: a.name, mime: a.mime })) }));
  };
  // 👁 Vista previa del profesor: la prueba tal como la verá el estudiante (sin guardar nada)
  if (manager && !student) {
    const { data: q } = await ctx.supabase.from('quizzes').select('*').eq('id', qid).eq('section_id', id).maybeSingle();
    if (!q) notFound();
    const [{ data: qs }, mats] = await Promise.all([
      ctx.supabase.from('quiz_questions').select(COLS).eq('quiz_id', qid).order('position').order('id'),
      listAttachments(ctx, 'quiz', [qid])]);
    const pts = (qs ?? []).reduce((n: number, x: any) => n + Number(x.points), 0);
    const list = await withImages(qs ?? []);
    const deadline = new Date(Date.now() + (q.time_limit_min ?? 60) * 60000).toISOString();
    return (
      <>
        <div className="mb-3 flex flex-wrap gap-3 text-sm"><Link href={`/app/aula/${id}?t=examenes`} className="link">← Exámenes</Link><Link href={`/app/aula/${id}/examen/${qid}`} className="link">✏ Preguntas y resultados</Link></div>
        <Cover q={q} n={qs?.length ?? 0} pts={pts}>
          <p className="rounded-lg bg-blue-50 p-3 text-sm text-blue-900" data-testid="vista-previa">
            👁 Vista previa del profesor: así verán la prueba sus estudiantes. {q.published ? `Ellos la pueden abrir entre el ${fmtDateTime(q.opens_at)} y el ${fmtDateTime(q.closes_at)}.` : 'Todavía es un borrador: publíquela para que la vean.'} En esta vista no se guardan respuestas.</p>
          {q.instructions && <p className="mt-3 whitespace-pre-line text-sm">{q.instructions}</p>}
          {mats[qid]?.length ? <div className="mt-3"><p className="text-sm font-semibold">📎 Archivos del examen</p><AttachmentList items={mats[qid]} /></div> : null}
        </Cover>
        <div className="mt-4">{list.length
          ? <QuizRunner preview attemptId={`preview-${qid}`} deadline={deadline} startedAt={new Date().toISOString()} questions={list} back={`/app/aula/${id}?t=examenes`} title={q.title} theme={q.theme}
              shuffleQ={q.shuffle_questions} shuffleO={q.shuffle_options} onePerPage={q.one_per_page} />
          : <Card><p className="text-sm text-slate-500">La prueba aún no tiene preguntas.</p></Card>}</div>
      </>);
  }
  const { data: q } = await ctx.supabase.from('quizzes').select('*').eq('id', qid).eq('published', true).maybeSingle();
  if (!q) notFound();
  const [{ data: open }, { data: done }] = await Promise.all([
    ctx.supabase.from('quiz_attempts').select('id, deadline, started_at').eq('quiz_id', qid).eq('student_id', ctx.studentId!).is('submitted_at', null).gt('deadline', new Date().toISOString()).maybeSingle(),
    ctx.supabase.from('quiz_attempts').select('id, submitted_at, score, max_score, grade, needs_review').eq('quiz_id', qid).eq('student_id', ctx.studentId!).not('submitted_at', 'is', null).order('started_at'),
  ]);
  const { data: qs } = open ? await ctx.supabase.from('quiz_questions').select(COLS).eq('quiz_id', qid).order('position').order('id') : { data: null };
  const mats = await listAttachments(ctx, 'quiz', [qid]);
  const back = `/app/aula/${id}?t=examenes`;
  if (open && qs) {
    return (
      <>
        <Link href={back} className="link text-sm">← Exámenes</Link>
        {mats[qid]?.length ? <Card className="mt-3"><p className="text-sm font-semibold">📎 Archivos del examen</p><AttachmentList items={mats[qid]} /></Card> : null}
        <div className="mt-3">
          <QuizRunner attemptId={open.id} deadline={open.deadline} startedAt={open.started_at} questions={await withImages(qs)} back={back} org={sec.organization_id}
            title={q.title} theme={q.theme} shuffleQ={q.shuffle_questions} shuffleO={q.shuffle_options} onePerPage={q.one_per_page}
            reviewHref={`/app/aula/${id}/examen/${qid}/revision?intento=${open.id}`} />
        </div>
      </>);
  }
  const { data: info } = await ctx.supabase.rpc('quiz_info', { p_quiz: qid });
  const inf = (info ?? { n: 0, points: 0 }) as { n: number; points: number };
  return (
    <>
      <Link href={back} className="link text-sm">← Exámenes</Link>
      <div className="mt-3">
        <Cover q={q} n={inf.n} pts={Number(inf.points)}>
          {q.instructions && <p className="mb-4 whitespace-pre-line text-sm">{q.instructions}</p>}
          {mats[qid]?.length ? <div className="mb-4"><p className="text-sm font-semibold">📎 Archivos del examen</p><AttachmentList items={mats[qid]} /></div> : null}
          {(done ?? []).length > 0 && (
            <div className="mb-4 space-y-1 text-sm" data-testid="mis-intentos">{(done ?? []).map((t: any, i: number) => (
              <p key={t.id}>Intento {i + 1}: {q.show_results ? <b>{t.score} / {t.max_score}{t.grade != null && ` · nota ${t.grade}`}</b> : 'enviado'}
                {t.needs_review && <span className="ml-2 text-xs text-amber-700">📝 falta corrección del profesor</span>}
                {q.show_results && <Link className="link ml-2 text-xs" href={`/app/aula/${id}/examen/${qid}/revision?intento=${t.id}`} data-testid="ver-revision">🔍 Ver mis respuestas</Link>}</p>))}</div>)}
          <p className="mb-4 text-sm text-slate-600">Al comenzar, el tiempo empieza a correr. Sus respuestas se guardan en este equipo mientras responde y se corrigen al enviar.</p>
          {(done ?? []).length < q.max_attempts ? <StartQuiz quizId={qid} /> : <p className="text-sm font-semibold text-slate-600">Ya usó todos sus intentos.</p>}
        </Cover>
      </div>
    </>
  );
}
