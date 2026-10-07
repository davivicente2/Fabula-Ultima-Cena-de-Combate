-- Route HP changes through an authoritative database action.
-- The client requests a delta; the database validates control, clamps HP,
-- updates the snapshot and stores an action log entry.

create table if not exists public.combat_actions (
  id uuid primary key default gen_random_uuid(),
  battle_id uuid not null references public.battles(id) on delete cascade,
  actor_user_id uuid references auth.users(id) on delete set null,
  target_combatant_id uuid references public.combatants(id) on delete set null,
  action_type text not null check (action_type in ('hp_adjustment')),
  requested_delta integer not null,
  applied_delta integer not null,
  previous_hp integer not null,
  resulting_hp integer not null,
  created_at timestamptz not null default now()
);

create index if not exists combat_actions_battle_created_idx
  on public.combat_actions (battle_id, created_at desc);

alter table public.combat_actions enable row level security;

revoke all on table public.combat_actions from anon, authenticated;
grant select on table public.combat_actions to authenticated;

drop policy if exists "Room members can read combat actions"
  on public.combat_actions;

create policy "Room members can read combat actions"
  on public.combat_actions
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.battles
      where battles.id = combat_actions.battle_id
        and private.is_room_member(battles.room_id)
    )
  );

-- Assigned control remains valid only while the user is still a room member.
drop policy if exists "Hosts or assigned players can update combatants"
  on public.combatants;

create policy "Hosts or assigned players can update combatants"
  on public.combatants
  for update
  to authenticated
  using (
    exists (
      select 1
      from public.battles
      where battles.id = combatants.battle_id
        and (
          private.is_room_host(battles.room_id)
          or (
            combatants.controller_user_id = auth.uid()
            and private.is_room_member(battles.room_id)
          )
        )
    )
  )
  with check (
    exists (
      select 1
      from public.battles
      where battles.id = combatants.battle_id
        and (
          private.is_room_host(battles.room_id)
          or (
            combatants.controller_user_id = auth.uid()
            and private.is_room_member(battles.room_id)
          )
        )
    )
  );

-- HP is no longer directly writable from the browser.
revoke update (hp) on table public.combatants from authenticated;

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
    combatants.hp,
    combatants.max_hp
  into
    v_battle_id,
    v_room_id,
    v_controller_user_id,
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

  v_next_hp := greatest(0, least(v_max_hp, v_previous_hp + p_delta));
  v_applied_delta := v_next_hp - v_previous_hp;

  if v_applied_delta <> 0 then
    update public.combatants
    set hp = v_next_hp
    where id = p_combatant_id;

    insert into public.combat_actions (
      battle_id,
      actor_user_id,
      target_combatant_id,
      action_type,
      requested_delta,
      applied_delta,
      previous_hp,
      resulting_hp
    )
    values (
      v_battle_id,
      v_user_id,
      p_combatant_id,
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

revoke all on function public.apply_combatant_hp_delta(uuid, integer)
  from public, anon;
grant execute on function public.apply_combatant_hp_delta(uuid, integer)
  to authenticated;
