-- Host-only scene roster management.
-- Editing the roster is intentionally restricted to conflicts that are stopped,
-- so the current round cannot be invalidated by removing/adding participants.

create or replace function public.create_scene_combatant(
  p_battle_id uuid,
  p_name text,
  p_side text,
  p_max_hp integer,
  p_max_mp integer,
  p_max_ip integer,
  p_dex_die integer,
  p_ins_die integer,
  p_mig_die integer,
  p_wlp_die integer,
  p_defense integer,
  p_magic_defense integer,
  p_attack_name text,
  p_attack_attribute_a text,
  p_attack_attribute_b text,
  p_attack_bonus integer,
  p_damage_bonus integer,
  p_damage_type text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $manager$
declare
  v_room_id uuid;
  v_conflict_started boolean;
  v_combatant_id uuid;
  v_sort_order integer;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  select battles.room_id, battles.conflict_started
  into v_room_id, v_conflict_started
  from public.battles
  where battles.id = p_battle_id
  for update;

  if v_room_id is null then
    raise exception 'Batalha não encontrada.';
  end if;

  if not private.is_room_host(v_room_id) then
    raise exception 'Apenas o GM pode gerenciar combatentes.';
  end if;

  if v_conflict_started then
    raise exception 'Encerre o conflito antes de adicionar combatentes.';
  end if;

  if nullif(trim(p_name), '') is null then
    raise exception 'Nome obrigatório.';
  end if;

  if p_side not in ('heroes', 'enemies') then
    raise exception 'Lado inválido.';
  end if;

  if p_max_hp < 1 or p_max_mp < 0 or p_max_ip < 0 then
    raise exception 'Recursos máximos inválidos.';
  end if;

  if p_dex_die not in (6, 8, 10, 12)
    or p_ins_die not in (6, 8, 10, 12)
    or p_mig_die not in (6, 8, 10, 12)
    or p_wlp_die not in (6, 8, 10, 12) then
    raise exception 'Dados de atributo inválidos.';
  end if;

  if p_attack_attribute_a not in ('dex', 'ins', 'mig', 'wlp')
    or p_attack_attribute_b not in ('dex', 'ins', 'mig', 'wlp') then
    raise exception 'Atributo de ataque inválido.';
  end if;

  if p_damage_type not in (
    'physical','air','bolt','dark','earth','fire','ice','light','poison'
  ) then
    raise exception 'Tipo de dano inválido.';
  end if;

  select coalesce(max(combatants.sort_order), -1) + 1
  into v_sort_order
  from public.combatants
  where combatants.battle_id = p_battle_id;

  insert into public.combatants (
    battle_id,
    name,
    side,
    hp,
    max_hp,
    mp,
    max_mp,
    ip,
    max_ip,
    dex_die,
    ins_die,
    mig_die,
    wlp_die,
    base_dex_die,
    base_ins_die,
    base_mig_die,
    base_wlp_die,
    defense,
    magic_defense,
    statuses,
    last_acted_round,
    sort_order
  )
  values (
    p_battle_id,
    trim(p_name),
    p_side,
    p_max_hp,
    p_max_hp,
    p_max_mp,
    p_max_mp,
    p_max_ip,
    p_max_ip,
    p_dex_die,
    p_ins_die,
    p_mig_die,
    p_wlp_die,
    p_dex_die,
    p_ins_die,
    p_mig_die,
    p_wlp_die,
    greatest(0, p_defense),
    greatest(0, p_magic_defense),
    array[]::text[],
    0,
    v_sort_order
  )
  returning id into v_combatant_id;

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
    coalesce(nullif(trim(p_attack_name), ''), 'Ataque básico'),
    p_attack_attribute_a,
    p_attack_attribute_b,
    p_attack_bonus,
    p_damage_bonus,
    p_damage_type,
    0
  );

  return v_combatant_id;
end;
$manager$;

create or replace function public.delete_scene_combatant(
  p_combatant_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $manager$
declare
  v_room_id uuid;
  v_conflict_started boolean;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  select battles.room_id, battles.conflict_started
  into v_room_id, v_conflict_started
  from public.combatants
  join public.battles on battles.id = combatants.battle_id
  where combatants.id = p_combatant_id
  for update of battles;

  if v_room_id is null then
    raise exception 'Combatente não encontrado.';
  end if;

  if not private.is_room_host(v_room_id) then
    raise exception 'Apenas o GM pode gerenciar combatentes.';
  end if;

  if v_conflict_started then
    raise exception 'Encerre o conflito antes de remover combatentes.';
  end if;

  delete from public.combatants
  where id = p_combatant_id;

  return p_combatant_id;
end;
$manager$;

revoke all on function public.create_scene_combatant(
  uuid, text, text, integer, integer, integer,
  integer, integer, integer, integer,
  integer, integer, text, text, text, integer, integer, text
) from public, anon;

revoke all on function public.delete_scene_combatant(uuid)
  from public, anon;

grant execute on function public.create_scene_combatant(
  uuid, text, text, integer, integer, integer,
  integer, integer, integer, integer,
  integer, integer, text, text, text, integer, integer, text
) to authenticated;

grant execute on function public.delete_scene_combatant(uuid)
  to authenticated;
