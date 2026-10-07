-- Generalize combat abilities to healing and status effects.
-- Statuses are stored on combatants and current die sizes are recalculated from
-- immutable base die sizes, so existing attack/ability RPCs automatically use
-- the effective values.

alter table public.combatants
  add column if not exists base_dex_die integer,
  add column if not exists base_ins_die integer,
  add column if not exists base_mig_die integer,
  add column if not exists base_wlp_die integer,
  add column if not exists statuses text[] not null default '{}';

update public.combatants
set
  base_dex_die = coalesce(base_dex_die, dex_die),
  base_ins_die = coalesce(base_ins_die, ins_die),
  base_mig_die = coalesce(base_mig_die, mig_die),
  base_wlp_die = coalesce(base_wlp_die, wlp_die);

alter table public.combatants
  alter column base_dex_die set not null,
  alter column base_ins_die set not null,
  alter column base_mig_die set not null,
  alter column base_wlp_die set not null;

alter table public.combatants
  drop constraint if exists combatants_base_dex_die_check,
  drop constraint if exists combatants_base_ins_die_check,
  drop constraint if exists combatants_base_mig_die_check,
  drop constraint if exists combatants_base_wlp_die_check,
  drop constraint if exists combatants_statuses_check;

alter table public.combatants
  add constraint combatants_base_dex_die_check
    check (base_dex_die in (6, 8, 10, 12)),
  add constraint combatants_base_ins_die_check
    check (base_ins_die in (6, 8, 10, 12)),
  add constraint combatants_base_mig_die_check
    check (base_mig_die in (6, 8, 10, 12)),
  add constraint combatants_base_wlp_die_check
    check (base_wlp_die in (6, 8, 10, 12)),
  add constraint combatants_statuses_check
    check (
      statuses <@ array[
        'slow',
        'dazed',
        'weak',
        'shaken',
        'enraged',
        'poisoned'
      ]::text[]
    );

create or replace function private.refresh_combatant_status_dice(
  p_combatant_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $status_dice$
begin
  update public.combatants
  set
    dex_die = greatest(
      6,
      base_dex_die
        - 2 * (
          case when 'slow' = any(statuses) then 1 else 0 end
          + case when 'enraged' = any(statuses) then 1 else 0 end
        )
    ),
    ins_die = greatest(
      6,
      base_ins_die
        - 2 * (
          case when 'dazed' = any(statuses) then 1 else 0 end
          + case when 'enraged' = any(statuses) then 1 else 0 end
        )
    ),
    mig_die = greatest(
      6,
      base_mig_die
        - 2 * (
          case when 'weak' = any(statuses) then 1 else 0 end
          + case when 'poisoned' = any(statuses) then 1 else 0 end
        )
    ),
    wlp_die = greatest(
      6,
      base_wlp_die
        - 2 * (
          case when 'shaken' = any(statuses) then 1 else 0 end
          + case when 'poisoned' = any(statuses) then 1 else 0 end
        )
    )
  where id = p_combatant_id;
end;
$status_dice$;

revoke all on function private.refresh_combatant_status_dice(uuid)
  from public, anon, authenticated;

-- Future tonic/rest/editor flows can call this through a host-only RPC.
create or replace function public.set_combatant_status(
  p_combatant_id uuid,
  p_status text,
  p_active boolean
)
returns table (
  combatant_id uuid,
  statuses text[]
)
language plpgsql
security definer
set search_path = ''
as $status_admin$
declare
  v_room_id uuid;
  v_statuses text[];
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  if p_status not in (
    'slow',
    'dazed',
    'weak',
    'shaken',
    'enraged',
    'poisoned'
  ) then
    raise exception 'Status inválido.';
  end if;

  select battles.room_id
  into v_room_id
  from public.combatants
  join public.battles on battles.id = combatants.battle_id
  where combatants.id = p_combatant_id
  for update of combatants;

  if v_room_id is null then
    raise exception 'Combatente não encontrado.';
  end if;

  if not private.is_room_host(v_room_id) then
    raise exception 'Apenas o GM pode alterar status manualmente.';
  end if;

  if p_active then
    update public.combatants
    set statuses = case
      when p_status = any(statuses) then statuses
      else array_append(statuses, p_status)
    end
    where id = p_combatant_id;
  else
    update public.combatants
    set statuses = array_remove(statuses, p_status)
    where id = p_combatant_id;
  end if;

  perform private.refresh_combatant_status_dice(p_combatant_id);

  select combatants.statuses
  into v_statuses
  from public.combatants
  where id = p_combatant_id;

  return query
  select p_combatant_id, v_statuses;
end;
$status_admin$;

revoke all on function public.set_combatant_status(uuid, text, boolean)
  from public, anon;
grant execute on function public.set_combatant_status(uuid, text, boolean)
  to authenticated;

alter table public.combatant_abilities
  add column if not exists effect_type text not null default 'damage',
  add column if not exists target_relation text not null default 'enemy',
  add column if not exists heal_amount integer not null default 0,
  add column if not exists status_effect text;

alter table public.combatant_abilities
  alter column damage_type drop not null;

alter table public.combatant_abilities
  drop constraint if exists combatant_abilities_effect_type_check,
  drop constraint if exists combatant_abilities_target_relation_check,
  drop constraint if exists combatant_abilities_heal_amount_check,
  drop constraint if exists combatant_abilities_status_effect_check,
  drop constraint if exists combatant_abilities_effect_config_check;

alter table public.combatant_abilities
  add constraint combatant_abilities_effect_type_check
    check (effect_type in ('damage', 'heal', 'status')),
  add constraint combatant_abilities_target_relation_check
    check (target_relation in ('enemy', 'ally')),
  add constraint combatant_abilities_heal_amount_check
    check (heal_amount >= 0),
  add constraint combatant_abilities_status_effect_check
    check (
      status_effect is null
      or status_effect in (
        'slow',
        'dazed',
        'weak',
        'shaken',
        'enraged',
        'poisoned'
      )
    ),
  add constraint combatant_abilities_effect_config_check
    check (
      (effect_type = 'damage' and damage_type is not null)
      or (effect_type = 'heal' and heal_amount > 0)
      or (effect_type = 'status' and status_effect is not null)
    );

-- Preserve the existing prototype offensive ability.
update public.combatant_abilities
set
  effect_type = 'damage',
  target_relation = 'enemy'
where name = 'Pulso Arcano';

-- Original prototype healing ability for Aurora.
insert into public.combatant_abilities (
  combatant_id,
  name,
  effect_type,
  target_relation,
  check_attribute_a,
  check_attribute_b,
  check_bonus,
  mp_cost,
  damage_bonus,
  damage_type,
  heal_amount,
  status_effect,
  sort_order
)
select
  combatants.id,
  'Vínculo Vital',
  'heal',
  'ally',
  'ins',
  'wlp',
  0,
  10,
  0,
  null,
  20,
  null,
  0
from public.combatants
where combatants.name = 'Aurora'
  and not exists (
    select 1
    from public.combatant_abilities
    where combatant_abilities.combatant_id = combatants.id
      and combatant_abilities.name = 'Vínculo Vital'
  );

-- A second Cael ability exercises multiple-skill selection and status logic.
insert into public.combatant_abilities (
  combatant_id,
  name,
  effect_type,
  target_relation,
  check_attribute_a,
  check_attribute_b,
  check_bonus,
  mp_cost,
  damage_bonus,
  damage_type,
  heal_amount,
  status_effect,
  sort_order
)
select
  combatants.id,
  'Névoa Lenta',
  'status',
  'enemy',
  'ins',
  'wlp',
  0,
  5,
  0,
  null,
  0,
  'slow',
  1
from public.combatants
where combatants.name = 'Cael'
  and not exists (
    select 1
    from public.combatant_abilities
    where combatant_abilities.combatant_id = combatants.id
      and combatant_abilities.name = 'Névoa Lenta'
  );

alter table public.combat_actions
  add column if not exists ability_effect_type text
    check (
      ability_effect_type is null
      or ability_effect_type in ('damage', 'heal', 'status')
    ),
  add column if not exists status_effect text
    check (
      status_effect is null
      or status_effect in (
        'slow',
        'dazed',
        'weak',
        'shaken',
        'enraged',
        'poisoned'
      )
    ),
  add column if not exists healing integer;

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
as $ability_general$
declare
  v_user_id uuid := auth.uid();
  v_battle_id uuid;
  v_room_id uuid;
  v_caster_id uuid;
  v_caster_side text;
  v_controller_user_id uuid;
  v_caster_name text;
  v_ability_name text;
  v_effect_type text;
  v_target_relation text;
  v_attr_a text;
  v_attr_b text;
  v_check_bonus integer;
  v_mp_cost integer;
  v_damage_bonus integer;
  v_damage_type text;
  v_heal_amount integer;
  v_status_effect text;
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
  v_target_mdef integer;
  v_previous_hp integer;
  v_max_hp integer;
  v_resulting_hp integer;
  v_target_guard_round integer;
  v_target_statuses text[];
  v_base_affinity text := 'neutral';
  v_damage_affinity text;
  v_guard_applied boolean := false;
  v_is_critical boolean := false;
  v_is_fumble boolean := false;
  v_is_hit boolean := true;
  v_raw_damage integer := 0;
  v_healing integer := 0;
  v_hp_amount integer;
  v_applied_delta integer := 0;
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
  from public.combatant_abilities
  join public.combatants
    on combatants.id = combatant_abilities.combatant_id
  where combatant_abilities.id = p_ability_id;

  if v_battle_id is null then
    raise exception 'Habilidade não encontrada.';
  end if;

  perform private.assert_turn_revision(
    v_battle_id,
    p_expected_revision
  );

  select
    abilities.combatant_id,
    abilities.name,
    abilities.effect_type,
    abilities.target_relation,
    abilities.check_attribute_a,
    abilities.check_attribute_b,
    abilities.check_bonus,
    abilities.mp_cost,
    abilities.damage_bonus,
    abilities.damage_type,
    abilities.heal_amount,
    abilities.status_effect,
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
    v_effect_type,
    v_target_relation,
    v_attr_a,
    v_attr_b,
    v_check_bonus,
    v_mp_cost,
    v_damage_bonus,
    v_damage_type,
    v_heal_amount,
    v_status_effect,
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
  join public.combatants
    on combatants.id = abilities.combatant_id
  join public.battles
    on battles.id = combatants.battle_id
  where abilities.id = p_ability_id
    and combatants.battle_id = v_battle_id
  for update of combatants;

  if v_caster_id is null then
    raise exception 'Habilidade não encontrada.';
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
    raise exception 'MP insuficiente para usar esta habilidade.';
  end if;

  select
    combatants.name,
    combatants.side,
    combatants.magic_defense,
    combatants.hp,
    combatants.max_hp,
    combatants.guard_started_round,
    combatants.statuses
  into
    v_target_name,
    v_target_side,
    v_target_mdef,
    v_previous_hp,
    v_max_hp,
    v_target_guard_round,
    v_target_statuses
  from public.combatants
  where combatants.id = p_target_id
    and combatants.battle_id = v_battle_id
  for update;

  if v_target_name is null then
    raise exception 'Alvo não encontrado nesta batalha.';
  end if;

  if v_previous_hp <= 0 then
    raise exception 'O alvo está com 0 HP.';
  end if;

  if v_target_relation = 'enemy' and v_target_side = v_caster_side then
    raise exception 'Esta habilidade exige um alvo inimigo.';
  end if;

  if v_target_relation = 'ally' and v_target_side <> v_caster_side then
    raise exception 'Esta habilidade exige um alvo aliado.';
  end if;

  select *
  into v_turn
  from private.consume_combatant_turn(v_battle_id, v_caster_id);

  v_resulting_mp := v_previous_mp - v_mp_cost;

  update public.combatants
  set mp = v_resulting_mp
  where id = v_caster_id;

  if v_effect_type in ('damage', 'status') then
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
    v_is_hit := not v_is_fumble
      and (v_is_critical or v_total >= v_target_mdef);
  end if;

  v_resulting_hp := v_previous_hp;

  if v_effect_type = 'heal' then
    v_healing := least(v_max_hp, v_previous_hp + v_heal_amount) - v_previous_hp;
    v_resulting_hp := v_previous_hp + v_healing;
    v_applied_delta := v_healing;

    if v_healing > 0 then
      update public.combatants
      set hp = v_resulting_hp
      where id = p_target_id;
    end if;
  elsif v_effect_type = 'status' then
    if v_is_hit and not (v_status_effect = any(v_target_statuses)) then
      update public.combatants
      set statuses = array_append(statuses, v_status_effect)
      where id = p_target_id;

      perform private.refresh_combatant_status_dice(p_target_id);
    end if;
  else
    select affinities.affinity
    into v_base_affinity
    from public.combatant_affinities as affinities
    where affinities.combatant_id = p_target_id
      and affinities.damage_type = v_damage_type;

    v_base_affinity := coalesce(v_base_affinity, 'neutral');
    v_damage_affinity := v_base_affinity;
    v_guard_applied := v_target_guard_round is not null;

    if v_base_affinity = 'absorbs' then
      v_damage_affinity := 'absorbs';
    elsif v_base_affinity = 'immune' then
      v_damage_affinity := 'immune';
    elsif v_guard_applied and v_base_affinity = 'vulnerable' then
      v_damage_affinity := 'neutral';
    elsif v_guard_applied then
      v_damage_affinity := 'resistant';
    end if;

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
    ability_name,
    ability_effect_type,
    status_effect,
    healing,
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
    case
      when v_effect_type = 'damage' then -v_raw_damage
      when v_effect_type = 'heal' then v_healing
      else 0
    end,
    v_applied_delta,
    v_previous_hp,
    v_resulting_hp,
    v_caster_id,
    v_caster_name,
    v_ability_name,
    v_effect_type,
    v_status_effect,
    v_healing,
    v_roll_a,
    v_roll_b,
    v_total,
    v_hr,
    case when v_effect_type in ('damage', 'status') then v_target_mdef else null end,
    v_is_hit,
    v_is_critical,
    v_is_fumble,
    v_raw_damage,
    v_damage_type,
    v_damage_affinity,
    v_turn.acted_round,
    v_guard_applied,
    'mp',
    v_previous_mp,
    v_resulting_mp
  )
  returning id into v_action_id;

  update public.battles
  set turn_revision = turn_revision + 1
  where id = v_battle_id
  returning turn_revision into v_next_revision;

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
    case when v_effect_type in ('damage', 'status') then v_target_mdef else null end,
    v_is_hit,
    v_is_critical,
    v_is_fumble,
    v_raw_damage,
    v_damage_type,
    v_damage_affinity,
    v_previous_hp,
    v_resulting_hp,
    v_previous_mp,
    v_resulting_mp,
    v_turn.acted_round,
    v_turn.next_round,
    v_turn.next_side,
    v_next_revision;
end;
$ability_general$;

revoke all on function public.perform_combatant_ability(uuid, uuid, bigint)
  from public, anon;
grant execute on function public.perform_combatant_ability(uuid, uuid, bigint)
  to authenticated;
