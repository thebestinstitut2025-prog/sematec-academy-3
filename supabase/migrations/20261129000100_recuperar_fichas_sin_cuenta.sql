-- =====================================================================
-- «¿Olvidó su contraseña?» también para estudiantes y profesores SIN cuenta todavía:
-- si su ficha activa tiene ese correo (o ese RUT con correo), se crea su cuenta y se le
-- envía el enlace para crear su contraseña (prueba que el correo es suyo).
-- =====================================================================

-- Ficha activa sin cuenta con ese correo o RUT (solo el servidor)
create or replace function public.find_unlinked_person(p_identifier text)
returns table (kind text, person_id uuid, organization_id uuid, full_name text, email text)
language plpgsql stable security definer set search_path = '' as $$
declare v text := lower(btrim(coalesce(p_identifier, ''))); d text;
begin
  if v = '' then return; end if;
  if position('@' in v) > 0 then
    return query
      select x.kind, x.id, x.org, x.nm, x.em from (
        select 'student'::text kind, s.id, s.organization_id org, trim(s.first_names || ' ' || s.last_names) nm, lower(btrim(s.email)) em, s.created_at, 1 o
          from public.students s where s.user_id is null and s.status = 'active' and lower(btrim(s.email)) = v
        union all
        select 'teacher', t.id, t.organization_id, trim(t.first_names || ' ' || t.last_names), lower(btrim(t.email)), t.created_at, 2
          from public.teachers t where t.user_id is null and t.status = 'active' and lower(btrim(t.email)) = v
      ) x order by x.o, x.created_at limit 1;
  else
    d := upper(regexp_replace(v, '[^0-9Kk]', '', 'g'));
    if length(d) < 5 then return; end if;
    return query
      select x.kind, x.id, x.org, x.nm, x.em from (
        select 'student'::text kind, s.id, s.organization_id org, trim(s.first_names || ' ' || s.last_names) nm, lower(btrim(s.email)) em, s.created_at, 1 o
          from public.students s where s.user_id is null and s.status = 'active' and coalesce(btrim(s.email), '') like '%@%'
           and upper(regexp_replace(coalesce(s.id_document_number, ''), '[^0-9Kk]', '', 'g')) = d
        union all
        select 'teacher', t.id, t.organization_id, trim(t.first_names || ' ' || t.last_names), lower(btrim(t.email)), t.created_at, 2
          from public.teachers t where t.user_id is null and t.status = 'active' and coalesce(btrim(t.email), '') like '%@%'
           and upper(regexp_replace(coalesce(t.id_document_number, ''), '[^0-9Kk]', '', 'g')) = d
      ) x order by x.o, x.created_at limit 1;
  end if;
end $$;
revoke all on function public.find_unlinked_person(text) from public, anon, authenticated;
grant execute on function public.find_unlinked_person(text) to service_role;

-- Une la ficha a la cuenta recién creada y le da su rol (estudiante o profesor) en la institución
create or replace function public.activate_person_account(p_kind text, p_person uuid, p_user uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_org uuid; v_role uuid;
begin
  if p_kind = 'student' then
    update public.students set user_id = p_user where id = p_person and user_id is null
      and not exists (select 1 from public.students o where o.organization_id = students.organization_id and o.user_id = p_user)
      returning organization_id into v_org;
    select id into v_role from public.roles where organization_id is null and code = 'estudiante';
  elsif p_kind = 'teacher' then
    update public.teachers set user_id = p_user where id = p_person and user_id is null
      and not exists (select 1 from public.teachers o where o.organization_id = teachers.organization_id and o.user_id = p_user)
      returning organization_id into v_org;
    select id into v_role from public.roles where organization_id is null and code = 'profesor';
  else
    raise exception 'Tipo no válido' using errcode = '22023';
  end if;
  if v_org is null then raise exception 'La ficha ya tiene cuenta' using errcode = '23505'; end if;
  insert into public.memberships (user_id, organization_id, role_id) values (p_user, v_org, v_role)
  on conflict (user_id, organization_id, role_id, campus_id) do nothing;
end $$;
revoke all on function public.activate_person_account(text, uuid, uuid) from public, anon, authenticated;
grant execute on function public.activate_person_account(text, uuid, uuid) to service_role;
