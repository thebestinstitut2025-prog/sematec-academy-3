-- =====================================================================
-- Pagos: transferencia con comprobante (se revisa antes de confirmar) y datos para transferir
-- · El estudiante o apoderado elige las cuotas, sube el comprobante y queda «en revisión»
-- · Finanzas aprueba (se registra el pago y se envía la boleta) o rechaza con motivo
-- =====================================================================

create table if not exists public.transfer_proofs (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id),
  student_id       uuid not null references public.students(id) on delete cascade,
  installment_ids  uuid[] not null default '{}',
  amount           numeric(14,2) not null check (amount > 0),
  currency         text not null,
  bank             text check (bank is null or length(bank) <= 120),
  operation        text check (operation is null or length(operation) <= 80),
  transferred_on   date,
  note             text check (note is null or length(note) <= 1000),
  status           text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  reject_reason    text check (reject_reason is null or length(reject_reason) <= 500),
  payment_id       uuid references public.payments(id),
  created_by       uuid default auth.uid() references public.profiles(id),
  created_at       timestamptz not null default now(),
  reviewed_by      uuid references public.profiles(id),
  reviewed_at      timestamptz
);
create index if not exists transfer_proofs_org_status on public.transfer_proofs (organization_id, status, created_at desc);
create index if not exists transfer_proofs_student on public.transfer_proofs (student_id, created_at desc);
alter table public.transfer_proofs enable row level security;
drop policy if exists tp_select on public.transfer_proofs;
create policy tp_select on public.transfer_proofs for select using (
  private.has_permission(organization_id, 'finance.view') or student_id in (select private.my_student_ids()) or private.is_guardian_of(student_id));
grant select on public.transfer_proofs to authenticated;
drop trigger if exists trg_audit_transfer_proofs on public.transfer_proofs;
create trigger trg_audit_transfer_proofs after insert or update or delete on public.transfer_proofs for each row execute function private.audit_row();

-- Comprobantes como adjuntos
alter table public.attachments drop constraint if exists attachments_entity_type_check;
alter table public.attachments add constraint attachments_entity_type_check
  check (entity_type in ('submission', 'quiz_attempt', 'external_eval', 'message', 'assignment', 'quiz', 'eval_material', 'content', 'quiz_question', 'transfer_proof'));

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
  elsif p_type = 'transfer_proof' then
    -- Comprobante de transferencia: lo ve quien pagó (estudiante o apoderado) y finanzas
    return exists (select 1 from public.transfer_proofs t where t.id = p_entity
      and (private.has_permission(t.organization_id, 'finance.view') or t.student_id in (select private.my_student_ids()) or private.is_guardian_of(t.student_id)));
  elsif p_type = 'submission' then
    select a.section_id into v_section from public.submissions s join public.assignments a on a.id = s.assignment_id where s.id = p_entity;
  elsif p_type = 'quiz_attempt' then
    select q.section_id into v_section from public.quiz_attempts t join public.quizzes q on q.id = t.quiz_id where t.id = p_entity;
  elsif p_type = 'external_eval' then
    select e.section_id into v_section from public.external_evaluations e where e.id = p_entity;
  end if;
  return v_section is not null and (private.teaches_section(v_section) or private.has_permission(p_org, 'sections.view'));
end $$;


-- El estudiante o apoderado informa su transferencia con el comprobante
create or replace function public.submit_transfer_proof(p_student uuid, p_installments uuid[], p_amount numeric,
  p_bank text, p_operation text, p_date date, p_note text, p_files uuid[])
returns uuid language plpgsql security definer set search_path = '' as $$
declare s public.students; v_total numeric; v_curr text; v_n int; v_num int; v_id uuid; f uuid; u record;
begin
  select * into s from public.students where id = p_student;
  if not found or not (p_student in (select private.my_student_ids()) or private.is_guardian_of(p_student)) then
    raise exception 'No autorizado' using errcode = '42501';
  end if;
  if coalesce(cardinality(p_files), 0) = 0 then raise exception 'Suba la foto o el PDF del comprobante de la transferencia.' using errcode = '22023'; end if;
  if cardinality(p_files) > 5 then raise exception 'Máximo 5 archivos.' using errcode = '22023'; end if;
  if coalesce(cardinality(p_installments), 0) = 0 then raise exception 'Marque las cuotas que pagó.' using errcode = '22023'; end if;
  select coalesce(sum(b.outstanding), 0), min(b.currency), count(distinct b.currency), count(*) into v_total, v_curr, v_n, v_num
    from public.installment_balances b
   where b.student_id = p_student and b.installment_id = any(p_installments) and not b.cancelled and b.outstanding > 0;
  if v_num <> cardinality(p_installments) then raise exception 'Alguna cuota ya fue pagada o no corresponde. Actualice la página.' using errcode = '22023'; end if;
  if v_n <> 1 then raise exception 'Informe por separado las cuotas de distinta moneda.' using errcode = '22023'; end if;
  if p_amount is null or p_amount <= 0 or p_amount > v_total then
    raise exception 'El monto debe ser mayor que 0 y no puede superar lo que debe en esas cuotas (%).', v_total using errcode = '22023';
  end if;
  if exists (select 1 from public.transfer_proofs t where t.student_id = p_student and t.status = 'pending' and t.installment_ids && p_installments) then
    raise exception 'Ya informó una transferencia de esas cuotas y está en revisión. Espere la respuesta de finanzas.' using errcode = '22023';
  end if;
  if private.rate_limited('transfer_proof', auth.uid()::text, 10, interval '1 hour') then
    raise exception 'Demasiados intentos. Intente más tarde.' using errcode = '54000';
  end if;
  insert into public.transfer_proofs (organization_id, student_id, installment_ids, amount, currency, bank, operation, transferred_on, note)
  values (s.organization_id, p_student, p_installments, p_amount, v_curr, nullif(btrim(p_bank), ''), nullif(btrim(p_operation), ''), p_date, nullif(btrim(p_note), ''))
  returning id into v_id;
  foreach f in array p_files loop
    if not exists (select 1 from public.user_files x where x.id = f and x.owner_id = auth.uid() and x.deleted_at is null) then
      raise exception 'Uno de los archivos no es suyo o fue eliminado.' using errcode = '42501';
    end if;
    insert into public.attachments (organization_id, entity_type, entity_id, file_id, created_by)
    values (s.organization_id, 'transfer_proof', v_id, f, auth.uid()) on conflict do nothing;
  end loop;
  -- 🔔 Aviso a finanzas
  for u in select distinct m.user_id from public.memberships m join public.role_permissions rp on rp.role_id = m.role_id
           where m.organization_id = s.organization_id and m.status = 'active' and rp.permission_code = 'finance.create' limit 50 loop
    insert into public.notifications (organization_id, user_id, category, title, body, data)
    values (s.organization_id, u.user_id, 'finance', 'Transferencia por revisar',
            s.first_names || ' ' || s.last_names || ' informó una transferencia de ' || p_amount || ' ' || v_curr || '.',
            jsonb_build_object('href', '/app/finanzas/transferencias', 'proof', v_id));
  end loop;
  return v_id;
end $$;
revoke all on function public.submit_transfer_proof(uuid, uuid[], numeric, text, text, date, text, uuid[]) from public, anon;
grant execute on function public.submit_transfer_proof(uuid, uuid[], numeric, text, text, date, text, uuid[]) to authenticated;

-- Finanzas revisa: aprobar (registra el pago en esas cuotas) o rechazar con motivo
create or replace function public.review_transfer_proof(p_proof uuid, p_approve boolean, p_reason text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare t public.transfer_proofs; v_pay uuid; v_left numeric;
begin
  select * into t from public.transfer_proofs where id = p_proof for update;
  if not found then raise exception 'Comprobante inexistente' using errcode = 'P0002'; end if;
  if not private.has_permission(t.organization_id, 'finance.create') then raise exception 'No autorizado (finance.create).' using errcode = '42501'; end if;
  if t.status <> 'pending' then raise exception 'Este comprobante ya fue revisado.' using errcode = '22023'; end if;
  if not p_approve then
    if coalesce(length(btrim(p_reason)), 0) < 3 then raise exception 'Indique el motivo del rechazo.' using errcode = '22023'; end if;
    update public.transfer_proofs set status = 'rejected', reject_reason = left(btrim(p_reason), 500), reviewed_by = auth.uid(), reviewed_at = now() where id = t.id;
    return null;
  end if;
  -- Si alguna cuota se pagó por otro medio mientras tanto, se aplica a lo que queda
  select coalesce(sum(outstanding), 0) into v_left from public.installment_balances
   where student_id = t.student_id and installment_id = any (t.installment_ids) and not cancelled;
  if v_left <= 0 then raise exception 'Esas cuotas ya están pagadas. Rechace el comprobante indicando el motivo.' using errcode = '22023'; end if;
  v_pay := public.register_payment(t.student_id, least(t.amount, v_left), t.currency, 'bank_transfer', null, t.operation, t.installment_ids,
    'Transferencia verificada' || coalesce(' · ' || t.bank, '') || coalesce(' · op. ' || t.operation, ''));
  update public.transfer_proofs set status = 'approved', payment_id = v_pay, reviewed_by = auth.uid(), reviewed_at = now() where id = t.id;
  return v_pay;
end $$;
revoke all on function public.review_transfer_proof(uuid, boolean, text) from public, anon;
grant execute on function public.review_transfer_proof(uuid, boolean, text) to authenticated;
