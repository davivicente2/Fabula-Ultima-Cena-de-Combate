-- Multiple scenes per room.
-- Each member has an active battle/scene. The host can create scenes and move
-- combatants between them without moving the rest of the room.

alter table public.room_members
  add column if not exists active_battle_id uuid
    references public.battles(id) on delete set null;

create index if not exists room_members_active_battle_idx
  on public.room_members (active_battle_id);

-- Point existing memberships at the oldest battle in their room.
update public.room_members
set active_battle_id = coalesce(
  active_battle_id,
  (
    select battles.id
    from public.battles
    where battles.room_id = room_members.room_id
    order by battles.created_at
    limit 1
  )
)
where active_battle_id is null;

create or replace function private.reconcile_battle_turn(
  p_battle_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $reconcile$
declare
  v_started boolean;
  v_round integer;
  v_initiative text;
  v_current text;
  v_other text;
  v_current_has_turn boolean;
  v_other_has_turn boolean;
  v_initiative_has_living boolean;
  v_other_initiative_has_living boolean;
  v_any_living boolean;
begin
  select
    battles.conflict_started,
    battles.round_number,
    battles.initiative_side,
    battles.current_side
  into
    v_started,
    v_round,
    v_initiative,
    v_current
  from public.battles
  where battles.id = p_battle_id
  for update;

  if not coalesce(v_started, false) then
    return;
  end if;

  select exists (
    select 1
    from public.combatants
    where combatants.battle_id = p_battle_id
      and combatants.hp > 0
  )
  into v_any_living;

  if not v_any_living then
    update public.battles
    set
      conflict_started = false,
      current_side = null,
      turn_revision = turn_revision + 1
    where id = p_battle_id;
    return;
  end if;

  v_other := case
    when v_current = 'heroes' then 'enemies'
    else 'heroes'
  end;

  select exists (
    select 1
    from public.combatants
    where combatants.battle_id = p_battle_id
      and combatants.side = v_current
      and combatants.hp > 0
      and combatants.last_acted_round < v_round
  )
  into v_current_has_turn;

  if v_current_has_turn then
    update public.battles
    set turn_revision = turn_revision + 1
    where id = p_battle_id;
    return;
  end if;

  select exists (
    select 1
    from public.combatants
    where combatants.battle_id = p_battle_id
      and combatants.side = v_other
      and combatants.hp > 0
      and combatants.last_acted_round < v_round
  )
  into v_other_has_turn;

  if v_other_has_turn then
    update public.battles
    set
      current_side = v_other,
      turn_revision = turn_revision + 1
    where id = p_battle_id;
    return;
  end if;

  -- Everyone who can act in this battle has acted; advance the round.
  v_round := v_round + 1;

  select exists (
    select 1
    from public.combatants
    where combatants.battle_id = p_battle_id
      and combatants.side = v_initiative
      and combatants.hp > 0
  )
  into v_initiative_has_living;

  select exists (
    select 1
    from public.combatants
    where combatants.battle_id = p_battle_id
      and combatants.side <> v_initiative
      and combatants.hp > 0
  )
  into v_other_initiative_has_living;

  update public.battles
  set
    round_number = v_round,
    current_side = case
      when v_initiative_has_living then v_initiative
      when v_other_initiative_has_living then
        case when v_initiative = 'heroes' then 'enemies' else 'heroes' end
      else null
    end,
    conflict_started = v_initiative_has_living or v_other_initiative_has_living,
    turn_revision = turn_revision + 1
  where id = p_battle_id;
end;
$reconcile$;

revoke all on function private.reconcile_battle_turn(uuid)
  from public, anon, authenticated;

create or replace function public.create_battle_scene(
  p_room_id uuid,
  p_name text default 'Nova cena'
)
returns table (
  battle_id uuid,
  battle_name text
)
language plpgsql
security definer
set search_path = ''
as $create_scene$
declare
  v_user_id uuid := auth.uid();
  v_battle_id uuid;
  v_name text := coalesce(nullif(trim(p_name), ''), 'Nova cena');
begin
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;

  if not private.is_room_host(p_room_id) then
    raise exception 'Apenas o GM pode criar cenas.';
  end if;

  insert into public.battles (
    owner_id,
    room_id,
    name
  )
  values (
    v_user_id,
    p_room_id,
    v_name
  )
  returning id into v_battle_id;

  update public.room_members
  set active_battle_id = v_battle_id
  where room_id = p_room_id
    and user_id = v_user_id;

  return query
  select v_battle_id, v_name;
end;
$create_scene$;

revoke all on function public.create_battle_scene(uuid, text)
  from public, anon;
grant execute on function public.create_battle_scene(uuid, text)
  to authenticated;

create or replace function public.set_my_active_battle(
  p_battle_id uuid
)
returns table (
  battle_id uuid,
  battle_name text,
  room_id uuid
)
language plpgsql
security definer
set search_path = ''
as $set_scene$
declare
  v_user_id uuid := auth.uid();
  v_room_id uuid;
  v_name text;
begin
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;

  select battles.room_id, battles.name
  into v_room_id, v_name
  from public.battles
  where battles.id = p_battle_id;

  if v_room_id is null then
    raise exception 'Cena não encontrada.';
  end if;

  if not private.is_room_member(v_room_id) then
    raise exception 'Você não pertence a esta sala.';
  end if;

  update public.room_members
  set active_battle_id = p_battle_id
  where room_id = v_room_id
    and user_id = v_user_id;

  return query
  select p_battle_id, v_name, v_room_id;
end;
$set_scene$;

revoke all on function public.set_my_active_battle(uuid)
  from public, anon;
grant execute on function public.set_my_active_battle(uuid)
  to authenticated;

create or replace function public.move_combatant_to_battle(
  p_combatant_id uuid,
  p_destination_battle_id uuid
)
returns table (
  combatant_id uuid,
  source_battle_id uuid,
  destination_battle_id uuid,
  controller_user_id uuid
)
language plpgsql
security definer
set search_path = ''
as $move_combatant$
declare
  v_source_battle_id uuid;
  v_source_room_id uuid;
  v_destination_room_id uuid;
  v_controller_user_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  select
    combatants.battle_id,
    battles.room_id,
    combatants.controller_user_id
  into
    v_source_battle_id,
    v_source_room_id,
    v_controller_user_id
  from public.combatants
  join public.battles on battles.id = combatants.battle_id
  where combatants.id = p_combatant_id
  for update of combatants;

  if v_source_battle_id is null then
    raise exception 'Combatente não encontrado.';
  end if;

  select battles.room_id
  into v_destination_room_id
  from public.battles
  where battles.id = p_destination_battle_id
  for update;

  if v_destination_room_id is null then
    raise exception 'Cena de destino não encontrada.';
  end if;

  if v_source_room_id <> v_destination_room_id then
    raise exception 'Só é possível mover combatentes entre cenas da mesma sala.';
  end if;

  if not private.is_room_host(v_source_room_id) then
    raise exception 'Apenas o GM pode mover combatentes entre cenas.';
  end if;

  if v_source_battle_id = p_destination_battle_id then
    return query
    select
      p_combatant_id,
      v_source_battle_id,
      p_destination_battle_id,
      v_controller_user_id;
    return;
  end if;

  update public.combatants
  set
    battle_id = p_destination_battle_id,
    last_acted_round = 0,
    guard_started_round = null,
    is_active = false
  where id = p_combatant_id;

  -- The assigned player follows their character to the new scene. Other
  -- members remain in their current scene.
  if v_controller_user_id is not null then
    update public.room_members
    set active_battle_id = p_destination_battle_id
    where room_id = v_source_room_id
      and user_id = v_controller_user_id;
  end if;

  perform private.reconcile_battle_turn(v_source_battle_id);
  perform private.reconcile_battle_turn(p_destination_battle_id);

  return query
  select
    p_combatant_id,
    v_source_battle_id,
    p_destination_battle_id,
    v_controller_user_id;
end;
$move_combatant$;

revoke all on function public.move_combatant_to_battle(uuid, uuid)
  from public, anon;
grant execute on function public.move_combatant_to_battle(uuid, uuid)
  to authenticated;

-- Existing room creation now stores the first active scene for the host.
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

  insert into public.rooms (host_id, name)
  values (v_user_id, v_battle_name)
  returning id, code into v_room_id, v_room_code;

  insert into public.room_members (room_id, user_id, role)
  values (v_room_id, v_user_id, 'host');

  insert into public.battles (owner_id, room_id, name)
  values (v_user_id, v_room_id, v_battle_name)
  returning id into v_battle_id;

  update public.room_members
  set active_battle_id = v_battle_id
  where room_id = v_room_id
    and user_id = v_user_id;

  return query
  select v_room_id, v_room_code, v_battle_id, v_battle_name;
end;
$create_room$;

-- Joining a room returns the member's active scene when possible.
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
  from public.room_members
  join public.battles
    on battles.id = room_members.active_battle_id
  where room_members.room_id = v_room_id
    and room_members.user_id = v_user_id
    and battles.room_id = v_room_id;

  if v_battle_id is null then
    select battles.id, battles.name
    into v_battle_id, v_battle_name
    from public.battles
    where battles.room_id = v_room_id
    order by battles.created_at
    limit 1;

    if v_battle_id is null then
      raise exception 'A sala não possui uma cena.';
    end if;

    update public.room_members
    set active_battle_id = v_battle_id
    where room_id = v_room_id
      and user_id = v_user_id;
  end if;

  return query
  select v_room_id, v_room_code, v_battle_id, v_battle_name;
end;
$join_room$;

revoke all on function public.create_room_with_battle(text) from public, anon;
revoke all on function public.join_room(text) from public, anon;
grant execute on function public.create_room_with_battle(text) to authenticated;
grant execute on function public.join_room(text) to authenticated;

do $publication$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'room_members'
  ) then
    execute 'alter publication supabase_realtime add table public.room_members';
  end if;
end
$publication$;
