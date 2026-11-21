import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getContext } from '@/lib/context';
import { loadSection } from '@/lib/aula';
import { fmtDateTime } from '@/lib/format';
import { PageHeader, Card } from '@/components/ui';
import { QuizRunner, StartQuiz } from './runner';
import { AttachmentList } from '@/components/attachment-list';
import { listAttachments } from '@/lib/attachments';

export default async function Page({ params }: { params: Promise<{ id: string; qid: string }> }) {
  const { id, qid } = await params;
  const ctx = await getContext();
  const { s: sec, student, manager } = await loadSection(ctx, id);
  if (!student && !manager) notFound();
  // 👁 Vista previa del profesor: ve la prueba tal como la verá el estudiante (sin respuestas correctas ni intento)
  if (manager && !student) {
    const { data: q } = await ctx.supabase.from('quizzes').select('*').eq('id', qid).eq('section_id', id).maybeSingle();
    if (!q) notFound();
    const [{ data: qs }, mats] = await Promise.all([
      ctx.supabase.from('quiz_questions').select('id, prompt, kind, options, points').eq('quiz_id', qid).order('position').order('id'),
      listAttachments(ctx, 'quiz', [qid])]);
    const pts = (qs ?? []).reduce((n: number, x: any) => n + Number(x.points), 0);
    return (
      <>
        <PageHeader title={`👁 ${q.title}`} subtitle={`Vista previa del profesor · ${qs?.length ?? 0} preguntas · ${pts} puntos${q.time_limit_min ? ` · ${q.time_limit_min} minutos` : ''}`} />
        <div className="flex flex-wrap gap-3 text-sm"><Link href={`/app/aula/${id}?t=examenes`} className="link">← Exámenes</Link><Link href={`/app/aula/${id}/examen/${qid}`} className="link">✏ Preguntas y resultados</Link></div>
        <p className="mt-3 rounded-lg bg-blue-50 p-3 text-sm text-blue-900" data-testid="vista-previa">
          Así verán la prueba sus estudiantes. {q.published ? `Ellos la pueden abrir entre el ${fmtDateTime(q.opens_at)} y el ${fmtDateTime(q.closes_at)}.` : 'Todavía es un borrador: publíquela para que la vean.'} En esta vista no se guardan respuestas.</p>
        {mats[qid]?.length ? <Card className="mt-4"><p className="text-sm font-semibold">📎 Archivos del examen</p><AttachmentList items={mats[qid]} /></Card> : null}
        {q.instructions && <Card className="mt-4"><p className="whitespace-pre-line text-sm">{q.instructions}</p></Card>}
        <div className="mt-4 space-y-3">{(qs ?? []).map((x: any, i: number) => (
          <Card key={x.id} title={`${i + 1}. ${x.prompt}`}>
            <ul className="space-y-1 text-sm">{(x.options as string[]).map((o, j) => (
              <li key={j} className="flex items-center gap-2"><input type={x.kind === 'multiple' ? 'checkbox' : 'radio'} name={x.id} disabled /> {o}</li>))}</ul>
            <p className="mt-1 text-xs text-slate-500">{x.points} pt · {x.kind === 'multiple' ? 'puede marcar varias' : 'marque una'}</p>
          </Card>))}
          {!qs?.length && <Card><p className="text-sm text-slate-500">La prueba aún no tiene preguntas.</p></Card>}
        </div>
      </>);
  }
  const { data: q } = await ctx.supabase.from('quizzes').select('*').eq('id', qid).eq('published', true).maybeSingle();
  if (!q) notFound();
  const { data: open } = await ctx.supabase.from('quiz_attempts').select('id, deadline').eq('quiz_id', qid).eq('student_id', ctx.studentId!)
    .is('submitted_at', null).gt('deadline', new Date().toISOString()).maybeSingle();
  const { data: qs } = open ? await ctx.supabase.from('quiz_questions').select('id, prompt, kind, options, points').eq('quiz_id', qid).order('position').order('id') : { data: null };
  const mats = await listAttachments(ctx, 'quiz', [qid]);
  return (
    <>
      <PageHeader title={q.title} subtitle={q.time_limit_min ? `Tiempo límite: ${q.time_limit_min} minutos` : 'Sin tiempo límite (hasta el cierre)'} />
      <Link href={`/app/aula/${id}?t=examenes`} className="link text-sm">← Exámenes</Link>
      {mats[qid]?.length ? <Card className="mt-4"><p className="text-sm font-semibold">📎 Archivos del examen</p><AttachmentList items={mats[qid]} /></Card> : null}
      <div className="mt-4">
        {open && qs ? <QuizRunner attemptId={open.id} deadline={open.deadline} questions={qs as any} back={`/app/aula/${id}?t=examenes`} org={sec.organization_id} />
          : <Card>{q.instructions && <p className="mb-4 whitespace-pre-line text-sm">{q.instructions}</p>}
              <p className="mb-4 text-sm text-slate-600">Al comenzar, el tiempo empieza a correr. Las respuestas se corrigen automáticamente al enviar.</p>
              <StartQuiz quizId={qid} /></Card>}
      </div>
    </>
  );
}
