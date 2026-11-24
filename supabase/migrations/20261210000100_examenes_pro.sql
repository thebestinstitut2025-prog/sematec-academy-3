-- =====================================================================
-- Exámenes, tareas y evaluaciones «pro»
-- · Nuevos tipos de pregunta: respuesta corta, numérica, completar, ordenar, unir parejas y desarrollo
-- · Imagen por pregunta, retroalimentación, orden aleatorio, una pregunta por página, portada de color
-- · Corrección de preguntas de desarrollo por el profesor, estadística por pregunta
-- · Duplicar exámenes e importar preguntas · Rúbricas para tareas
-- Las respuestas correctas siguen viviendo aparte (quiz_answer_keys): el estudiante nunca las lee.
-- =====================================================================

-- ---------- 1. Examen: opciones de presentación ----------
alter table public.quizzes add column if not exists shuffle_questions boolean not null default false;
alter table public.quizzes add column if not exists shuffle_options boolean not null default false;
alter table public.quizzes add column if not exists one_per_page boolean not null default false;
alter table public.quizzes add column if not exists show_feedback boolean not null default true;
alter table public.quizzes add column if not exists pass_pct int check (pass_pct is null or pass_pct between 1 and 100);
alter table public.quizzes add column if not exists theme text not null default 'azul'
  check (theme in ('azul','verde','morado','naranjo','rosado','gris','turquesa','rojo'));

-- ---------- 2. Preguntas: más tipos ----------
alter table public.quiz_questions drop constraint if exists quiz_questions_kind_check;
alter table public.quiz_questions add constraint quiz_questions_kind_check
  check (kind in ('unica','multiple','vf','corta','numerica','completar','ordenar','unir','desarrollo'));
alter table public.quiz_questions drop constraint if exists quiz_questions_options_check;
alter table public.quiz_questions add constraint quiz_questions_options_check
  check (jsonb_typeof(options) = 'array' and jsonb_array_length(options) <= 12);
-- «unir»: columna derecha (ya desordenada al guardar); la pareja correcta está en la clave
alter table public.quiz_questions add column if not exists choices jsonb check (choices is null or (jsonb_typeof(choices) = 'array' and jsonb_array_length(choices) <= 12));
alter table public.quiz_questions add column if not exists feedback text check (feedback is null or length(feedback) <= 2000);

alter table public.quiz_answer_keys drop constraint if exists quiz_answer_keys_correct_check;
-- Respuestas de texto/número/espacios: {"accept":[...]} · {"value":n,"tol":t} · {"blanks":[[...],[...]]}
alter table public.quiz_answer_keys add column if not exists answer jsonb;

-- ---------- 3. Intentos: detalle por pregunta y corrección manual ----------
alter table public.quiz_attempts add column if not exists detail jsonb;
alter table public.quiz_attempts add column if not exists manual jsonb not null default '{}'::jsonb;
alter table public.quiz_attempts add column if not exists needs_review boolean not null default false;

-- Texto normalizado para comparar (sin mayúsculas, tildes ni espacios de más)
create or replace function private.quiz_norm(p text)
returns text language sql immutable set search_path = '' as $$
  select translate(lower(btrim(regexp_replace(coalesce(p, ''), '\s+', ' ', 'g'))), 'áéíóúüñàèìòùâêîôûäëïö', 'aeiouunaeiouaeiouaeio')
$$;

-- Puntaje de una respuesta. null = la corrige el profesor (desarrollo)
create or replace function private.quiz_points(p_kind text, p_points numeric, p_correct int[], p_answer jsonb, p_given jsonb)
returns numeric language plpgsql immutable set search_path = '' as $$
declare v_ints int[]; v_txt text; v_num numeric; v_n int; v_ok int := 0; i int;
begin
  if p_kind = 'desarrollo' then return null; end if;
  if p_kind in ('unica', 'multiple', 'vf') then
    select coalesce(array_agg(distinct v::int order by v::int), '{}') into v_ints
      from jsonb_array_elements_text(case when jsonb_typeof(p_given) = 'array' then p_given else '[]'::jsonb end) v where v ~ '^\d{1,3}$';
    return case when v_ints = (select coalesce(array_agg(distinct c order by c), '{}') from unnest(p_correct) c) and cardinality(v_ints) > 0 then p_points else 0 end;
  end if;
  if p_kind = 'corta' then
    v_txt := private.quiz_norm(case when jsonb_typeof(p_given) = 'string' then p_given #>> '{}' else '' end);
    if v_txt = '' then return 0; end if;
    return case when exists (select 1 from jsonb_array_elements_text(coalesce(p_answer -> 'accept', '[]')) a where private.quiz_norm(a) = v_txt) then p_points else 0 end;
  end if;
  if p_kind = 'numerica' then
    v_txt := replace(btrim(coalesce(p_given #>> '{}', '')), ',', '.');
    if v_txt !~ '^-?\d+(\.\d+)?$' then return 0; end if;
    v_num := v_txt::numeric;
    return case when abs(v_num - (p_answer ->> 'value')::numeric) <= coalesce((p_answer ->> 'tol')::numeric, 0) then p_points else 0 end;
  end if;
  if p_kind = 'completar' then
    v_n := coalesce(jsonb_array_length(p_answer -> 'blanks'), 0);
    if v_n = 0 or jsonb_typeof(p_given) <> 'array' then return 0; end if;
    for i in 0 .. v_n - 1 loop
      v_txt := private.quiz_norm(p_given ->> i);
      if v_txt <> '' and exists (select 1 from jsonb_array_elements_text(p_answer -> 'blanks' -> i) a where private.quiz_norm(a) = v_txt) then v_ok := v_ok + 1; end if;
    end loop;
    return round(p_points * v_ok / v_n, 2);
  end if;
  if p_kind in ('ordenar', 'unir') then
    -- ordenar: p_correct = orden correcto de las opciones · unir: p_correct[i] = pareja de la opción i
    v_n := coalesce(cardinality(p_correct), 0);
    if v_n = 0 or jsonb_typeof(p_given) <> 'array' then return 0; end if;
    for i in 1 .. v_n loop
      if (p_given ->> (i - 1)) ~ '^\d{1,3}$' and (p_given ->> (i - 1))::int = p_correct[i] then v_ok := v_ok + 1; end if;
    end loop;
    return round(p_points * v_ok / v_n, 2);
  end if;
  return 0;
end $$;

-- Corrige en el servidor (todos los tipos). Respuestas {"<question_id>": valor}
create or replace function public.submit_quiz(p_attempt uuid, p_answers jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare t public.quiz_attempts; q public.quizzes; v_score numeric := 0; v_max numeric := 0; r record; v_pts numeric;
        v_grade numeric; v_detail jsonb := '{}'::jsonb; v_review boolean := false;
begin
  select * into t from public.quiz_attempts where id = p_attempt for update;
  if not found or t.student_id not in (select private.my_student_ids()) then raise exception 'Intento inexistente' using errcode = '42501'; end if;
  if t.submitted_at is not null then raise exception 'Este intento ya fue enviado' using errcode = 'P0001'; end if;
  select * into q from public.quizzes where id = t.quiz_id;
  if jsonb_typeof(p_answers) is distinct from 'object' then p_answers := '{}'::jsonb; end if;
  -- 2 minutos de tolerancia por conexión; pasado eso, no se reciben respuestas
  if now() > t.deadline + interval '2 minutes' then p_answers := '{}'::jsonb; end if;
  for r in select x.id, x.points, x.kind, coalesce(k.correct, '{}') as correct, k.answer
           from public.quiz_questions x left join public.quiz_answer_keys k on k.question_id = x.id where x.quiz_id = q.id loop
    v_max := v_max + r.points;
    v_pts := private.quiz_points(r.kind, r.points, r.correct, r.answer, p_answers -> r.id::text);
    if v_pts is null then
      v_review := true;
      v_detail := v_detail || jsonb_build_object(r.id::text, jsonb_build_object('pts', null, 'max', r.points, 'pending', true));
    else
      v_score := v_score + v_pts;
      v_detail := v_detail || jsonb_build_object(r.id::text, jsonb_build_object('pts', v_pts, 'max', r.points));
    end if;
  end loop;
  v_grade := private.post_grade(q.assessment_id, t.student_id, case when v_max > 0 then v_score / v_max else 0 end, 'Examen en línea: ' || q.title);
  update public.quiz_attempts set submitted_at = now(), answers = p_answers, score = v_score, max_score = v_max, grade = v_grade,
         detail = v_detail, needs_review = v_review where id = t.id;
  return jsonb_build_object('score', v_score, 'max', v_max, 'grade', v_grade, 'show', q.show_results, 'review', v_review,
                            'pass', case when q.pass_pct is null or v_max = 0 then null else v_score * 100 / v_max >= q.pass_pct end);
end $$;

-- El profesor corrige una pregunta (desarrollo, o ajusta cualquier otra) y se recalcula la nota
create or replace function public.grade_quiz_question(p_attempt uuid, p_question uuid, p_points numeric, p_comment text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare t public.quiz_attempts; q public.quizzes; x public.quiz_questions; v_detail jsonb; v_score numeric := 0; v_review boolean := false; k text; v jsonb; v_grade numeric;
begin
  select * into t from public.quiz_attempts where id = p_attempt for update;
  if not found or t.submitted_at is null then raise exception 'Intento inexistente o sin enviar' using errcode = 'P0002'; end if;
  select * into q from public.quizzes where id = t.quiz_id;
  if not private.section_manager(q.section_id) then raise exception 'No autorizado' using errcode = '42501'; end if;
  select * into x from public.quiz_questions where id = p_question and quiz_id = q.id;
  if not found then raise exception 'Pregunta inexistente' using errcode = 'P0002'; end if;
  if p_points is null or p_points < 0 or p_points > x.points then raise exception 'El puntaje debe estar entre 0 y %', x.points using errcode = '22023'; end if;
  v_detail := coalesce(t.detail, '{}'::jsonb) || jsonb_build_object(p_question::text,
    jsonb_build_object('pts', p_points, 'max', x.points, 'manual', true, 'comment', left(coalesce(p_comment, ''), 1000)));
  for k, v in select * from jsonb_each(v_detail) loop
    if coalesce((v ->> 'pending')::boolean, false) and not coalesce((v ->> 'manual')::boolean, false) then v_review := true;
    else v_score := v_score + coalesce((v ->> 'pts')::numeric, 0); end if;
  end loop;
  v_grade := private.post_grade(q.assessment_id, t.student_id, case when t.max_score > 0 then v_score / t.max_score else 0 end, 'Examen en línea: ' || q.title);
  update public.quiz_attempts set detail = v_detail, score = v_score, grade = coalesce(v_grade, grade), needs_review = v_review,
         manual = manual || jsonb_build_object(p_question::text, jsonb_build_object('pts', p_points, 'comment', left(coalesce(p_comment, ''), 1000), 'by', auth.uid(), 'at', now()))
   where id = t.id;
  return jsonb_build_object('score', v_score, 'max', t.max_score, 'grade', v_grade, 'review', v_review);
end $$;
revoke all on function public.grade_quiz_question(uuid, uuid, numeric, text) from public, anon;
grant execute on function public.grade_quiz_question(uuid, uuid, numeric, text) to authenticated;

-- Revisión del estudiante: su respuesta, la correcta, el puntaje y la retroalimentación
drop function if exists public.quiz_review(uuid);
create or replace function public.quiz_review(p_attempt uuid)
returns table (question_id uuid, kind text, prompt text, options jsonb, choices jsonb, given jsonb, correct int[], answer jsonb,
               points numeric, earned numeric, feedback text, comment text)
language sql stable security definer set search_path = '' as $$
  select x.id, x.kind, x.prompt, x.options, x.choices, t.answers -> x.id::text,
         case when now() > q.closes_at then k.correct end, case when now() > q.closes_at and x.kind <> 'desarrollo' then k.answer end,
         x.points, (t.detail -> x.id::text ->> 'pts')::numeric, case when q.show_feedback then x.feedback end,
         t.detail -> x.id::text ->> 'comment'
  from public.quiz_attempts t join public.quizzes q on q.id = t.quiz_id
  join public.quiz_questions x on x.quiz_id = q.id left join public.quiz_answer_keys k on k.question_id = x.id
  where t.id = p_attempt and t.submitted_at is not null and t.student_id in (select private.my_student_ids()) and q.show_results
  order by x.position, x.id
$$;
revoke all on function public.quiz_review(uuid) from public, anon;
grant execute on function public.quiz_review(uuid) to authenticated;

-- Copiar preguntas (con sus respuestas) de un examen a otro: banco de preguntas reutilizable
create or replace function public.copy_quiz_questions(p_from uuid, p_to uuid)
returns int language plpgsql security definer set search_path = '' as $$
declare a public.quizzes; b public.quizzes; r record; v_id uuid; n int := 0; v_pos int;
begin
  select * into a from public.quizzes where id = p_from;
  select * into b from public.quizzes where id = p_to;
  if a.id is null or b.id is null or not private.section_manager(a.section_id) or not private.section_manager(b.section_id) or a.organization_id <> b.organization_id then
    raise exception 'No autorizado' using errcode = '42501';
  end if;
  if p_from = p_to then raise exception 'Elija otro examen' using errcode = '22023'; end if;
  select coalesce(max(position), 0) into v_pos from public.quiz_questions where quiz_id = p_to;
  for r in select x.*, k.correct, k.answer from public.quiz_questions x left join public.quiz_answer_keys k on k.question_id = x.id where x.quiz_id = p_from order by x.position, x.id loop
    v_pos := v_pos + 1;
    insert into public.quiz_questions (organization_id, quiz_id, position, kind, prompt, options, points, choices, feedback)
    values (b.organization_id, p_to, v_pos, r.kind, r.prompt, r.options, r.points, r.choices, r.feedback) returning id into v_id;
    insert into public.quiz_answer_keys (question_id, correct, answer) values (v_id, coalesce(r.correct, '{}'), r.answer);
    n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function public.copy_quiz_questions(uuid, uuid) from public, anon;
grant execute on function public.copy_quiz_questions(uuid, uuid) to authenticated;

-- Duplicar un examen (como borrador), en la misma sala u otra que el profesor gestione
create or replace function public.duplicate_quiz(p_quiz uuid, p_section uuid default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare a public.quizzes; v_sec uuid; v_id uuid;
begin
  select * into a from public.quizzes where id = p_quiz;
  v_sec := coalesce(p_section, a.section_id);
  if a.id is null or not private.section_manager(a.section_id) or not private.section_manager(v_sec)
     or not exists (select 1 from public.sections s where s.id = v_sec and s.organization_id = a.organization_id) then
    raise exception 'No autorizado' using errcode = '42501';
  end if;
  insert into public.quizzes (organization_id, section_id, title, instructions, opens_at, closes_at, time_limit_min, max_attempts, show_results,
                              published, shuffle_questions, shuffle_options, one_per_page, show_feedback, pass_pct, theme)
  values (a.organization_id, v_sec, left('Copia de ' || a.title, 200), a.instructions, a.opens_at, a.closes_at, a.time_limit_min, a.max_attempts, a.show_results,
          false, a.shuffle_questions, a.shuffle_options, a.one_per_page, a.show_feedback, a.pass_pct, a.theme)
  returning id into v_id;
  perform public.copy_quiz_questions(p_quiz, v_id);
  return v_id;
end $$;
revoke all on function public.duplicate_quiz(uuid, uuid) from public, anon;
grant execute on function public.duplicate_quiz(uuid, uuid) to authenticated;

-- ---------- 4. Imagen por pregunta (adjunto «quiz_question») ----------
alter table public.attachments drop constraint if exists attachments_entity_type_check;
alter table public.attachments add constraint attachments_entity_type_check
  check (entity_type in ('submission', 'quiz_attempt', 'external_eval', 'message', 'assignment', 'quiz', 'eval_material', 'content', 'quiz_question'));

create or replace function private.material_section(p_type text, p_entity uuid, out section_id uuid, out published boolean)
language plpgsql stable security definer set search_path = '' as $$
begin
  if p_type = 'assignment' then select a.section_id, a.published into section_id, published from public.assignments a where a.id = p_entity;
  elsif p_type = 'quiz' then select q.section_id, q.published into section_id, published from public.quizzes q where q.id = p_entity;
  elsif p_type = 'eval_material' then select e.section_id, e.published into section_id, published from public.external_evaluations e where e.id = p_entity;
  elsif p_type = 'content' then select c.section_id, c.published into section_id, published from public.course_contents c where c.id = p_entity;
  elsif p_type = 'quiz_question' then select q.section_id, q.published into section_id, published from public.quiz_questions x join public.quizzes q on q.id = x.quiz_id where x.id = p_entity;
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
  elsif p_type in ('assignment', 'quiz', 'eval_material', 'content', 'quiz_question') then
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
  elsif p_type in ('assignment', 'quiz', 'eval_material', 'content', 'quiz_question') then
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
    if a.entity_type in ('assignment', 'quiz', 'eval_material', 'content', 'quiz_question') then
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


drop trigger if exists trg_att_cleanup on public.quiz_questions;
create trigger trg_att_cleanup after delete on public.quiz_questions for each row execute function private.cleanup_attachments('quiz_question');

-- ---------- 5. Tareas: rúbrica y portada ----------
-- Rúbrica: [{"c":"Criterio","d":"Descripción","max":10}, …] (hasta 15 criterios)
alter table public.assignments add column if not exists rubric jsonb
  check (rubric is null or (jsonb_typeof(rubric) = 'array' and jsonb_array_length(rubric) <= 15));
alter table public.assignments add column if not exists theme text not null default 'azul'
  check (theme in ('azul','verde','morado','naranjo','rosado','gris','turquesa','rojo'));
alter table public.submissions add column if not exists rubric_scores jsonb;

-- Calificar con rúbrica: puntaje por criterio; el total pasa a la entrega y al libro
create or replace function public.grade_with_rubric(p_submission uuid, p_scores jsonb, p_feedback text)
returns numeric language plpgsql security definer set search_path = '' as $$
declare s public.submissions; a public.assignments; v_total numeric := 0; v_max numeric := 0; i int; v_pts numeric; v_crit numeric; v_out jsonb := '[]'::jsonb;
begin
  select * into s from public.submissions where id = p_submission;
  if not found then raise exception 'Entrega inexistente' using errcode = 'P0002'; end if;
  select * into a from public.assignments where id = s.assignment_id;
  if not private.section_manager(a.section_id) then raise exception 'No autorizado' using errcode = '42501'; end if;
  if a.rubric is null or jsonb_array_length(a.rubric) = 0 then raise exception 'La tarea no tiene rúbrica' using errcode = '22023'; end if;
  for i in 0 .. jsonb_array_length(a.rubric) - 1 loop
    v_crit := (a.rubric -> i ->> 'max')::numeric;
    v_pts := case when (p_scores ->> i) ~ '^\d+(\.\d+)?$' then (p_scores ->> i)::numeric else null end;
    if v_pts is null or v_pts > v_crit then
      raise exception 'Criterio «%»: el puntaje debe estar entre 0 y %', a.rubric -> i ->> 'c', v_crit using errcode = '22023';
    end if;
    v_total := v_total + v_pts; v_max := v_max + v_crit; v_out := v_out || to_jsonb(v_pts);
  end loop;
  -- La rúbrica se escala al puntaje máximo de la tarea
  v_total := round(v_total * a.max_score / nullif(v_max, 0), 2);
  update public.submissions set rubric_scores = v_out where id = p_submission;
  return public.grade_submission(p_submission, v_total, p_feedback);
end $$;
revoke all on function public.grade_with_rubric(uuid, jsonb, text) from public, anon;
grant execute on function public.grade_with_rubric(uuid, jsonb, text) to authenticated;

-- Portada del examen: cuántas preguntas y puntos tiene (sin mostrar las preguntas antes de empezar)
create or replace function public.quiz_info(p_quiz uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('n', count(x.id), 'points', coalesce(sum(x.points), 0))
  from public.quizzes q left join public.quiz_questions x on x.quiz_id = q.id
  where q.id = p_quiz and (private.section_manager(q.section_id) or (q.published and private.section_member(q.section_id)))
  group by q.id
$$;
revoke all on function public.quiz_info(uuid) from public, anon;
grant execute on function public.quiz_info(uuid) to authenticated;
