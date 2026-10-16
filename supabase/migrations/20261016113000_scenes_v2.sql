-- Scene navigation v2.
-- The physical table remains "battles" for compatibility, but a battle row now
-- represents a persistent room scene that may or may not have an active conflict.
-- Characters remain persistent records; combatants are their current scene instances.

alter table public.room_members
  add column if not exists active_battle_id uuid
    references public.battles(id) on delete set null;

create index if not exists room_members_active_battle_idx
  on public.room_members (active_battle_id);

-- Repair any stale active-scene pointer left by older experiments.
update public.room_members as members
set active_battle_id = null
where members.active_battle_id is not null
  and not exists (
    select 1
    from public.battles as battles
    where battles.id = members.active_battle_id
      and battles.room_id = members.room_id
  );

-- Existing members start in the oldest scene of their room.
update public.room_members as members
set active_battle_id = (
  select battles.id
  from public.battles as battles
  where battles.room_id = members.room_id
  order by battles.created_at
  limit 1
)
where members.active_battle_id is null;

create or replace function private.validate_member_active_scene()
returns trigger
language plpgsql
security definer
set search_path = ''
as $validate_active_scene$
begin
  if new.active_battle_id is null then
    return new;
  end if;

  if not exists (
    select 1
    from public.battles as battles
    where battles.id = new.active_battle_id
      and battles.room_id = new.room_id
  ) then
    raise exception 'A cena ativa precisa pertencer à mesma sala.';
  end if;

  return new;
end;
$validate_active_scene$;

revoke all on function private.validate_member_active_scene()
  from public, anon, authenticated;

drop trigger if exists validate_member_active_scene
  on public.room_members;

create trigger validate_member_active_scene
before insert or update of active_battle_id, room_id
on public.room_members
for each row
execute function private.validate_member_active_scene();

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

  if char_length(v_name) > 64 then
    raise exception 'O nome da cena deve ter no máximo 64 caracteres.';
  end if;

  insert into public.battles as battles (
    owner_id,
    room_id,
    name
  )
  values (
    v_user_id,
    p_room_id,
    v_name
  )
  returning battles.id into v_battle_id;

  update public.room_members as members
  set active_battle_id = v_battle_id
  where members.room_id = p_room_id
    and members.user_id = v_user_id;

  return query
  select v_battle_id, v_name;
end;
$create_scene$;

revoke all on function public.create_battle_scene(uuid, text)
  from public, anon;
grant execute on function public.create_battle_scene(uuid, text)
  to authenticated;

create or replace function public.rename_battle_scene(
  p_battle_id uuid,
  p_name text
)
returns table (
  battle_id uuid,
  battle_name text
)
language plpgsql
security definer
set search_path = ''
as $rename_scene$
declare
  v_room_id uuid;
  v_name text := nullif(trim(p_name), '');
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  select battles.room_id
  into v_room_id
  from public.battles as battles
  where battles.id = p_battle_id;

  if v_room_id is null then
    raise exception 'Cena não encontrada.';
  end if;

  if not private.is_room_host(v_room_id) then
    raise exception 'Apenas o GM pode renomear cenas.';
  end if;

  if v_name is null or char_length(v_name) > 64 then
    raise exception 'O nome da cena deve ter entre 1 e 64 caracteres.';
  end if;

  update public.battles as battles
  set name = v_name
  where battles.id = p_battle_id;

  return query
  select p_battle_id, v_name;
end;
$rename_scene$;

revoke all on function public.rename_battle_scene(uuid, text)
  from public, anon;
grant execute on function public.rename_battle_scene(uuid, text)
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
  from public.battles as battles
  where battles.id = p_battle_id;

  if v_room_id is null then
    raise exception 'Cena não encontrada.';
  end if;

  if not private.is_room_member(v_room_id) then
    raise exception 'Você não pertence a esta sala.';
  end if;

  update public.room_members as members
  set active_battle_id = p_battle_id
  where members.room_id = v_room_id
    and members.user_id = v_user_id;

  if not found then
    raise exception 'Sua participação na sala não foi encontrada.';
  end if;

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
  v_source_conflict boolean;
  v_destination_conflict boolean;
  v_controller_user_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  select
    combatants.battle_id,
    battles.room_id,
    battles.conflict_started,
    combatants.controller_user_id
  into
    v_source_battle_id,
    v_source_room_id,
    v_source_conflict,
    v_controller_user_id
  from public.combatants as combatants
  join public.battles as battles
    on battles.id = combatants.battle_id
  where combatants.id = p_combatant_id
  for update of combatants;

  if v_source_battle_id is null then
    raise exception 'Combatente não encontrado.';
  end if;

  select
    battles.room_id,
    battles.conflict_started
  into
    v_destination_room_id,
    v_destination_conflict
  from public.battles as battles
  where battles.id = p_destination_battle_id
  for update;

  if v_destination_room_id is null then
    raise exception 'Cena de destino não encontrada.';
  end if;

  if v_source_room_id <> v_destination_room_id then
    raise exception 'Só é possível mover combatentes entre cenas da mesma sala.';
  end if;

  if not private.is_room_host(v_source_room_id) then
    raise exception 'Apenas o GM pode mover participantes entre cenas.';
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

  -- Moving a participant while either conflict is running creates ambiguous
  -- turn state. Keep the alpha deterministic: end conflicts before moving.
  if coalesce(v_source_conflict, false)
    or coalesce(v_destination_conflict, false)
  then
    raise exception 'Encerre os conflitos das duas cenas antes de mover participantes.';
  end if;

  update public.combatants as combatants
  set
    battle_id = p_destination_battle_id,
    last_acted_round = 0,
    guard_started_round = null,
    is_active = false
  where combatants.id = p_combatant_id;

  -- The assigned player follows their character. Everyone else stays put.
  if v_controller_user_id is not null then
    update public.room_members as members
    set active_battle_id = p_destination_battle_id
    where members.room_id = v_source_room_id
      and members.user_id = v_controller_user_id;
  end if;

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

-- New rooms point the host at their first scene immediately.
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

  insert into public.room_members (
    room_id,
    user_id,
    role,
    active_battle_id
  )
  values (
    v_room_id,
    v_user_id,
    'host',
    null
  );

  insert into public.battles as battles_row (
    owner_id,
    room_id,
    name
  )
  values (
    v_user_id,
    v_room_id,
    v_battle_name
  )
  returning battles_row.id into v_battle_id;

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

  insert into public.room_members (
    room_id,
    user_id,
    role
  )
  values (
    v_room_id,
    v_user_id,
    'player'
  )
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

revoke all on function public.create_room_with_battle(text)
  from public, anon;
revoke all on function public.join_room(text)
  from public, anon;
grant execute on function public.create_room_with_battle(text)
  to authenticated;
grant execute on function public.join_room(text)
  to authenticated;

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
