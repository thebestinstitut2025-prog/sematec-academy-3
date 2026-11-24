import { idsOrNone, myTeachingSectionIds } from '@/lib/teaching';
import { notFound } from 'next/navigation';
import QRCode from 'qrcode';
import { OwnerActions } from '@/components/owner-actions';
import { env } from '@/lib/env';
import Link from 'next/link';
import { getContext, can } from '@/lib/context';
import { CopyCode } from '@/components/copy-code';
import { PageHeader, Card, Empty, StatusBadge, Tabs, Badge } from '@/components/ui';
import { ActionForm, Field, Grid, SelectField, TextArea } from '@/components/forms';
import { roomOptions, teacherOptions } from '@/lib/options';
import { WEEKDAYS, fmtDateTime, fmtNum, fullName, label, tzOffset, fmtSlot } from '@/lib/format';
import {
  addSchedule, removeSchedule, registerStudent, dropStudent, createClassSession, saveAttendance,
  createAssessment, togglePublish, saveGrades, closeActa, amendGrade, updateSection,
  openCheckin, closeCheckin, teacherMark, attendanceFromVirtual, newRoomCode, addSectionTeacher, removeSectionTeacher,
} from '../actions';
import { PeoplePicker } from '@/components/people-picker';
import { AttendanceSheet } from '@/components/attendance-sheet';
import { createSheet } from '../planilla-actions';
import { TEACHER_ROLES } from '@/lib/teaching';

const TSTATUS: Record<string, [string, 'gray' | 'green' | 'red' | 'amber']> = {
  pending: ['Por dictar', 'gray'], held: ['Dictada', 'green'], cancelled: ['Suspendida', 'red'], rescheduled: ['Reprogramada', 'amber'],
};

export default async function Page({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ t?: string; clase?: string; planilla?: string }> }) {
  const { id } = await params;
  const { t = 'resumen', clase, planilla } = await searchParams;
  const ctx = await getContext();
  const sb = ctx.supabase;
  const { data: s } = await sb.from('sections')
    .select('*, courses(code, name), academic_periods(id, code, name), campuses(name, timezone), teachers(id, first_names, last_names), grade_scales(*)')
    .eq('id', id).maybeSingle();
  if (!s) notFound();
  const isTeacher = !!ctx.teacherId && (s.teacher_id === ctx.teacherId || (await myTeachingSectionIds(ctx)).includes(s.id));
  if (!isTeacher && !can(ctx, 'sections.view') && !can(ctx, 'grades.view')) notFound();
  const closed = !!s.grades_closed_at;
  const tz: string = s.campuses?.timezone ?? 'America/Santiago';

  const { data: roster } = await sb.from('section_enrollments')
    .select('id, status, student_id, students(id, student_code, first_names, last_names)').eq('section_id', id).neq('status', 'dropped');
  const students = (roster ?? []).map((r: any) => ({ ...r.students, enr: r.id, enrStatus: r.status }))
    .sort((a: any, b: any) => a.last_names.localeCompare(b.last_names));

  const tabs = [['resumen', 'Resumen e inscritos'], ['asistencia', 'Libro de clases y asistencia'], ['planillas', '📊 Planillas de asistencia'], ['notas', 'Evaluaciones y notas']]
    .map(([key, l]) => ({ key, label: l, href: `/app/secciones/${id}?t=${key}` }));

  return (
    <>
      <PageHeader title={`${s.courses.code} · ${s.courses.name}`} subtitle={`Sección ${s.code} · ${s.academic_periods.name} · ${s.campuses.name} · Profesor: ${s.teachers ? fullName(s.teachers) : 'sin asignar'}`}
        actions={<>{closed ? <Badge color="gray">Acta cerrada</Badge> : <Badge color="green">Acta abierta</Badge>}<Link className="btn-secondary" href={isTeacher ? '/app/docencia' : '/app/secciones'}>Volver</Link></>} />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        {s.room_code && <CopyCode code={s.room_code} />}
        <Link className="link text-sm" href={`/app/aula/${id}`}>🎓 Abrir la sala en el Aula</Link>
        {can(ctx, 'sections.edit') && (
          <ActionForm action={newRoomCode} inline submitLabel="♻ Nuevo código" submitClass="btn-secondary btn-sm" confirm="¿Generar un código nuevo? El anterior deja de funcionar.">
            <input type="hidden" name="id" value={id} /></ActionForm>)}
      </div>
      <Tabs items={tabs} current={t} />
      {t === 'resumen' && <Resumen />}
      {t === 'asistencia' && <Asistencia />}
      {t === 'planillas' && <Planillas />}
      {t === 'notas' && <Notas />}
    </>
  );

  async function Resumen() {
    const [{ data: sched }, rooms, teachers, { data: candidates }, { data: staffT }] = await Promise.all([
      sb.from('section_schedules').select('id, weekday, time_slot, rooms(code, name)').eq('section_id', id).order('weekday'),
      roomOptions(ctx), teacherOptions(ctx),
      can(ctx, 'enrollments.create')
        ? sb.from('enrollments').select('student_id, students(first_names, last_names, student_code)').eq('period_id', s.period_id).eq('status', 'active')
        : Promise.resolve({ data: [] as any[] }),
      sb.rpc('section_teacher_list', { p_section: id }),
    ]);
    const teamList = (staffT ?? []) as { teacher_id: string; full_name: string; email: string; role: string }[];
    const inTeam = new Set(teamList.map((x) => x.teacher_id));
    const enrolledIds = new Set(students.map((x: any) => x.id));
    const options = (candidates ?? []).filter((c: any) => !enrolledIds.has(c.student_id))
      .map((c: any) => ({ value: c.student_id, label: `${c.students.last_names}, ${c.students.first_names} (${c.students.student_code})` }));
    return (
      <div className="grid gap-6 xl:grid-cols-2">
        <Card title={`Inscritos (${students.length} / ${s.capacity})`}>
          {students.length ? <table className="table"><thead><tr><th>Código</th><th>Estudiante</th><th>Estado</th><th></th></tr></thead>
            <tbody>{students.map((x: any) => <tr key={x.id}><td className="font-mono text-xs">{x.student_code}</td><td>{x.last_names}, {x.first_names}</td><td><StatusBadge status={x.enrStatus} /></td>
              <td className="text-right">{can(ctx, 'enrollments.edit') && !closed && (
                <ActionForm action={dropStudent} inline submitLabel="Dar de baja" submitClass="btn-secondary btn-sm" confirm={`¿Dar de baja a ${x.first_names} ${x.last_names}?`}>
                  <input type="hidden" name="id" value={x.enr} /><input type="hidden" name="section_id" value={id} />
                </ActionForm>)}</td></tr>)}</tbody></table> : <Empty>Sin estudiantes inscritos.</Empty>}
          {can(ctx, 'enrollments.create') && !closed && (
            <div className="mt-4 border-t border-slate-100 pt-4">
              <ActionForm action={registerStudent} inline submitLabel="Inscribir">
                <input type="hidden" name="section_id" value={id} />
                <SelectField label="Estudiante matriculado en el periodo" name="student_id" required options={options} className="min-w-72" />
                {can(ctx, 'enrollments.approve') && <label className="flex items-center gap-2 pb-2 text-xs"><input type="checkbox" name="override" /> Autorizar sin prerrequisitos</label>}
              </ActionForm>
            </div>
          )}
        </Card>
        <div className="space-y-6">
          <Card title={`👩‍🏫 Profesores de la sección (${teamList.length || (s.teacher_id ? 1 : 0)})`}>
            {teamList.length ? <ul className="mb-3 divide-y divide-slate-100 text-sm" data-testid="equipo-docente">{teamList.map((x) => (
              <li key={x.teacher_id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span><b>{x.full_name}</b> <Badge color={x.role === 'titular' ? 'green' : x.role === 'coprofesor' ? 'blue' : 'gray'}>{TEACHER_ROLES[x.role] ?? x.role}</Badge><span className="block text-xs text-slate-500">{x.email}</span></span>
                {x.role !== 'titular' && can(ctx, 'sections.edit') && <ActionForm action={removeSectionTeacher} inline submitLabel="Quitar" submitClass="btn-secondary btn-sm" confirm={`¿Quitar a ${x.full_name} de esta sección?`}>
                  <input type="hidden" name="section_id" value={id} /><input type="hidden" name="teacher_id" value={x.teacher_id} /></ActionForm>}
              </li>))}</ul> : <Empty>{s.teachers ? `Titular: ${fullName(s.teachers)}` : 'Sin profesores asignados.'}</Empty>}
            {can(ctx, 'sections.edit') && (
              <details className="rounded-lg border border-slate-200 p-3" data-testid="agregar-profesores"><summary className="cursor-pointer font-semibold text-brand-700">➕ Agregar profesores (los que quiera)</summary>
                <ActionForm action={addSectionTeacher} submitLabel="Agregar a la sección">
                  <input type="hidden" name="section_id" value={id} />
                  <PeoplePicker name="teacher_id" options={teachers.filter((t) => !inTeam.has(t.value) && t.value !== s.teacher_id)} />
                  <SelectField label="Como" name="role" defaultValue="coprofesor" options={[{ value: 'coprofesor', label: 'Co-profesor (mismos permisos que el titular)' }, { value: 'ayudante', label: 'Ayudante' }]} />
                  <p className="text-xs text-slate-500">Todos manejan el aula, las notas, la asistencia y las clases de esta sección. El titular se cambia en «Datos de la sección».</p>
                </ActionForm></details>)}
          </Card>
          <Card title="Horario">
            {sched?.length ? <ul className="mb-4 divide-y divide-slate-100 text-sm">{sched.map((h: any) => (
              <li key={h.id} className="flex items-center justify-between py-2">
                <span>{WEEKDAYS[h.weekday]} {fmtSlot(h.time_slot)} · {h.rooms ? `${h.rooms.code} ${h.rooms.name}` : 'Sin sala'}</span>
                {ctx.isOwner && <OwnerActions table="section_schedules" id={h.id} path={`/app/secciones/${id}`} name="este horario" />}
                {!ctx.isOwner && can(ctx, 'sections.edit') && <ActionForm action={removeSchedule} inline submitLabel="Quitar" submitClass="btn-secondary btn-sm"><input type="hidden" name="id" value={h.id} /><input type="hidden" name="section_id" value={id} /></ActionForm>}
              </li>))}</ul> : <Empty>Sin horario asignado.</Empty>}
            {can(ctx, 'sections.create') && (
              <ActionForm action={addSchedule} inline submitLabel="Agregar bloque">
                <input type="hidden" name="section_id" value={id} />
                <SelectField label="Día" name="weekday" required options={WEEKDAYS.slice(1).map((d, i) => ({ value: String(i + 1), label: d }))} />
                <Field label="Desde" name="start" type="time" required /><Field label="Hasta" name="end" type="time" required />
                <SelectField label="Sala" name="room_id" options={rooms} placeholder="Sin sala" />
              </ActionForm>
            )}
          </Card>
          {can(ctx, 'sections.edit') && (
            <Card title="Datos de la sección">
              <ActionForm action={updateSection} submitLabel="Guardar" resetOnSuccess={false}>
                <input type="hidden" name="id" value={id} />
                <Grid cols={3}>
                  <SelectField label="Profesor titular" name="teacher_id" options={teachers} defaultValue={s.teacher_id} placeholder="Sin asignar" />
                  <Field label="Cupos" name="capacity" type="number" min={1} defaultValue={s.capacity} required />
                  <Field label="Asistencia mínima %" name="min_attendance_pct" type="number" min={0} max={100} defaultValue={s.min_attendance_pct} required />
                </Grid>
              </ActionForm>
            </Card>
          )}
        </div>
      </div>
    );
  }

  async function Planillas() {
    const canWrite = (isTeacher || can(ctx, 'attendance.edit')) && !closed;
    const { data: sheets, error: shErr } = await sb.from('attendance_sheets').select('*').eq('section_id', id).order('position').order('created_at');
    if (shErr) return <Card><p className="text-sm text-amber-800">Falta instalar la actualización «Planillas de asistencia» en Actualizar base de datos.</p></Card>;
    const list = (sheets ?? []) as any[];
    const cur = list.find((x) => x.id === planilla) ?? list[0];
    const create = canWrite && (
      <details className="card mb-4" open={!list.length} data-testid="nueva-tabla"><summary className="cursor-pointer px-5 py-3 text-sm font-bold text-brand-700">➕ Crear tabla de asistencia</summary>
        <div className="border-t border-slate-100 p-5">
          <ActionForm action={createSheet} submitLabel="Crear tabla">
            <input type="hidden" name="section_id" value={id} />
            <Grid cols={3}>
              <Field label="Nombre" name="name" required placeholder="Ej.: Marzo, Unidad 1, Semestre" />
              <Field label="Clases desde (opcional)" name="from_date" type="date" />
              <Field label="Hasta (opcional)" name="to_date" type="date" />
            </Grid>
            <Grid>
              <SelectField label="Color" name="theme" defaultValue="azul" options={[['azul', 'Azul'], ['verde', 'Verde'], ['morado', 'Morado'], ['naranjo', 'Naranjo'], ['rosado', 'Rosado'], ['turquesa', 'Turquesa'], ['rojo', 'Rojo'], ['gris', 'Gris']].map(([value, label]) => ({ value, label }))} />
              {list.length > 0 && <SelectField label="Copiar diseño y columnas de" name="copy_from" placeholder="— No copiar —" options={list.map((x) => ({ value: x.id, label: x.name }))} />}
            </Grid>
            <p className="text-xs text-slate-500">Cada tabla muestra las clases de su rango de fechas (sin fechas: todas). Puede crear todas las que quiera.</p>
          </ActionForm>
        </div></details>);
    if (!cur) return <>{create}{!canWrite && <Empty>Aún no hay tablas de asistencia.</Empty>}</>;
    let q = sb.from('class_sessions').select('id, starts_at, topic').eq('section_id', id).order('starts_at');
    if (cur.from_date) q = q.gte('starts_at', `${cur.from_date}T00:00:00-04:00`);
    if (cur.to_date) q = q.lte('starts_at', `${cur.to_date}T23:59:59-03:00`);
    const { data: ses } = await q.limit(400);
    const sesIds = (ses ?? []).map((x: any) => x.id);
    const [{ data: recs }, { data: cells }] = await Promise.all([
      sesIds.length ? sb.from('attendance_records').select('class_session_id, student_id, status').in('class_session_id', sesIds) : Promise.resolve({ data: [] as any[] }),
      sb.from('attendance_sheet_cells').select('student_id, col_key, value').eq('sheet_id', cur.id),
    ]);
    const recMap: Record<string, string> = {}; for (const r of (recs ?? []) as any[]) recMap[`${r.class_session_id}|${r.student_id}`] = r.status;
    const cellMap: Record<string, string> = {}; for (const c of (cells ?? []) as any[]) cellMap[`${c.student_id}|${c.col_key}`] = c.value;
    const def = { theme: 'azul', font: 'md', density: 'normal', symbols: 'letras', header: 'fecha', stripes: true, grid: true, code: false, pct: true, totals: true, colTotals: true, highlightLow: true, title: '' };
    return (
      <>
        <nav className="mb-3 flex flex-wrap gap-2" aria-label="Tablas" data-testid="tablas">{list.map((x) => (
          <Link key={x.id} href={`/app/secciones/${id}?t=planillas&planilla=${x.id}`} className={x.id === cur.id ? 'btn-primary btn-sm' : 'btn-secondary btn-sm'}>📊 {x.name}</Link>))}</nav>
        {create}
        <Card title={`📊 ${cur.name}${cur.from_date || cur.to_date ? ` · ${cur.from_date ?? '…'} a ${cur.to_date ?? '…'}` : ''}`}>
          <AttendanceSheet key={cur.id} sheet={{ id: cur.id, name: cur.name, design: { ...def, ...(cur.design ?? {}) }, extra_cols: cur.extra_cols ?? [], from_date: cur.from_date, to_date: cur.to_date }}
            sessions={(ses ?? []) as any[]} students={students.map((x: any) => ({ id: x.id, name: `${x.last_names}, ${x.first_names}`, code: x.student_code }))}
            records={recMap} cells={cellMap} canWrite={canWrite} sectionId={id} minPct={Number(s.min_attendance_pct ?? 75)} tz={tz} />
        </Card>
      </>
    );
  }

  async function Asistencia() {
    const { data: sessions } = await sb.from('class_sessions').select('id, starts_at, ends_at, topic, content_covered, teacher_status, teacher_checkin_at, teacher_checkout_at, checkin_code, checkin_expires_at, conference_session_id, conference_sessions!conference_sessions_organization_id_class_session_id_fkey(id), attendance_records(student_id, status, source)')
      .eq('section_id', id).order('starts_at', { ascending: false });
    const canWrite = (isTeacher || can(ctx, 'attendance.create')) && !closed;
    const current = sessions?.find((x: any) => x.id === clase) ?? sessions?.[0];
    const statusOf = (stu: string) => current?.attendance_records?.find((a: any) => a.student_id === stu)?.status ?? 'present';
    const total = (sessions ?? []).length;
    const codeOpen = current?.checkin_code && new Date(current.checkin_expires_at).getTime() > Date.now();
    const checkinUrl = codeOpen ? `${env.siteUrl()}/app/asistencia/marcar?c=${current.checkin_code}` : '';
    const qr = codeOpen ? await QRCode.toDataURL(checkinUrl, { margin: 1, width: 260 }) : null;
    const hasVirtual = !!current && (!!current.conference_session_id || !!current.conference_sessions?.length);
    const hid = current ? <><input type="hidden" name="class_session_id" value={current.id} /><input type="hidden" name="section_id" value={id} /></> : null;
    const time = (iso?: string | null) => iso ? new Date(iso).toLocaleTimeString('es-CL', { timeZone: tz, hour: '2-digit', minute: '2-digit' }) : '';
    const pct = (stu: string) => {
      let att = 0, den = 0;
      for (const ses of sessions ?? []) {
        const st = ses.attendance_records?.find((a: any) => a.student_id === stu)?.status;
        if (!st || st === 'excused') continue;
        den++; if (st === 'present' || st === 'late') att++;
      }
      return den ? Math.round((100 * att) / den) : null;
    };
    return (
      <div className="grid gap-6 xl:grid-cols-3">
        <div className="space-y-6">
          {canWrite && (
            <Card title="Registrar clase">
              <ActionForm action={createClassSession} submitLabel="Registrar clase">
                <input type="hidden" name="section_id" value={id} /><input type="hidden" name="tz_offset" value={tzOffset(tz)} />
                <Field label="Fecha" name="date" type="date" required defaultValue={new Date().toISOString().slice(0, 10)} />
                <Grid><Field label="Inicio" name="start" type="time" required /><Field label="Término" name="end" type="time" required /></Grid>
                <Field label="Tema" name="topic" required />
                <TextArea label="Contenido tratado (avance curricular)" name="content_covered" />
              </ActionForm>
            </Card>
          )}
          <Card title={`Clases registradas (${total})`}>
            {sessions?.length ? <ul className="divide-y divide-slate-100 text-sm">{sessions.map((x: any) => (
              <li key={x.id} className="py-2"><Link className={x.id === current?.id ? 'font-bold text-brand-700' : 'link'} href={`/app/secciones/${id}?t=asistencia&clase=${x.id}`}>{fmtDateTime(x.starts_at, tz)}</Link>
                <p className="flex flex-wrap items-center gap-1 text-xs text-slate-500">{x.topic ?? 'Sin tema'} · {x.attendance_records?.length ?? 0} registros
                  <Badge color={TSTATUS[x.teacher_status]?.[1]}>{TSTATUS[x.teacher_status]?.[0]}</Badge></p>
                {ctx.isOwner && <div className="mt-1"><OwnerActions table="class_sessions" id={x.id} path={`/app/secciones/${id}?t=asistencia`} name="esta clase" /></div>}</li>))}</ul>
              : <Empty>Aún no hay clases registradas.</Empty>}
          </Card>
        </div>
        <Card title={current ? `Asistencia: ${fmtDateTime(current.starts_at, tz)} — ${current.topic ?? ''}` : 'Asistencia'} className="xl:col-span-2">
          {current && canWrite && (
            <div className="mb-5 space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-4" data-testid="herramientas-clase">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <b>Clase:</b> <Badge color={TSTATUS[current.teacher_status]?.[1]}>{TSTATUS[current.teacher_status]?.[0]}</Badge>
                {current.teacher_checkin_at && <span className="text-xs text-slate-600">Inicio {time(current.teacher_checkin_at)}{current.teacher_checkout_at && ` · Término ${time(current.teacher_checkout_at)}`}</span>}
                <span className="ml-auto flex flex-wrap gap-1">
                  {!current.teacher_checkin_at && <ActionForm action={teacherMark} inline submitLabel="▶ Iniciar clase" submitClass="btn-primary btn-sm">{hid}<input type="hidden" name="action" value="start" /></ActionForm>}
                  {current.teacher_checkin_at && !current.teacher_checkout_at && <ActionForm action={teacherMark} inline submitLabel="■ Terminar clase" submitClass="btn-secondary btn-sm">{hid}<input type="hidden" name="action" value="end" /></ActionForm>}
                  {current.teacher_status !== 'cancelled' && <ActionForm action={teacherMark} inline submitLabel="✕ Suspender clase" submitClass="btn-secondary btn-sm" confirm="¿Marcar esta clase como suspendida? No contará para la asistencia.">{hid}<input type="hidden" name="action" value="cancel" /></ActionForm>}
                </span>
              </div>
              {codeOpen ? (
                <div className="flex flex-wrap items-center gap-4" data-testid="qr-asistencia">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={qr!} alt="QR de asistencia" className="h-40 w-40 rounded-lg border border-slate-200 bg-white p-1" />
                  <div className="text-sm">
                    <p>Los estudiantes escanean el QR o escriben el código en <b>Mi portal → Marcar asistencia</b>:</p>
                    <p className="my-2 font-mono text-3xl font-black tracking-[0.3em] text-brand-700" data-testid="codigo-asistencia">{current.checkin_code}</p>
                    <p className="text-xs text-slate-500">Válido hasta las {time(current.checkin_expires_at)}. Después de 15 min de iniciada la clase se registra como atraso.</p>
                    <ActionForm action={closeCheckin} inline submitLabel="Cerrar código" submitClass="btn-secondary btn-sm mt-2">{hid}</ActionForm>
                  </div>
                </div>
              ) : (
                <div className="flex flex-wrap gap-2">
                  <ActionForm action={openCheckin} inline submitLabel="📱 Asistencia con QR (15 min)" submitClass="btn-secondary btn-sm">{hid}<input type="hidden" name="minutes" value="15" /></ActionForm>
                  {hasVirtual && <ActionForm action={attendanceFromVirtual} inline submitLabel="🎥 Tomar asistencia desde el aula virtual" submitClass="btn-secondary btn-sm">{hid}</ActionForm>}
                </div>
              )}
            </div>
          )}
          {!current ? <Empty>Registre una clase para tomar asistencia.</Empty> : !students.length ? <Empty>Sin estudiantes inscritos.</Empty> : (
            <ActionForm action={saveAttendance} offline={{ key: 'asistencia', label: `Asistencia ${fmtDateTime(current.starts_at, tz)}` }} submitLabel="Guardar asistencia" resetOnSuccess={false} hideSubmit={!canWrite}>
              <input type="hidden" name="class_session_id" value={current.id} /><input type="hidden" name="section_id" value={id} />
              <table className="table"><thead><tr><th>Estudiante</th><th>Estado</th><th>% acumulado</th></tr></thead>
                <tbody>{students.map((x: any) => (
                  <tr key={x.id}><td>{x.last_names}, {x.first_names}{(() => { const src = current.attendance_records?.find((a: any) => a.student_id === x.id)?.source; return src === 'qr' ? <span className="ml-1 text-xs" title="Marcó con QR">📱</span> : src === 'virtual' ? <span className="ml-1 text-xs" title="Aula virtual">🎥</span> : null; })()}</td>
                    <td><div className="flex flex-wrap gap-3 text-xs">{['present', 'late', 'absent', 'excused'].map((st) => (
                      <label key={st} className="flex items-center gap-1"><input type="radio" name={`att_${x.id}`} value={st} defaultChecked={statusOf(x.id) === st} disabled={!canWrite} />{label(st)}</label>))}</div></td>
                    <td className={(pct(x.id) ?? 100) < Number(s.min_attendance_pct) ? 'font-semibold text-red-600' : ''}>{pct(x.id) ?? '—'}{pct(x.id) != null && ' %'}</td></tr>))}</tbody></table>
            </ActionForm>
          )}
        </Card>
      </div>
    );
  }

  async function Notas() {
    const [{ data: assessments }, { data: grades }, { data: records }] = await Promise.all([
      sb.from('assessments').select('*').eq('section_id', id).order('created_at'),
      sb.from('grades').select('id, assessment_id, student_id, grade, assessments!inner(section_id)').eq('assessments.section_id', id),
      sb.from('academic_records').select('student_id, final_grade, attendance_pct, result').eq('section_id', id),
    ]);
    const gs = s.grade_scales;
    const canGrade = (isTeacher || can(ctx, 'grades.edit')) && !closed;
    const totalW = (assessments ?? []).reduce((a: number, x: any) => a + Number(x.weight_pct), 0);
    const g = (a: string, st: string) => grades?.find((x: any) => x.assessment_id === a && x.student_id === st);
    const avg = (st: string) => {
      let sum = 0, w = 0;
      for (const a of assessments ?? []) { const v = g(a.id, st); if (v) { sum += Number(v.grade) * Number(a.weight_pct); w += Number(a.weight_pct); } }
      return w ? sum / w : null;
    };
    const rec = (st: string) => records?.find((r: any) => r.student_id === st);
    return (
      <div className="space-y-6">
        <Card title={`Planilla de notas · escala ${gs.min_grade}–${gs.max_grade}, aprueba con ${gs.passing_grade} · ponderación total ${totalW} %`}>
          {!assessments?.length ? <Empty>Cree las evaluaciones de la sección.</Empty> : !students.length ? <Empty>Sin estudiantes inscritos.</Empty> : (
            <ActionForm action={saveGrades} offline={{ key: 'notas', label: 'Planilla de notas' }} submitLabel="Guardar notas" resetOnSuccess={false} hideSubmit={!canGrade}>
              <input type="hidden" name="section_id" value={id} />
              <div className="overflow-x-auto"><table className="table">
                <thead><tr><th>Estudiante</th>{assessments.map((a: any) => <th key={a.id} className="text-center">{a.name}<br /><span className="font-normal normal-case">{a.weight_pct} % {a.published ? '· visible' : '· oculta'}</span></th>)}
                  <th className="text-center">{closed ? 'Nota final' : 'Promedio parcial'}</th>{closed && <><th>Asist.</th><th>Resultado</th></>}</tr></thead>
                <tbody>{students.map((x: any) => (
                  <tr key={x.id}><td className="whitespace-nowrap">{x.last_names}, {x.first_names}</td>
                    {assessments.map((a: any) => (
                      <td key={a.id} className="text-center">
                        <input name={`g_${a.id}_${x.id}`} defaultValue={g(a.id, x.id)?.grade ?? ''} disabled={!canGrade} inputMode="decimal"
                          className="input w-20 text-center" aria-label={`Nota ${a.name} ${x.first_names}`} />
                      </td>))}
                    <td className="text-center font-bold">{closed ? fmtNum(rec(x.id)?.final_grade, gs.decimals) : avg(x.id) != null ? fmtNum(avg(x.id), gs.decimals) : '—'}</td>
                    {closed && <><td>{rec(x.id)?.attendance_pct != null ? `${fmtNum(rec(x.id)?.attendance_pct, 0)} %` : '—'}</td><td><StatusBadge status={rec(x.id)?.result} /></td></>}
                  </tr>))}</tbody></table></div>
              {!canGrade && <p className="text-xs text-slate-500">{closed ? 'El acta está cerrada. Las correcciones se hacen con «Rectificar nota».' : 'Solo lectura.'}</p>}
            </ActionForm>
          )}
        </Card>
        <div className="grid gap-6 xl:grid-cols-3">
          {canGrade && (
            <Card title="Nueva evaluación">
              <ActionForm action={createAssessment} submitLabel="Crear evaluación">
                <input type="hidden" name="section_id" value={id} />
                <Field label="Nombre" name="name" required placeholder="Prueba 1" />
                <Grid><Field label="Ponderación %" name="weight_pct" type="number" step="0.5" min={0.5} max={100} required /><Field label="Fecha" name="due_on" type="date" /></Grid>
                <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="published" /> Visible para estudiantes</label>
              </ActionForm>
            </Card>
          )}
          {canGrade && !!assessments?.length && (
            <Card title="Visibilidad">
              <ul className="space-y-2 text-sm">{assessments.map((a: any) => (
                <li key={a.id} className="flex flex-wrap items-center justify-between gap-1"><span>{a.name}</span>
                  {ctx.isOwner && <OwnerActions table="assessments" id={a.id} active={a.published} path={`/app/secciones/${id}?t=notas`} name={`la evaluación ${a.name}`} />}
                  <ActionForm action={togglePublish} inline submitLabel={a.published ? 'Ocultar' : 'Publicar'} submitClass="btn-secondary btn-sm">
                    <input type="hidden" name="id" value={a.id} /><input type="hidden" name="section_id" value={id} /><input type="hidden" name="published" value={String(!a.published)} />
                  </ActionForm></li>))}</ul>
            </Card>
          )}
          {!closed && (isTeacher || can(ctx, 'grades.approve')) && (
            <Card title="Cerrar acta">
              <p className="mb-3 text-sm text-slate-600">Calcula nota final y asistencia, determina aprobación y bloquea la planilla. Requiere que las ponderaciones sumen 100 % y que no falten notas.</p>
              <ActionForm action={closeActa} submitLabel="Cerrar acta" submitClass="btn-danger" confirm="Al cerrar el acta, las notas quedan bloqueadas. ¿Continuar?">
                <input type="hidden" name="section_id" value={id} />
              </ActionForm>
            </Card>
          )}
          {closed && can(ctx, 'grades.approve') && (
            <Card title="Rectificar nota (requiere MFA)">
              <ActionForm action={amendGrade} submitLabel="Rectificar">
                <input type="hidden" name="section_id" value={id} />
                <SelectField label="Nota" name="grade_id" required options={(grades ?? []).map((x: any) => {
                  const st = students.find((y: any) => y.id === x.student_id); const a = assessments?.find((y: any) => y.id === x.assessment_id);
                  return { value: x.id, label: `${st ? `${st.last_names}, ${st.first_names}` : '?'} · ${a?.name}: ${x.grade}` };
                })} />
                <Field label="Nueva nota" name="new_grade" type="number" step="0.1" required />
                <TextArea label="Motivo detallado" name="reason" required />
              </ActionForm>
            </Card>
          )}
        </div>
      </div>
    );
  }
}
