-- Generic/manual actions.
-- These represent Fabula Ultima skills/spells whose full effect is not yet
-- modeled by the engine. The backend still owns MP spending, checks, turn
-- consumption and logging; the described effect is resolved manually.

alter table public.combatant_abilities
  add column if not exists description text,
  add column if not exists check_defense text not null default 'mdef';

alter table public.combatant_abilities
  drop constraint if exists combatant_abilities_effect_type_check,
  drop constraint if exists combatant_abilities_target_relation_check,
  drop constraint if exists combatant_abilities_effect_config_check,
  drop constraint if exists combatant_abilities_check_defense_check;

alter table public.combatant_abilities
  add constraint combatant_abilities_effect_type_check
    check (effect_type in ('damage', 'heal', 'status', 'manual')),
  add constraint combatant_abilities_target_relation_check
    check (target_relation in ('enemy', 'ally', 'self', 'any')),
  add constraint combatant_abilities_check_defense_check
    check (check_defense in ('def', 'mdef', 'none', 'auto')),
  add constraint combatant_abilities_effect_config_check
    check (
      (effect_type = 'damage' and damage_type is not null)
      or (effect_type = 'heal' and heal_amount > 0)
      or (effect_type = 'status' and status_effect is not null)
      or effect_type = 'manual'
    );

alter table public.combat_actions
  drop constraint if exists combat_actions_ability_effect_type_check;

alter table public.combat_actions
  add constraint combat_actions_ability_effect_type_check
    check (
      ability_effect_type is null
      or ability_effect_type in ('damage', 'heal', 'status', 'manual')
    );

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
as $manual_ability$
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
  v_mp_cost integer;
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
  v_target_name text;
  v_target_side text;
  v_target_def integer;
  v_target_mdef integer;
  v_target_threshold integer;
  v_previous_hp integer;
  v_is_critical boolean := false;
  v_is_fumble boolean := false;
  v_is_hit boolean := true;
  v_actor_display_name text;
  v_action_id uuid;
  v_turn record;
  v_next_revision bigint;
begin
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;

  select combatants.battle_id
  into v_battle_id
  from public.combatant_abilities as abilities
  join public.combatants as combatants
    on combatants.id = abilities.combatant_id
  where abilities.id = p_ability_id
    and abilities.effect_type = 'manual';

  if v_battle_id is null then
    raise exception 'Ação customizada não encontrada.';
  end if;

  perform private.assert_turn_revision(
    v_battle_id,
    p_expected_revision
  );

  select
    abilities.combatant_id,
    abilities.name,
    abilities.target_relation,
    abilities.check_attribute_a,
    abilities.check_attribute_b,
    abilities.check_bonus,
    abilities.check_defense,
    abilities.mp_cost,
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
    v_caster_id,
    v_ability_name,
    v_target_relation,
    v_attr_a,
    v_attr_b,
    v_check_bonus,
    v_check_defense,
    v_mp_cost,
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
    and combatants.battle_id = v_battle_id
  for update of combatants;

  if v_caster_id is null then
    raise exception 'Ação customizada não encontrada.';
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

  if v_previous_mp < v_mp_cost then
    raise exception 'MP insuficiente para usar esta ação.';
  end if;

  select
    target.name,
    target.side,
    target.defense,
    target.magic_defense,
    target.hp
  into
    v_target_name,
    v_target_side,
    v_target_def,
    v_target_mdef,
    v_previous_hp
  from public.combatants as target
  where target.id = p_target_id
    and target.battle_id = v_battle_id
  for update;

  if v_target_name is null then
    raise exception 'Alvo não encontrado nesta cena.';
  end if;

  if v_target_relation = 'enemy' and v_target_side = v_caster_side then
    raise exception 'Esta ação exige um alvo inimigo.';
  end if;

  if v_target_relation = 'ally' and v_target_side <> v_caster_side then
    raise exception 'Esta ação exige um alvo aliado.';
  end if;

  if v_target_relation = 'self' and p_target_id <> v_caster_id then
    raise exception 'Esta ação deve ter o próprio usuário como alvo.';
  end if;

  select *
  into v_turn
  from private.consume_combatant_turn(v_battle_id, v_caster_id);

  v_resulting_mp := v_previous_mp - v_mp_cost;

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

    if v_check_defense = 'def' then
      v_target_threshold := v_target_def;
      v_is_hit := not v_is_fumble
        and (v_is_critical or v_total >= v_target_threshold);
    elsif v_check_defense = 'mdef' then
      v_target_threshold := v_target_mdef;
      v_is_hit := not v_is_fumble
        and (v_is_critical or v_total >= v_target_threshold);
    else
      -- "none" is a free check: roll and report the total, but do not compare.
      v_target_threshold := null;
      v_is_hit := not v_is_fumble;
    end if;
  else
    -- Auto actions consume the turn/resources but deliberately make no roll.
    v_roll_a := null;
    v_roll_b := null;
    v_total := null;
    v_hr := null;
    v_target_threshold := null;
    v_is_hit := true;
    v_is_critical := false;
    v_is_fumble := false;
  end if;

  select coalesce(
    nullif(trim(members.display_name), ''),
    case when members.role = 'host' then 'GM' else 'Jogador' end
  )
  into v_actor_display_name
  from public.room_members as members
  where members.room_id = v_room_id
    and members.user_id = v_user_id;

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
    p_target_id,
    v_target_name,
    'ability',
    0,
    0,
    v_previous_hp,
    v_previous_hp,
    v_caster_id,
    v_caster_name,
    v_ability_name,
    'manual',
    v_roll_a,
    v_roll_b,
    v_total,
    v_hr,
    v_target_threshold,
    v_is_hit,
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

  update public.battles as battles
  set turn_revision = battles.turn_revision + 1
  where battles.id = v_battle_id
  returning battles.turn_revision into v_next_revision;

  return query
  select
    v_action_id,
    v_caster_id,
    p_target_id,
    v_ability_name,
    v_roll_a,
    v_roll_b,
    v_total,
    v_hr,
    v_target_threshold,
    v_is_hit,
    v_is_critical,
    v_is_fumble,
    0,
    null::text,
    null::text,
    v_previous_hp,
    v_previous_hp,
    v_previous_mp,
    v_resulting_mp,
    v_turn.acted_round,
    v_turn.next_round,
    v_turn.next_side,
    v_next_revision;
end;
$manual_ability$;

revoke all on function public.perform_manual_combatant_ability(
  uuid, uuid, bigint
) from public, anon;
grant execute on function public.perform_manual_combatant_ability(
  uuid, uuid, bigint
) to authenticated;

-- Older databases may already have the experimental PR #19 wrapper/internal
-- pair. Fresh databases only have perform_combatant_ability. Normalize both
-- cases to one safe router.
do $normalize_router$
begin
  if to_regprocedure(
    'public.perform_structured_combatant_ability_internal(uuid,uuid,bigint)'
  ) is null then
    execute
      'alter function public.perform_combatant_ability(uuid, uuid, bigint) '
      || 'rename to perform_structured_combatant_ability_internal';
  end if;
end
$normalize_router$;

revoke all on function public.perform_structured_combatant_ability_internal(
  uuid, uuid, bigint
) from public, anon, authenticated;

create or replace function public.perform_combatant_ability(
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
as $ability_router$
declare
  v_effect_type text;
begin
  select abilities.effect_type
  into v_effect_type
  from public.combatant_abilities as abilities
  where abilities.id = p_ability_id;

  if v_effect_type is null then
    raise exception 'Habilidade não encontrada.';
  end if;

  if v_effect_type = 'manual' then
    return query
    select *
    from public.perform_manual_combatant_ability(
      p_ability_id,
      p_target_id,
      p_expected_revision
    );
    return;
  end if;

  return query
  select *
  from public.perform_structured_combatant_ability_internal(
    p_ability_id,
    p_target_id,
    p_expected_revision
  );
end;
$ability_router$;

revoke all on function public.perform_combatant_ability(
  uuid, uuid, bigint
) from public, anon;
grant execute on function public.perform_combatant_ability(
  uuid, uuid, bigint
) to authenticated;

-- Re-sync linked characters so their stored generic actions become available
-- immediately after this migration.
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
