-- =====================================================================
-- 📇 Contactos (llamar, WhatsApp, SMS, correo, mensaje) con privacidad del teléfono
-- 📱 Apps y accesos rápidos (YouTube, Meet, Zoom, WhatsApp, cualquier enlace)
--    con quién los ve: solo yo, personas/grupos, un curso, estudiantes, profesores
--    y personal, o toda la institución.
-- =====================================================================

-- ---------- 1. Contactos ----------
-- Cada persona decide quién ve su teléfono y correo:
--   'nadie' · 'personal' (personal y profesores, por defecto) · 'contactos' (todos sus contactos de la plataforma)
create or replace function public.my_contacts(p_org uuid)
returns table (user_id uuid, full_name text, role_name text, email text, phone text)
language sql stable security definer set search_path = '' as $$
  with me as (
    select private.is_staff(p_org) or exists (select 1 from public.teachers t where t.user_id = auth.uid() and t.organization_id = p_org and t.status = 'active') as pro
  )
  select r.user_id, r.full_name, r.role_name,
         case when v.vis = 'contactos' or (v.vis = 'personal' and me.pro) then p.email end,
         case when v.vis = 'contactos' or (v.vis = 'personal' and me.pro)
              then coalesce(nullif(trim(p.phone), ''), (select nullif(trim(s.phone), '') from public.students s where s.user_id = p.id and s.organization_id = p_org limit 1)) end
  from public.message_recipients(p_org) r
  join public.profiles p on p.id = r.user_id
  cross join me
  cross join lateral (select coalesce(nullif(p.preferences ->> 'contact_visibility', ''), 'personal') as vis) v
  order by r.full_name
$$;
revoke all on function public.my_contacts(uuid) from public, anon;
grant execute on function public.my_contacts(uuid) to authenticated;

create or replace function public.set_contact_visibility(p_vis text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'Inicie sesión' using errcode = '42501'; end if;
  if p_vis not in ('nadie', 'personal', 'contactos') then raise exception 'Opción no válida' using errcode = '22023'; end if;
  update public.profiles set preferences = coalesce(preferences, '{}'::jsonb) || jsonb_build_object('contact_visibility', p_vis) where id = auth.uid();
end $$;
revoke all on function public.set_contact_visibility(text) from public, anon;
grant execute on function public.set_contact_visibility(text) to authenticated;

-- ---------- 2. Apps y accesos rápidos ----------
create table if not exists public.app_links (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  owner_id        uuid not null references public.profiles (id) on delete cascade,
  title           text not null check (length(trim(title)) between 1 and 80),
  url             text not null check (length(url) <= 2000 and url ~ '^(https://|tel:|mailto:|sms:|whatsapp:)'),
  icon            text not null default '🔗' check (length(icon) <= 8),
  description     text check (length(description) <= 300),
  visibility      text not null default 'private' check (visibility in ('private', 'people', 'section', 'students', 'staff', 'org')),
  section_id      uuid references public.sections (id) on delete cascade,
  users           uuid[] not null default '{}',
  groups          uuid[] not null default '{}',
  position        int not null default 0,
  created_at      timestamptz not null default now(),
  check ((visibility = 'section') = (section_id is not null)),
  check (cardinality(users) <= 500 and cardinality(groups) <= 100)
);
create index if not exists app_links_org_idx on public.app_links (organization_id, position);
alter table public.app_links enable row level security;
revoke all on public.app_links from anon;
grant select, insert, update, delete on public.app_links to authenticated;

create or replace function private.app_link_visible(l public.app_links)
returns boolean language sql stable security definer set search_path = '' as $$
  select l.owner_id = auth.uid() or (private.is_member(l.organization_id) and (
       l.visibility = 'org'
    or (l.visibility = 'staff' and (private.is_staff(l.organization_id) or exists (select 1 from public.teachers t where t.user_id = auth.uid() and t.organization_id = l.organization_id)))
    or (l.visibility = 'students' and (exists (select 1 from public.students s where s.user_id = auth.uid() and s.organization_id = l.organization_id) or private.is_staff(l.organization_id)))
    or (l.visibility = 'section' and (private.teaches_section(l.section_id) or private.enrolled_in_section(l.section_id)))
    or (l.visibility = 'people' and (auth.uid() = any (l.users)
         or exists (select 1 from public.people_group_members m where m.group_id = any (l.groups) and m.user_id = auth.uid())))))
$$;

drop policy if exists al_read on public.app_links;
create policy al_read on public.app_links for select to authenticated using (private.app_link_visible(app_links) or private.is_owner(organization_id));
-- Crear: cualquiera puede crear los suyos; para la institución, estudiantes o personal hay que ser personal o profesor
drop policy if exists al_insert on public.app_links;
create policy al_insert on public.app_links for insert to authenticated with check (
  owner_id = auth.uid() and private.is_member(organization_id)
  and (visibility in ('private', 'people')
       or (visibility = 'section' and private.teaches_section(section_id))
       or private.is_staff(organization_id)
       or exists (select 1 from public.teachers t where t.user_id = auth.uid() and t.organization_id = app_links.organization_id)));
drop policy if exists al_update on public.app_links;
create policy al_update on public.app_links for update to authenticated
  using (owner_id = auth.uid() or private.is_owner(organization_id))
  with check (private.is_member(organization_id) and (visibility in ('private', 'people')
       or (visibility = 'section' and private.teaches_section(section_id))
       or private.is_staff(organization_id)
       or exists (select 1 from public.teachers t where t.user_id = auth.uid() and t.organization_id = app_links.organization_id)));
drop policy if exists al_delete on public.app_links;
create policy al_delete on public.app_links for delete to authenticated using (owner_id = auth.uid() or private.is_owner(organization_id));
