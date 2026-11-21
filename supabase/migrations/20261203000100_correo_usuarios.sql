-- =====================================================================
-- ✉ Correo para todos los usuarios: cada persona escribe correos a cualquier
-- dirección (con archivos), ve los que envió y su estado. Límite diario para evitar abusos.
-- =====================================================================

-- Cada persona ve los correos que ella envió
drop policy if exists mail_log_own on public.mail_log;
create policy mail_log_own on public.mail_log for select to authenticated using (sent_by = auth.uid());

-- ¿Puede enviar otro correo hoy? (personal con permisos: 200 al día; demás: 30 al día)
create or replace function public.mail_compose_allowed(p_recipients int)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_staff boolean; v_limit int; v_used int;
begin
  if auth.uid() is null then raise exception 'Inicie sesión' using errcode = '42501'; end if;
  if not private.current_user_active() then raise exception 'Su cuenta no está activa.' using errcode = '42501'; end if;
  v_staff := exists (select 1 from public.memberships m join public.role_permissions rp on rp.role_id = m.role_id
                      where m.user_id = auth.uid() and m.status = 'active');
  v_limit := case when v_staff then 200 else 30 end;
  select count(*) into v_used from public.mail_log where sent_by = auth.uid() and kind = 'correo' and created_at > now() - interval '1 day';
  return jsonb_build_object('ok', v_used + greatest(p_recipients, 1) <= v_limit, 'used', v_used, 'limit', v_limit);
end $$;
revoke all on function public.mail_compose_allowed(int) from public, anon;
grant execute on function public.mail_compose_allowed(int) to authenticated;

-- Rutas de archivos propios para adjuntarlos al correo (solo los de quien envía)
create or replace function public.my_file_paths(p_ids uuid[])
returns table (id uuid, name text, mime_type text, size_bytes bigint, storage_path text)
language sql stable security definer set search_path = '' as $$
  select u.id, u.name, u.mime_type, u.size_bytes::bigint, u.storage_path
    from public.user_files u where u.id = any (p_ids) and u.owner_id = auth.uid() and u.deleted_at is null
$$;
revoke all on function public.my_file_paths(uuid[]) from public, anon;
grant execute on function public.my_file_paths(uuid[]) to authenticated;
