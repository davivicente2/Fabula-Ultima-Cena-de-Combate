-- Import offensive Fultimator spells as safe manual spell actions.
-- We automate only what the exported structure states explicitly:
-- Magic Check, MP cost, target MDEF and turn consumption.
-- The textual spell effect is preserved for the player/GM and is not parsed
-- into damage/status rules.

alter table public.combatant_abilities
  add column if not exists description text,
  add column if not exists source text not null default 'native',
  add column if not exists max_targets integer not null default 1;

alter table public.combatant_abilities
  drop constraint if exists combatant_abilities_effect_type_check,
  drop constraint if exists combatant_abilities_effect_config_check,
  drop constraint if exists combatant_abilities_source_check,
  drop constraint if exists combatant_abilities_max_targets_check;

alter table public.combatant_abilities
  add constraint combatant_abilities_effect_type_check
    check (effect_type in ('damage', 'heal', 'status', 'manual')),
  add constraint combatant_abilities_effect_config_check
    check (
      (effect_type = 'damage' and damage_type is not null)
      or (effect_type = 'heal' and heal_amount > 0)
      or (effect_type = 'status' and status_effect is not null)
      or (effect_type = 'manual')
    ),
  add constraint combatant_abilities_source_check
    check (source in ('native', 'fultimator')),
  add constraint combatant_abilities_max_targets_check
    check (max_targets >= 1);

alter table public.combat_actions
  drop constraint if exists combat_actions_ability_effect_type_check;

alter table public.combat_actions
  add constraint combat_actions_ability_effect_type_check
    check (
      ability_effect_type is null
      or ability_effect_type in ('damage', 'heal', 'status', 'manual')
    );

create or replace function private.seed_imported_spells_for_combatant(
  p_combatant_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $seed_spells$
declare
  v_source text;
  v_source_data jsonb;
  v_class jsonb;
  v_spell jsonb;
  v_spell_name text;
  v_description text;
  v_attr_a text;
  v_attr_b text;
  v_mp_cost integer;
  v_max_targets integer;
  v_magic_bonus integer := 0;
  v_sort integer := 100;
begin
  select
    characters.source,
    characters.source_data
  into
    v_source,
    v_source_data
  from public.combatants as combatants
  join public.characters as characters
    on characters.id = combatants.character_id
  where combatants.id = p_combatant_id;

  if v_source is distinct from 'fultimator' or v_source_data is null then
    return;
  end if;

  delete from public.combatant_abilities as abilities
  where abilities.combatant_id = p_combatant_id
    and abilities.source = 'fultimator';

  v_magic_bonus :=
    coalesce((v_source_data #>> '{modifiers,magicPrec}')::integer, 0)
    + coalesce(
        (
          select (armor.value ->> 'magicModifier')::integer
          from jsonb_array_elements(
            coalesce(v_source_data -> 'armor', '[]'::jsonb)
          ) as armor(value)
          where coalesce(armor.value ->> 'isEquipped', 'false') = 'true'
          limit 1
        ),
        0
      )
    + coalesce(
        (
          select (shield.value ->> 'magicModifier')::integer
          from jsonb_array_elements(
            coalesce(v_source_data -> 'shields', '[]'::jsonb)
          ) as shield(value)
          where coalesce(shield.value ->> 'isEquipped', 'false') = 'true'
          limit 1
        ),
        0
      )
    + coalesce(
        (
          select (accessory.value ->> 'magicModifier')::integer
          from jsonb_array_elements(
            coalesce(v_source_data -> 'accessories', '[]'::jsonb)
          ) as accessory(value)
          where coalesce(accessory.value ->> 'isEquipped', 'false') = 'true'
          limit 1
        ),
        0
      );

  for v_class in
    select class_entry.value
    from jsonb_array_elements(
      coalesce(v_source_data -> 'classes', '[]'::jsonb)
    ) as class_entry(value)
  loop
    for v_spell in
      select spell_entry.value
      from jsonb_array_elements(
        coalesce(v_class -> 'spells', '[]'::jsonb)
      ) as spell_entry(value)
    loop
      if lower(coalesce(v_spell ->> 'isOffensive', 'false')) <> 'true' then
        continue;
      end if;

      if coalesce(v_spell ->> 'spellType', 'default') <> 'default' then
        continue;
      end if;

      if lower(coalesce(v_spell ->> 'showInPlayerSheet', 'true')) = 'false' then
        continue;
      end if;

      v_spell_name := nullif(
        trim(coalesce(v_spell ->> 'name', v_spell ->> 'spellName', '')),
        ''
      );

      if v_spell_name is null then
        continue;
      end if;

      v_attr_a := case lower(coalesce(v_spell ->> 'attr1', 'insight'))
        when 'dex' then 'dex'
        when 'dexterity' then 'dex'
        when 'ins' then 'ins'
        when 'insight' then 'ins'
        when 'mig' then 'mig'
        when 'might' then 'mig'
        when 'wlp' then 'wlp'
        when 'will' then 'wlp'
        when 'willpower' then 'wlp'
        else 'ins'
      end;

      v_attr_b := case lower(coalesce(v_spell ->> 'attr2', 'will'))
        when 'dex' then 'dex'
        when 'dexterity' then 'dex'
        when 'ins' then 'ins'
        when 'insight' then 'ins'
        when 'mig' then 'mig'
        when 'might' then 'mig'
        when 'wlp' then 'wlp'
        when 'will' then 'wlp'
        when 'willpower' then 'wlp'
        else 'wlp'
      end;

      v_mp_cost := greatest(
        0,
        coalesce(
          nullif(v_spell ->> 'mp', '')::integer,
          nullif(v_spell ->> 'mpCostTarget', '')::integer,
          0
        )
      );

      v_max_targets := greatest(
        1,
        coalesce(
          nullif(v_spell ->> 'maxTargets', '')::integer,
          1
        )
      );

      v_description := nullif(
        trim(
          concat_ws(
            E'\n',
            nullif(v_spell ->> 'description', ''),
            nullif(v_spell ->> 'targetDesc', ''),
            nullif(v_spell ->> 'targetDescription', ''),
            nullif(v_spell ->> 'effect1', ''),
            nullif(v_spell ->> 'effect2', ''),
            nullif(v_spell ->> 'effect3', ''),
            nullif(v_spell ->> 'effect4', ''),
            nullif(v_spell ->> 'effect5', ''),
            nullif(v_spell ->> 'effect6', '')
          )
        ),
        ''
      );

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
        description,
        source,
        max_targets,
        sort_order
      )
      values (
        p_combatant_id,
        v_spell_name,
        'manual',
        'enemy',
        v_attr_a,
        v_attr_b,
        v_magic_bonus,
        v_mp_cost,
        0,
        null,
        0,
        null,
        v_description,
        'fultimator',
        v_max_targets,
        v_sort
      );

      v_sort := v_sort + 1;
    end loop;
  end loop;
end;
$seed_spells$;

revoke all on function private.seed_imported_spells_for_combatant(uuid)
  from public, anon, authenticated;

create or replace function private.seed_imported_spells_trigger()
returns trigger
language plpgsql
security definer
set search_path = ''
as $seed_spells_trigger$
begin
  if new.character_id is not null then
    perform private.seed_imported_spells_for_combatant(new.id);
  end if;

  return new;
end;
$seed_spells_trigger$;

revoke all on function private.seed_imported_spells_trigger()
  from public, anon, authenticated;

drop trigger if exists seed_imported_spells_after_combatant_insert
  on public.combatants;

create trigger seed_imported_spells_after_combatant_insert
after insert on public.combatants
for each row
execute function private.seed_imported_spells_trigger();

-- Backfill characters already added to a scene before this migration.
do $backfill$
declare
  v_combatant record;
begin
  for v_combatant in
    select combatants.id
    from public.combatants as combatants
    join public.characters as characters
      on characters.id = combatants.character_id
    where characters.source = 'fultimator'
  loop
    perform private.seed_imported_spells_for_combatant(v_combatant.id);
  end loop;
end
$backfill$;

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
  v_attr_a text;
  v_attr_b text;
  v_check_bonus integer;
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
  v_target_mdef integer;
  v_previous_hp integer;
  v_is_critical boolean;
  v_is_fumble boolean;
  v_is_hit boolean;
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
    raise exception 'Spell importada não encontrada.';
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
    raise exception 'Spell importada não encontrada.';
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
    raise exception 'MP insuficiente para usar esta spell.';
  end if;

  select
    target.name,
    target.side,
    target.magic_defense,
    target.hp
  into
    v_target_name,
    v_target_side,
    v_target_mdef,
    v_previous_hp
  from public.combatants as target
  where target.id = p_target_id
    and target.battle_id = v_battle_id
  for update;

  if v_target_name is null then
    raise exception 'Alvo não encontrado nesta batalha.';
  end if;

  if v_target_side = v_caster_side then
    raise exception 'Esta spell ofensiva exige um alvo inimigo.';
  end if;

  if v_previous_hp <= 0 then
    raise exception 'O alvo está com 0 HP.';
  end if;

  select *
  into v_turn
  from private.consume_combatant_turn(v_battle_id, v_caster_id);

  v_resulting_mp := v_previous_mp - v_mp_cost;

  update public.combatants as caster
  set mp = v_resulting_mp
  where caster.id = v_caster_id;

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
    v_target_mdef,
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
    v_target_mdef,
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
