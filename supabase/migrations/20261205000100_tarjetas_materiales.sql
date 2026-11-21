-- =====================================================================
-- 1) 🎨 Tarjetas de asignatura y sección (sala) con color y fondo propio
-- 2) 📎 Archivos del profesor en tareas, exámenes, evaluaciones con enlace
--    y contenidos (material de apoyo, pautas, guías…)
-- =====================================================================

-- ---------- 1. Apariencia de las tarjetas ----------
alter table public.sections add column if not exists card_color text check (card_color is null or card_color ~ '^#[0-9a-fA-F]{6}$');
alter table public.sections add column if not exists card_image uuid references public.media_assets (id) on delete set null;
alter table public.courses  add column if not exists card_color text check (card_color is null or card_color ~ '^#[0-9a-fA-F]{6}$');
alter table public.courses  add column if not exists card_image uuid references public.media_assets (id) on delete set null;

alter table public.media_assets drop constraint if exists media_assets_kind_check;
alter table public.media_assets add constraint media_assets_kind_check
  check (kind in ('logo','favicon','hero','course','avatar','page','product','card'));

-- Cambia color y/o fondo de la tarjeta de una sala (profesor de la sala o quien edita secciones)
-- o de una asignatura completa (quien edita la oferta académica). p_image = '00000000-…' quita la imagen.
create or replace function public.set_card_style(p_kind text, p_id uuid, p_color text, p_image uuid, p_clear_image boolean default false)
returns void language plpgsql security definer set search_path = '' as $$
declare v_org uuid;
begin
  if p_color is not null and p_color !~ '^#[0-9a-fA-F]{6}$' then raise exception 'Color no válido' using errcode = '22023'; end if;
  if p_kind = 'section' then
    select organization_id into v_org from public.sections where id = p_id;
    if v_org is null then raise exception 'La sala no existe' using errcode = 'P0002'; end if;
    if not (private.teaches_section(p_id) or private.has_permission(v_org, 'sections.edit')) then
      raise exception 'Solo el profesor de la sala o quien administra secciones puede cambiar su tarjeta.' using errcode = '42501';
    end if;
  elsif p_kind = 'course' then
    select organization_id into v_org from public.courses where id = p_id;
    if v_org is null then raise exception 'La asignatura no existe' using errcode = 'P0002'; end if;
    if not private.has_permission(v_org, 'academic.edit') then
      raise exception 'Solo quien administra la oferta académica puede cambiar la tarjeta de toda la asignatura.' using errcode = '42501';
    end if;
  else
    raise exception 'Tipo no válido' using errcode = '22023';
  end if;
  if p_image is not null and not exists (select 1 from public.media_assets m where m.id = p_image and m.kind = 'card' and m.organization_id = v_org) then
    raise exception 'Imagen no válida' using errcode = '22023';
  end if;
  if p_kind = 'section' then
    update public.sections set card_color = p_color,
      card_image = case when p_clear_image then null else coalesce(p_image, card_image) end where id = p_id;
  else
    update public.courses set card_color = p_color,
      card_image = case when p_clear_image then null else coalesce(p_image, card_image) end where id = p_id;
  end if;
end $$;
revoke all on function public.set_card_style(text, uuid, text, uuid, boolean) from public, anon;
grant execute on function public.set_card_style(text, uuid, text, uuid, boolean) to authenticated, service_role;

-- ---------- 2. Material del profesor ----------
alter table public.attachments drop constraint if exists attachments_entity_type_check;
alter table public.attachments add constraint attachments_entity_type_check
  check (entity_type in ('submission', 'quiz_attempt', 'external_eval', 'message', 'assignment', 'quiz', 'eval_material', 'content'));

-- Sección y estado de publicación de cada elemento con material del profesor
create or replace function private.material_section(p_type text, p_entity uuid, out section_id uuid, out published boolean)
language plpgsql stable security definer set search_path = '' as $$
begin
  if p_type = 'assignment' then select a.section_id, a.published into section_id, published from public.assignments a where a.id = p_entity;
  elsif p_type = 'quiz' then select q.section_id, q.published into section_id, published from public.quizzes q where q.id = p_entity;
  elsif p_type = 'eval_material' then select e.section_id, e.published into section_id, published from public.external_evaluations e where e.id = p_entity;
  elsif p_type = 'content' then select c.section_id, c.published into section_id, published from public.course_contents c where c.id = p_entity;
  end if;
end $$;

create or replace function private.attachment_visible(p_type text, p_entity uuid, p_by uuid, p_org uuid)
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare v_section uuid; v_pub boolean;
begin
  if auth.uid() is null then return false; end if;
  if p_by = auth.uid() then return true; end if;
  if p_type = 'message' then
    return exists (select 1 from public.messages m where m.id = p_entity and (m.sender_id = auth.uid() or m.recipient_id = auth.uid()));
  elsif p_type in ('assignment', 'quiz', 'eval_material', 'content') then
    -- Material del profesor: lo ve el profesor, el personal y los estudiantes de la sala (si está publicado)
    select m.section_id, m.published into v_section, v_pub from private.material_section(p_type, p_entity) m;
    return v_section is not null and (private.teaches_section(v_section) or private.section_manager(v_section)
      or private.has_permission(p_org, 'sections.view') or (coalesce(v_pub, false) and private.section_member(v_section)));
  elsif p_type = 'submission' then
    select a.section_id into v_section from public.submissions s join public.assignments a on a.id = s.assignment_id where s.id = p_entity;
  elsif p_type = 'quiz_attempt' then
    select q.section_id into v_section from public.quiz_attempts t join public.quizzes q on q.id = t.quiz_id where t.id = p_entity;
  elsif p_type = 'external_eval' then
    select e.section_id into v_section from public.external_evaluations e where e.id = p_entity;
  end if;
  return v_section is not null and (private.teaches_section(v_section) or private.has_permission(p_org, 'sections.view'));
end $$;

create or replace function public.attach_files(p_type text, p_entity uuid, p_files uuid[])
returns int language plpgsql security definer set search_path = '' as $$
declare v_org uuid; v_ok boolean := false; f uuid; n int := 0; e record; v_section uuid;
begin
  if auth.uid() is null then raise exception 'Inicie sesión' using errcode = '42501'; end if;
  if coalesce(array_length(p_files, 1), 0) = 0 then return 0; end if;
  if array_length(p_files, 1) > 20 then raise exception 'Máximo 20 archivos por vez.' using errcode = '22023'; end if;
  if p_type = 'message' then
    select organization_id, sender_id = auth.uid() into v_org, v_ok from public.messages where id = p_entity;
  elsif p_type in ('assignment', 'quiz', 'eval_material', 'content') then
    select m.section_id into v_section from private.material_section(p_type, p_entity) m;
    select s.organization_id into v_org from public.sections s where s.id = v_section;
    v_ok := v_section is not null and private.section_manager(v_section);
  elsif p_type = 'submission' then
    select s.organization_id, s.student_id in (select private.my_student_ids()) into v_org, v_ok from public.submissions s where s.id = p_entity;
    if exists (select 1 from public.submissions s where s.id = p_entity and s.score is not null) then raise exception 'La entrega ya fue calificada: no se puede cambiar.' using errcode = '22023'; end if;
  elsif p_type = 'quiz_attempt' then
    select t.organization_id, t.student_id in (select private.my_student_ids()) and t.submitted_at is null into v_org, v_ok from public.quiz_attempts t where t.id = p_entity;
  elsif p_type = 'external_eval' then
    select x.organization_id, x.section_id, x.opens_at, x.closes_at, x.published into e from public.external_evaluations x where x.id = p_entity;
    v_org := e.organization_id;
    if e.organization_id is not null then
      if not private.enrolled_in_section(e.section_id) then v_ok := false;
      elsif not e.published or now() < e.opens_at then raise exception 'La evaluación todavía no abre.' using errcode = '22023';
      elsif now() > e.closes_at then raise exception 'La evaluación ya cerró: no se reciben archivos.' using errcode = '22023';
      else v_ok := true; end if;
    end if;
  else
    raise exception 'Tipo no válido' using errcode = '22023';
  end if;
  if v_org is null or not coalesce(v_ok, false) then raise exception 'No puede adjuntar archivos aquí.' using errcode = '42501'; end if;
  foreach f in array p_files loop
    if not exists (select 1 from public.user_files u where u.id = f and u.owner_id = auth.uid() and u.deleted_at is null) then
      raise exception 'Uno de los archivos no es suyo o fue eliminado.' using errcode = '42501';
    end if;
    insert into public.attachments (organization_id, entity_type, entity_id, file_id, created_by)
    values (v_org, p_type, p_entity, f, auth.uid()) on conflict do nothing;
    if found then n := n + 1; end if;
  end loop;
  return n;
end $$;

-- Quitar: quien lo subió; el material del profesor también lo puede quitar otro profesor de la sala
create or replace function public.detach_file(p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare a record; v_section uuid;
begin
  select * into a from public.attachments where id = p_id;
  if a.id is null then raise exception 'No autorizado' using errcode = '42501'; end if;
  if a.created_by <> auth.uid() then
    if a.entity_type in ('assignment', 'quiz', 'eval_material', 'content') then
      select m.section_id into v_section from private.material_section(a.entity_type, a.entity_id) m;
      if v_section is null or not private.section_manager(v_section) then raise exception 'No autorizado' using errcode = '42501'; end if;
    else
      raise exception 'No autorizado' using errcode = '42501';
    end if;
  end if;
  if a.entity_type = 'submission' and exists (select 1 from public.submissions s where s.id = a.entity_id and s.score is not null) then
    raise exception 'La entrega ya fue calificada: no se puede cambiar.' using errcode = '22023';
  end if;
  if a.entity_type = 'quiz_attempt' and exists (select 1 from public.quiz_attempts t where t.id = a.entity_id and t.submitted_at is not null) then
    raise exception 'El examen ya fue enviado: no se puede cambiar.' using errcode = '22023';
  end if;
  delete from public.attachments where id = p_id;
end $$;

-- Al eliminar una tarea, examen, evaluación o contenido se quitan sus adjuntos (los archivos siguen en «Mis archivos»)
create or replace function private.cleanup_attachments()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  delete from public.attachments where entity_id = old.id and entity_type = any (tg_argv);
  return old;
end $$;
drop trigger if exists trg_att_cleanup on public.assignments;
create trigger trg_att_cleanup after delete on public.assignments for each row execute function private.cleanup_attachments('assignment');
drop trigger if exists trg_att_cleanup on public.quizzes;
create trigger trg_att_cleanup after delete on public.quizzes for each row execute function private.cleanup_attachments('quiz');
drop trigger if exists trg_att_cleanup on public.external_evaluations;
create trigger trg_att_cleanup after delete on public.external_evaluations for each row execute function private.cleanup_attachments('eval_material', 'external_eval');
drop trigger if exists trg_att_cleanup on public.course_contents;
create trigger trg_att_cleanup after delete on public.course_contents for each row execute function private.cleanup_attachments('content');
