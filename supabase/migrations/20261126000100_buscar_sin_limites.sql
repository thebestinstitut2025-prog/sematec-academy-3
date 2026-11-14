-- =====================================================================
-- Búsqueda sin límites: cualquier palabra o número (desde 1 carácter), números parciales
-- (RUT, teléfono, boleta, monto, certificado, venta, código de barras) y página «Ver todos».
-- =====================================================================
drop function if exists public.global_search(uuid, text, int);
drop function if exists public.store_search(uuid, text);

create function public.global_search(p_org uuid, p_q text, p_limit int default 40, p_per int default 8)
returns table (kind text, id uuid, title text, subtitle text, href text, rank int)
language plpgsql stable security invoker set search_path = '' as $$
declare
  q text := public.search_norm(btrim(coalesce(p_q, '')));
  pat text; d text; n bigint; per int := least(greatest(coalesce(p_per, 8), 1), 2000);
begin
  if length(q) < 1 or p_org is null then return; end if;
  pat := '%' || replace(replace(replace(q, '\', '\\'), '%', '\%'), '_', '\_') || '%';
  d := case when q ~ '[0-9]' then regexp_replace(q, '[^0-9k]', '', 'g') else '' end;  -- números: RUT, teléfono, boleta… sin puntos ni guion
  n := case when q ~ '^[0-9]{1,15}$' then q::bigint end;  -- número de boleta
  return query
  select * from (
    (select 'Estudiante'::text, s.id, (s.last_names || ', ' || s.first_names)::text,
            concat_ws(' · ', s.student_code, s.id_document_number, s.email)::text, ('/app/estudiantes/' || s.id)::text, 1
       from public.students s
      where s.organization_id = p_org and (
            public.search_norm(s.first_names || ' ' || s.last_names) like pat
         or public.search_norm(s.last_names || ' ' || s.first_names) like pat
         or public.search_norm(s.student_code) like pat or public.search_norm(s.email) like pat
         or (length(d) >= 1 and regexp_replace(lower(coalesce(s.id_document_number, '')), '[^0-9k]', '', 'g') like '%' || d || '%')
         or (length(d) >= 1 and regexp_replace(coalesce(s.phone, ''), '[^0-9]', '', 'g') like '%' || d || '%'))
      order by s.last_names limit per)
    union all
    (select 'Profesor', t.id, (t.last_names || ', ' || t.first_names), concat_ws(' · ', t.teacher_code, t.specialty, t.email), '/app/profesores', 2
       from public.teachers t
      where t.organization_id = p_org and (public.search_norm(t.first_names || ' ' || t.last_names) like pat
         or public.search_norm(t.last_names || ' ' || t.first_names) like pat or public.search_norm(t.email) like pat or public.search_norm(t.teacher_code) like pat)
      order by t.last_names limit per)
    union all
    (select 'Funcionario', e.id, (e.last_names || ', ' || e.first_names), concat_ws(' · ', e.employee_code, e.position, e.email), '/app/personal', 3
       from public.employees e
      where e.organization_id = p_org and (public.search_norm(e.first_names || ' ' || e.last_names) like pat
         or public.search_norm(e.last_names || ' ' || e.first_names) like pat or public.search_norm(e.position) like pat or public.search_norm(e.email) like pat)
      order by e.last_names limit per)
    union all
    (select 'Programa', p.id, p.name, concat_ws(' · ', p.code, p.level, p.modality), '/app/academico/programas/' || p.id, 4
       from public.programs p
      where p.organization_id = p_org and (public.search_norm(p.name) like pat or public.search_norm(p.code) like pat)
      order by p.name limit per)
    union all
    (select 'Asignatura', c.id, c.name, c.code, '/app/academico?t=cursos', 5
       from public.courses c
      where c.organization_id = p_org and (public.search_norm(c.name) like pat or public.search_norm(c.code) like pat)
      order by c.name limit per)
    union all
    (select 'Sección', s.id, (c.name || ' · ' || s.code), concat_ws(' · ', s.modality, s.status::text), '/app/secciones/' || s.id, 6
       from public.sections s join public.courses c on c.id = s.course_id
      where s.organization_id = p_org and (public.search_norm(s.code) like pat or public.search_norm(c.name) like pat or public.search_norm(c.code) like pat or public.search_norm(s.room_code) like pat)
      order by c.name limit per)
    union all
    (select 'Matrícula', e.id, (st.last_names || ', ' || st.first_names), concat_ws(' · ', pr.name, ap.name, e.status::text), '/app/matriculas/' || e.id, 7
       from public.enrollments e join public.students st on st.id = e.student_id
       join public.programs pr on pr.id = e.program_id left join public.academic_periods ap on ap.id = e.period_id
      where e.organization_id = p_org and (public.search_norm(st.first_names || ' ' || st.last_names) like pat
         or public.search_norm(st.last_names || ' ' || st.first_names) like pat or public.search_norm(st.student_code) like pat
         or (length(d) >= 1 and regexp_replace(lower(coalesce(st.id_document_number, '')), '[^0-9k]', '', 'g') like '%' || d || '%'))
      order by e.enrolled_at desc limit per)
    union all
    (select 'Boleta', p.id, ('Boleta N° ' || case when p.kind = 'refund' then 'R-' else '' end || p.receipt_number),
            concat_ws(' · ', st.last_names || ', ' || st.first_names, p.currency || ' ' || p.amount::text, to_char(p.paid_at, 'DD-MM-YYYY')), '/app/finanzas/boleta/' || p.id, 8
       from public.payments p join public.students st on st.id = p.student_id
      where p.organization_id = p_org and (p.receipt_number = n or (length(d) >= 1 and (p.receipt_number::text like '%' || d || '%' or trunc(p.amount)::text like '%' || d || '%')) or public.search_norm(p.external_reference) like pat)
      order by p.paid_at desc
      limit per)
    union all
    (select 'Gasto', x.id, x.description, concat_ws(' · ', x.supplier, x.currency || ' ' || x.amount::text, to_char(x.spent_on, 'DD-MM-YYYY')), '/app/finanzas/gastos', 9
       from public.expenses x
      where x.organization_id = p_org and (public.search_norm(x.description) like pat or public.search_norm(x.supplier) like pat or public.search_norm(x.document_number) like pat or (length(d) >= 1 and trunc(x.amount)::text like '%' || d || '%'))
      order by x.spent_on desc limit per)
    union all
    (select 'Clase o reunión', cs.id, cs.title, to_char(cs.scheduled_start at time zone 'America/Santiago', 'DD-MM-YYYY HH24:MI'), '/app/conferencias/' || cs.id, 10
       from public.conference_sessions cs
      where cs.organization_id = p_org and public.search_norm(cs.title) like pat
      order by cs.scheduled_start desc limit per)
    union all
    (select 'Biblioteca', l.id, l.title, concat_ws(' · ', l.author, l.category), '/app/biblioteca', 11
       from public.library_items l
      where l.organization_id = p_org and (public.search_norm(l.title) like pat or public.search_norm(l.author) like pat or public.search_norm(l.isbn) like pat)
      order by l.title limit per)
    union all
    (select 'Archivo', f.id, f.name, coalesce(f.description, ''), '/app/archivos/ver/' || f.id, 12
       from public.user_files f
      where f.organization_id = p_org and f.deleted_at is null and (public.search_norm(f.name) like pat or public.search_norm(f.description) like pat)
      order by f.created_at desc limit per)
    union all
    (select 'Certificado', c.id, c.title, concat_ws(' · ', c.recipient_name, 'N° ' || c.serial_number), '/app/certificados/' || c.id, 13
       from public.certificates c
      where c.organization_id = p_org and (public.search_norm(c.recipient_name) like pat or public.search_norm(c.title) like pat or (length(d) >= 1 and c.serial_number::text like '%' || d || '%'))
      order by c.issued_at desc limit per)
    union all
    (select 'Anuncio', a.id, a.title, '', '/app/anuncios', 14
       from public.announcements a
      where a.organization_id = p_org and public.search_norm(a.title) like pat
      order by a.created_at desc limit per)
    union all
    (select 'Soporte', t.id, t.subject, t.status::text, '/app/soporte/' || t.id, 15
       from public.support_tickets t
      where t.organization_id = p_org and public.search_norm(t.subject) like pat
      order by t.created_at desc limit per)
  ) r(kind, id, title, subtitle, href, rank)
  order by r.rank, r.title
  limit least(greatest(coalesce(p_limit, 40), 1), 5000);
end $$;
grant execute on function public.global_search(uuid, text, int, int) to authenticated;

create function public.store_search(p_org uuid, p_q text, p_per int default 6)
returns table (kind text, id uuid, title text, subtitle text, href text, rank int)
language plpgsql stable security invoker set search_path = '' as $$
declare q text := public.search_norm(btrim(coalesce(p_q, ''))); pat text; n bigint; per int := least(greatest(coalesce(p_per, 6), 1), 2000);
begin
  if length(q) < 1 then return; end if;
  pat := '%' || replace(replace(replace(q, '\', '\\'), '%', '\%'), '_', '\_') || '%';
  n := case when q ~ '^[0-9]{1,15}$' then q::bigint end;
  return query
    (select 'Producto'::text, p.id, p.name, concat_ws(' · ', p.sku, p.brand, 'stock ' || trim(to_char(p.stock, 'FM999999990.###'))), ('/app/tienda/productos/' || p.id)::text, 2
       from public.products p
      where p.organization_id = p_org and (public.search_norm(p.name) like pat or public.search_norm(p.sku) like pat or public.search_norm(p.barcode) like pat or public.search_norm(p.brand) like pat)
      order by p.name limit per)
    union all
    (select 'Venta', s.id, 'Venta N° ' || s.number, concat_ws(' · ', s.customer_name, s.currency || ' ' || s.total::text), '/app/tienda/ventas/' || s.id, 8
       from public.sales s where s.organization_id = p_org and (s.number = n or (n is not null and s.number::text like '%' || q || '%')
         or public.search_norm(s.customer_name) like pat or public.search_norm(s.tracking_code) like pat)
      order by s.created_at desc limit per);
end $$;
grant execute on function public.store_search(uuid, text, int) to authenticated;
