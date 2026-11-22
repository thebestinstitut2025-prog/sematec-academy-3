-- =====================================================================
-- 👩‍🏫 Varios profesores por sección (sala) y por asignatura
-- Además del profesor titular (sections.teacher_id), cada sección puede tener
-- todos los co-profesores y ayudantes que se quiera. Todos manejan el aula,
-- notas, asistencia y clases de esa sección.
-- =====================================================================

create table if not exists public.section_teachers (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  section_id      uuid not null references public.sections (id) on delete cascade,
  teacher_id      uuid not null references public.teachers (id) on delete cascade,
  role            text not null default 'coprofesor' check (role in ('coprofesor', 'ayudante')),
  created_at      timestamptz not null default now(),
  created_by      uuid references public.profiles (id),
  unique (section_id, teacher_id)
);
create index if not exists section_teachers_teacher_idx on public.section_teachers (teacher_id);
alter table public.section_teachers enable row level security;
revoke all on public.section_teachers from anon;
grant select on public.section_teachers to authenticated;
drop policy if exists st_read on public.section_teachers;
create policy st_read on public.section_teachers for select to authenticated using (private.is_member(organization_id));

do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'audit_section_teachers') then
    create trigger audit_section_teachers after insert or update or delete on public.section_teachers for each row execute function private.audit_row();
  end if;
end $$;

-- ¿Enseño en esta sección? (titular, co-profesor/ayudante o profesor de algún horario)
create or replace function private.teaches_section(p_section uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.sections s where s.id = p_section and s.teacher_id in (select private.my_teacher_ids()))
      or exists (select 1 from public.section_teachers st where st.section_id = p_section and st.teacher_id in (select private.my_teacher_ids()))
      or exists (select 1 from public.section_schedules sc where sc.section_id = p_section and sc.teacher_id in (select private.my_teacher_ids()))
$$;

-- Secciones donde enseño (para listas: aula, asistencia, archivos, anuncios…)
create or replace function public.my_teaching_sections()
returns setof uuid language sql stable security definer set search_path = '' as $$
  select s.id from public.sections s where s.teacher_id in (select private.my_teacher_ids())
  union select st.section_id from public.section_teachers st where st.teacher_id in (select private.my_teacher_ids())
  union select sc.section_id from public.section_schedules sc where sc.teacher_id in (select private.my_teacher_ids())
$$;
revoke all on function public.my_teaching_sections() from public, anon;
grant execute on function public.my_teaching_sections() to authenticated;

-- Todos los profesores de una sección (titular primero)
create or replace function public.section_teacher_list(p_section uuid)
returns table (teacher_id uuid, user_id uuid, full_name text, email text, phone text, role text)
language sql stable security definer set search_path = '' as $$
  select t.id, t.user_id, trim(t.first_names || ' ' || t.last_names), t.email, p.phone, x.role
  from (
    select s.teacher_id tid, 'titular'::text role, 0 ord from public.sections s where s.id = p_section and s.teacher_id is not null
    union all
    select st.teacher_id, st.role, case st.role when 'coprofesor' then 1 else 2 end from public.section_teachers st where st.section_id = p_section
  ) x join public.teachers t on t.id = x.tid left join public.profiles p on p.id = t.user_id
  where exists (select 1 from public.sections s where s.id = p_section and private.is_member(s.organization_id))
  order by x.ord, t.last_names
$$;
revoke all on function public.section_teacher_list(uuid) from public, anon;
grant execute on function public.section_teacher_list(uuid) to authenticated;

-- ➕ Agregar profesor a una sección (o a todas las secciones de una asignatura)
create or replace function public.add_section_teacher(p_section uuid, p_teacher uuid, p_role text default 'coprofesor')
returns void language plpgsql security definer set search_path = '' as $$
declare s public.sections;
begin
  select * into s from public.sections where id = p_section;
  if s.id is null then raise exception 'Sección no encontrada' using errcode = 'P0002'; end if;
  if not private.has_permission(s.organization_id, 'sections.edit', s.campus_id) then raise exception 'No autorizado' using errcode = '42501'; end if;
  if not exists (select 1 from public.teachers t where t.id = p_teacher and t.organization_id = s.organization_id) then
    raise exception 'El profesor no pertenece a esta institución' using errcode = '22023';
  end if;
  if p_role not in ('coprofesor', 'ayudante') then raise exception 'Rol no válido' using errcode = '22023'; end if;
  if s.teacher_id = p_teacher then return; end if;   -- ya es el titular
  insert into public.section_teachers (organization_id, section_id, teacher_id, role, created_by)
  values (s.organization_id, p_section, p_teacher, p_role, auth.uid())
  on conflict (section_id, teacher_id) do update set role = excluded.role;
end $$;

create or replace function public.add_course_teacher(p_course uuid, p_teacher uuid, p_role text default 'coprofesor', p_period uuid default null)
returns int language plpgsql security definer set search_path = '' as $$
declare r record; n int := 0;
begin
  for r in select s.id, s.teacher_id from public.sections s
           where s.course_id = p_course and s.status = 'active' and (p_period is null or s.period_id = p_period) loop
    perform public.add_section_teacher(r.id, p_teacher, p_role);
    if r.teacher_id is distinct from p_teacher then n := n + 1; end if;
  end loop;
  return n;
end $$;

create or replace function public.remove_section_teacher(p_section uuid, p_teacher uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare s public.sections;
begin
  select * into s from public.sections where id = p_section;
  if s.id is null or not private.has_permission(s.organization_id, 'sections.edit', s.campus_id) then raise exception 'No autorizado' using errcode = '42501'; end if;
  delete from public.section_teachers where section_id = p_section and teacher_id = p_teacher;
end $$;

revoke all on function public.add_section_teacher(uuid, uuid, text), public.add_course_teacher(uuid, uuid, text, uuid), public.remove_section_teacher(uuid, uuid) from public, anon;
grant execute on function public.add_section_teacher(uuid, uuid, text), public.add_course_teacher(uuid, uuid, text, uuid), public.remove_section_teacher(uuid, uuid) to authenticated;

-- Mensajes: los estudiantes pueden escribir a todos sus profesores (también co-profesores) y viceversa
create or replace function public.message_recipients(p_org uuid)
returns table (user_id uuid, full_name text, role_name text)
language sql stable security definer set search_path = '' as $$
  with me as (select private.is_member(p_org) ok, private.is_staff(p_org) staff),
  members as (
    select distinct on (p.id) p.id, p.full_name, r.name, r.code
    from public.memberships m join public.profiles p on p.id = m.user_id join public.roles r on r.id = m.role_id
    where m.organization_id = p_org and m.status = 'active' and p.status = 'active' and p.id <> auth.uid()
    order by p.id, r.code in ('estudiante','postulante','egresado')
  ),
  sec_teachers as (
    select s.id section_id, s.teacher_id from public.sections s where s.organization_id = p_org and s.teacher_id is not null
    union select st.section_id, st.teacher_id from public.section_teachers st where st.organization_id = p_org
  )
  select x.id, x.full_name, x.name from members x, me
  where me.ok and (
    me.staff
    or x.code not in ('estudiante','postulante','egresado','profesor')
    or exists (
      select 1 from public.section_enrollments se
      join sec_teachers q on q.section_id = se.section_id
      join public.students st on st.id = se.student_id
      join public.teachers t on t.id = q.teacher_id
      where se.status = 'enrolled'
        and ((st.user_id = auth.uid() and t.user_id = x.id) or (t.user_id = auth.uid() and st.user_id = x.id))))
  order by x.full_name
$$;

-- Biblioteca virtual: los co-profesores también ven los libros de sus secciones
create or replace function public.my_virtual_books(p_org uuid)
returns setof public.library_items language sql stable security definer set search_path = '' as $$
  select li.* from public.library_items li
  where li.organization_id = p_org and private.is_member(p_org)
    and (li.file_id is not null or li.url is not null)
    and private.library_visible(li.organization_id, li.visible_roles, li.hidden_users)
    and (
      li.section_id in (select se.section_id from public.section_enrollments se where se.student_id in (select private.my_student_ids()) and se.status <> 'dropped')
      or li.section_id in (select public.my_teaching_sections())
      or li.course_id in (select s.course_id from public.section_enrollments se join public.sections s on s.id = se.section_id
                          where se.student_id in (select private.my_student_ids()) and se.status <> 'dropped')
      or li.course_id in (select s.course_id from public.sections s where s.id in (select public.my_teaching_sections()))
      or li.program_id in (select e.program_id from public.enrollments e where e.student_id in (select private.my_student_ids()))
    )
  order by li.title
$$;
