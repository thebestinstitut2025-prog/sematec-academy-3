-- =====================================================================
-- Aula: eliminar tareas, exámenes y evaluaciones del libro de notas
--
-- Editar se hace con UPDATE normal (las políticas ya lo permiten al
-- profesor de la sección). Eliminar pasa por estas funciones porque:
--  * limpian los adjuntos de entregas e intentos (quedan huérfanos si no),
--  * dicen cuántas entregas/intentos se borran,
--  * protegen las notas oficiales: una evaluación del libro con notas
--    registradas no se borra (su historial es inmutable).
-- Las notas que una tarea o examen ya pasó al libro se conservan.
-- =====================================================================

create or replace function public.delete_assignment(p_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare a public.assignments; n int;
begin
  select * into a from public.assignments where id = p_id for update;
  if not found then raise exception 'La tarea ya no existe' using errcode = 'P0002'; end if;
  if not private.section_manager(a.section_id) then raise exception 'No autorizado' using errcode = '42501'; end if;
  select count(*) into n from public.submissions where assignment_id = p_id;
  delete from public.attachments where entity_type = 'submission'
     and entity_id in (select id from public.submissions where assignment_id = p_id);
  delete from public.assignments where id = p_id;   -- las entregas se borran en cascada
  return jsonb_build_object('title', a.title, 'submissions', n, 'section_id', a.section_id);
end $$;

create or replace function public.delete_quiz(p_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare q public.quizzes; n int;
begin
  select * into q from public.quizzes where id = p_id for update;
  if not found then raise exception 'El examen ya no existe' using errcode = 'P0002'; end if;
  if not private.section_manager(q.section_id) then raise exception 'No autorizado' using errcode = '42501'; end if;
  select count(*) into n from public.quiz_attempts where quiz_id = p_id;
  delete from public.attachments where entity_type = 'quiz_attempt'
     and entity_id in (select id from public.quiz_attempts where quiz_id = p_id);
  delete from public.quizzes where id = p_id;       -- preguntas, claves e intentos en cascada
  return jsonb_build_object('title', q.title, 'attempts', n, 'section_id', q.section_id);
end $$;

create or replace function public.delete_assessment(p_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare a public.assessments; n int;
begin
  select * into a from public.assessments where id = p_id for update;
  if not found then raise exception 'La evaluación ya no existe' using errcode = 'P0002'; end if;
  if not (private.teaches_section(a.section_id) or private.has_permission(a.organization_id, 'grades.edit')) then
    raise exception 'No autorizado' using errcode = '42501';
  end if;
  if private.section_is_closed(a.section_id) then
    raise exception 'El acta está cerrada: no se pueden eliminar evaluaciones' using errcode = '42501';
  end if;
  select count(*) into n from public.grades where assessment_id = p_id;
  if n > 0 then
    raise exception 'La evaluación «%» ya tiene % nota(s) registrada(s) y las notas son registro oficial: no se puede eliminar. Puede ocultarla, cambiarle el nombre o la ponderación.', a.name, n
      using errcode = 'P0001';
  end if;
  -- Tareas, exámenes y evaluaciones con enlace vinculados dejan de pasar nota a esta evaluación
  update public.assignments set assessment_id = null where assessment_id = p_id;
  update public.quizzes set assessment_id = null where assessment_id = p_id;
  delete from public.assessments where id = p_id;
  return jsonb_build_object('name', a.name, 'section_id', a.section_id);
end $$;

revoke all on function public.delete_assignment(uuid), public.delete_quiz(uuid), public.delete_assessment(uuid) from public, anon;
grant execute on function public.delete_assignment(uuid), public.delete_quiz(uuid), public.delete_assessment(uuid) to authenticated, service_role;
