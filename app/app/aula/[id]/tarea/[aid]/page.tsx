import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getContext } from '@/lib/context';
import { loadSection } from '@/lib/aula';
import { PageHeader, Card, Badge, Empty } from '@/components/ui';
import { ActionForm, Field } from '@/components/forms';
import { fmtDateTime } from '@/lib/format';
import { AttachmentList } from '@/components/attachment-list';
import { listAttachments } from '@/lib/attachments';
import { gradeSubmission } from '../../../actions';
import { gradeWithRubric } from '../../../examen-pro-actions';
import { RubricTable } from '@/components/rubric-table';

export default async function Page({ params }: { params: Promise<{ id: string; aid: string }> }) {
  const { id, aid } = await params;
  const ctx = await getContext();
  const { manager } = await loadSection(ctx, id);
  if (!manager) notFound();
  const [{ data: a }, { data: subs }, { data: roster }] = await Promise.all([
    ctx.supabase.from('assignments').select('*').eq('id', aid).maybeSingle(),
    ctx.supabase.from('submissions').select('*, students(first_names, last_names)').eq('assignment_id', aid).order('submitted_at'),
    ctx.supabase.from('section_enrollments').select('student_id, students(first_names, last_names)').eq('section_id', id).neq('status', 'dropped'),
  ]);
  if (!a) notFound();
  const files = await listAttachments(ctx, 'submission', (subs ?? []).map((x: any) => x.id));
  const rub: any[] = Array.isArray(a.rubric) ? a.rubric : [];
  const missing = (roster ?? []).filter((r: any) => !(subs ?? []).some((s: any) => s.student_id === r.student_id));
  return (
    <>
      <PageHeader title={a.title} subtitle={`Entrega ${fmtDateTime(a.due_at)} · puntaje máximo ${a.max_score}`} />
      <Link href={`/app/aula/${id}?t=tareas`} className="link text-sm">← Tareas</Link>
      {rub.length > 0 && <RubricTable rubric={rub} />}
      <div className="mt-4 space-y-4">
        {subs?.length ? subs.map((s: any) => (
          <Card key={s.id} title={`${s.students?.last_names}, ${s.students?.first_names}`}
            actions={s.score != null ? <Badge color="green">{s.score} / {a.max_score}</Badge> : s.late ? <Badge color="amber">Atrasada</Badge> : <Badge color="blue">Por calificar</Badge>}>
            <p className="text-xs text-slate-500">Entregado {fmtDateTime(s.submitted_at)}</p>
            {s.body && <p className="mt-2 whitespace-pre-line text-sm">{s.body}</p>}
            {s.url && <p className="mt-1 text-sm"><a className="link" href={s.url} target="_blank" rel="noopener noreferrer">{s.url} ↗</a></p>}
            {s.file_id && <p className="mt-1 text-sm"><a className="link" href={`/app/aula/archivo/${s.file_id}`}>📎 Descargar archivo</a></p>}
            <AttachmentList items={files[s.id]} />
            {rub.length > 0 && (
              <ActionForm action={gradeWithRubric} submitLabel="📏 Calificar con rúbrica" className="mt-4 space-y-2" resetOnSuccess={false}>
                <input type="hidden" name="section_id" value={id} /><input type="hidden" name="submission_id" value={s.id} /><input type="hidden" name="n" value={rub.length} />
                <div className="overflow-x-auto rounded-xl border border-slate-200" data-testid="calificar-rubrica"><table className="w-full text-sm"><tbody>{rub.map((r: any, i: number) => (
                  <tr key={i} className="border-t border-slate-100 first:border-0"><td className="px-3 py-2"><b>{r.c}</b>{r.d && <p className="text-xs text-slate-500">{r.d}</p>}</td>
                    <td className="w-40 px-3 py-2"><div className="flex items-center gap-1"><input name={`r${i}`} type="number" step="0.5" min={0} max={r.max} required defaultValue={s.rubric_scores?.[i] ?? ''} className="input w-20" aria-label={r.c} data-testid="criterio" /><span className="text-xs text-slate-500">/ {r.max}</span></div></td></tr>))}</tbody></table></div>
                <input name="feedback" defaultValue={s.feedback ?? ''} className="input w-full" placeholder="Comentario para el estudiante" />
              </ActionForm>)}
            {rub.length > 0 && <p className="mt-3 text-xs text-slate-500">…o ponga el puntaje directo:</p>}
            <ActionForm action={gradeSubmission} submitLabel="Guardar calificación" className="mt-4 grid gap-3 sm:grid-cols-[8rem_1fr_auto] sm:items-end" resetOnSuccess={false}>
              <input type="hidden" name="section_id" value={id} /><input type="hidden" name="submission_id" value={s.id} />
              <Field label="Puntaje" name="score" type="number" step="0.5" min={0} max={Number(a.max_score)} required defaultValue={s.score ?? undefined} />
              <Field label="Comentario" name="feedback" defaultValue={s.feedback} />
            </ActionForm>
          </Card>)) : <Card><Empty>Aún no hay entregas.</Empty></Card>}
        {missing.length > 0 && <Card title={`Sin entregar (${missing.length})`}><p className="text-sm">{missing.map((m: any) => `${m.students?.last_names}, ${m.students?.first_names}`).join(' · ')}</p></Card>}
      </div>
    </>
  );
}
