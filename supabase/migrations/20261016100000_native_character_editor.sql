-- Native character editing.
-- Character records remain the source of truth outside a conflict. Saving a
-- character also refreshes its current scene representation when no conflict
-- is active.

-- PR #19 was an experimental Fultimator spell importer. If its migration was
-- manually applied during testing, retire its insert trigger so the native
-- editor remains the single source of combat abilities. The experimental
-- functions/columns can remain harmlessly until that feature is redesigned.
drop trigger if exists seed_imported_spells_after_combatant_insert
  on public.combatants;

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
    values (
      p_combatant_id,
      v_ability ->> 'name',
      case
        when v_ability ->> 'effectType' in ('damage', 'heal', 'status')
        then v_ability ->> 'effectType'
        else 'damage'
      end,
      case
        when v_ability ->> 'targetRelation' in ('enemy', 'ally')
        then v_ability ->> 'targetRelation'
        else 'enemy'
      end,
      case
        when v_ability ->> 'checkAttributeA' in ('dex', 'ins', 'mig', 'wlp')
        then v_ability ->> 'checkAttributeA'
        else 'ins'
      end,
      case
        when v_ability ->> 'checkAttributeB' in ('dex', 'ins', 'mig', 'wlp')
        then v_ability ->> 'checkAttributeB'
        else 'wlp'
      end,
      coalesce((v_ability ->> 'checkBonus')::integer, 0),
      greatest(0, coalesce((v_ability ->> 'mpCost')::integer, 0)),
      coalesce((v_ability ->> 'damageBonus')::integer, 0),
      case
        when v_ability ->> 'effectType' = 'damage'
          and v_ability ->> 'damageType' in (
            'physical', 'air', 'bolt', 'dark', 'earth',
            'fire', 'ice', 'light', 'poison'
          )
        then v_ability ->> 'damageType'
        else null
      end,
      case
        when v_ability ->> 'effectType' = 'heal'
        then greatest(1, coalesce((v_ability ->> 'healAmount')::integer, 1))
        else 0
      end,
      case
        when v_ability ->> 'effectType' = 'status'
          and v_ability ->> 'statusEffect' in (
            'slow', 'dazed', 'weak', 'shaken', 'enraged', 'poisoned'
          )
        then v_ability ->> 'statusEffect'
        else null
      end,
      coalesce((v_ability ->> 'sortOrder')::integer, 0)
    );
  end loop;
end;
$seed_profile_abilities$;

revoke all on function private.seed_profile_abilities(uuid, jsonb)
  from public, anon, authenticated;

create or replace function private.sync_character_to_combatant(
  p_character_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $sync_character$
declare
  v_combatant_id uuid;
  v_battle_id uuid;
  v_conflict_started boolean;
  v_name text;
  v_kind text;
  v_profile jsonb;
  v_side text;
  v_hp integer;
  v_max_hp integer;
  v_mp integer;
  v_max_mp integer;
  v_ip integer;
  v_max_ip integer;
  v_dex integer;
  v_ins integer;
  v_mig integer;
  v_wlp integer;
  v_def integer;
  v_mdef integer;
  v_statuses text[];
  v_attack jsonb;
  v_affinity record;
begin
  select
    combatants.id,
    combatants.battle_id,
    battles.conflict_started,
    characters.name,
    characters.kind,
    characters.combat_profile
  into
    v_combatant_id,
    v_battle_id,
    v_conflict_started,
    v_name,
    v_kind,
    v_profile
  from public.characters as characters
  left join public.combatants as combatants
    on combatants.character_id = characters.id
  left join public.battles as battles
    on battles.id = combatants.battle_id
  where characters.id = p_character_id;

  if v_combatant_id is null then
    return;
  end if;

  if coalesce(v_conflict_started, false) then
    raise exception 'Encerre o conflito antes de editar uma ficha que está na cena.';
  end if;

  v_side := case
    when v_kind = 'npc' then 'enemies'
    else coalesce(v_profile ->> 'side', 'heroes')
  end;

  if v_side not in ('heroes', 'enemies') then
    v_side := case when v_kind = 'npc' then 'enemies' else 'heroes' end;
  end if;

  v_max_hp := greatest(1, coalesce((v_profile #>> '{hp,max}')::integer, 1));
  v_hp := greatest(
    0,
    least(v_max_hp, coalesce((v_profile #>> '{hp,current}')::integer, v_max_hp))
  );
  v_max_mp := greatest(0, coalesce((v_profile #>> '{mp,max}')::integer, 0));
  v_mp := greatest(
    0,
    least(v_max_mp, coalesce((v_profile #>> '{mp,current}')::integer, v_max_mp))
  );
  v_max_ip := greatest(0, coalesce((v_profile #>> '{ip,max}')::integer, 0));
  v_ip := greatest(
    0,
    least(v_max_ip, coalesce((v_profile #>> '{ip,current}')::integer, v_max_ip))
  );

  v_dex := coalesce((v_profile #>> '{attributes,dex}')::integer, 8);
  v_ins := coalesce((v_profile #>> '{attributes,ins}')::integer, 8);
  v_mig := coalesce((v_profile #>> '{attributes,mig}')::integer, 8);
  v_wlp := coalesce((v_profile #>> '{attributes,wlp}')::integer, 8);

  if v_dex not in (6, 8, 10, 12)
    or v_ins not in (6, 8, 10, 12)
    or v_mig not in (6, 8, 10, 12)
    or v_wlp not in (6, 8, 10, 12)
  then
    raise exception 'Dados de atributo inválidos no perfil de combate.';
  end if;

  v_def := greatest(0, coalesce((v_profile ->> 'defense')::integer, v_dex));
  v_mdef := greatest(0, coalesce((v_profile ->> 'magicDefense')::integer, v_ins));

  select coalesce(array_agg(value), array[]::text[])
  into v_statuses
  from jsonb_array_elements_text(
    coalesce(v_profile -> 'statuses', '[]'::jsonb)
  ) as status(value)
  where value in (
    'slow', 'dazed', 'weak', 'shaken', 'enraged', 'poisoned'
  );

  update public.combatants as combatants
  set
    name = v_name,
    side = v_side,
    hp = v_hp,
    max_hp = v_max_hp,
    mp = v_mp,
    max_mp = v_max_mp,
    ip = v_ip,
    max_ip = v_max_ip,
    dex_die = v_dex,
    ins_die = v_ins,
    mig_die = v_mig,
    wlp_die = v_wlp,
    base_dex_die = v_dex,
    base_ins_die = v_ins,
    base_mig_die = v_mig,
    base_wlp_die = v_wlp,
    defense = v_def,
    magic_defense = v_mdef,
    statuses = v_statuses
  where combatants.id = v_combatant_id;

  delete from public.combatant_attacks as attacks
  where attacks.combatant_id = v_combatant_id;

  for v_attack in
    select value
    from jsonb_array_elements(
      coalesce(v_profile -> 'attacks', '[]'::jsonb)
    )
  loop
    if coalesce(v_attack ->> 'name', '') = '' then
      continue;
    end if;

    insert into public.combatant_attacks (
      combatant_id,
      name,
      accuracy_attribute_a,
      accuracy_attribute_b,
      accuracy_bonus,
      damage_bonus,
      damage_type,
      sort_order
    )
    values (
      v_combatant_id,
      v_attack ->> 'name',
      case
        when v_attack ->> 'accuracyAttributeA' in ('dex', 'ins', 'mig', 'wlp')
        then v_attack ->> 'accuracyAttributeA'
        else 'dex'
      end,
      case
        when v_attack ->> 'accuracyAttributeB' in ('dex', 'ins', 'mig', 'wlp')
        then v_attack ->> 'accuracyAttributeB'
        else 'mig'
      end,
      coalesce((v_attack ->> 'accuracyBonus')::integer, 0),
      coalesce((v_attack ->> 'damageBonus')::integer, 0),
      case
        when v_attack ->> 'damageType' in (
          'physical', 'air', 'bolt', 'dark', 'earth',
          'fire', 'ice', 'light', 'poison'
        )
        then v_attack ->> 'damageType'
        else 'physical'
      end,
      coalesce((v_attack ->> 'sortOrder')::integer, 0)
    );
  end loop;

  perform private.seed_profile_abilities(v_combatant_id, v_profile);

  delete from public.combatant_affinities as affinities
  where affinities.combatant_id = v_combatant_id;

  for v_affinity in
    select key, value
    from jsonb_each_text(
      coalesce(v_profile -> 'affinities', '{}'::jsonb)
    )
  loop
    if v_affinity.key in (
      'physical', 'air', 'bolt', 'dark', 'earth',
      'fire', 'ice', 'light', 'poison'
    )
    and v_affinity.value in (
      'vulnerable', 'resistant', 'immune', 'absorbs'
    )
    then
      insert into public.combatant_affinities (
        combatant_id,
        damage_type,
        affinity
      )
      values (
        v_combatant_id,
        v_affinity.key,
        v_affinity.value
      );
    end if;
  end loop;

  perform private.refresh_combatant_status_dice(v_combatant_id);
end;
$sync_character$;

revoke all on function private.sync_character_to_combatant(uuid)
  from public, anon, authenticated;

create or replace function public.update_character_record(
  p_character_id uuid,
  p_name text,
  p_source_data jsonb,
  p_combat_profile jsonb
)
returns table (
  character_id uuid,
  character_name text
)
language plpgsql
security definer
set search_path = ''
as $character_update$
declare
  v_user_id uuid := auth.uid();
  v_room_id uuid;
  v_owner_user_id uuid;
  v_name text := nullif(trim(p_name), '');
begin
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;

  select
    characters.room_id,
    characters.owner_user_id
  into
    v_room_id,
    v_owner_user_id
  from public.characters as characters
  where characters.id = p_character_id;

  if v_room_id is null then
    raise exception 'Personagem não encontrado.';
  end if;

  if not private.is_room_member(v_room_id) then
    raise exception 'Você não pertence a esta sala.';
  end if;

  if not (
    private.is_room_host(v_room_id)
    or v_owner_user_id = v_user_id
  ) then
    raise exception 'Você não pode editar esta ficha.';
  end if;

  if v_name is null then
    raise exception 'O personagem precisa de um nome.';
  end if;

  if jsonb_typeof(coalesce(p_combat_profile, '{}'::jsonb)) <> 'object' then
    raise exception 'Perfil de combate inválido.';
  end if;

  -- Sync first after staging the new data. The transaction rolls back the
  -- character update too if the current scene is in an active conflict.
  update public.characters as characters
  set
    name = v_name,
    source_data = coalesce(p_source_data, '{}'::jsonb),
    combat_profile = coalesce(p_combat_profile, '{}'::jsonb),
    updated_at = now()
  where characters.id = p_character_id;

  perform private.sync_character_to_combatant(p_character_id);

  return query
  select p_character_id, v_name;
end;
$character_update$;

revoke all on function public.update_character_record(
  uuid, text, jsonb, jsonb
) from public, anon;
grant execute on function public.update_character_record(
  uuid, text, jsonb, jsonb
) to authenticated;

-- Characters added to a scene should receive native profile abilities.
create or replace function private.seed_character_profile_abilities_trigger()
returns trigger
language plpgsql
security definer
set search_path = ''
as $profile_abilities_trigger$
declare
  v_profile jsonb;
begin
  if new.character_id is null then
    return new;
  end if;

  select characters.combat_profile
  into v_profile
  from public.characters as characters
  where characters.id = new.character_id;

  perform private.seed_profile_abilities(new.id, coalesce(v_profile, '{}'::jsonb));
  return new;
end;
$profile_abilities_trigger$;

revoke all on function private.seed_character_profile_abilities_trigger()
  from public, anon, authenticated;

drop trigger if exists seed_character_profile_abilities_after_insert
  on public.combatants;

create trigger seed_character_profile_abilities_after_insert
after insert on public.combatants
for each row
execute function private.seed_character_profile_abilities_trigger();

-- Backfill native/profile abilities for linked combatants already in a scene.
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
