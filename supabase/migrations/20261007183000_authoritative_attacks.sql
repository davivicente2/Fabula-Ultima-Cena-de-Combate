-- Add the minimum Fabula Ultima combat statistics and authoritative attacks.

alter table public.combatants
  add column if not exists dex_die integer not null default 8
    check (dex_die in (6, 8, 10, 12)),
  add column if not exists ins_die integer not null default 8
    check (ins_die in (6, 8, 10, 12)),
  add column if not exists mig_die integer not null default 8
    check (mig_die in (6, 8, 10, 12)),
  add column if not exists wlp_die integer not null default 8
    check (wlp_die in (6, 8, 10, 12)),
  add column if not exists defense integer not null default 10
    check (defense >= 0),
  add column if not exists magic_defense integer not null default 10
    check (magic_defense >= 0);

create table public.combatant_attacks (
  id uuid primary key default gen_random_uuid(),
  combatant_id uuid not null references public.combatants(id) on delete cascade,
  name text not null,
  accuracy_attribute_a text not null
    check (accuracy_attribute_a in ('dex', 'ins', 'mig', 'wlp')),
  accuracy_attribute_b text not null
    check (accuracy_attribute_b in ('dex', 'ins', 'mig', 'wlp')),
  accuracy_bonus integer not null default 0,
  damage_bonus integer not null default 0,
  damage_type text not null default 'physical',
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create index combatant_attacks_combatant_idx
  on public.combatant_attacks (combatant_id, sort_order);

alter table public.combatant_attacks enable row level security;

revoke all on table public.combatant_attacks from anon, authenticated;
grant select, insert, update, delete on table public.combatant_attacks to authenticated;

create policy "Room members can read combatant attacks"
  on public.combatant_attacks
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.combatants
      join public.battles on battles.id = combatants.battle_id
      where combatants.id = combatant_attacks.combatant_id
        and private.is_room_member(battles.room_id)
    )
  );

create policy "Room hosts can create combatant attacks"
  on public.combatant_attacks
  for insert
  to authenticated
  with check (
    exists (
      select 1
      from public.combatants
      join public.battles on battles.id = combatants.battle_id
      where combatants.id = combatant_attacks.combatant_id
        and private.is_room_host(battles.room_id)
    )
  );

create policy "Room hosts can update combatant attacks"
  on public.combatant_attacks
  for update
  to authenticated
  using (
    exists (
      select 1
      from public.combatants
      join public.battles on battles.id = combatants.battle_id
      where combatants.id = combatant_attacks.combatant_id
        and private.is_room_host(battles.room_id)
    )
  )
  with check (
    exists (
      select 1
      from public.combatants
      join public.battles on battles.id = combatants.battle_id
      where combatants.id = combatant_attacks.combatant_id
        and private.is_room_host(battles.room_id)
    )
  );

create policy "Room hosts can delete combatant attacks"
  on public.combatant_attacks
  for delete
  to authenticated
  using (
    exists (
      select 1
      from public.combatants
      join public.battles on battles.id = combatants.battle_id
      where combatants.id = combatant_attacks.combatant_id
        and private.is_room_host(battles.room_id)
    )
  );

-- Existing prototype combatants receive a simple placeholder attack.
insert into public.combatant_attacks (
  combatant_id,
  name,
  accuracy_attribute_a,
  accuracy_attribute_b,
  accuracy_bonus,
  damage_bonus,
  damage_type
)
select
  combatants.id,
  case
    when combatants.side = 'heroes' then 'Ataque básico'
    else 'Golpe'
  end,
  'dex',
  'mig',
  1,
  case
    when combatants.side = 'heroes' then 8
    else 6
  end,
  'physical'
from public.combatants
where not exists (
  select 1
  from public.combatant_attacks
  where combatant_attacks.combatant_id = combatants.id
);

-- Generalize the event log so attacks can coexist with direct HP adjustments.
alter table public.combat_actions
  drop constraint if exists combat_actions_action_type_check;

alter table public.combat_actions
  add constraint combat_actions_action_type_check
  check (action_type in ('hp_adjustment', 'attack'));

alter table public.combat_actions
  add column if not exists attacker_combatant_id uuid
    references public.combatants(id) on delete set null,
  add column if not exists attacker_name text,
  add column if not exists attack_name text,
  add column if not exists roll_a integer,
  add column if not exists roll_b integer,
  add column if not exists check_total integer,
  add column if not exists high_roll integer,
  add column if not exists target_defense integer,
  add column if not exists is_hit boolean,
  add column if not exists is_critical boolean,
  add column if not exists is_fumble boolean,
  add column if not exists damage integer,
  add column if not exists damage_type text;

create or replace function public.perform_combatant_attack(
  p_attack_id uuid,
  p_target_id uuid
)
returns table (
  action_id uuid,
  attacker_id uuid,
  target_id uuid,
  attack_name text,
  roll_a integer,
  roll_b integer,
  check_total integer,
  high_roll integer,
  target_defense integer,
  is_hit boolean,
  is_critical boolean,
  is_fumble boolean,
  damage integer,
  previous_hp integer,
  resulting_hp integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_battle_id uuid;
  v_room_id uuid;
  v_attacker_id uuid;
  v_controller_user_id uuid;
  v_attacker_name text;
  v_target_name text;
  v_actor_display_name text;
  v_attack_name text;
  v_attr_a text;
  v_attr_b text;
  v_accuracy_bonus integer;
  v_damage_bonus integer;
  v_damage_type text;
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
  v_target_defense integer;
  v_previous_hp integer;
  v_resulting_hp integer;
  v_is_critical boolean;
  v_is_fumble boolean;
  v_is_hit boolean;
  v_damage integer;
  v_action_id uuid;
begin
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;

  select
    attacks.combatant_id,
    attacks.name,
    attacks.accuracy_attribute_a,
    attacks.accuracy_attribute_b,
    attacks.accuracy_bonus,
    attacks.damage_bonus,
    attacks.damage_type,
    combatants.battle_id,
    battles.room_id,
    combatants.controller_user_id,
    combatants.name,
    combatants.dex_die,
    combatants.ins_die,
    combatants.mig_die,
    combatants.wlp_die
  into
    v_attacker_id,
    v_attack_name,
    v_attr_a,
    v_attr_b,
    v_accuracy_bonus,
    v_damage_bonus,
    v_damage_type,
    v_battle_id,
    v_room_id,
    v_controller_user_id,
    v_attacker_name,
    v_dex,
    v_ins,
    v_mig,
    v_wlp
  from public.combatant_attacks as attacks
  join public.combatants on combatants.id = attacks.combatant_id
  join public.battles on battles.id = combatants.battle_id
  where attacks.id = p_attack_id;

  if v_attacker_id is null then
    raise exception 'Ataque não encontrado.';
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

  select
    combatants.name,
    combatants.defense,
    combatants.hp
  into
    v_target_name,
    v_target_defense,
    v_previous_hp
  from public.combatants
  where combatants.id = p_target_id
    and combatants.battle_id = v_battle_id
  for update;

  if v_target_name is null then
    raise exception 'Alvo não encontrado nesta batalha.';
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
  v_total := v_roll_a + v_roll_b + v_accuracy_bonus;
  v_hr := greatest(v_roll_a, v_roll_b);
  v_is_fumble := v_roll_a = 1 and v_roll_b = 1;
  v_is_critical := v_roll_a = v_roll_b and v_roll_a >= 6;
  v_is_hit := not v_is_fumble
    and (v_is_critical or v_total >= v_target_defense);

  v_damage := case
    when v_is_hit then greatest(0, v_hr + v_damage_bonus)
    else 0
  end;

  v_resulting_hp := greatest(0, v_previous_hp - v_damage);

  if v_damage > 0 then
    update public.combatants
    set hp = v_resulting_hp
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

  if v_actor_display_name is null then
    v_actor_display_name := case
      when private.is_room_host(v_room_id) then 'GM'
      else 'Jogador'
    end;
  end if;

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
    attack_name,
    roll_a,
    roll_b,
    check_total,
    high_roll,
    target_defense,
    is_hit,
    is_critical,
    is_fumble,
    damage,
    damage_type
  )
  values (
    v_battle_id,
    v_user_id,
    v_actor_display_name,
    p_target_id,
    v_target_name,
    'attack',
    -v_damage,
    -v_damage,
    v_previous_hp,
    v_resulting_hp,
    v_attacker_id,
    v_attacker_name,
    v_attack_name,
    v_roll_a,
    v_roll_b,
    v_total,
    v_hr,
    v_target_defense,
    v_is_hit,
    v_is_critical,
    v_is_fumble,
    v_damage,
    v_damage_type
  )
  returning id into v_action_id;

  return query
  select
    v_action_id,
    v_attacker_id,
    p_target_id,
    v_attack_name,
    v_roll_a,
    v_roll_b,
    v_total,
    v_hr,
    v_target_defense,
    v_is_hit,
    v_is_critical,
    v_is_fumble,
    v_damage,
    v_previous_hp,
    v_resulting_hp;
end;
$$;

revoke all on function public.perform_combatant_attack(uuid, uuid)
  from public, anon;
grant execute on function public.perform_combatant_attack(uuid, uuid)
  to authenticated;
