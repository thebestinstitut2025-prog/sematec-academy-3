-- =====================================================================
-- Matrículas: eliminar una matrícula y cambiar el monto de sus aranceles
-- Los cargos nunca se borran (contabilidad): se anulan con motivo y quedan en el historial.
-- =====================================================================

-- 🗑 Eliminar matrícula (sin pagos ni notas). Sus aranceles pendientes quedan anulados.
create or replace function public.delete_enrollment(p_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare e public.enrollments; v_reason text := nullif(trim(coalesce(p_reason, '')), '');
begin
  select * into e from public.enrollments where id = p_id for update;
  if not found then raise exception 'Matrícula inexistente' using errcode = 'P0002'; end if;
  if not (private.is_owner(e.organization_id) or private.has_permission(e.organization_id, 'enrollments.void')) then
    raise exception 'No autorizado: necesita permiso para anular matrículas.' using errcode = '42501';
  end if;
  if v_reason is null then raise exception 'Escriba el motivo para eliminar la matrícula.' using errcode = '22023'; end if;
  if exists (select 1 from public.payment_allocations pa join public.installments i on i.id = pa.installment_id
              join public.charges c on c.id = i.charge_id where c.enrollment_id = e.id and pa.amount <> 0) then
    raise exception 'Esta matrícula tiene pagos registrados: no se puede eliminar. Anule o reembolse los pagos en Finanzas, o cambie su estado a «Anulada» o «Retiro» para conservar el historial.' using errcode = '23503';
  end if;
  if exists (select 1 from public.section_enrollments se
              where se.enrollment_id = e.id and (
                exists (select 1 from public.grades g join public.assessments a on a.id = g.assessment_id
                         where a.section_id = se.section_id and g.student_id = e.student_id)
                or exists (select 1 from public.academic_records ar where ar.section_id = se.section_id and ar.student_id = e.student_id))) then
    raise exception 'Esta matrícula ya tiene notas o actas: no se puede eliminar. Cambie su estado a «Retiro» o «Anulada».' using errcode = '23503';
  end if;
  perform set_config('sematec.audit_reason', 'Matrícula eliminada: ' || v_reason, true);
  update public.charges set status = 'cancelled', cancelled_at = now(), cancelled_by = auth.uid(),
         cancel_reason = 'Matrícula eliminada: ' || v_reason
   where enrollment_id = e.id and status <> 'cancelled';
  update public.charges set enrollment_id = null where enrollment_id = e.id;
  update public.checkout_orders set enrollment_id = null where enrollment_id = e.id;
  delete from public.section_enrollments where enrollment_id = e.id;
  delete from public.enrollment_documents where enrollment_id = e.id;
  delete from public.enrollments where id = e.id;
end $$;
revoke all on function public.delete_enrollment(uuid, text) from public, anon;
grant execute on function public.delete_enrollment(uuid, text) to authenticated;

-- ✏ Cambiar un arancel sin pagos: se anula y se genera de nuevo con el monto, cuotas y fechas nuevas
create or replace function public.change_charge(p_charge uuid, p_gross numeric, p_installments int, p_first_due date,
                                                p_benefit uuid default null, p_description text default null, p_reason text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare c public.charges;
begin
  select * into c from public.charges where id = p_charge;
  if not found then raise exception 'Arancel inexistente' using errcode = 'P0002'; end if;
  if c.status = 'cancelled' then raise exception 'Ese arancel está anulado.' using errcode = '22023'; end if;
  if coalesce(p_gross, 0) <= 0 then raise exception 'Escriba un monto mayor que cero.' using errcode = '22023'; end if;
  perform public.cancel_charge(p_charge, 'Cambio de monto: ' || coalesce(nullif(trim(p_reason), ''), 'corrección'));
  return public.create_charge(c.student_id, c.concept, p_gross, c.currency, p_installments, p_first_due,
                              c.enrollment_id, p_benefit, coalesce(nullif(trim(p_description), ''), c.description));
end $$;
revoke all on function public.change_charge(uuid, numeric, int, date, uuid, text, text) from public, anon;
grant execute on function public.change_charge(uuid, numeric, int, date, uuid, text, text) to authenticated;
