import { idsOrNone, myTeachingSectionIds } from '@/lib/teaching';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getContext, can, requireOrg } from '@/lib/context';
import { PageHeader, Card, Empty } from '@/components/ui';
import { ActionForm } from '@/components/forms';
import { enterRoomByCode } from './sala-actions';
import { cardStyle, pickCard } from '@/lib/card-style';

export const metadata = { title: 'Aula de aprendizaje' };

export default async function Page({ searchParams }: { searchParams: Promise<{ aviso?: string }> }) {
  const aviso = String((await searchParams).aviso ?? '').slice(0, 200);
  const ctx = await getContext();
  // Ficha de estudiante con el mismo correo y sin cuenta: se vincula sola al entrar
  if (!ctx.studentId && !ctx.teacherId && !can(ctx, 'sections.view')) {
    const { data: n } = await ctx.supabase.rpc('claim_my_student_records');
    if (Number(n) > 0) redirect('/app/aula');
  }
  const orgId = requireOrg(ctx);
  let q = ctx.supabase.from('sections').select('id, code, room_code, course_id, courses(code, name), academic_periods(name), teachers(first_names, last_names)').eq('organization_id', orgId).limit(300);
  if (ctx.studentId && !ctx.teacherId && !can(ctx, 'sections.view')) {
    const { data: se } = await ctx.supabase.from('section_enrollments').select('section_id').eq('student_id', ctx.studentId).neq('status', 'dropped');
    q = q.in('id', (se ?? []).map((x: any) => x.section_id).concat(['00000000-0000-0000-0000-000000000000']));
  } else if (ctx.teacherId && !can(ctx, 'sections.view')) q = q.in('id', idsOrNone(await myTeachingSectionIds(ctx)));
  const { data: sections } = await q;
  // 🎨 Color y fondo de cada tarjeta (si la actualización aún no está instalada, se ven como siempre)
  const { data: looks } = sections?.length ? await ctx.supabase.from('sections').select('id, card_color, card_image, courses(card_color, card_image)').in('id', sections.map((x: any) => x.id)) : { data: null };
  const lookOf = (id: string) => { const l: any = (looks ?? []).find((x: any) => x.id === id); return cardStyle(...Object.values(pickCard(l, l?.courses)) as [string | null, string | null]); };
  const perCourse = (sections ?? []).reduce<Record<string, number>>((a, x: any) => { a[x.course_id] = (a[x.course_id] ?? 0) + 1; return a; }, {});
  const staff = can(ctx, 'students.view');
  const { data: rep } = staff ? await ctx.supabase.rpc('aula_access_report', { p_org: orgId }) : { data: null };
  const badN = ((rep ?? []) as { issue: string }[]).filter((r) => r.issue !== 'ok').length;
  const why = ctx.studentId ? 'Está registrado como estudiante, pero todavía no está inscrito en ningún curso (sección). Pida a la institución que lo inscriba: apenas lo haga, sus cursos, tareas y evaluaciones aparecerán aquí.'
    : 'Su cuenta todavía no está vinculada a una ficha de estudiante de esta institución. Pida a la institución que registre su ficha con este mismo correo o que use «Crear contraseña» en su ficha.';
  return (
    <>
      <PageHeader title="Aula de aprendizaje" subtitle="Contenidos, tareas, exámenes en línea y foros de cada curso" />
      {staff && (
        <p className={`mb-4 rounded-lg p-3 text-sm ${badN ? 'bg-amber-50 text-amber-900' : 'bg-emerald-50 text-emerald-800'}`} data-testid="aviso-acceso">
          {badN ? <>⚠ <b>{badN} estudiante(s)</b> no pueden ver sus cursos o evaluaciones. </> : <>✓ Todos los estudiantes activos ven sus cursos. </>}
          <Link className="link font-semibold" href="/app/aula/acceso">🩺 Revisar acceso de estudiantes</Link>
        </p>)}
      {aviso && <p className="mb-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-900" role="alert" data-testid="aviso-aula">⚠ {aviso}</p>}
      <ActionForm action={enterRoomByCode} className="mb-4 flex flex-wrap items-end gap-2" submitLabel="🔑 Entrar a la sala" submitClass="btn-secondary">
        <label className="text-sm"><span className="mb-1 block font-semibold text-slate-600">¿Tiene el código de su sala?</span>
          <input name="code" required className="input w-56 font-mono uppercase" placeholder="SALA-XXXXXX" autoComplete="off" /></label>
      </ActionForm>
      {sections?.length ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {sections.map((s: any) => (
            (() => { const k = lookOf(s.id); return (
            <Link key={s.id} href={`/app/aula/${s.id}`} style={k.style} data-testid="tarjeta-curso"
              className={`card card-pad block min-h-[9rem] transition hover:-translate-y-0.5 hover:shadow-lg ${k.light ? 'border-transparent text-white' : 'hover:border-brand-500'}`}>
              <p className={`text-xs font-bold ${k.light ? 'text-white/85' : 'text-brand-600'}`}>{s.courses?.code} · Sala {s.code}{perCourse[s.course_id] > 1 ? ` (de ${perCourse[s.course_id]})` : ''}</p>
              <h2 className="mt-1 text-lg font-bold">{s.courses?.name}</h2>
              <p className={`mt-2 text-sm ${k.light ? 'text-white/85' : 'text-slate-500'}`}>{s.academic_periods?.name}{s.teachers && ` · ${s.teachers.first_names} ${s.teachers.last_names}`}</p>
              <p className={`mt-2 font-mono text-xs tracking-wider ${k.light ? 'text-white/80' : 'text-slate-500'}`} data-testid="tarjeta-codigo">🔑 {s.room_code}</p>
            </Link>); })()))}
        </div>
      ) : can(ctx, 'sections.create') ? (
        <Card title="Aún no hay cursos: créelos en 5 pasos">
          <ol className="list-decimal space-y-2 pl-5 text-sm">
            <li><Link className="link" href="/app/academico">Oferta académica</Link>: cree el programa, la asignatura y el periodo.</li>
            <li><Link className="link" href="/app/profesores">Profesores</Link>: registre al profesor y use «Crear contraseña».</li>
            <li><Link className="link" href="/app/secciones">Secciones y notas</Link>: cree la sección (asignatura + periodo + profesor).</li>
            <li><Link className="link" href="/app/estudiantes">Estudiantes</Link> y <Link className="link" href="/app/matriculas">Matrículas</Link>: registre y matricule. Si el estudiante debe entrar a la plataforma, use «Crear contraseña» en Estudiantes.</li>
            <li>Abra la sección e <b>inscriba</b> a los estudiantes. El curso aparecerá aquí con Contenidos, Tareas, Exámenes y Foro.</li>
          </ol>
        </Card>
      ) : <Card><Empty><span data-testid="sin-cursos">Aún no tiene cursos. {why}</span></Empty></Card>}
    </>
  );
}
