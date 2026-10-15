-- Fix PL/pgSQL ambiguity introduced by the multiple-scenes RPCs.
-- RETURNS TABLE creates output variables named room_id/battle_id, so column
-- references inside SQL statements must be explicitly qualified.

create or replace function public.create_room_with_battle(
  p_name text default 'Batalha de teste'
)
returns table (
  room_id uuid,
  room_code text,
  battle_id uuid,
  battle_name text
)
language plpgsql
security definer
set search_path = ''
as $create_room$
declare
  v_user_id uuid := auth.uid();
  v_room_id uuid;
  v_room_code text;
  v_battle_id uuid;
  v_battle_name text := coalesce(nullif(trim(p_name), ''), 'Batalha de teste');
begin
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;

  insert into public.rooms as rooms_row (host_id, name)
  values (v_user_id, v_battle_name)
  returning rooms_row.id, rooms_row.code
  into v_room_id, v_room_code;

  insert into public.room_members (room_id, user_id, role)
  values (v_room_id, v_user_id, 'host');

  insert into public.battles as battles_row (owner_id, room_id, name)
  values (v_user_id, v_room_id, v_battle_name)
  returning battles_row.id
  into v_battle_id;

  update public.room_members as members
  set active_battle_id = v_battle_id
  where members.room_id = v_room_id
    and members.user_id = v_user_id;

  return query
  select v_room_id, v_room_code, v_battle_id, v_battle_name;
end;
$create_room$;

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
as $join_room$
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

  select rooms_row.id, rooms_row.code
  into v_room_id, v_room_code
  from public.rooms as rooms_row
  where upper(rooms_row.code) = upper(trim(p_code))
  limit 1;

  if v_room_id is null then
    raise exception 'Sala não encontrada.';
  end if;

  insert into public.room_members (room_id, user_id, role)
  values (v_room_id, v_user_id, 'player')
  on conflict on constraint room_members_pkey do nothing;

  select battles_row.id, battles_row.name
  into v_battle_id, v_battle_name
  from public.room_members as members
  join public.battles as battles_row
    on battles_row.id = members.active_battle_id
  where members.room_id = v_room_id
    and members.user_id = v_user_id
    and battles_row.room_id = v_room_id;

  if v_battle_id is null then
    select battles_row.id, battles_row.name
    into v_battle_id, v_battle_name
    from public.battles as battles_row
    where battles_row.room_id = v_room_id
    order by battles_row.created_at
    limit 1;

    if v_battle_id is null then
      raise exception 'A sala não possui uma cena.';
    end if;

    update public.room_members as members
    set active_battle_id = v_battle_id
    where members.room_id = v_room_id
      and members.user_id = v_user_id;
  end if;

  return query
  select v_room_id, v_room_code, v_battle_id, v_battle_name;
end;
$join_room$;

revoke all on function public.create_room_with_battle(text) from public, anon;
revoke all on function public.join_room(text) from public, anon;
grant execute on function public.create_room_with_battle(text) to authenticated;
grant execute on function public.join_room(text) to authenticated;
