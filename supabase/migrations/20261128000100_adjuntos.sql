-- =====================================================================
-- Adjuntos: cada persona sube archivos donde le corresponde (tareas, exámenes,
-- evaluaciones con enlace, mensajes). El archivo queda en «Mis archivos» de quien lo
-- sube y se ve solo donde corresponde: quien lo subió, el profesor de la sala
-- (o personal autorizado) y, en mensajes, el destinatario.
-- =====================================================================

create table if not exists public.attachments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  entity_type text not null check (entity_type in ('submission', 'quiz_attempt', 'external_eval', 'message')),
  entity_id uuid not null,
  file_id uuid not null references public.user_files (id) on delete cascade,
  created_by uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (entity_type, entity_id, file_id)
);
create index if not exists attachments_entity_idx on public.attachments (entity_type, entity_id);
alter table public.attachments enable row level security;

-- ¿Quién puede ver un adjunto?
create or replace function private.attachment_visible(p_type text, p_entity uuid, p_by uuid, p_org uuid)
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare v_section uuid;
begin
  if auth.uid() is null then return false; end if;
  if p_by = auth.uid() then return true; end if;
  if p_type = 'message' then
    return exists (select 1 from public.messages m where m.id = p_entity and (m.sender_id = auth.uid() or m.recipient_id = auth.uid()));
  elsif p_type = 'submission' then
    select a.section_id into v_section from public.submissions s join public.assignments a on a.id = s.assignment_id where s.id = p_entity;
  elsif p_type = 'quiz_attempt' then
    select q.section_id into v_section from public.quiz_attempts t join public.quizzes q on q.id = t.quiz_id where t.id = p_entity;
  elsif p_type = 'external_eval' then
    select e.section_id into v_section from public.external_evaluations e where e.id = p_entity;
  end if;
  return v_section is not null and (private.teaches_section(v_section) or private.has_permission(p_org, 'sections.view'));
end $$;

drop policy if exists attachments_read on public.attachments;
create policy attachments_read on public.attachments for select to authenticated
  using (private.attachment_visible(entity_type, entity_id, created_by, organization_id));
-- Solo se escribe con attach_files / detach_file
revoke insert, update, delete on public.attachments from authenticated, anon;
grant select on public.attachments to authenticated;
grant all on public.attachments to service_role;

-- 📎 Adjuntar archivos propios (de «Mis archivos») a una entrega, examen, evaluación o mensaje
create or replace function public.attach_files(p_type text, p_entity uuid, p_files uuid[])
returns int language plpgsql security definer set search_path = '' as $$
declare v_org uuid; v_ok boolean := false; f uuid; n int := 0; e record;
begin
  if auth.uid() is null then raise exception 'Inicie sesión' using errcode = '42501'; end if;
  if coalesce(array_length(p_files, 1), 0) = 0 then return 0; end if;
  if array_length(p_files, 1) > 20 then raise exception 'Máximo 20 archivos por vez.' using errcode = '22023'; end if;
  if p_type = 'message' then
    select organization_id, sender_id = auth.uid() into v_org, v_ok from public.messages where id = p_entity;
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
revoke all on function public.attach_files(text, uuid, uuid[]) from public, anon;
grant execute on function public.attach_files(text, uuid, uuid[]) to authenticated;

-- 🗑 Quitar un adjunto propio (el archivo sigue en «Mis archivos»)
create or replace function public.detach_file(p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare a record;
begin
  select * into a from public.attachments where id = p_id;
  if a.id is null or a.created_by <> auth.uid() then raise exception 'No autorizado' using errcode = '42501'; end if;
  if a.entity_type = 'submission' and exists (select 1 from public.submissions s where s.id = a.entity_id and s.score is not null) then
    raise exception 'La entrega ya fue calificada: no se puede cambiar.' using errcode = '22023';
  end if;
  if a.entity_type = 'quiz_attempt' and exists (select 1 from public.quiz_attempts t where t.id = a.entity_id and t.submitted_at is not null) then
    raise exception 'El examen ya fue enviado: no se puede cambiar.' using errcode = '22023';
  end if;
  delete from public.attachments where id = p_id;
end $$;
revoke all on function public.detach_file(uuid) from public, anon;
grant execute on function public.detach_file(uuid) to authenticated;

-- Datos del archivo de cada adjunto visible (nombre, tamaño, tipo y ruta para abrirlo)
create or replace function public.attachment_files(p_ids uuid[])
returns table (id uuid, entity_id uuid, file_id uuid, created_by uuid, created_at timestamptz, name text, size_bytes bigint, mime_type text, storage_path text)
language sql stable security definer set search_path = '' as $$
  select a.id, a.entity_id, a.file_id, a.created_by, a.created_at, u.name, u.size_bytes::bigint, u.mime_type, u.storage_path
    from public.attachments a join public.user_files u on u.id = a.file_id and u.deleted_at is null
   where a.id = any (p_ids) and private.attachment_visible(a.entity_type, a.entity_id, a.created_by, a.organization_id)
   order by a.created_at
$$;
revoke all on function public.attachment_files(uuid[]) from public, anon;
grant execute on function public.attachment_files(uuid[]) to authenticated;
