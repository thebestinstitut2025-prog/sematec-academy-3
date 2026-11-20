-- =====================================================================
-- Publicaciones del sitio web: noticias, fotos, videos, mensajes y eventos
-- con galería de fotos y videos (subidos o de YouTube / Vimeo).
-- Los visitantes ven solo lo publicado; la administración lo maneja en /app/sitio/publicaciones.
-- =====================================================================

create table if not exists public.site_posts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  kind text not null default 'noticia' check (kind in ('noticia', 'foto', 'video', 'mensaje', 'evento')),
  title text not null check (length(btrim(title)) between 2 and 160),
  body text check (body is null or length(body) <= 20000),
  video_url text check (video_url is null or video_url ~* '^https://'),
  published boolean not null default true,
  pinned boolean not null default false,
  published_at timestamptz not null default now(),
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists site_posts_org_idx on public.site_posts (organization_id, published, pinned desc, published_at desc);

create table if not exists public.site_post_media (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  post_id uuid not null references public.site_posts (id) on delete cascade,
  file_id uuid not null references public.user_files (id) on delete cascade,
  position int not null default 0,
  created_at timestamptz not null default now(),
  unique (post_id, file_id)
);
create index if not exists site_post_media_post_idx on public.site_post_media (post_id, position);

alter table public.site_posts enable row level security;
alter table public.site_post_media enable row level security;

drop policy if exists site_posts_staff on public.site_posts;
create policy site_posts_staff on public.site_posts for all to authenticated
  using (private.has_permission(organization_id, 'settings.admin'))
  with check (private.has_permission(organization_id, 'settings.admin'));
drop policy if exists site_post_media_staff on public.site_post_media;
create policy site_post_media_staff on public.site_post_media for all to authenticated
  using (private.has_permission(organization_id, 'settings.admin'))
  with check (private.has_permission(organization_id, 'settings.admin')
              and exists (select 1 from public.user_files u where u.id = file_id and u.owner_id = auth.uid() and u.deleted_at is null));
grant select, insert, update, delete on public.site_posts, public.site_post_media to authenticated;
grant all on public.site_posts, public.site_post_media to service_role;

create or replace function private.site_posts_touch() returns trigger language plpgsql set search_path = '' as $$
begin new.updated_at := now(); return new; end $$;
drop trigger if exists trg_site_posts_touch on public.site_posts;
create trigger trg_site_posts_touch before update on public.site_posts for each row execute function private.site_posts_touch();

-- Publicaciones visibles para cualquier visitante (con sus fotos y videos)
create or replace function public.public_site_posts(p_org uuid, p_limit int default 24, p_kind text default null, p_id uuid default null)
returns table (id uuid, kind text, title text, body text, video_url text, pinned boolean, published_at timestamptz, media jsonb)
language sql stable security definer set search_path = '' as $$
  select p.id, p.kind, p.title, p.body, p.video_url, p.pinned, p.published_at,
         coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'name', u.name, 'mime', u.mime_type) order by m.position, m.created_at)
                     from public.site_post_media m join public.user_files u on u.id = m.file_id and u.deleted_at is null
                    where m.post_id = p.id), '[]'::jsonb)
    from public.site_posts p
   where p.organization_id = p_org and p.published and p.published_at <= now()
     and (p_kind is null or p.kind = p_kind) and (p_id is null or p.id = p_id)
   order by p.pinned desc, p.published_at desc
   limit least(greatest(coalesce(p_limit, 24), 1), 200)
$$;
grant execute on function public.public_site_posts(uuid, int, text, uuid) to anon, authenticated;

-- Ruta del archivo de una foto o video publicado (solo el servidor, para servirlo al visitante)
create or replace function public.public_site_media(p_media uuid)
returns table (storage_path text, mime_type text, name text)
language sql stable security definer set search_path = '' as $$
  select u.storage_path, u.mime_type, u.name
    from public.site_post_media m join public.site_posts p on p.id = m.post_id
    join public.user_files u on u.id = m.file_id and u.deleted_at is null
   where m.id = p_media and p.published and p.published_at <= now()
$$;
revoke all on function public.public_site_media(uuid) from public, anon, authenticated;
grant execute on function public.public_site_media(uuid) to service_role;

-- Vista previa para la administración (también borradores)
create or replace function public.staff_site_media(p_media uuid)
returns table (storage_path text, mime_type text, name text)
language sql stable security definer set search_path = '' as $$
  select u.storage_path, u.mime_type, u.name
    from public.site_post_media m join public.user_files u on u.id = m.file_id and u.deleted_at is null
   where m.id = p_media and private.has_permission(m.organization_id, 'settings.admin')
$$;
revoke all on function public.staff_site_media(uuid) from public, anon;
grant execute on function public.staff_site_media(uuid) to authenticated;
