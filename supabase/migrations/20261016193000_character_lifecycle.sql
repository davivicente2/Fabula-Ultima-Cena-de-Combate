-- Character / NPC lifecycle.
-- Removing a character from a scene snapshots the mutable combat state back
-- into the persistent character record before deleting only the scene instance.

create or replace function public.remove_character_from_scene(
  p_character_id uuid
)
returns table (
  character_id uuid,
  character_name text
)
language plpgsql
security definer
set search_path = ''
as $remove_character$
declare
  v_user_id uuid := auth.uid();
  v_combatant_id uuid;
  v_battle_id uuid;
  v_room_id uuid;
  v_conflict_started boolean;
  v_name text;
  v_profile jsonb;
  v_source_data jsonb;
  v_hp integer;
  v_max_hp integer;
  v_mp integer;
  v_max_mp integer;
  v_ip integer;
  v_max_ip integer;
  v_fp integer;
  v_dex integer;
  v_ins integer;
  v_mig integer;
  v_wlp integer;
  v_def integer;
  v_mdef integer;
  v_statuses text[];
begin
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;

  select
    combatants.id,
    combatants.battle_id,
    battles.room_id,
    battles.conflict_started,
    characters.name,
    characters.combat_profile,
    characters.source_data,
    combatants.hp,
    combatants.max_hp,
    combatants.mp,
    combatants.max_mp,
    combatants.ip,
    combatants.max_ip,
    combatants.fabula_points,
    combatants.base_dex_die,
    combatants.base_ins_die,
    combatants.base_mig_die,
    combatants.base_wlp_die,
    combatants.defense,
    combatants.magic_defense,
    combatants.statuses
  into
    v_combatant_id,
    v_battle_id,
    v_room_id,
    v_conflict_started,
    v_name,
    v_profile,
    v_source_data,
    v_hp,
    v_max_hp,
    v_mp,
    v_max_mp,
    v_ip,
    v_max_ip,
    v_fp,
    v_dex,
    v_ins,
    v_mig,
    v_wlp,
    v_def,
    v_mdef,
    v_statuses
  from public.characters as characters
  join public.combatants as combatants
    on combatants.character_id = characters.id
  join public.battles as battles
    on battles.id = combatants.battle_id
  where characters.id = p_character_id
  for update of combatants, characters;

  if v_combatant_id is null then
    raise exception 'Este personagem não está em nenhuma cena.';
  end if;

  if not private.is_room_host(v_room_id) then
    raise exception 'Apenas o GM pode remover participantes da cena.';
  end if;

  if coalesce(v_conflict_started, false) then
    raise exception 'Encerre o conflito antes de remover um participante da cena.';
  end if;

  v_profile :=
    coalesce(v_profile, '{}'::jsonb)
    || jsonb_build_object(
      'hp', jsonb_build_object('current', v_hp, 'max', v_max_hp),
      'mp', jsonb_build_object('current', v_mp, 'max', v_max_mp),
      'ip', jsonb_build_object('current', v_ip, 'max', v_max_ip),
      'attributes', jsonb_build_object(
        'dex', v_dex,
        'ins', v_ins,
        'mig', v_mig,
        'wlp', v_wlp
      ),
      'defense', v_def,
      'magicDefense', v_mdef,
      'statuses', to_jsonb(coalesce(v_statuses, array[]::text[]))
    );

  v_source_data :=
    coalesce(v_source_data, '{}'::jsonb)
    || jsonb_build_object(
      'info',
      coalesce(v_source_data -> 'info', '{}'::jsonb)
      || jsonb_build_object('fabulapoints', v_fp)
    );

  update public.characters as characters
  set
    combat_profile = v_profile,
    source_data = v_source_data,
    updated_at = now()
  where characters.id = p_character_id;

  delete from public.combatants as combatants
  where combatants.id = v_combatant_id;

  return query
  select p_character_id, v_name;
end;
$remove_character$;

revoke all on function public.remove_character_from_scene(uuid)
  from public, anon;
grant execute on function public.remove_character_from_scene(uuid)
  to authenticated;

create or replace function public.delete_character_record(
  p_character_id uuid
)
returns table (
  character_id uuid,
  character_name text
)
language plpgsql
security definer
set search_path = ''
as $delete_character$
declare
  v_user_id uuid := auth.uid();
  v_room_id uuid;
  v_owner_user_id uuid;
  v_kind text;
  v_name text;
begin
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;

  select
    characters.room_id,
    characters.owner_user_id,
    characters.kind,
    characters.name
  into
    v_room_id,
    v_owner_user_id,
    v_kind,
    v_name
  from public.characters as characters
  where characters.id = p_character_id
  for update;

  if v_room_id is null then
    raise exception 'Personagem não encontrado.';
  end if;

  if exists (
    select 1
    from public.combatants as combatants
    where combatants.character_id = p_character_id
  ) then
    raise exception 'Remova o personagem da cena antes de excluir a ficha.';
  end if;

  if not (
    private.is_room_host(v_room_id)
    or (
      v_kind = 'character'
      and v_owner_user_id = v_user_id
      and private.is_room_member(v_room_id)
    )
  ) then
    raise exception 'Você não pode excluir esta ficha.';
  end if;

  delete from public.characters as characters
  where characters.id = p_character_id;

  return query
  select p_character_id, v_name;
end;
$delete_character$;

revoke all on function public.delete_character_record(uuid)
  from public, anon;
grant execute on function public.delete_character_record(uuid)
  to authenticated;

create or replace function public.duplicate_character_record(
  p_character_id uuid,
  p_name text default null
)
returns table (
  character_id uuid,
  character_name text
)
language plpgsql
security definer
set search_path = ''
as $duplicate_character$
declare
  v_user_id uuid := auth.uid();
  v_source public.characters%rowtype;
  v_new_id uuid;
  v_name text;
begin
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;

  select *
  into v_source
  from public.characters as characters
  where characters.id = p_character_id;

  if v_source.id is null then
    raise exception 'Personagem não encontrado.';
  end if;

  if not private.is_room_host(v_source.room_id) then
    raise exception 'Apenas o GM pode duplicar fichas.';
  end if;

  v_name := coalesce(
    nullif(trim(p_name), ''),
    v_source.name || ' (cópia)'
  );

  if char_length(v_name) > 80 then
    raise exception 'O nome da cópia deve ter no máximo 80 caracteres.';
  end if;

  insert into public.characters (
    room_id,
    created_by,
    owner_user_id,
    name,
    kind,
    source,
    source_data,
    combat_profile
  )
  values (
    v_source.room_id,
    v_user_id,
    v_source.owner_user_id,
    v_name,
    v_source.kind,
    v_source.source,
    v_source.source_data,
    v_source.combat_profile
  )
  returning id into v_new_id;

  return query
  select v_new_id, v_name;
end;
$duplicate_character$;

revoke all on function public.duplicate_character_record(uuid, text)
  from public, anon;
grant execute on function public.duplicate_character_record(uuid, text)
  to authenticated;

create or replace function public.duplicate_character_to_battle(
  p_character_id uuid,
  p_battle_id uuid
)
returns table (
  character_id uuid,
  combatant_id uuid,
  character_name text
)
language plpgsql
security definer
set search_path = ''
as $duplicate_to_battle$
declare
  v_new_character_id uuid;
  v_new_name text;
  v_new_combatant_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  select duplicated.character_id, duplicated.character_name
  into v_new_character_id, v_new_name
  from public.duplicate_character_record(
    p_character_id,
    null
  ) as duplicated;

  select added.combatant_id
  into v_new_combatant_id
  from public.add_character_to_battle(
    v_new_character_id,
    p_battle_id
  ) as added;

  return query
  select v_new_character_id, v_new_combatant_id, v_new_name;
end;
$duplicate_to_battle$;

revoke all on function public.duplicate_character_to_battle(uuid, uuid)
  from public, anon;
grant execute on function public.duplicate_character_to_battle(uuid, uuid)
  to authenticated;
