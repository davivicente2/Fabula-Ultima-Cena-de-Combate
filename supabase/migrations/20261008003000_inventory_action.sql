-- Add authoritative Inventory actions for the three basic recovery items.
-- Fabula Ultima 1.1: Remedy costs 3 IP and restores 50 HP, Elixir costs
-- 3 IP and restores 50 MP, Tonic costs 2 IP and removes all status effects.

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
      'ability',
      'inventory'
    )
  );

alter table public.combat_actions
  add column if not exists inventory_item text
    check (
      inventory_item is null
      or inventory_item in ('remedy', 'elixir', 'tonic')
    ),
  add column if not exists previous_ip integer,
  add column if not exists resulting_ip integer,
  add column if not exists statuses_removed integer;

create or replace function public.perform_inventory_item(
  p_combatant_id uuid,
  p_target_id uuid,
  p_item text,
  p_expected_revision bigint
)
returns table (
  action_id uuid,
  combatant_id uuid,
  target_id uuid,
  inventory_item text,
  ip_cost integer,
  previous_ip integer,
  resulting_ip integer,
  previous_hp integer,
  resulting_hp integer,
  previous_mp integer,
  resulting_mp integer,
  statuses_removed integer,
  target_statuses text[],
  acted_round integer,
  next_round integer,
  next_side text,
  next_revision bigint
)
language plpgsql
security definer
set search_path = ''
as $inventory$
declare
  v_user_id uuid := auth.uid();
  v_battle_id uuid;
  v_room_id uuid;
  v_controller_user_id uuid;
  v_actor_name text;
  v_actor_side text;
  v_previous_ip integer;
  v_resulting_ip integer;
  v_ip_cost integer;

  v_target_name text;
  v_target_side text;
  v_previous_hp integer;
  v_resulting_hp integer;
  v_max_hp integer;
  v_previous_mp integer;
  v_resulting_mp integer;
  v_max_mp integer;
  v_previous_statuses text[];
  v_resulting_statuses text[];
  v_statuses_removed integer := 0;

  v_actor_display_name text;
  v_action_id uuid;
  v_turn record;
  v_next_revision bigint;
begin
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;

  if p_item not in ('remedy', 'elixir', 'tonic') then
    raise exception 'Item de inventário inválido.';
  end if;

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

  select
    battles.room_id,
    combatants.controller_user_id,
    combatants.name,
    combatants.side,
    combatants.ip
  into
    v_room_id,
    v_controller_user_id,
    v_actor_name,
    v_actor_side,
    v_previous_ip
  from public.combatants
  join public.battles on battles.id = combatants.battle_id
  where combatants.id = p_combatant_id
    and combatants.battle_id = v_battle_id
  for update of combatants;

  if not (
    private.is_room_host(v_room_id)
    or (
      v_controller_user_id = v_user_id
      and private.is_room_member(v_room_id)
    )
  ) then
    raise exception 'Você não controla este combatente.';
  end if;

  v_ip_cost := case p_item
    when 'remedy' then 3
    when 'elixir' then 3
    when 'tonic' then 2
  end;

  if v_previous_ip < v_ip_cost then
    raise exception 'IP insuficiente para criar este item.';
  end if;

  select
    combatants.name,
    combatants.side,
    combatants.hp,
    combatants.max_hp,
    combatants.mp,
    combatants.max_mp,
    combatants.statuses
  into
    v_target_name,
    v_target_side,
    v_previous_hp,
    v_max_hp,
    v_previous_mp,
    v_max_mp,
    v_previous_statuses
  from public.combatants
  where combatants.id = p_target_id
    and combatants.battle_id = v_battle_id
  for update;

  if v_target_name is null then
    raise exception 'Alvo não encontrado nesta batalha.';
  end if;

  if v_target_side <> v_actor_side then
    raise exception 'Itens de recuperação exigem você ou um aliado como alvo.';
  end if;

  if v_previous_hp <= 0 then
    raise exception 'O alvo está com 0 HP.';
  end if;

  select *
  into v_turn
  from private.consume_combatant_turn(v_battle_id, p_combatant_id);

  v_resulting_ip := v_previous_ip - v_ip_cost;
  v_resulting_hp := v_previous_hp;
  v_resulting_mp := v_previous_mp;
  v_resulting_statuses := v_previous_statuses;

  if p_item = 'remedy' then
    v_resulting_hp := least(v_max_hp, v_previous_hp + 50);

    update public.combatants
    set hp = v_resulting_hp
    where id = p_target_id;
  elsif p_item = 'elixir' then
    v_resulting_mp := least(v_max_mp, v_previous_mp + 50);

    update public.combatants
    set mp = v_resulting_mp
    where id = p_target_id;
  else
    v_statuses_removed := cardinality(v_previous_statuses);
    v_resulting_statuses := array[]::text[];

    update public.combatants
    set statuses = v_resulting_statuses
    where id = p_target_id;

    perform private.refresh_combatant_status_dice(p_target_id);
  end if;

  update public.combatants
  set ip = v_resulting_ip
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
    inventory_item,
    previous_ip,
    resulting_ip,
    statuses_removed,
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
    'inventory',
    case
      when p_item = 'remedy' then 50
      when p_item = 'elixir' then 50
      else 0
    end,
    v_resulting_hp - v_previous_hp,
    v_previous_hp,
    v_resulting_hp,
    p_combatant_id,
    v_actor_name,
    v_turn.acted_round,
    p_item,
    v_previous_ip,
    v_resulting_ip,
    v_statuses_removed,
    case when p_item = 'elixir' then 'mp' else null end,
    case when p_item = 'elixir' then v_previous_mp else null end,
    case when p_item = 'elixir' then v_resulting_mp else null end
  )
  returning id into v_action_id;

  update public.battles
  set turn_revision = turn_revision + 1
  where id = v_battle_id
  returning turn_revision into v_next_revision;

  return query
  select
    v_action_id,
    p_combatant_id,
    p_target_id,
    p_item,
    v_ip_cost,
    v_previous_ip,
    v_resulting_ip,
    v_previous_hp,
    v_resulting_hp,
    v_previous_mp,
    v_resulting_mp,
    v_statuses_removed,
    v_resulting_statuses,
    v_turn.acted_round,
    v_turn.next_round,
    v_turn.next_side,
    v_next_revision;
end;
$inventory$;

revoke all on function public.perform_inventory_item(uuid, uuid, text, bigint)
  from public, anon;
grant execute on function public.perform_inventory_item(uuid, uuid, text, bigint)
  to authenticated;
