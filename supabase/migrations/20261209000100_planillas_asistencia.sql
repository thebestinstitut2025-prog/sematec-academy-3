-- =====================================================================
-- 📊 Planillas de asistencia: tablas con filas (estudiantes) y columnas (clases)
-- Varias tablas por sección (por mes, unidad…), cada una con su diseño y columnas
-- propias extra (observaciones, notas, ✓). Las celdas de asistencia son los
-- registros oficiales del libro de clases (attendance_records).
-- =====================================================================

create table if not exists public.attendance_sheets (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  section_id      uuid not null references public.sections (id) on delete cascade,
  name            text not null check (length(trim(name)) between 1 and 80),
  from_date       date,
  to_date         date,
  design          jsonb not null default '{}'::jsonb,
  extra_cols      jsonb not null default '[]'::jsonb check (jsonb_typeof(extra_cols) = 'array' and jsonb_array_length(extra_cols) <= 20),
  position        int not null default 0,
  created_by      uuid references public.profiles (id),
  created_at      timestamptz not null default now(),
  check (to_date is null or from_date is null or to_date >= from_date)
);
create index if not exists attendance_sheets_section_idx on public.attendance_sheets (section_id, position);

create table if not exists public.attendance_sheet_cells (
  sheet_id   uuid not null references public.attendance_sheets (id) on delete cascade,
  student_id uuid not null references public.students (id) on delete cascade,
  col_key    text not null check (col_key ~ '^[a-z0-9_]{1,30}$'),
  value      text check (length(value) <= 500),
  updated_by uuid references public.profiles (id),
  updated_at timestamptz not null default now(),
  primary key (sheet_id, student_id, col_key)
);

alter table public.attendance_sheets enable row level security;
alter table public.attendance_sheet_cells enable row level security;
revoke all on public.attendance_sheets, public.attendance_sheet_cells from anon;
grant select, insert, update, delete on public.attendance_sheets, public.attendance_sheet_cells to authenticated;

create or replace function private.sheet_can_read(p_section uuid, p_org uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.teaches_section(p_section) or private.has_permission(p_org, 'attendance.view')
$$;
create or replace function private.sheet_can_write(p_section uuid, p_org uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select (private.teaches_section(p_section) or private.has_permission(p_org, 'attendance.edit')) and not private.section_is_closed(p_section)
$$;

drop policy if exists ash_read on public.attendance_sheets;
create policy ash_read on public.attendance_sheets for select to authenticated using (private.sheet_can_read(section_id, organization_id));
drop policy if exists ash_write on public.attendance_sheets;
create policy ash_write on public.attendance_sheets for all to authenticated
  using (private.sheet_can_write(section_id, organization_id)) with check (private.sheet_can_write(section_id, organization_id));

drop policy if exists ashc_read on public.attendance_sheet_cells;
create policy ashc_read on public.attendance_sheet_cells for select to authenticated using (
  exists (select 1 from public.attendance_sheets s where s.id = sheet_id and private.sheet_can_read(s.section_id, s.organization_id)));
drop policy if exists ashc_write on public.attendance_sheet_cells;
create policy ashc_write on public.attendance_sheet_cells for all to authenticated
  using (exists (select 1 from public.attendance_sheets s where s.id = sheet_id and private.sheet_can_write(s.section_id, s.organization_id)))
  with check (exists (select 1 from public.attendance_sheets s where s.id = sheet_id and private.sheet_can_write(s.section_id, s.organization_id)));

do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'audit_attendance_sheets') then
    create trigger audit_attendance_sheets after insert or update or delete on public.attendance_sheets for each row execute function private.audit_row();
  end if;
end $$;

-- Borrar una celda de asistencia (dejarla vacía)
create or replace function public.clear_attendance(p_session uuid, p_student uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare cs public.class_sessions;
begin
  select * into cs from public.class_sessions where id = p_session;
  if cs.id is null or not private.sheet_can_write(cs.section_id, cs.organization_id) then raise exception 'No autorizado' using errcode = '42501'; end if;
  delete from public.attendance_records where class_session_id = p_session and student_id = p_student;
end $$;

-- Eliminar una columna (clase) de la planilla y su asistencia
create or replace function public.delete_class_session(p_session uuid)
returns int language plpgsql security definer set search_path = '' as $$
declare cs public.class_sessions; n int;
begin
  select * into cs from public.class_sessions where id = p_session;
  if cs.id is null then raise exception 'La clase ya no existe' using errcode = 'P0002'; end if;
  if not private.sheet_can_write(cs.section_id, cs.organization_id) then raise exception 'No autorizado (o el acta está cerrada)' using errcode = '42501'; end if;
  update public.conference_sessions set class_session_id = null where class_session_id = p_session;
  delete from public.attendance_records where class_session_id = p_session;
  get diagnostics n = row_count;
  delete from public.class_sessions where id = p_session;
  return n;
end $$;

revoke all on function public.clear_attendance(uuid, uuid), public.delete_class_session(uuid) from public, anon;
grant execute on function public.clear_attendance(uuid, uuid), public.delete_class_session(uuid) to authenticated;
