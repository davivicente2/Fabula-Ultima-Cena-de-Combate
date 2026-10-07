-- Persist a display name for each room member.
-- Realtime Presence itself remains ephemeral; this identity survives reloads.

alter table public.room_members
  add column if not exists display_name text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'room_members_display_name_length'
      and conrelid = 'public.room_members'::regclass
  ) then
    alter table public.room_members
      add constraint room_members_display_name_length
      check (
        display_name is null
        or char_length(trim(display_name)) between 1 and 32
      );
  end if;
end
$$;

create or replace function public.set_my_room_display_name(
  p_room_id uuid,
  p_display_name text
)
returns table (
  user_id uuid,
  role text,
  display_name text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_display_name text := trim(p_display_name);
begin
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;

  if char_length(v_display_name) < 1 or char_length(v_display_name) > 32 then
    raise exception 'O nome deve ter entre 1 e 32 caracteres.';
  end if;

  return query
  update public.room_members as members
  set display_name = v_display_name
  where members.room_id = p_room_id
    and members.user_id = v_user_id
  returning members.user_id, members.role, members.display_name;

  if not found then
    raise exception 'Você não faz parte desta sala.';
  end if;
end;
$$;

revoke all on function public.set_my_room_display_name(uuid, text)
  from public, anon;
grant execute on function public.set_my_room_display_name(uuid, text)
  to authenticated;
