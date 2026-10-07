-- Add Fabula Ultima damage affinities and resolve them inside attacks.

alter table public.combatant_attacks
  drop constraint if exists combatant_attacks_damage_type_check;

alter table public.combatant_attacks
  add constraint combatant_attacks_damage_type_check
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
  );

create table if not exists public.combatant_affinities (
  combatant_id uuid not null
    references public.combatants(id) on delete cascade,
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
  affinity text not null
    check (
      affinity in (
        'vulnerable',
        'resistant',
        'immune',
        'absorbs'
      )
    ),
  primary key (combatant_id, damage_type)
);

alter table public.combatant_affinities enable row level security;

revoke all on table public.combatant_affinities from anon, authenticated;
grant select, insert, update, delete
  on table public.combatant_affinities
  to authenticated;

drop policy if exists "Room members can read combatant affinities" on public.combatant_affinities;

create policy "Room members can read combatant affinities"
  on public.combatant_affinities
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.combatants
      join public.battles on battles.id = combatants.battle_id
      where combatants.id = combatant_affinities.combatant_id
        and private.is_room_member(battles.room_id)
    )
  );

drop policy if exists "Room hosts can create combatant affinities" on public.combatant_affinities;

create policy "Room hosts can create combatant affinities"
  on public.combatant_affinities
  for insert
  to authenticated
  with check (
    exists (
      select 1
      from public.combatants
      join public.battles on battles.id = combatants.battle_id
      where combatants.id = combatant_affinities.combatant_id
        and private.is_room_host(battles.room_id)
    )
  );

drop policy if exists "Room hosts can update combatant affinities" on public.combatant_affinities;

create policy "Room hosts can update combatant affinities"
  on public.combatant_affinities
  for update
  to authenticated
  using (
    exists (
      select 1
      from public.combatants
      join public.battles on battles.id = combatants.battle_id
      where combatants.id = combatant_affinities.combatant_id
        and private.is_room_host(battles.room_id)
    )
  )
  with check (
    exists (
      select 1
      from public.combatants
      join public.battles on battles.id = combatants.battle_id
      where combatants.id = combatant_affinities.combatant_id
        and private.is_room_host(battles.room_id)
    )
  );

drop policy if exists "Room hosts can delete combatant affinities" on public.combatant_affinities;

create policy "Room hosts can delete combatant affinities"
  on public.combatant_affinities
  for delete
  to authenticated
  using (
    exists (
      select 1
      from public.combatants
      join public.battles on battles.id = combatants.battle_id
      where combatants.id = combatant_affinities.combatant_id
        and private.is_room_host(battles.room_id)
    )
  );

alter table public.combat_actions
  add column if not exists damage_affinity text
    check (
      damage_affinity is null
      or damage_affinity in (
        'neutral',
        'vulnerable',
        'resistant',
        'immune',
        'absorbs'
      )
    );

-- Make the prototype cast exercise every affinity in ordinary play.
update public.combatant_attacks as attacks
set damage_type = case combatants.name
  when 'Cael' then 'bolt'
  when 'Lobo de Cinzas' then 'poison'
  else attacks.damage_type
end
from public.combatants
where combatants.id = attacks.combatant_id
  and combatants.name in ('Cael', 'Lobo de Cinzas');

insert into public.combatant_affinities (
  combatant_id,
  damage_type,
  affinity
)
select id, 'physical', 'resistant'
from public.combatants
where name = 'Aurora'
on conflict (combatant_id, damage_type)
do update set affinity = excluded.affinity;

insert into public.combatant_affinities (
  combatant_id,
  damage_type,
  affinity
)
select id, 'poison', 'immune'
from public.combatants
where name = 'Aurora'
on conflict (combatant_id, damage_type)
do update set affinity = excluded.affinity;

insert into public.combatant_affinities (
  combatant_id,
  damage_type,
  affinity
)
select id, 'physical', 'vulnerable'
from public.combatants
where name = 'Cael'
on conflict (combatant_id, damage_type)
do update set affinity = excluded.affinity;

insert into public.combatant_affinities (
  combatant_id,
  damage_type,
  affinity
)
select id, 'poison', 'absorbs'
from public.combatants
where name = 'Cael'
on conflict (combatant_id, damage_type)
do update set affinity = excluded.affinity;

insert into public.combatant_affinities (
  combatant_id,
  damage_type,
  affinity
)
select id, 'physical', 'vulnerable'
from public.combatants
where name = 'Lobo de Cinzas'
on conflict (combatant_id, damage_type)
do update set affinity = excluded.affinity;

insert into public.combatant_affinities (
  combatant_id,
  damage_type,
  affinity
)
select id, 'physical', 'resistant'
from public.combatants
where name = 'Cavaleiro Rubro'
on conflict (combatant_id, damage_type)
do update set affinity = excluded.affinity;

insert into public.combatant_affinities (
  combatant_id,
  damage_type,
  affinity
)
select id, 'bolt', 'vulnerable'
from public.combatants
where name = 'Cavaleiro Rubro'
on conflict (combatant_id, damage_type)
do update set affinity = excluded.affinity;

drop function if exists public.perform_combatant_attack(uuid, uuid);

create function public.perform_combatant_attack(
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
  damage_type text,
  damage_affinity text,
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
  v_damage_affinity text := 'neutral';
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
  v_max_hp integer;
  v_resulting_hp integer;
  v_is_critical boolean;
  v_is_fumble boolean;
  v_is_hit boolean;
  v_raw_damage integer;
  v_hp_amount integer;
  v_applied_delta integer;
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
    combatants.hp,
    combatants.max_hp
  into
    v_target_name,
    v_target_defense,
    v_previous_hp,
    v_max_hp
  from public.combatants
  where combatants.id = p_target_id
    and combatants.battle_id = v_battle_id
  for update;

  if v_target_name is null then
    raise exception 'Alvo não encontrado nesta batalha.';
  end if;

  select affinities.affinity
  into v_damage_affinity
  from public.combatant_affinities as affinities
  where affinities.combatant_id = p_target_id
    and affinities.damage_type = v_damage_type;

  v_damage_affinity := coalesce(v_damage_affinity, 'neutral');

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
    damage_type,
    damage_affinity
  )
  values (
    v_battle_id,
    v_user_id,
    v_actor_display_name,
    p_target_id,
    v_target_name,
    'attack',
    -v_raw_damage,
    v_applied_delta,
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
    v_raw_damage,
    v_damage_type,
    v_damage_affinity
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
    v_raw_damage,
    v_damage_type,
    v_damage_affinity,
    v_previous_hp,
    v_resulting_hp;
end;
$$;

revoke all on function public.perform_combatant_attack(uuid, uuid)
  from public, anon;
grant execute on function public.perform_combatant_attack(uuid, uuid)
  to authenticated;
