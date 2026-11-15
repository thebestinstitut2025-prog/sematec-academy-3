-- =====================================================================
-- Mi cuenta: cada persona cambia su correo de acceso (con su contraseña y confirmación por correo)
-- =====================================================================

-- Solicitudes de cambio de correo (solo el servidor las lee: RLS sin políticas)
create table if not exists public.email_change_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  new_email text not null,
  token_hash text not null unique,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);
alter table public.email_change_requests enable row level security;
revoke all on public.email_change_requests from anon, authenticated;
grant all on public.email_change_requests to service_role;

-- 🔑 Comprueba la contraseña actual de quien está conectado (máx. 8 intentos cada 15 minutos)
create or replace function public.verify_my_password(p_password text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare v_ok boolean;
begin
  if auth.uid() is null then raise exception 'Inicie sesión' using errcode = '42501'; end if;
  if private.rate_limited('verify_password', auth.uid()::text, 8, interval '15 minutes') then
    raise exception 'Demasiados intentos: espere 15 minutos.' using errcode = '54000';
  end if;
  select u.encrypted_password is not null and u.encrypted_password = extensions.crypt(coalesce(p_password, ''), u.encrypted_password)
    into v_ok from auth.users u where u.id = auth.uid();
  return coalesce(v_ok, false);
end $$;
revoke all on function public.verify_my_password(text) from public, anon;
grant execute on function public.verify_my_password(text) to authenticated;

-- Al cambiar el correo de acceso, se actualiza el perfil y las fichas que usaban el correo anterior
create or replace function private.sync_profile_email()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.email is distinct from old.email and new.email is not null then
    update public.profiles set email = new.email where id = new.id;
    update public.students set email = new.email where user_id = new.id and lower(coalesce(email, '')) = lower(coalesce(old.email, ''));
    update public.teachers set email = new.email where user_id = new.id and lower(coalesce(email, '')) = lower(coalesce(old.email, ''));
    update public.employees set email = new.email where user_id = new.id and lower(coalesce(email, '')) = lower(coalesce(old.email, ''));
  end if;
  return new;
end $$;
drop trigger if exists on_auth_user_email_changed on auth.users;
create trigger on_auth_user_email_changed after update of email on auth.users
for each row execute function private.sync_profile_email();
