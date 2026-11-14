-- =====================================================================
-- Código de sala: cada sección (sala) de un curso tiene su propio código único,
-- asociado a sus estudiantes y a su profesor. Entrar con el código solo abre la sala
-- a quien pertenece a ella (o al personal con permiso).
-- =====================================================================

alter table public.sections add column if not exists room_code text;

create or replace function private.new_room_code()
returns text language plpgsql volatile security definer set search_path = '' as $$
declare v text; a constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; i int;
begin
  loop
    v := 'SALA-';
    for i in 1..6 loop v := v || substr(a, 1 + floor(random() * length(a))::int, 1); end loop;
    exit when not exists (select 1 from public.sections where room_code = v);
  end loop;
  return v;
end $$;

create or replace function private.sections_room_code()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.room_code is null or trim(new.room_code) = '' then new.room_code := private.new_room_code(); end if;
  new.room_code := upper(trim(new.room_code));
  return new;
end $$;

drop trigger if exists trg_sections_room_code on public.sections;
create trigger trg_sections_room_code before insert or update of room_code on public.sections
for each row execute function private.sections_room_code();

update public.sections set room_code = private.new_room_code() where room_code is null;
create unique index if not exists sections_room_code_key on public.sections (room_code);
alter table public.sections alter column room_code set not null;

-- 🔑 Entrar con el código: devuelve la sala si la persona es su profesor, su estudiante o personal con permiso
create or replace function public.find_room_by_code(p_code text)
returns uuid language plpgsql stable security definer set search_path = '' as $$
declare v_code text; s record;
begin
  if auth.uid() is null then raise exception 'Inicie sesión' using errcode = '42501'; end if;
  v_code := upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g'));
  if v_code = '' then raise exception 'Escriba el código de la sala.' using errcode = '22023'; end if;
  if v_code not like 'SALA%' then v_code := 'SALA' || v_code; end if;
  select x.id, x.organization_id, x.campus_id into s from public.sections x
   where replace(x.room_code, '-', '') = v_code;
  if s.id is null
     or not (private.teaches_section(s.id) or private.enrolled_in_section(s.id)
             or private.has_permission(s.organization_id, 'sections.view', s.campus_id)) then
    raise exception 'Ese código no corresponde a ninguna de sus salas. Revíselo o pida a la institución que lo inscriba en esa sala.' using errcode = 'P0002';
  end if;
  return s.id;
end $$;
revoke all on function public.find_room_by_code(text) from public, anon;
grant execute on function public.find_room_by_code(text) to authenticated;

-- ♻ Nuevo código (por ejemplo si el código se compartió por error)
create or replace function public.regenerate_room_code(p_section uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare s record; v text;
begin
  select id, organization_id, campus_id into s from public.sections where id = p_section;
  if s.id is null then raise exception 'Sala inexistente' using errcode = 'P0002'; end if;
  if not private.has_permission(s.organization_id, 'sections.edit', s.campus_id) then
    raise exception 'No autorizado: necesita permiso para editar secciones.' using errcode = '42501';
  end if;
  v := private.new_room_code();
  update public.sections set room_code = v where id = p_section;
  return v;
end $$;
revoke all on function public.regenerate_room_code(uuid) from public, anon;
grant execute on function public.regenerate_room_code(uuid) to authenticated;
