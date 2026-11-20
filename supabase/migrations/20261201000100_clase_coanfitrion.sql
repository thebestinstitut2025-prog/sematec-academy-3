-- =====================================================================
-- Clases en vivo: co-anfitrión. El anfitrión (o un moderador) puede nombrar a un
-- participante como co-anfitrión durante la clase y quitárselo después.
-- =====================================================================
alter table public.conference_participants add column if not exists prev_role public.conference_role;

create or replace function public.conference_set_cohost(p_session uuid, p_user uuid, p_on boolean)
returns text language plpgsql security definer set search_path = '' as $$
declare s record; r record;
begin
  if not public.conference_is_moderator(p_session) then
    raise exception 'Solo el anfitrión o un moderador puede hacer esto.' using errcode = '42501';
  end if;
  if p_user = auth.uid() then raise exception 'No puede cambiar su propio rol.' using errcode = '22023'; end if;
  select id, organization_id into s from public.conference_sessions where id = p_session;
  if s.id is null then raise exception 'Sesión no encontrada' using errcode = 'P0002'; end if;
  select * into r from public.conference_participants where session_id = p_session and user_id = p_user;
  if p_on then
    if r.id is null then
      insert into public.conference_participants (organization_id, session_id, user_id, role, prev_role, added_by)
      values (s.organization_id, p_session, p_user, 'moderator', 'attendee', auth.uid());
    elsif r.role in ('organizer', 'teacher', 'moderator') then
      return r.role::text;  -- ya modera
    else
      update public.conference_participants set prev_role = role, role = 'moderator' where id = r.id;
    end if;
    return 'moderator';
  else
    if r.id is null or r.role <> 'moderator' or r.prev_role is null then
      raise exception 'Esa persona no es co-anfitrión de esta clase.' using errcode = '22023';
    end if;
    update public.conference_participants set role = prev_role, prev_role = null where id = r.id;
    return r.prev_role::text;
  end if;
end $$;
revoke all on function public.conference_set_cohost(uuid, uuid, boolean) from public, anon;
grant execute on function public.conference_set_cohost(uuid, uuid, boolean) to authenticated;
