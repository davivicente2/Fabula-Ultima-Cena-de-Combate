-- Multi-target support for generic/manual abilities.
-- One check is rolled for the action and compared independently against every
-- selected target. MP may be a flat cost or multiplied by target count.

alter table public.combatant_abilities
  add column if not exists max_targets integer not null default 1,
  add column if not exists mp_per_target boolean not null default false;

alter table public.combatant_abilities
  drop constraint if exists combatant_abilities_max_targets_check;

alter table public.combatant_abilities
  add constraint combatant_abilities_max_targets_check
    check (max_targets between 1 and 20);

create or replace function private.seed_profile_abilities(
  p_combatant_id uuid,
  p_profile jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $seed_profile_abilities$
declare
  v_ability jsonb;
  v_effect_type text;
begin
  delete from public.combatant_abilities as abilities
  where abilities.combatant_id = p_combatant_id;

  for v_ability in
    select value
    from jsonb_array_elements(
      coalesce(p_profile -> 'abilities', '[]'::jsonb)
    )
  loop
    if coalesce(v_ability ->> 'name', '') = '' then
      continue;
    end if;

    v_effect_type := case
      when v_ability ->> 'effectType'
        in ('damage', 'heal', 'status', 'manual')
      then v_ability ->> 'effectType'
      else 'manual'
    end;

    insert into public.combatant_abilities (
      combatant_id,
      name,
      effect_type,
      target_relation,
      check_attribute_a,
      check_attribute_b,
      check_bonus,
      check_defense,
      mp_cost,
      max_targets,
      mp_per_target,
      damage_bonus,
      damage_type,
      heal_amount,
      status_effect,
      description,
      sort_order
    )
    values (
      p_combatant_id,
      v_ability ->> 'name',
      v_effect_type,
      case
        when v_ability ->> 'targetRelation'
          in ('enemy', 'ally', 'self', 'any')
        then v_ability ->> 'targetRelation'
        else case when v_effect_type = 'manual' then 'any' else 'enemy' end
      end,
      case
        when v_ability ->> 'checkAttributeA'
          in ('dex', 'ins', 'mig', 'wlp')
        then v_ability ->> 'checkAttributeA'
        else 'ins'
      end,
      case
        when v_ability ->> 'checkAttributeB'
          in ('dex', 'ins', 'mig', 'wlp')
        then v_ability ->> 'checkAttributeB'
        else 'wlp'
      end,
      coalesce((v_ability ->> 'checkBonus')::integer, 0),
      case
        when v_ability ->> 'checkDefense'
          in ('def', 'mdef', 'none', 'auto')
        then v_ability ->> 'checkDefense'
        when v_effect_type in ('damage', 'status') then 'mdef'
        else 'auto'
      end,
      greatest(0, coalesce((v_ability ->> 'mpCost')::integer, 0)),
      case
        when v_effect_type = 'manual'
        then least(
          20,
          greatest(1, coalesce((v_ability ->> 'maxTargets')::integer, 1))
        )
        else 1
      end,
      case
        when v_effect_type = 'manual'
        then coalesce((v_ability ->> 'mpPerTarget')::boolean, false)
        else false
      end,
      case
        when v_effect_type = 'damage'
        then coalesce((v_ability ->> 'damageBonus')::integer, 0)
        else 0
      end,
      case
        when v_effect_type = 'damage'
          and v_ability ->> 'damageType' in (
            'physical', 'air', 'bolt', 'dark', 'earth',
            'fire', 'ice', 'light', 'poison'
          )
        then v_ability ->> 'damageType'
        else null
      end,
      case
        when v_effect_type = 'heal'
        then greatest(1, coalesce((v_ability ->> 'healAmount')::integer, 1))
        else 0
      end,
      case
        when v_effect_type = 'status'
          and v_ability ->> 'statusEffect' in (
            'slow', 'dazed', 'weak', 'shaken', 'enraged', 'poisoned'
          )
        then v_ability ->> 'statusEffect'
        else null
      end,
      nullif(trim(coalesce(v_ability ->> 'description', '')), ''),
      coalesce((v_ability ->> 'sortOrder')::integer, 0)
    );
  end loop;
end;
$seed_profile_abilities$;

revoke all on function private.seed_profile_abilities(uuid, jsonb)
  from public, anon, authenticated;

create or replace function public.perform_manual_combatant_ability_multi(
  p_ability_id uuid,
  p_target_ids uuid[],
  p_expected_revision bigint
)
returns table (
  action_id uuid,
  caster_id uuid,
  target_id uuid,
  ability_name text,
  roll_a integer,
  roll_b integer,
  check_total integer,
  high_roll integer,
  target_defense integer,
  is_hit boolean,
  is_critical boolean,
  is_fumble boolean,
  previous_hp integer,
  resulting_hp integer,
  previous_mp integer,
  resulting_mp integer,
  mp_cost integer,
  target_count integer,
  acted_round integer,
  next_round integer,
  next_side text,
  next_revision bigint
)
language plpgsql
security definer
set search_path = ''
as $manual_multi$
declare
  v_user_id uuid := auth.uid();
  v_battle_id uuid;
  v_room_id uuid;
  v_caster_id uuid;
  v_caster_side text;
  v_controller_user_id uuid;
  v_caster_name text;
  v_ability_name text;
  v_target_relation text;
  v_attr_a text;
  v_attr_b text;
  v_check_bonus integer;
  v_check_defense text;
  v_base_mp_cost integer;
  v_max_targets integer;
  v_mp_per_target boolean;
  v_total_mp_cost integer;
  v_target_count integer;
  v_distinct_target_count integer;
  v_previous_mp integer;
  v_resulting_mp integer;
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
  v_is_critical boolean := false;
  v_is_fumble boolean := false;
  v_actor_display_name text;
  v_turn record;
  v_next_revision bigint;
  v_target record;
  v_target_threshold integer;
  v_target_hit boolean;
  v_action_id uuid;
begin
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;

  v_target_count := coalesce(cardinality(p_target_ids), 0);

  if v_target_count < 1 then
    raise exception 'Selecione pelo menos um alvo.';
  end if;

  select count(distinct selected_target.id)
  into v_distinct_target_count
  from unnest(p_target_ids) as selected_target(id);

  if v_distinct_target_count <> v_target_count then
    raise exception 'A lista de alvos contém duplicatas.';
  end if;

  select
    combatants.battle_id,
    abilities.combatant_id,
    abilities.name,
    abilities.target_relation,
    abilities.check_attribute_a,
    abilities.check_attribute_b,
    abilities.check_bonus,
    abilities.check_defense,
    abilities.mp_cost,
    abilities.max_targets,
    abilities.mp_per_target,
    battles.room_id,
    combatants.controller_user_id,
    combatants.name,
    combatants.side,
    combatants.mp,
    combatants.dex_die,
    combatants.ins_die,
    combatants.mig_die,
    combatants.wlp_die
  into
    v_battle_id,
    v_caster_id,
    v_ability_name,
    v_target_relation,
    v_attr_a,
    v_attr_b,
    v_check_bonus,
    v_check_defense,
    v_base_mp_cost,
    v_max_targets,
    v_mp_per_target,
    v_room_id,
    v_controller_user_id,
    v_caster_name,
    v_caster_side,
    v_previous_mp,
    v_dex,
    v_ins,
    v_mig,
    v_wlp
  from public.combatant_abilities as abilities
  join public.combatants as combatants
    on combatants.id = abilities.combatant_id
  join public.battles as battles
    on battles.id = combatants.battle_id
  where abilities.id = p_ability_id
    and abilities.effect_type = 'manual'
  for update of combatants;

  if v_battle_id is null or v_caster_id is null then
    raise exception 'Ação customizada não encontrada.';
  end if;

  perform private.assert_turn_revision(
    v_battle_id,
    p_expected_revision
  );

  if not (
    private.is_room_host(v_room_id)
    or (
      v_controller_user_id = v_user_id
      and private.is_room_member(v_room_id)
    )
  ) then
    raise exception 'Você não controla este combatente.';
  end if;

  if v_target_count > v_max_targets then
    raise exception
      'Esta ação aceita no máximo % alvo(s).',
      v_max_targets;
  end if;

  if v_target_relation = 'self'
    and (
      v_target_count <> 1
      or p_target_ids[1] <> v_caster_id
    )
  then
    raise exception 'Esta ação deve ter apenas o próprio usuário como alvo.';
  end if;

  -- Lock every selected target deterministically and validate that all belong
  -- to this battle before spending MP or consuming the turn.
  for v_target in
    select
      target.id,
      target.name,
      target.side,
      target.defense,
      target.magic_defense,
      target.hp
    from public.combatants as target
    where target.id = any(p_target_ids)
      and target.battle_id = v_battle_id
    order by target.id
    for update
  loop
    if v_target_relation = 'enemy' and v_target.side = v_caster_side then
      raise exception 'Esta ação exige alvo(s) inimigo(s).';
    end if;

    if v_target_relation = 'ally' and v_target.side <> v_caster_side then
      raise exception 'Esta ação exige alvo(s) aliado(s).';
    end if;
  end loop;

  if (
    select count(*)
    from public.combatants as target
    where target.id = any(p_target_ids)
      and target.battle_id = v_battle_id
  ) <> v_target_count
  then
    raise exception 'Um ou mais alvos não pertencem a esta cena.';
  end if;

  v_total_mp_cost := case
    when v_mp_per_target then v_base_mp_cost * v_target_count
    else v_base_mp_cost
  end;

  if v_previous_mp < v_total_mp_cost then
    raise exception
      'MP insuficiente: esta ação custa % MP com % alvo(s).',
      v_total_mp_cost,
      v_target_count;
  end if;

  select *
  into v_turn
  from private.consume_combatant_turn(v_battle_id, v_caster_id);

  v_resulting_mp := v_previous_mp - v_total_mp_cost;

  update public.combatants as caster
  set mp = v_resulting_mp
  where caster.id = v_caster_id;

  if v_check_defense <> 'auto' then
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
    v_total := v_roll_a + v_roll_b + v_check_bonus;
    v_hr := greatest(v_roll_a, v_roll_b);
    v_is_fumble := v_roll_a = 1 and v_roll_b = 1;
    v_is_critical := v_roll_a = v_roll_b and v_roll_a >= 6;
  else
    v_roll_a := null;
    v_roll_b := null;
    v_total := null;
    v_hr := null;
    v_is_fumble := false;
    v_is_critical := false;
  end if;

  select coalesce(
    nullif(trim(members.display_name), ''),
    case when members.role = 'host' then 'GM' else 'Jogador' end
  )
  into v_actor_display_name
  from public.room_members as members
  where members.room_id = v_room_id
    and members.user_id = v_user_id;

  update public.battles as battles
  set turn_revision = battles.turn_revision + 1
  where battles.id = v_battle_id
  returning battles.turn_revision into v_next_revision;

  for v_target in
    select
      target.id,
      target.name,
      target.defense,
      target.magic_defense,
      target.hp
    from public.combatants as target
    where target.id = any(p_target_ids)
      and target.battle_id = v_battle_id
    order by array_position(p_target_ids, target.id)
  loop
    v_target_threshold := case v_check_defense
      when 'def' then v_target.defense
      when 'mdef' then v_target.magic_defense
      else null
    end;

    if v_check_defense = 'auto' then
      v_target_hit := true;
    elsif v_check_defense = 'none' then
      v_target_hit := not v_is_fumble;
    else
      v_target_hit := not v_is_fumble
        and (
          v_is_critical
          or v_total >= v_target_threshold
        );
    end if;

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
      ability_name,
      ability_effect_type,
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
      guard_applied,
      resource_name,
      previous_resource,
      resulting_resource
    )
    values (
      v_battle_id,
      v_user_id,
      coalesce(v_actor_display_name, 'Jogador'),
      v_target.id,
      v_target.name,
      'ability',
      0,
      0,
      v_target.hp,
      v_target.hp,
      v_caster_id,
      v_caster_name,
      v_ability_name,
      'manual',
      v_roll_a,
      v_roll_b,
      v_total,
      v_hr,
      v_target_threshold,
      v_target_hit,
      v_is_critical,
      v_is_fumble,
      0,
      null,
      null,
      v_turn.acted_round,
      false,
      'mp',
      v_previous_mp,
      v_resulting_mp
    )
    returning id into v_action_id;

    action_id := v_action_id;
    caster_id := v_caster_id;
    target_id := v_target.id;
    ability_name := v_ability_name;
    roll_a := v_roll_a;
    roll_b := v_roll_b;
    check_total := v_total;
    high_roll := v_hr;
    target_defense := v_target_threshold;
    is_hit := v_target_hit;
    is_critical := v_is_critical;
    is_fumble := v_is_fumble;
    previous_hp := v_target.hp;
    resulting_hp := v_target.hp;
    previous_mp := v_previous_mp;
    resulting_mp := v_resulting_mp;
    mp_cost := v_total_mp_cost;
    target_count := v_target_count;
    acted_round := v_turn.acted_round;
    next_round := v_turn.next_round;
    next_side := v_turn.next_side;
    next_revision := v_next_revision;
    return next;
  end loop;
end;
$manual_multi$;

revoke all on function public.perform_manual_combatant_ability_multi(
  uuid, uuid[], bigint
) from public, anon;
grant execute on function public.perform_manual_combatant_ability_multi(
  uuid, uuid[], bigint
) to authenticated;

-- Keep the single-target API used by old clients and by the public ability
-- router. It delegates to the multi-target resolver.
create or replace function public.perform_manual_combatant_ability(
  p_ability_id uuid,
  p_target_id uuid,
  p_expected_revision bigint
)
returns table (
  action_id uuid,
  caster_id uuid,
  target_id uuid,
  ability_name text,
  roll_a integer,
  roll_b integer,
  check_total integer,
  high_roll integer,
  target_magic_defense integer,
  is_hit boolean,
  is_critical boolean,
  is_fumble boolean,
  damage integer,
  damage_type text,
  damage_affinity text,
  previous_hp integer,
  resulting_hp integer,
  previous_mp integer,
  resulting_mp integer,
  acted_round integer,
  next_round integer,
  next_side text,
  next_revision bigint
)
language plpgsql
security definer
set search_path = ''
as $manual_single$
begin
  return query
  select
    result.action_id,
    result.caster_id,
    result.target_id,
    result.ability_name,
    result.roll_a,
    result.roll_b,
    result.check_total,
    result.high_roll,
    result.target_defense,
    result.is_hit,
    result.is_critical,
    result.is_fumble,
    0,
    null::text,
    null::text,
    result.previous_hp,
    result.resulting_hp,
    result.previous_mp,
    result.resulting_mp,
    result.acted_round,
    result.next_round,
    result.next_side,
    result.next_revision
  from public.perform_manual_combatant_ability_multi(
    p_ability_id,
    array[p_target_id],
    p_expected_revision
  ) as result;
end;
$manual_single$;

revoke all on function public.perform_manual_combatant_ability(
  uuid, uuid, bigint
) from public, anon;
grant execute on function public.perform_manual_combatant_ability(
  uuid, uuid, bigint
) to authenticated;

-- Existing linked characters immediately gain the new target/cost settings.
do $backfill$
declare
  v_row record;
begin
  for v_row in
    select combatants.id, characters.combat_profile
    from public.combatants as combatants
    join public.characters as characters
      on characters.id = combatants.character_id
  loop
    perform private.seed_profile_abilities(v_row.id, v_row.combat_profile);
  end loop;
end
$backfill$;
