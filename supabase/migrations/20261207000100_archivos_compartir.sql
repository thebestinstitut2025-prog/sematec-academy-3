-- =====================================================================
-- 📁 Archivos: quién puede verlos (privado, público, personas, grupos, curso,
-- personal, institución), grupos de personas, enlaces (YouTube, Drive…),
-- enlaces para personas nuevas por correo y para abrir en apps (PowerPoint, Word…).
-- =====================================================================

-- ---------- 1. Nuevas visibilidades y enlaces ----------
alter table public.user_files drop constraint if exists user_files_visibility_check;
alter table public.user_files add constraint user_files_visibility_check
  check (visibility in ('private', 'section', 'staff', 'org', 'public', 'people'));
alter table public.user_files add column if not exists url text check (url is null or (url ~ '^https://' and length(url) <= 2000));

-- ---------- 2. Grupos de personas (propios de cada usuario, reutilizables) ----------
create table if not exists public.people_groups (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  owner_id        uuid not null references public.profiles (id) on delete cascade,
  name            text not null check (length(trim(name)) between 1 and 80),
  created_at      timestamptz not null default now()
);
create table if not exists public.people_group_members (
  group_id uuid not null references public.people_groups (id) on delete cascade,
  user_id  uuid not null references public.profiles (id) on delete cascade,
  primary key (group_id, user_id)
);
alter table public.people_groups enable row level security;
alter table public.people_group_members enable row level security;
revoke all on public.people_groups, public.people_group_members from anon;
grant select, insert, update, delete on public.people_groups, public.people_group_members to authenticated;
drop policy if exists pg_own on public.people_groups;
create policy pg_own on public.people_groups for all to authenticated
  using (owner_id = auth.uid()) with check (owner_id = auth.uid() and private.is_member(organization_id));
drop policy if exists pgm_own on public.people_group_members;
create policy pgm_own on public.people_group_members for all to authenticated
  using (exists (select 1 from public.people_groups g where g.id = group_id and g.owner_id = auth.uid()))
  with check (exists (select 1 from public.people_groups g where g.id = group_id and g.owner_id = auth.uid()));

-- ---------- 3. Compartido con personas o grupos ----------
create table if not exists public.file_shares (
  id         uuid primary key default gen_random_uuid(),
  file_id    uuid not null references public.user_files (id) on delete cascade,
  user_id    uuid references public.profiles (id) on delete cascade,
  group_id   uuid references public.people_groups (id) on delete cascade,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  check ((user_id is null) <> (group_id is null))
);
create unique index if not exists file_shares_user_uq on public.file_shares (file_id, user_id) where user_id is not null;
create unique index if not exists file_shares_group_uq on public.file_shares (file_id, group_id) where group_id is not null;
create index if not exists file_shares_user_idx on public.file_shares (user_id);
alter table public.file_shares enable row level security;
revoke all on public.file_shares from anon;
grant select on public.file_shares to authenticated;
drop policy if exists fs_read on public.file_shares;
create policy fs_read on public.file_shares for select to authenticated using (
  user_id = auth.uid() or exists (select 1 from public.user_files f where f.id = file_id and f.owner_id = auth.uid()));

create or replace function private.file_shared_with_me(p_file uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.file_shares s where s.file_id = p_file and (
    s.user_id = auth.uid()
    or exists (select 1 from public.people_group_members m where m.group_id = s.group_id and m.user_id = auth.uid())))
$$;

drop policy if exists ufiles_read on public.user_files;
create policy ufiles_read on public.user_files for select to authenticated using (
  private.is_owner(organization_id)
  or (deleted_at is null and (
        owner_id = auth.uid()
     or (visibility in ('org', 'public') and private.is_member(organization_id))
     or (visibility = 'staff' and (private.is_staff(organization_id) or exists (select 1 from public.teachers t where t.user_id = auth.uid() and t.organization_id = user_files.organization_id)))
     or (visibility = 'section' and (private.teaches_section(section_id) or private.enrolled_in_section(section_id)))
     or private.file_shared_with_me(id))));

-- ---------- 4. Enlaces con clave: público, persona nueva (correo) y abrir en apps ----------
create table if not exists public.file_tokens (
  token      text primary key check (length(token) >= 32),
  file_id    uuid not null references public.user_files (id) on delete cascade,
  kind       text not null check (kind in ('public', 'email', 'open')),
  email      text,
  expires_at timestamptz,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now()
);
create index if not exists file_tokens_file_idx on public.file_tokens (file_id);
alter table public.file_tokens enable row level security;
revoke all on public.file_tokens from anon, authenticated;

-- Quién puede ver el archivo: visibilidad + personas + grupos (solo quien lo subió o el propietario)
create or replace function public.set_file_access(p_file uuid, p_visibility text, p_section uuid default null,
  p_users uuid[] default '{}', p_groups uuid[] default '{}')
returns text language plpgsql security definer set search_path = '' as $$
declare f public.user_files; v_token text;
begin
  select * into f from public.user_files where id = p_file and deleted_at is null;
  if f.id is null then raise exception 'Archivo no encontrado' using errcode = 'P0002'; end if;
  if f.owner_id <> auth.uid() and not private.is_owner(f.organization_id) then raise exception 'Solo quien lo subió puede cambiar quién lo ve' using errcode = '42501'; end if;
  if p_visibility not in ('private', 'section', 'staff', 'org', 'public', 'people') then raise exception 'Visibilidad no válida' using errcode = '22023'; end if;
  if p_visibility = 'section' and (p_section is null or not (private.teaches_section(p_section) or private.enrolled_in_section(p_section) or private.is_owner(f.organization_id))) then
    raise exception 'Elija un curso suyo' using errcode = '42501';
  end if;
  if coalesce(array_length(p_users, 1), 0) + coalesce(array_length(p_groups, 1), 0) > 500 then raise exception 'Máximo 500 personas o grupos' using errcode = '22023'; end if;
  update public.user_files set visibility = p_visibility, section_id = case when p_visibility = 'section' then p_section end where id = p_file;
  delete from public.file_shares where file_id = p_file;
  insert into public.file_shares (file_id, user_id, created_by)
    select p_file, u, auth.uid() from unnest(coalesce(p_users, '{}')) u
    where exists (select 1 from public.memberships m where m.user_id = u and m.organization_id = f.organization_id and m.status = 'active')
    on conflict do nothing;
  insert into public.file_shares (file_id, group_id, created_by)
    select p_file, g, auth.uid() from unnest(coalesce(p_groups, '{}')) g
    where exists (select 1 from public.people_groups pg where pg.id = g and pg.owner_id = auth.uid())
    on conflict do nothing;
  -- Enlace público: uno fijo por archivo (se desactiva solo si deja de ser público)
  if p_visibility = 'public' then
    select token into v_token from public.file_tokens where file_id = p_file and kind = 'public';
    if v_token is null then
      v_token := encode(extensions.gen_random_bytes(24), 'hex');
      insert into public.file_tokens (token, file_id, kind, created_by) values (v_token, p_file, 'public', auth.uid());
    end if;
  end if;
  return v_token;
end $$;

-- Enlace con clave para una persona nueva (correo, 30 días) o para abrir en una app (2 horas)
create or replace function public.create_file_token(p_file uuid, p_kind text, p_email text default null)
returns text language plpgsql security definer set search_path = '' as $$
declare v_token text; f public.user_files;
begin
  if auth.uid() is null then raise exception 'Inicie sesión' using errcode = '42501'; end if;
  select * into f from public.user_files where id = p_file and deleted_at is null;
  if f.id is null then raise exception 'Archivo no encontrado' using errcode = 'P0002'; end if;
  if p_kind = 'email' then
    if f.owner_id <> auth.uid() and not private.is_owner(f.organization_id) then raise exception 'Solo quien lo subió puede enviarlo' using errcode = '42501'; end if;
    if p_email is null or p_email !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'Correo no válido' using errcode = '22023'; end if;
    if private.rate_limited('file_email', auth.uid()::text, 60, interval '1 hour') then raise exception 'Demasiados envíos seguidos. Espere unos minutos.' using errcode = '54000'; end if;
  elsif p_kind = 'open' then
    -- Puede abrirlo en una app quien puede verlo
    if not (f.owner_id = auth.uid() or private.is_owner(f.organization_id)
            or (f.visibility in ('org', 'public') and private.is_member(f.organization_id))
            or (f.visibility = 'staff' and private.is_staff(f.organization_id))
            or (f.visibility = 'section' and (private.teaches_section(f.section_id) or private.enrolled_in_section(f.section_id)))
            or private.file_shared_with_me(f.id)) then
      raise exception 'Sin acceso' using errcode = '42501';
    end if;
  else
    raise exception 'Tipo no válido' using errcode = '22023';
  end if;
  v_token := encode(extensions.gen_random_bytes(24), 'hex');
  insert into public.file_tokens (token, file_id, kind, email, expires_at, created_by)
  values (v_token, p_file, p_kind, lower(p_email), now() + case when p_kind = 'email' then interval '30 days' else interval '2 hours' end, auth.uid());
  return v_token;
end $$;

-- Lectura del archivo por su enlace (solo el servidor)
create or replace function public.file_by_token(p_token text)
returns table (id uuid, name text, mime_type text, size_bytes bigint, storage_path text, url text, description text, organization_id uuid, kind text)
language sql stable security definer set search_path = '' as $$
  select f.id, f.name, f.mime_type, f.size_bytes, f.storage_path, f.url, f.description, f.organization_id, t.kind
  from public.file_tokens t join public.user_files f on f.id = t.file_id
  where t.token = p_token and f.deleted_at is null
    and (t.expires_at is null or t.expires_at > now())
    and (t.kind <> 'public' or f.visibility = 'public')
$$;

-- Enlaces (YouTube, Drive, cualquier página) como un archivo más
create or replace function public.register_user_link(p_org uuid, p_name text, p_url text, p_description text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  if auth.uid() is null or not private.is_member(p_org) then raise exception 'Sin acceso a la institución' using errcode = '42501'; end if;
  if p_url !~ '^https://[^\s<>"]+$' or length(p_url) > 2000 then raise exception 'El enlace debe comenzar con https://' using errcode = '22023'; end if;
  if private.rate_limited('upload', auth.uid()::text, 200, interval '1 hour') then raise exception 'Demasiadas subidas seguidas. Espere unos minutos.' using errcode = '54000'; end if;
  insert into public.user_files (organization_id, owner_id, name, description, mime_type, size_bytes, storage_path, visibility, url)
  values (p_org, auth.uid(), left(trim(p_name), 200), nullif(trim(p_description), ''), 'text/x-uri', 1, 'link/' || gen_random_uuid(), 'private', p_url)
  returning id into v_id;
  return v_id;
end $$;

revoke all on function public.set_file_access(uuid, text, uuid, uuid[], uuid[]), public.create_file_token(uuid, text, text),
  public.file_by_token(text), public.register_user_link(uuid, text, text, text) from public, anon;
grant execute on function public.set_file_access(uuid, text, uuid, uuid[], uuid[]), public.create_file_token(uuid, text, text),
  public.register_user_link(uuid, text, text, text) to authenticated;
grant execute on function public.file_by_token(text) to service_role;

-- Enlace público actual de un archivo (solo quien lo subió o el propietario)
create or replace function public.file_public_token(p_file uuid)
returns text language sql stable security definer set search_path = '' as $$
  select t.token from public.file_tokens t join public.user_files f on f.id = t.file_id
  where t.file_id = p_file and t.kind = 'public' and f.visibility = 'public'
    and (f.owner_id = auth.uid() or private.is_owner(f.organization_id))
$$;
revoke all on function public.file_public_token(uuid) from public, anon;
grant execute on function public.file_public_token(uuid) to authenticated;
