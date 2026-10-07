-- Fix ambiguous PL/pgSQL reference in join_room.
-- Output parameters such as room_id are variables inside the function, so
-- ON CONFLICT (room_id, user_id) can be ambiguous. Refer to the named
-- primary-key constraint instead.

create or replace function public.join_room(p_code text)
returns table (
  room_id uuid,
  room_code text,
  battle_id uuid,
  battle_name text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_room_id uuid;
  v_room_code text;
  v_battle_id uuid;
  v_battle_name text;
begin
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;

  select rooms.id, rooms.code
  into v_room_id, v_room_code
  from public.rooms
  where upper(rooms.code) = upper(trim(p_code))
  limit 1;

  if v_room_id is null then
    raise exception 'Sala não encontrada.';
  end if;

  insert into public.room_members (room_id, user_id, role)
  values (v_room_id, v_user_id, 'player')
  on conflict on constraint room_members_pkey do nothing;

  select battles.id, battles.name
  into v_battle_id, v_battle_name
  from public.battles
  where battles.room_id = v_room_id
  order by battles.created_at
  limit 1;

  if v_battle_id is null then
    raise exception 'A sala não possui uma batalha.';
  end if;

  return query
  select v_room_id, v_room_code, v_battle_id, v_battle_name;
end;
$$;

revoke all on function public.join_room(text) from public, anon;
grant execute on function public.join_room(text) to authenticated;
