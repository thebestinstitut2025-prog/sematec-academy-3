-- =====================================================================
-- Inscripción web asociada a los cursos
-- · Cada curso del sitio indica en qué asignaturas/secciones de la plataforma queda el estudiante
-- · Al pagar en línea, o al aprobarse/registrarse la inscripción general, el estudiante queda
--   matriculado en el curso o carrera que eligió y en sus asignaturas (aula virtual, notas, asistencia)
-- =====================================================================

alter table public.catalog_offerings add column if not exists section_ids uuid[] not null default '{}';

-- Matrícula del estudiante en un programa y periodo (la crea si no existe; si el programa no tiene plan, crea uno «WEB»)
create or replace function private.ensure_enrollment(p_org uuid, p_student uuid, p_program uuid, p_period uuid, p_source text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_enr uuid; v_curr uuid; v_campus uuid;
begin
  if p_program is null or p_period is null then return null; end if;
  select id into v_enr from public.enrollments where student_id = p_student and program_id = p_program and period_id = p_period;
  if v_enr is not null then
    update public.enrollments set status = 'active', status_reason = null where id = v_enr and status <> 'active';
    return v_enr;
  end if;
  select id into v_curr from public.curricula where program_id = p_program and status = 'active' order by valid_from desc limit 1;
  if v_curr is null then
    insert into public.curricula (organization_id, program_id, version, valid_from)
    values (p_org, p_program, 'WEB', current_date)
    on conflict (program_id, version) do update set status = 'active' returning id into v_curr;
  end if;
  select coalesce(s.campus_id, (select c.id from public.campuses c where c.organization_id = p_org and c.status = 'active' order by c.created_at limit 1))
    into v_campus from public.students s where s.id = p_student;
  insert into public.enrollments (organization_id, campus_id, student_id, program_id, curriculum_id, period_id, financial_terms)
  values (p_org, v_campus, p_student, p_program, v_curr, p_period, jsonb_build_object('source', p_source))
  returning id into v_enr;
  return v_enr;
end $$;

-- Inscribe al estudiante en las secciones (asignaturas) indicadas
create or replace function private.enroll_sections(p_org uuid, p_student uuid, p_enr uuid, p_sections uuid[])
returns int language plpgsql security definer set search_path = '' as $$
declare s record; n int := 0;
begin
  if p_enr is null or coalesce(cardinality(p_sections), 0) = 0 then return 0; end if;
  for s in select x.id, x.course_id, x.period_id from public.sections x
           where x.organization_id = p_org and x.id = any (p_sections) and x.status = 'active' loop
    insert into public.section_enrollments (organization_id, section_id, student_id, enrollment_id)
    values (p_org, s.id, p_student, p_enr)
    on conflict (section_id, student_id) do update set status = 'enrolled', dropped_at = null, enrolled_at = now()
      where public.section_enrollments.status = 'dropped';
    insert into public.academic_records (organization_id, student_id, course_id, section_id, period_id, result)
    values (p_org, p_student, s.course_id, s.id, s.period_id, 'in_progress')
    on conflict (student_id, section_id) do nothing;
    n := n + 1;
  end loop;
  return n;
end $$;

-- Lo que eligió en la inscripción general: un curso del sitio (catálogo) o una carrera/programa
create or replace function private.enroll_choice(p_org uuid, p_student uuid, p_choice text)
returns int language plpgsql security definer set search_path = '' as $$
declare off public.catalog_offerings; v_enr uuid; v_period uuid;
begin
  if p_choice is null or p_choice !~* '^[0-9a-f-]{36}$' then return 0; end if;
  select * into off from public.catalog_offerings where id = p_choice::uuid and organization_id = p_org;
  if off.id is not null then
    v_enr := private.ensure_enrollment(p_org, p_student, off.program_id, off.period_id, 'inscripcion');
    return private.enroll_sections(p_org, p_student, v_enr, off.section_ids);
  end if;
  if exists (select 1 from public.programs where id = p_choice::uuid and organization_id = p_org) then
    select id into v_period from public.academic_periods where organization_id = p_org and status in ('open', 'planned')
     order by (status = 'open') desc, starts_on desc nulls last limit 1;
    perform private.ensure_enrollment(p_org, p_student, p_choice::uuid, v_period, 'inscripcion');
  end if;
  return 0;
end $$;

create or replace function private.register_student(
  p_org uuid, p_user uuid, p_name text, p_first text, p_last text, p_email text, p_phone text,
  p_doc_country char(2), p_doc_type text, p_doc_number text, p_form jsonb, p_source text,
  p_amount numeric, p_currency text, p_method text, p_provider text, p_reference text, p_order uuid, p_notes text, p_by uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_student uuid; v_campus uuid; v_code text; v_role uuid; v_acc uuid; v_charge uuid; v_inst uuid; v_pay uuid; v_reg uuid;
  v_first text := nullif(trim(coalesce(p_first, split_part(trim(p_name), ' ', 1))), '');
  v_last text := nullif(trim(coalesce(p_last, substr(trim(p_name), length(split_part(trim(p_name), ' ', 1)) + 1))), '');
  v_form jsonb := private.clean_registration_form(coalesce(p_form, '{}'::jsonb));
  v_birth date;
begin
  if v_first is null then raise exception 'Escriba el nombre' using errcode = '22023'; end if;
  begin v_birth := nullif(v_form ->> 'birth_date', '')::date; exception when others then v_birth := null; end;
  select id into v_campus from public.campuses where organization_id = p_org and status = 'active' order by created_at limit 1;
  select id into v_student from public.students
   where organization_id = p_org
     and ((p_doc_number is not null and id_document_country = p_doc_country and id_document_type = p_doc_type and id_document_number = p_doc_number)
          or (p_user is not null and user_id = p_user))
   limit 1;
  if v_student is null then
    v_code := (case when p_source = 'web' then 'WEB-' else 'INS-' end) || lpad(private.next_number(p_org, 'student_code')::text, 6, '0');
    insert into public.students (organization_id, campus_id, user_id, student_code, first_names, last_names,
                                 id_document_country, id_document_type, id_document_number, email, phone, birth_date)
    values (p_org, v_campus, p_user, v_code, v_first, coalesce(v_last, '-'), p_doc_country, p_doc_type, p_doc_number,
            nullif(lower(trim(p_email)), ''), nullif(trim(coalesce(p_phone, '')), ''), v_birth)
    returning id into v_student;
  else
    update public.students set user_id = coalesce(user_id, p_user), phone = coalesce(phone, nullif(trim(coalesce(p_phone, '')), '')),
           email = coalesce(email, nullif(lower(trim(p_email)), '')), birth_date = coalesce(birth_date, v_birth)
     where id = v_student;
  end if;
  if p_user is not null then
    select id into v_role from public.roles where organization_id is null and code = 'estudiante';
    insert into public.memberships (user_id, organization_id, role_id) values (p_user, p_org, v_role)
    on conflict (user_id, organization_id, role_id, campus_id) do update set status = 'active', revoked_at = null;
  end if;

  if coalesce(p_amount, 0) > 0 then
    insert into public.student_accounts (organization_id, student_id, currency) values (p_org, v_student, p_currency)
    on conflict (student_id, currency) do update set currency = excluded.currency returning id into v_acc;
    insert into public.charges (organization_id, account_id, student_id, concept, description, gross_amount, currency, status)
    values (p_org, v_acc, v_student, 'registration_fee', 'Inscripción', p_amount, p_currency, 'paid') returning id into v_charge;
    insert into public.installments (organization_id, charge_id, number, amount, due_on)
    values (p_org, v_charge, 1, p_amount, current_date) returning id into v_inst;
    insert into public.payments (organization_id, account_id, student_id, receipt_number, amount, currency, method, provider, external_reference, notes, received_by)
    values (p_org, v_acc, v_student, private.next_number(p_org, 'receipt'), p_amount, p_currency, coalesce(p_method, 'other'), p_provider, p_reference,
            coalesce(nullif(p_notes, ''), 'Inscripción'), p_by)
    returning id into v_pay;
    insert into public.payment_allocations (organization_id, payment_id, installment_id, amount) values (p_org, v_pay, v_inst, p_amount);
  end if;

  -- 🎓 Lo deja matriculado en el curso o carrera que eligió (y en sus asignaturas)
  begin
    perform private.enroll_choice(p_org, v_student, v_form ->> 'program_id');
  exception when others then
    raise warning 'Inscripción: no se pudo matricular en el curso elegido: %', sqlerrm;
  end;

  insert into public.registrations (organization_id, student_id, source, amount, currency, method, payment_id, order_id, tracking_code, form_data, notes, created_by)
  values (p_org, v_student, p_source, coalesce(p_amount, 0), p_currency, case when coalesce(p_amount, 0) > 0 then coalesce(p_method, 'other') end, v_pay, p_order,
          (select tracking_code from public.checkout_orders where id = p_order), v_form, nullif(p_notes, ''), p_by)
  returning id into v_reg;
  return jsonb_build_object('student_id', v_student, 'registration_id', v_reg, 'payment_id', v_pay);
end $$;


create or replace function public.fulfill_checkout_order(p_order uuid, p_user uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  o public.checkout_orders; off public.catalog_offerings; v_student uuid; v_campus uuid; v_curr uuid; v_enr uuid;
  v_acc uuid; v_charge uuid; v_inst uuid; v_pay uuid; v_role uuid; v_code text;
  v_fee numeric; v_course numeric; v_n int; v_each numeric; i int; v_insts uuid[] := '{}'; v_amts numeric[] := '{}';
begin
  if not private.is_service() then raise exception 'Solo el backend' using errcode = '42501'; end if;
  select * into o from public.checkout_orders where id = p_order for update;
  if o.status <> 'paid' then raise exception 'El pedido no está pagado' using errcode = '22023'; end if;
  if o.fulfilled_at is not null then
    return jsonb_build_object('student_id', o.student_id, 'enrollment_id', o.enrollment_id, 'already', true);
  end if;
  select * into off from public.catalog_offerings where id = o.offering_id;
  select id into v_campus from public.campuses where organization_id = o.organization_id and status = 'active' order by created_at limit 1;

  select id into v_student from public.students
   where organization_id = o.organization_id
     and ((id_document_country = o.buyer_doc_country and id_document_type = o.buyer_doc_type and id_document_number = o.buyer_doc_number)
          or user_id = p_user)
   limit 1;
  if v_student is null then
    v_code := 'WEB-' || lpad(private.next_number(o.organization_id, 'student_code')::text, 6, '0');
    insert into public.students (organization_id, campus_id, user_id, student_code, first_names, last_names,
                                 id_document_country, id_document_type, id_document_number, email, phone)
    values (o.organization_id, v_campus, p_user, v_code,
            split_part(o.buyer_name, ' ', 1),
            coalesce(nullif(trim(substr(o.buyer_name, length(split_part(o.buyer_name, ' ', 1)) + 1)), ''), '-'),
            o.buyer_doc_country, o.buyer_doc_type, o.buyer_doc_number, o.buyer_email, o.buyer_phone)
    returning id into v_student;
  else
    update public.students set user_id = coalesce(user_id, p_user) where id = v_student;
  end if;

  select id into v_role from public.roles where organization_id is null and code = 'estudiante';
  insert into public.memberships (user_id, organization_id, role_id)
  values (p_user, o.organization_id, v_role)
  on conflict (user_id, organization_id, role_id, campus_id) do update set status = 'active', revoked_at = null;

  select id into v_enr from public.enrollments where student_id = v_student and program_id = off.program_id and period_id = off.period_id;
  if v_enr is null then
    select id into v_curr from public.curricula where program_id = off.program_id and status = 'active' order by valid_from desc limit 1;
    insert into public.enrollments (organization_id, campus_id, student_id, program_id, curriculum_id, period_id, application_id, financial_terms)
    values (o.organization_id, coalesce((select campus_id from public.students where id = v_student), v_campus), v_student,
            off.program_id, v_curr, off.period_id, o.application_id,
            jsonb_build_object('source', 'online', 'order', o.order_number, 'provider', o.provider, 'plan', o.plan,
                               'enrollment_fee', o.enrollment_fee_amount, 'course_amount', o.course_amount,
                               'installments', o.plan_installments))
    returning id into v_enr;
  end if;
  if o.application_id is not null then
    update public.applications set student_id = v_student where id = o.application_id;
  end if;

  -- 🎓 Queda inscrito en las asignaturas/secciones del curso (aula virtual, notas y asistencia)
  perform private.enroll_sections(o.organization_id, v_student, v_enr, off.section_ids);

  insert into public.student_accounts (organization_id, student_id, currency) values (o.organization_id, v_student, o.currency)
  on conflict (student_id, currency) do update set currency = excluded.currency returning id into v_acc;

  -- Pedidos antiguos (sin desglose): todo el monto es arancel
  v_fee := case when o.course_amount is null then 0 else o.enrollment_fee_amount end;
  v_course := coalesce(o.course_amount, o.amount);

  -- Matrícula
  if v_fee > 0 then
    insert into public.charges (organization_id, account_id, student_id, enrollment_id, concept, description, gross_amount, currency, status)
    values (o.organization_id, v_acc, v_student, v_enr, 'enrollment_fee', 'Matrícula: ' || off.title, v_fee, o.currency, 'paid')
    returning id into v_charge;
    insert into public.installments (organization_id, charge_id, number, amount, due_on)
    values (o.organization_id, v_charge, 1, v_fee, current_date) returning id into v_inst;
    v_insts := v_insts || v_inst; v_amts := v_amts || v_fee;
  end if;

  -- Arancel del curso
  if v_course > 0 then
    if o.plan = 'matricula' then
      v_n := greatest(o.plan_installments, 1);
      v_each := trunc(v_course / v_n, 0);
      if v_each <= 0 then v_n := 1; v_each := v_course; end if;
      insert into public.charges (organization_id, account_id, student_id, enrollment_id, concept, description, gross_amount, currency, status)
      values (o.organization_id, v_acc, v_student, v_enr, 'tuition',
              'Arancel: ' || off.title || case when v_n > 1 then ' (' || v_n || ' cuotas)' else '' end, v_course, o.currency, 'pending')
      returning id into v_charge;
      for i in 1..v_n loop
        insert into public.installments (organization_id, charge_id, number, amount, due_on)
        values (o.organization_id, v_charge, i,
                case when i = v_n then v_course - v_each * (v_n - 1) else v_each end,
                (greatest(current_date, coalesce(off.starts_on, current_date)) + make_interval(months => i - 1))::date);
      end loop;
    else
      insert into public.charges (organization_id, account_id, student_id, enrollment_id, concept, description, gross_amount, currency, status)
      values (o.organization_id, v_acc, v_student, v_enr, 'tuition', 'Compra en línea: ' || off.title, v_course, o.currency, 'paid')
      returning id into v_charge;
      insert into public.installments (organization_id, charge_id, number, amount, due_on)
      values (o.organization_id, v_charge, 1, v_course, current_date) returning id into v_inst;
      v_insts := v_insts || v_inst; v_amts := v_amts || v_course;
    end if;
  end if;

  insert into public.payments (organization_id, account_id, student_id, receipt_number, amount, currency, method, provider, external_reference, notes)
  values (o.organization_id, v_acc, v_student, private.next_number(o.organization_id, 'receipt'), o.amount, o.currency,
          'payment_gateway', o.provider, o.provider_reference,
          'Pedido web N° ' || o.order_number || case when o.plan = 'matricula' then ' (matrícula)' else '' end)
  returning id into v_pay;
  for i in 1..coalesce(array_length(v_insts, 1), 0) loop
    insert into public.payment_allocations (organization_id, payment_id, installment_id, amount)
    values (o.organization_id, v_pay, v_insts[i], v_amts[i]);
  end loop;

  update public.checkout_orders set user_id = p_user, student_id = v_student, enrollment_id = v_enr, payment_id = v_pay, fulfilled_at = now()
   where id = o.id;
  return jsonb_build_object('student_id', v_student, 'enrollment_id', v_enr, 'payment_id', v_pay, 'already', false, 'plan', o.plan);
end $$;

revoke all on function public.fulfill_checkout_order(uuid, uuid) from public, anon, authenticated;
grant execute on function public.fulfill_checkout_order(uuid, uuid) to service_role;

-- Sitio público: qué asignaturas incluye un curso (solo cursos publicados)
create or replace function public.offering_courses(p_offering uuid)
returns table (name text, code text, section text)
language sql stable security definer set search_path = '' as $$
  select c.name, c.code, s.code
  from public.catalog_offerings o
  join public.sections s on s.id = any (o.section_ids) and s.organization_id = o.organization_id and s.status = 'active'
  join public.courses c on c.id = s.course_id
  where o.id = p_offering and o.is_published
  order by c.name
$$;
revoke all on function public.offering_courses(uuid) from public;
grant execute on function public.offering_courses(uuid) to anon, authenticated;

-- Inscribir ahora en sus asignaturas a quienes ya habían comprado/inscrito ese curso
create or replace function public.enroll_offering_buyers(p_offering uuid)
returns int language plpgsql security definer set search_path = '' as $$
declare off public.catalog_offerings; r record; n int := 0; v_enr uuid;
begin
  select * into off from public.catalog_offerings where id = p_offering;
  if off.id is null or not (private.has_permission(off.organization_id, 'settings.admin') or private.has_permission(off.organization_id, 'enrollments.create')) then
    raise exception 'No autorizado' using errcode = '42501';
  end if;
  for r in select distinct student_id from (
      select o.student_id from public.checkout_orders o where o.offering_id = off.id and o.fulfilled_at is not null and o.student_id is not null
      union
      select g.student_id from public.registrations g where g.organization_id = off.organization_id and g.form_data ->> 'program_id' = off.id::text) x loop
    v_enr := private.ensure_enrollment(off.organization_id, r.student_id, off.program_id, off.period_id, 'inscripcion');
    n := n + private.enroll_sections(off.organization_id, r.student_id, v_enr, off.section_ids);
  end loop;
  return n;
end $$;
revoke all on function public.enroll_offering_buyers(uuid) from public, anon;
grant execute on function public.enroll_offering_buyers(uuid) to authenticated;
