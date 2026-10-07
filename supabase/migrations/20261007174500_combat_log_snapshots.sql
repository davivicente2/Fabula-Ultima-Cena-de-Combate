-- Store human-readable snapshots in the combat log and expose new actions
-- through Realtime. Snapshots keep historical entries readable even if names
-- change later or a player disconnects.

alter table public.combat_actions
  add column if not exists actor_display_name text,
  add column if not exists target_name text;

update public.combat_actions as actions
set target_name = combatants.name
from public.combatants
where actions.target_combatant_id = combatants.id
  and actions.target_name is null;

update public.combat_actions as actions
set actor_display_name = coalesce(
  nullif(trim(members.display_name), ''),
  case when members.role = 'host' then 'GM' else 'Jogador' end
)
from public.battles
join public.room_members as members
  on members.room_id = battles.room_id
where actions.battle_id = battles.id
  and actions.actor_user_id = members.user_id
  and actions.actor_display_name is null;

create or replace function public.apply_combatant_hp_delta(
  p_combatant_id uuid,
  p_delta integer
)
returns table (
  action_id uuid,
  combatant_id uuid,
  previous_hp integer,
  hp integer,
  max_hp integer,
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
  v_target_name text;
  v_actor_display_name text;
  v_previous_hp integer;
  v_max_hp integer;
  v_next_hp integer;
  v_applied_delta integer;
  v_action_id uuid;
begin
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;

  if p_delta is null or p_delta = 0 then
    raise exception 'O ajuste de HP não pode ser zero.';
  end if;

  if p_delta < -9999 or p_delta > 9999 then
    raise exception 'Ajuste de HP fora do limite permitido.';
  end if;

  select
    combatants.battle_id,
    battles.room_id,
    combatants.controller_user_id,
    combatants.name,
    combatants.hp,
    combatants.max_hp
  into
    v_battle_id,
    v_room_id,
    v_controller_user_id,
    v_target_name,
    v_previous_hp,
    v_max_hp
  from public.combatants
  join public.battles on battles.id = combatants.battle_id
  where combatants.id = p_combatant_id
  for update of combatants;

  if v_battle_id is null then
    raise exception 'Combatente não encontrado.';
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

  select coalesce(
    nullif(trim(room_members.display_name), ''),
    case when room_members.role = 'host' then 'GM' else 'Jogador' end
  )
  into v_actor_display_name
  from public.room_members
  where room_members.room_id = v_room_id
    and room_members.user_id = v_user_id;

  if v_actor_display_name is null then
    v_actor_display_name := case
      when private.is_room_host(v_room_id) then 'GM'
      else 'Jogador'
    end;
  end if;

  v_next_hp := greatest(0, least(v_max_hp, v_previous_hp + p_delta));
  v_applied_delta := v_next_hp - v_previous_hp;

  if v_applied_delta <> 0 then
    update public.combatants
    set hp = v_next_hp
    where id = p_combatant_id;

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
      resulting_hp
    )
    values (
      v_battle_id,
      v_user_id,
      v_actor_display_name,
      p_combatant_id,
      v_target_name,
      'hp_adjustment',
      p_delta,
      v_applied_delta,
      v_previous_hp,
      v_next_hp
    )
    returning id into v_action_id;
  end if;

  return query
  select
    v_action_id,
    p_combatant_id,
    v_previous_hp,
    v_next_hp,
    v_max_hp,
    v_applied_delta;
end;
$$;

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'combat_actions'
  ) then
    execute 'alter publication supabase_realtime add table public.combat_actions';
  end if;
end
$$;
