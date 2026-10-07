-- Prevent stale turn actions from being accepted after fast concurrent input.
-- Every turn-consuming request must match the battle revision observed by the
-- client. The battle row is locked while the revision is checked.

alter table public.battles
  add column if not exists turn_revision bigint not null default 0
    check (turn_revision >= 0);

create or replace function private.assert_turn_revision(
  p_battle_id uuid,
  p_expected_revision bigint
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_revision bigint;
begin
  if p_expected_revision is null then
    raise exception 'Revisão de turno obrigatória.';
  end if;

  select battles.turn_revision
  into v_revision
  from public.battles
  where battles.id = p_battle_id
  for update;

  if v_revision is null then
    raise exception 'Batalha não encontrada.';
  end if;

  if v_revision <> p_expected_revision then
    raise exception 'Estado de turno desatualizado. Aguarde a sincronização e tente novamente.';
  end if;
end;
$$;

revoke all on function private.assert_turn_revision(uuid, bigint)
  from public, anon, authenticated;

-- Wrap the existing authoritative actions with an optimistic revision check.
create or replace function public.perform_guard(
  p_combatant_id uuid,
  p_expected_revision bigint
)
returns table (
  battle_id uuid,
  combatant_id uuid,
  acted_round integer,
  next_round integer,
  next_side text,
  next_revision bigint
)
language plpgsql
security definer
set search_path = ''
as $
declare
  v_battle_id uuid;
  v_result record;
  v_next_revision bigint;
begin
  select combatants.battle_id
  into v_battle_id
  from public.combatants
  where combatants.id = p_combatant_id;

  if v_battle_id is null then
    raise exception 'Combatente não encontrado.';
  end if;

  perform private.assert_turn_revision(
    v_battle_id,
    p_expected_revision
  );

  select *
  into v_result
  from public.perform_guard(p_combatant_id);

  update public.battles
  set turn_revision = turn_revision + 1
  where id = v_battle_id
  returning turn_revision into v_next_revision;

  return query
  select
    v_result.battle_id,
    v_result.combatant_id,
    v_result.acted_round,
    v_result.next_round,
    v_result.next_side,
    v_next_revision;
end;
$;

create or replace function public.end_combatant_turn(
  p_combatant_id uuid,
  p_expected_revision bigint
)
returns table (
  battle_id uuid,
  combatant_id uuid,
  acted_round integer,
  next_round integer,
  next_side text,
  next_revision bigint
)
language plpgsql
security definer
set search_path = ''
as $
declare
  v_battle_id uuid;
  v_result record;
  v_next_revision bigint;
begin
  select combatants.battle_id
  into v_battle_id
  from public.combatants
  where combatants.id = p_combatant_id;

  if v_battle_id is null then
    raise exception 'Combatente não encontrado.';
  end if;

  perform private.assert_turn_revision(
    v_battle_id,
    p_expected_revision
  );

  select *
  into v_result
  from public.end_combatant_turn(p_combatant_id);

  update public.battles
  set turn_revision = turn_revision + 1
  where id = v_battle_id
  returning turn_revision into v_next_revision;

  return query
  select
    v_result.battle_id,
    v_result.combatant_id,
    v_result.acted_round,
    v_result.next_round,
    v_result.next_side,
    v_next_revision;
end;
$;

create or replace function public.perform_combatant_attack(
  p_attack_id uuid,
  p_target_id uuid,
  p_expected_revision bigint
)
returns table (
  action_id uuid,
  attacker_id uuid,
  target_id uuid,
  attack_name text,
  roll_a integer,
  roll_b integer,
  check_total integer,
  high_roll integer,
  target_defense integer,
  is_hit boolean,
  is_critical boolean,
  is_fumble boolean,
  damage integer,
  damage_type text,
  damage_affinity text,
  previous_hp integer,
  resulting_hp integer,
  acted_round integer,
  next_round integer,
  next_side text,
  next_revision bigint
)
language plpgsql
security definer
set search_path = ''
as $
declare
  v_battle_id uuid;
  v_attacker_id uuid;
  v_result record;
  v_acted_round integer;
  v_next_round integer;
  v_next_side text;
  v_next_revision bigint;
begin
  select combatants.battle_id, combatants.id
  into v_battle_id, v_attacker_id
  from public.combatant_attacks
  join public.combatants
    on combatants.id = combatant_attacks.combatant_id
  where combatant_attacks.id = p_attack_id;

  if v_battle_id is null then
    raise exception 'Ataque não encontrado.';
  end if;

  perform private.assert_turn_revision(
    v_battle_id,
    p_expected_revision
  );

  select *
  into v_result
  from public.perform_combatant_attack(
    p_attack_id,
    p_target_id
  );

  select combatants.last_acted_round
  into v_acted_round
  from public.combatants
  where combatants.id = v_attacker_id;

  select battles.round_number, battles.current_side
  into v_next_round, v_next_side
  from public.battles
  where battles.id = v_battle_id;

  update public.battles
  set turn_revision = turn_revision + 1
  where id = v_battle_id
  returning turn_revision into v_next_revision;

  return query
  select
    v_result.action_id,
    v_result.attacker_id,
    v_result.target_id,
    v_result.attack_name,
    v_result.roll_a,
    v_result.roll_b,
    v_result.check_total,
    v_result.high_roll,
    v_result.target_defense,
    v_result.is_hit,
    v_result.is_critical,
    v_result.is_fumble,
    v_result.damage,
    v_result.damage_type,
    v_result.damage_affinity,
    v_result.previous_hp,
    v_result.resulting_hp,
    v_acted_round,
    v_next_round,
    v_next_side,
    v_next_revision;
end;
$;

-- Stale clients must not be able to bypass the revision-aware overloads.
revoke execute on function public.perform_guard(uuid)
  from authenticated;
revoke execute on function public.end_combatant_turn(uuid)
  from authenticated;
revoke execute on function public.perform_combatant_attack(uuid, uuid)
  from authenticated;

revoke all on function public.perform_guard(uuid, bigint)
  from public, anon;
revoke all on function public.end_combatant_turn(uuid, bigint)
  from public, anon;
revoke all on function public.perform_combatant_attack(uuid, uuid, bigint)
  from public, anon;

grant execute on function public.perform_guard(uuid, bigint)
  to authenticated;
grant execute on function public.end_combatant_turn(uuid, bigint)
  to authenticated;
grant execute on function public.perform_combatant_attack(uuid, uuid, bigint)
  to authenticated;

-- Starting/stopping a conflict also invalidates outstanding turn requests.
create or replace function public.start_battle_turns(
  p_battle_id uuid,
  p_first_side text
)
returns table (
  battle_id uuid,
  conflict_started boolean,
  round_number integer,
  initiative_side text,
  current_side text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_room_id uuid;
  v_current_side text;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  if p_first_side not in ('heroes', 'enemies') then
    raise exception 'Lado inicial inválido.';
  end if;

  select battles.room_id
  into v_room_id
  from public.battles
  where battles.id = p_battle_id
  for update;

  if v_room_id is null then
    raise exception 'Batalha não encontrada.';
  end if;

  if not private.is_room_host(v_room_id) then
    raise exception 'Apenas o GM pode iniciar o conflito.';
  end if;

  if exists (
    select 1
    from public.combatants
    where combatants.battle_id = p_battle_id
      and combatants.side = p_first_side
      and combatants.hp > 0
  ) then
    v_current_side := p_first_side;
  elsif exists (
    select 1
    from public.combatants
    where combatants.battle_id = p_battle_id
      and combatants.side <> p_first_side
      and combatants.hp > 0
  ) then
    v_current_side := case
      when p_first_side = 'heroes' then 'enemies'
      else 'heroes'
    end;
  else
    raise exception 'Não há combatentes aptos a agir.';
  end if;

  update public.combatants
  set
    last_acted_round = 0,
    guard_started_round = null
  where combatants.battle_id = p_battle_id;

  update public.battles
  set
    conflict_started = true,
    round_number = 1,
    initiative_side = p_first_side,
    current_side = v_current_side,
    turn_revision = turn_revision + 1
  where id = p_battle_id;

  return query
  select p_battle_id, true, 1, p_first_side, v_current_side;
end;
$$;

create or replace function public.stop_battle_turns(
  p_battle_id uuid
)
returns table (
  battle_id uuid,
  conflict_started boolean,
  round_number integer,
  initiative_side text,
  current_side text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_room_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  select battles.room_id
  into v_room_id
  from public.battles
  where battles.id = p_battle_id
  for update;

  if v_room_id is null then
    raise exception 'Batalha não encontrada.';
  end if;

  if not private.is_room_host(v_room_id) then
    raise exception 'Apenas o GM pode encerrar o conflito.';
  end if;

  update public.battles
  set
    conflict_started = false,
    round_number = 0,
    initiative_side = null,
    current_side = null,
    turn_revision = turn_revision + 1
  where id = p_battle_id;

  update public.combatants
  set
    last_acted_round = 0,
    guard_started_round = null
  where combatants.battle_id = p_battle_id;

  return query
  select p_battle_id, false, 0, null::text, null::text;
end;
$$;
