-- Add the Guard action.
-- Guard grants Resistance to all damage types until the start of the
-- combatant's next turn. Cover is intentionally deferred until attack range
-- (melee/ranged) is modeled.

alter table public.combatants
  add column if not exists guard_started_round integer
    check (guard_started_round is null or guard_started_round >= 1);

alter table public.combat_actions
  drop constraint if exists combat_actions_action_type_check;

alter table public.combat_actions
  add constraint combat_actions_action_type_check
  check (action_type in ('hp_adjustment', 'attack', 'turn_end', 'guard'));

alter table public.combat_actions
  add column if not exists guard_applied boolean;

-- Starting a combatant's next turn ends a previous Guard.
create or replace function private.consume_combatant_turn(
  p_battle_id uuid,
  p_combatant_id uuid
)
returns table (
  acted_round integer,
  next_round integer,
  next_side text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_round integer;
  v_first_side text;
  v_current_side text;
  v_actor_side text;
  v_last_acted_round integer;
  v_actor_hp integer;
  v_guard_started_round integer;
  v_other_side text;
  v_other_has_turn boolean;
  v_same_has_turn boolean;
  v_first_has_living boolean;
  v_other_first_has_living boolean;
  v_acted_round integer;
begin
  select
    battles.round_number,
    battles.initiative_side,
    battles.current_side
  into
    v_round,
    v_first_side,
    v_current_side
  from public.battles
  where battles.id = p_battle_id
    and battles.conflict_started = true
  for update;

  if v_round is null or v_round < 1 then
    raise exception 'O conflito ainda não foi iniciado.';
  end if;

  select
    combatants.side,
    combatants.last_acted_round,
    combatants.hp,
    combatants.guard_started_round
  into
    v_actor_side,
    v_last_acted_round,
    v_actor_hp,
    v_guard_started_round
  from public.combatants
  where combatants.id = p_combatant_id
    and combatants.battle_id = p_battle_id;

  if v_actor_side is null then
    raise exception 'Combatente não encontrado nesta batalha.';
  end if;

  if v_actor_hp <= 0 then
    raise exception 'Este combatente está com 0 HP e não pode agir.';
  end if;

  if v_actor_side <> v_current_side then
    raise exception 'Não é a vez deste lado.';
  end if;

  if v_last_acted_round >= v_round then
    raise exception 'Este combatente já agiu nesta rodada.';
  end if;

  -- Guard lasts through the waiting period and expires exactly when this
  -- combatant begins a later turn.
  if v_guard_started_round is not null
    and v_guard_started_round < v_round then
    update public.combatants
    set guard_started_round = null
    where id = p_combatant_id;
  end if;

  v_acted_round := v_round;

  update public.combatants
  set last_acted_round = v_round
  where id = p_combatant_id;

  v_other_side := case
    when v_actor_side = 'heroes' then 'enemies'
    else 'heroes'
  end;

  select exists (
    select 1
    from public.combatants
    where combatants.battle_id = p_battle_id
      and combatants.side = v_other_side
      and combatants.hp > 0
      and combatants.last_acted_round < v_round
  )
  into v_other_has_turn;

  select exists (
    select 1
    from public.combatants
    where combatants.battle_id = p_battle_id
      and combatants.side = v_actor_side
      and combatants.hp > 0
      and combatants.last_acted_round < v_round
  )
  into v_same_has_turn;

  if v_other_has_turn then
    v_current_side := v_other_side;
  elsif v_same_has_turn then
    v_current_side := v_actor_side;
  else
    v_round := v_round + 1;

    select exists (
      select 1
      from public.combatants
      where combatants.battle_id = p_battle_id
        and combatants.side = v_first_side
        and combatants.hp > 0
    )
    into v_first_has_living;

    select exists (
      select 1
      from public.combatants
      where combatants.battle_id = p_battle_id
        and combatants.side <> v_first_side
        and combatants.hp > 0
    )
    into v_other_first_has_living;

    if v_first_has_living then
      v_current_side := v_first_side;
    elsif v_other_first_has_living then
      v_current_side := case
        when v_first_side = 'heroes' then 'enemies'
        else 'heroes'
      end;
    else
      update public.battles
      set
        conflict_started = false,
        current_side = null
      where id = p_battle_id;

      return query
      select v_acted_round, v_round, null::text;
      return;
    end if;
  end if;

  update public.battles
  set
    round_number = v_round,
    current_side = v_current_side
  where id = p_battle_id;

  return query
  select v_acted_round, v_round, v_current_side;
end;
$$;

revoke all on function private.consume_combatant_turn(uuid, uuid)
  from public, anon, authenticated;

create or replace function public.perform_guard(
  p_combatant_id uuid
)
returns table (
  battle_id uuid,
  combatant_id uuid,
  acted_round integer,
  next_round integer,
  next_side text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_battle_id uuid;
  v_room_id uuid;
  v_controller_user_id uuid;
  v_name text;
  v_hp integer;
  v_turn record;
  v_actor_display_name text;
begin
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;

  select
    combatants.battle_id,
    battles.room_id,
    combatants.controller_user_id,
    combatants.name,
    combatants.hp
  into
    v_battle_id,
    v_room_id,
    v_controller_user_id,
    v_name,
    v_hp
  from public.combatants
  join public.battles on battles.id = combatants.battle_id
  where combatants.id = p_combatant_id;

  if v_battle_id is null then
    raise exception 'Combatente não encontrado.';
  end if;

  if not (
    private.is_room_host(v_room_id)
    or (
      v_controller_user_id = v_user_id
      and private.is_room_member(v_room_id)
    )
  ) then
    raise exception 'Você não controla este combatente.';
  end if;

  select *
  into v_turn
  from private.consume_combatant_turn(v_battle_id, p_combatant_id);

  update public.combatants
  set guard_started_round = v_turn.acted_round
  where id = p_combatant_id;

  select coalesce(
    nullif(trim(room_members.display_name), ''),
    case when room_members.role = 'host' then 'GM' else 'Jogador' end
  )
  into v_actor_display_name
  from public.room_members
  where room_members.room_id = v_room_id
    and room_members.user_id = v_user_id;

  insert into public.combat_actions (
    battle_id,
    actor_user_id,
    actor_display_name,
    target_combatant_id,
    target_name,
    action_type,
    requested_delta,
    applied_delta,
    previous_hp,
    resulting_hp,
    attacker_combatant_id,
    attacker_name,
    round_number,
    guard_applied
  )
  values (
    v_battle_id,
    v_user_id,
    coalesce(v_actor_display_name, 'Jogador'),
    p_combatant_id,
    v_name,
    'guard',
    0,
    0,
    v_hp,
    v_hp,
    p_combatant_id,
    v_name,
    v_turn.acted_round,
    true
  );

  return query
  select
    v_battle_id,
    p_combatant_id,
    v_turn.acted_round,
    v_turn.next_round,
    v_turn.next_side;
end;
$$;

revoke all on function public.perform_guard(uuid)
  from public, anon;
grant execute on function public.perform_guard(uuid)
  to authenticated;

-- Guard ends when the conflict ends.
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
  where battles.id = p_battle_id;

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
    current_side = null
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

revoke all on function public.stop_battle_turns(uuid)
  from public, anon;
grant execute on function public.stop_battle_turns(uuid)
  to authenticated;

-- Recreate attack resolution with Guard-aware effective Affinities.
create or replace function public.perform_combatant_attack(
  p_attack_id uuid,
  p_target_id uuid
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
  resulting_hp integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_battle_id uuid;
  v_room_id uuid;
  v_attacker_id uuid;
  v_controller_user_id uuid;
  v_attacker_name text;
  v_target_name text;
  v_actor_display_name text;
  v_attack_name text;
  v_attr_a text;
  v_attr_b text;
  v_accuracy_bonus integer;
  v_damage_bonus integer;
  v_damage_type text;
  v_base_affinity text := 'neutral';
  v_damage_affinity text := 'neutral';
  v_target_guard_round integer;
  v_guard_applied boolean := false;
  v_dex integer;
  v_ins integer;
  v_mig integer;
  v_wlp integer;
  v_die_a integer;
  v_die_b integer;
  v_roll_a integer;
  v_roll_b integer;
  v_total integer;
  v_hr integer;
  v_target_defense integer;
  v_previous_hp integer;
  v_max_hp integer;
  v_resulting_hp integer;
  v_is_critical boolean;
  v_is_fumble boolean;
  v_is_hit boolean;
  v_raw_damage integer;
  v_hp_amount integer;
  v_applied_delta integer;
  v_action_id uuid;
  v_turn record;
begin
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;

  select
    attacks.combatant_id,
    attacks.name,
    attacks.accuracy_attribute_a,
    attacks.accuracy_attribute_b,
    attacks.accuracy_bonus,
    attacks.damage_bonus,
    attacks.damage_type,
    combatants.battle_id,
    battles.room_id,
    combatants.controller_user_id,
    combatants.name,
    combatants.dex_die,
    combatants.ins_die,
    combatants.mig_die,
    combatants.wlp_die
  into
    v_attacker_id,
    v_attack_name,
    v_attr_a,
    v_attr_b,
    v_accuracy_bonus,
    v_damage_bonus,
    v_damage_type,
    v_battle_id,
    v_room_id,
    v_controller_user_id,
    v_attacker_name,
    v_dex,
    v_ins,
    v_mig,
    v_wlp
  from public.combatant_attacks as attacks
  join public.combatants on combatants.id = attacks.combatant_id
  join public.battles on battles.id = combatants.battle_id
  where attacks.id = p_attack_id;

  if v_attacker_id is null then
    raise exception 'Ataque não encontrado.';
  end if;

  if not (
    private.is_room_host(v_room_id)
    or (
      v_controller_user_id = v_user_id
      and private.is_room_member(v_room_id)
    )
  ) then
    raise exception 'Você não controla este combatente.';
  end if;

  select *
  into v_turn
  from private.consume_combatant_turn(v_battle_id, v_attacker_id);

  select
    combatants.name,
    combatants.defense,
    combatants.hp,
    combatants.max_hp,
    combatants.guard_started_round
  into
    v_target_name,
    v_target_defense,
    v_previous_hp,
    v_max_hp,
    v_target_guard_round
  from public.combatants
  where combatants.id = p_target_id
    and combatants.battle_id = v_battle_id
  for update;

  if v_target_name is null then
    raise exception 'Alvo não encontrado nesta batalha.';
  end if;

  select affinities.affinity
  into v_base_affinity
  from public.combatant_affinities as affinities
  where affinities.combatant_id = p_target_id
    and affinities.damage_type = v_damage_type;

  v_base_affinity := coalesce(v_base_affinity, 'neutral');
  v_guard_applied := v_target_guard_round is not null;

  -- Absorption supersedes everything; Immunity supersedes Resistance and
  -- Vulnerability. Guard's Resistance cancels Vulnerability, leaves an
  -- existing Resistance as Resistance, and turns Neutral into Resistance.
  if v_base_affinity = 'absorbs' then
    v_damage_affinity := 'absorbs';
  elsif v_base_affinity = 'immune' then
    v_damage_affinity := 'immune';
  elsif v_guard_applied and v_base_affinity = 'vulnerable' then
    v_damage_affinity := 'neutral';
  elsif v_guard_applied then
    v_damage_affinity := 'resistant';
  else
    v_damage_affinity := v_base_affinity;
  end if;

  v_die_a := case v_attr_a
    when 'dex' then v_dex
    when 'ins' then v_ins
    when 'mig' then v_mig
    when 'wlp' then v_wlp
  end;

  v_die_b := case v_attr_b
    when 'dex' then v_dex
    when 'ins' then v_ins
    when 'mig' then v_mig
    when 'wlp' then v_wlp
  end;

  v_roll_a := floor(random() * v_die_a)::integer + 1;
  v_roll_b := floor(random() * v_die_b)::integer + 1;
  v_total := v_roll_a + v_roll_b + v_accuracy_bonus;
  v_hr := greatest(v_roll_a, v_roll_b);
  v_is_fumble := v_roll_a = 1 and v_roll_b = 1;
  v_is_critical := v_roll_a = v_roll_b and v_roll_a >= 6;
  v_is_hit := not v_is_fumble
    and (v_is_critical or v_total >= v_target_defense);

  v_raw_damage := case
    when v_is_hit then greatest(0, v_hr + v_damage_bonus)
    else 0
  end;

  if not v_is_hit or v_raw_damage = 0 then
    v_resulting_hp := v_previous_hp;
  elsif v_damage_affinity = 'vulnerable' then
    v_hp_amount := v_raw_damage * 2;
    v_resulting_hp := greatest(0, v_previous_hp - v_hp_amount);
  elsif v_damage_affinity = 'resistant' then
    v_hp_amount := v_raw_damage / 2;
    v_resulting_hp := greatest(0, v_previous_hp - v_hp_amount);
  elsif v_damage_affinity = 'immune' then
    v_hp_amount := 0;
    v_resulting_hp := v_previous_hp;
  elsif v_damage_affinity = 'absorbs' then
    v_hp_amount := v_raw_damage;
    v_resulting_hp := least(v_max_hp, v_previous_hp + v_hp_amount);
  else
    v_hp_amount := v_raw_damage;
    v_resulting_hp := greatest(0, v_previous_hp - v_hp_amount);
  end if;

  v_applied_delta := v_resulting_hp - v_previous_hp;

  if v_applied_delta <> 0 then
    update public.combatants
    set
      hp = v_resulting_hp,
      guard_started_round = case
        when v_resulting_hp = 0 then null
        else guard_started_round
      end
    where id = p_target_id;
  end if;

  select coalesce(
    nullif(trim(room_members.display_name), ''),
    case when room_members.role = 'host' then 'GM' else 'Jogador' end
  )
  into v_actor_display_name
  from public.room_members
  where room_members.room_id = v_room_id
    and room_members.user_id = v_user_id;

  insert into public.combat_actions (
    battle_id,
    actor_user_id,
    actor_display_name,
    target_combatant_id,
    target_name,
    action_type,
    requested_delta,
    applied_delta,
    previous_hp,
    resulting_hp,
    attacker_combatant_id,
    attacker_name,
    attack_name,
    roll_a,
    roll_b,
    check_total,
    high_roll,
    target_defense,
    is_hit,
    is_critical,
    is_fumble,
    damage,
    damage_type,
    damage_affinity,
    round_number,
    guard_applied
  )
  values (
    v_battle_id,
    v_user_id,
    coalesce(v_actor_display_name, 'Jogador'),
    p_target_id,
    v_target_name,
    'attack',
    -v_raw_damage,
    v_applied_delta,
    v_previous_hp,
    v_resulting_hp,
    v_attacker_id,
    v_attacker_name,
    v_attack_name,
    v_roll_a,
    v_roll_b,
    v_total,
    v_hr,
    v_target_defense,
    v_is_hit,
    v_is_critical,
    v_is_fumble,
    v_raw_damage,
    v_damage_type,
    v_damage_affinity,
    v_turn.acted_round,
    v_guard_applied
  )
  returning id into v_action_id;

  return query
  select
    v_action_id,
    v_attacker_id,
    p_target_id,
    v_attack_name,
    v_roll_a,
    v_roll_b,
    v_total,
    v_hr,
    v_target_defense,
    v_is_hit,
    v_is_critical,
    v_is_fumble,
    v_raw_damage,
    v_damage_type,
    v_damage_affinity,
    v_previous_hp,
    v_resulting_hp;
end;
$$;

revoke all on function public.perform_combatant_attack(uuid, uuid)
  from public, anon;
grant execute on function public.perform_combatant_attack(uuid, uuid)
  to authenticated;
