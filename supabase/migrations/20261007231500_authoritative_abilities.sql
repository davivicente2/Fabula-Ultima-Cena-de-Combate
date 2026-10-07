-- Add a generic authoritative offensive ability.
-- Prototype abilities are original test content; the engine is meant to host
-- user-configured Fabula Ultima spells/skills later.

create table if not exists public.combatant_abilities (
  id uuid primary key default gen_random_uuid(),
  combatant_id uuid not null
    references public.combatants(id) on delete cascade,
  name text not null,
  check_attribute_a text not null
    check (check_attribute_a in ('dex', 'ins', 'mig', 'wlp')),
  check_attribute_b text not null
    check (check_attribute_b in ('dex', 'ins', 'mig', 'wlp')),
  check_bonus integer not null default 0,
  mp_cost integer not null default 0
    check (mp_cost >= 0),
  damage_bonus integer not null default 0,
  damage_type text not null
    check (
      damage_type in (
        'physical',
        'air',
        'bolt',
        'dark',
        'earth',
        'fire',
        'ice',
        'light',
        'poison'
      )
    ),
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists combatant_abilities_combatant_idx
  on public.combatant_abilities (combatant_id, sort_order);

alter table public.combatant_abilities enable row level security;

revoke all on table public.combatant_abilities from anon, authenticated;
grant select, insert, update, delete
  on table public.combatant_abilities
  to authenticated;

drop policy if exists "Room members can read combatant abilities"
  on public.combatant_abilities;
create policy "Room members can read combatant abilities"
  on public.combatant_abilities
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.combatants
      join public.battles on battles.id = combatants.battle_id
      where combatants.id = combatant_abilities.combatant_id
        and private.is_room_member(battles.room_id)
    )
  );

drop policy if exists "Room hosts can create combatant abilities"
  on public.combatant_abilities;
create policy "Room hosts can create combatant abilities"
  on public.combatant_abilities
  for insert
  to authenticated
  with check (
    exists (
      select 1
      from public.combatants
      join public.battles on battles.id = combatants.battle_id
      where combatants.id = combatant_abilities.combatant_id
        and private.is_room_host(battles.room_id)
    )
  );

drop policy if exists "Room hosts can update combatant abilities"
  on public.combatant_abilities;
create policy "Room hosts can update combatant abilities"
  on public.combatant_abilities
  for update
  to authenticated
  using (
    exists (
      select 1
      from public.combatants
      join public.battles on battles.id = combatants.battle_id
      where combatants.id = combatant_abilities.combatant_id
        and private.is_room_host(battles.room_id)
    )
  )
  with check (
    exists (
      select 1
      from public.combatants
      join public.battles on battles.id = combatants.battle_id
      where combatants.id = combatant_abilities.combatant_id
        and private.is_room_host(battles.room_id)
    )
  );

drop policy if exists "Room hosts can delete combatant abilities"
  on public.combatant_abilities;
create policy "Room hosts can delete combatant abilities"
  on public.combatant_abilities
  for delete
  to authenticated
  using (
    exists (
      select 1
      from public.combatants
      join public.battles on battles.id = combatants.battle_id
      where combatants.id = combatant_abilities.combatant_id
        and private.is_room_host(battles.room_id)
    )
  );

-- Existing prototype Cael receives one original test ability.
insert into public.combatant_abilities (
  combatant_id,
  name,
  check_attribute_a,
  check_attribute_b,
  check_bonus,
  mp_cost,
  damage_bonus,
  damage_type,
  sort_order
)
select
  combatants.id,
  'Pulso Arcano',
  'ins',
  'wlp',
  0,
  10,
  10,
  'bolt',
  0
from public.combatants
where combatants.name = 'Cael'
  and not exists (
    select 1
    from public.combatant_abilities
    where combatant_abilities.combatant_id = combatants.id
      and combatant_abilities.name = 'Pulso Arcano'
  );

alter table public.combat_actions
  drop constraint if exists combat_actions_action_type_check;

alter table public.combat_actions
  add constraint combat_actions_action_type_check
  check (
    action_type in (
      'hp_adjustment',
      'attack',
      'turn_end',
      'guard',
      'resource_adjustment',
      'ability'
    )
  );

alter table public.combat_actions
  add column if not exists ability_name text;

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
as $ability$
declare
  v_user_id uuid := auth.uid();
  v_battle_id uuid;
  v_room_id uuid;
  v_caster_id uuid;
  v_caster_side text;
  v_controller_user_id uuid;
  v_caster_name text;
  v_ability_name text;
  v_attr_a text;
  v_attr_b text;
  v_check_bonus integer;
  v_mp_cost integer;
  v_damage_bonus integer;
  v_damage_type text;
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
  v_base_affinity text := 'neutral';
  v_damage_affinity text := 'neutral';
  v_guard_applied boolean := false;
  v_is_critical boolean;
  v_is_fumble boolean;
  v_is_hit boolean;
  v_raw_damage integer;
  v_hp_amount integer;
  v_applied_delta integer;
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
    abilities.check_attribute_a,
    abilities.check_attribute_b,
    abilities.check_bonus,
    abilities.mp_cost,
    abilities.damage_bonus,
    abilities.damage_type,
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
    v_attr_a,
    v_attr_b,
    v_check_bonus,
    v_mp_cost,
    v_damage_bonus,
    v_damage_type,
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
    combatants.guard_started_round
  into
    v_target_name,
    v_target_side,
    v_target_mdef,
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

  if v_target_side = v_caster_side then
    raise exception 'Esta habilidade ofensiva exige um alvo inimigo.';
  end if;

  if v_previous_hp <= 0 then
    raise exception 'O alvo já está com 0 HP.';
  end if;

  select *
  into v_turn
  from private.consume_combatant_turn(v_battle_id, v_caster_id);

  v_resulting_mp := v_previous_mp - v_mp_cost;

  update public.combatants
  set mp = v_resulting_mp
  where id = v_caster_id;

  select affinities.affinity
  into v_base_affinity
  from public.combatant_affinities as affinities
  where affinities.combatant_id = p_target_id
    and affinities.damage_type = v_damage_type;

  v_base_affinity := coalesce(v_base_affinity, 'neutral');
  v_guard_applied := v_target_guard_round is not null;

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
  v_total := v_roll_a + v_roll_b + v_check_bonus;
  v_hr := greatest(v_roll_a, v_roll_b);
  v_is_fumble := v_roll_a = 1 and v_roll_b = 1;
  v_is_critical := v_roll_a = v_roll_b and v_roll_a >= 6;
  v_is_hit := not v_is_fumble
    and (v_is_critical or v_total >= v_target_mdef);

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
    ability_name,
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
    -v_raw_damage,
    v_applied_delta,
    v_previous_hp,
    v_resulting_hp,
    v_caster_id,
    v_caster_name,
    v_ability_name,
    v_roll_a,
    v_roll_b,
    v_total,
    v_hr,
    v_target_mdef,
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
    v_target_mdef,
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
$ability$;

revoke all on function public.perform_combatant_ability(uuid, uuid, bigint)
  from public, anon;
grant execute on function public.perform_combatant_ability(uuid, uuid, bigint)
  to authenticated;
