-- Make MP and IP backend-authoritative.
-- Assigned players may spend their own resources; manual recovery is host-only.
-- Future skills/spells/items should change resources inside their own RPCs.

revoke update (mp, ip) on table public.combatants from authenticated;

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
      'resource_adjustment'
    )
  );

alter table public.combat_actions
  add column if not exists resource_name text
    check (resource_name is null or resource_name in ('mp', 'ip')),
  add column if not exists previous_resource integer,
  add column if not exists resulting_resource integer;

create or replace function public.adjust_combatant_resource(
  p_combatant_id uuid,
  p_resource text,
  p_delta integer
)
returns table (
  action_id uuid,
  combatant_id uuid,
  resource_name text,
  previous_value integer,
  value integer,
  max_value integer,
  applied_delta integer
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
  v_previous integer;
  v_max integer;
  v_next integer;
  v_applied integer;
  v_action_id uuid;
  v_is_host boolean;
  v_actor_display_name text;
begin
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;

  if p_resource not in ('mp', 'ip') then
    raise exception 'Recurso inválido.';
  end if;

  if p_delta is null or p_delta = 0 then
    raise exception 'O ajuste não pode ser zero.';
  end if;

  if p_delta < -9999 or p_delta > 9999 then
    raise exception 'Ajuste fora do limite permitido.';
  end if;

  select
    combatants.battle_id,
    battles.room_id,
    combatants.controller_user_id,
    combatants.name,
    combatants.hp,
    case when p_resource = 'mp' then combatants.mp else combatants.ip end,
    case when p_resource = 'mp' then combatants.max_mp else combatants.max_ip end
  into
    v_battle_id,
    v_room_id,
    v_controller_user_id,
    v_name,
    v_hp,
    v_previous,
    v_max
  from public.combatants
  join public.battles on battles.id = combatants.battle_id
  where combatants.id = p_combatant_id
  for update of combatants;

  if v_battle_id is null then
    raise exception 'Combatente não encontrado.';
  end if;

  v_is_host := private.is_room_host(v_room_id);

  if not (
    v_is_host
    or (
      v_controller_user_id = v_user_id
      and private.is_room_member(v_room_id)
    )
  ) then
    raise exception 'Você não controla este combatente.';
  end if;

  -- Manual recovery is a GM/debug operation. Player-facing recovery will be
  -- performed by the authoritative spell/item/skill that grants it.
  if p_delta > 0 and not v_is_host then
    raise exception 'Apenas o GM pode recuperar recursos manualmente.';
  end if;

  v_next := greatest(0, least(v_max, v_previous + p_delta));
  v_applied := v_next - v_previous;

  if v_applied <> 0 then
    if p_resource = 'mp' then
      update public.combatants
      set mp = v_next
      where id = p_combatant_id;
    else
      update public.combatants
      set ip = v_next
      where id = p_combatant_id;
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
      resource_name,
      previous_resource,
      resulting_resource
    )
    values (
      v_battle_id,
      v_user_id,
      coalesce(v_actor_display_name, 'Jogador'),
      p_combatant_id,
      v_name,
      'resource_adjustment',
      p_delta,
      v_applied,
      v_hp,
      v_hp,
      p_combatant_id,
      v_name,
      p_resource,
      v_previous,
      v_next
    )
    returning id into v_action_id;
  end if;

  return query
  select
    v_action_id,
    p_combatant_id,
    p_resource,
    v_previous,
    v_next,
    v_max,
    v_applied;
end;
$$;

revoke all on function public.adjust_combatant_resource(uuid, text, integer)
  from public, anon;
grant execute on function public.adjust_combatant_resource(uuid, text, integer)
  to authenticated;
