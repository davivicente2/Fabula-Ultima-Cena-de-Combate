-- Table tools: free checks, Fabula Points and scene Clocks.

-- ---------------------------------------------------------------------------
-- Generic checks in the shared log
-- ---------------------------------------------------------------------------

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
      'inventory',
      'check'
    )
  );

alter table public.combat_actions
  add column if not exists check_name text,
  add column if not exists check_attribute_a text,
  add column if not exists check_attribute_b text,
  add column if not exists check_bonus integer,
  add column if not exists check_difficulty integer;

create or replace function public.perform_combatant_check(
  p_combatant_id uuid,
  p_attribute_a text,
  p_attribute_b text,
  p_bonus integer default 0,
  p_difficulty integer default null,
  p_name text default null
)
returns table (
  action_id uuid,
  combatant_id uuid,
  combatant_name text,
  roll_a integer,
  roll_b integer,
  check_total integer,
  high_roll integer,
  difficulty integer,
  is_success boolean,
  is_critical boolean,
  is_fumble boolean
)
language plpgsql
security definer
set search_path = ''
as $free_check$
declare
  v_user_id uuid := auth.uid();
  v_battle_id uuid;
  v_room_id uuid;
  v_controller_user_id uuid;
  v_name text;
  v_hp integer;
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
  v_critical boolean;
  v_fumble boolean;
  v_success boolean;
  v_actor_display_name text;
  v_action_id uuid;
  v_check_name text;
begin
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;

  if p_attribute_a not in ('dex', 'ins', 'mig', 'wlp')
    or p_attribute_b not in ('dex', 'ins', 'mig', 'wlp')
  then
    raise exception 'Atributo inválido.';
  end if;

  if p_bonus < -99 or p_bonus > 99 then
    raise exception 'Bônus fora do limite permitido.';
  end if;

  if p_difficulty is not null
    and (p_difficulty < 1 or p_difficulty > 99)
  then
    raise exception 'Dificuldade fora do limite permitido.';
  end if;

  select
    combatants.battle_id,
    battles.room_id,
    combatants.controller_user_id,
    combatants.name,
    combatants.hp,
    combatants.dex_die,
    combatants.ins_die,
    combatants.mig_die,
    combatants.wlp_die
  into
    v_battle_id,
    v_room_id,
    v_controller_user_id,
    v_name,
    v_hp,
    v_dex,
    v_ins,
    v_mig,
    v_wlp
  from public.combatants as combatants
  join public.battles as battles
    on battles.id = combatants.battle_id
  where combatants.id = p_combatant_id;

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

  v_die_a := case p_attribute_a
    when 'dex' then v_dex
    when 'ins' then v_ins
    when 'mig' then v_mig
    when 'wlp' then v_wlp
  end;

  v_die_b := case p_attribute_b
    when 'dex' then v_dex
    when 'ins' then v_ins
    when 'mig' then v_mig
    when 'wlp' then v_wlp
  end;

  v_roll_a := floor(random() * v_die_a)::integer + 1;
  v_roll_b := floor(random() * v_die_b)::integer + 1;
  v_total := v_roll_a + v_roll_b + p_bonus;
  v_hr := greatest(v_roll_a, v_roll_b);
  v_fumble := v_roll_a = 1 and v_roll_b = 1;
  v_critical := v_roll_a = v_roll_b and v_roll_a >= 6;

  v_success := case
    when p_difficulty is null then null
    else not v_fumble
      and (v_critical or v_total >= p_difficulty)
  end;

  v_check_name := coalesce(
    nullif(trim(p_name), ''),
    upper(p_attribute_a) || ' + ' || upper(p_attribute_b)
  );

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
    roll_a,
    roll_b,
    check_total,
    high_roll,
    target_defense,
    is_hit,
    is_critical,
    is_fumble,
    damage,
    check_name,
    check_attribute_a,
    check_attribute_b,
    check_bonus,
    check_difficulty
  )
  values (
    v_battle_id,
    v_user_id,
    coalesce(v_actor_display_name, 'Jogador'),
    p_combatant_id,
    v_name,
    'check',
    0,
    0,
    v_hp,
    v_hp,
    p_combatant_id,
    v_name,
    v_roll_a,
    v_roll_b,
    v_total,
    v_hr,
    p_difficulty,
    v_success,
    v_critical,
    v_fumble,
    0,
    v_check_name,
    p_attribute_a,
    p_attribute_b,
    p_bonus,
    p_difficulty
  )
  returning id into v_action_id;

  return query
  select
    v_action_id,
    p_combatant_id,
    v_name,
    v_roll_a,
    v_roll_b,
    v_total,
    v_hr,
    p_difficulty,
    v_success,
    v_critical,
    v_fumble;
end;
$free_check$;

revoke all on function public.perform_combatant_check(
  uuid, text, text, integer, integer, text
) from public, anon;
grant execute on function public.perform_combatant_check(
  uuid, text, text, integer, integer, text
) to authenticated;

-- ---------------------------------------------------------------------------
-- Fabula Points
-- ---------------------------------------------------------------------------

alter table public.combatants
  add column if not exists fabula_points integer not null default 0;

alter table public.combatants
  drop constraint if exists combatants_fabula_points_check;

alter table public.combatants
  add constraint combatants_fabula_points_check
    check (fabula_points between 0 and 99);

alter table public.combat_actions
  drop constraint if exists combat_actions_resource_name_check;

alter table public.combat_actions
  add constraint combat_actions_resource_name_check
    check (
      resource_name is null
      or resource_name in ('mp', 'ip', 'fabula')
    );

update public.combatants as combatants
set fabula_points = least(
  99,
  greatest(
    0,
    case
      when characters.source_data #>> '{info,fabulapoints}' ~ '^\d+$'
      then (characters.source_data #>> '{info,fabulapoints}')::integer
      else 0
    end
  )
)
from public.characters as characters
where characters.id = combatants.character_id;

create or replace function private.seed_combatant_fabula_points()
returns trigger
language plpgsql
security definer
set search_path = ''
as $seed_fp$
declare
  v_raw text;
begin
  if new.character_id is null then
    return new;
  end if;

  select characters.source_data #>> '{info,fabulapoints}'
  into v_raw
  from public.characters as characters
  where characters.id = new.character_id;

  if v_raw ~ '^\d+$' then
    new.fabula_points := least(99, greatest(0, v_raw::integer));
  end if;

  return new;
end;
$seed_fp$;

revoke all on function private.seed_combatant_fabula_points()
  from public, anon, authenticated;

drop trigger if exists seed_combatant_fabula_points_before_insert
  on public.combatants;

create trigger seed_combatant_fabula_points_before_insert
before insert on public.combatants
for each row
execute function private.seed_combatant_fabula_points();

create or replace function public.adjust_combatant_fabula_points(
  p_combatant_id uuid,
  p_delta integer
)
returns table (
  action_id uuid,
  combatant_id uuid,
  previous_value integer,
  value integer,
  applied_delta integer
)
language plpgsql
security definer
set search_path = ''
as $adjust_fp$
declare
  v_user_id uuid := auth.uid();
  v_battle_id uuid;
  v_room_id uuid;
  v_controller_user_id uuid;
  v_character_id uuid;
  v_name text;
  v_hp integer;
  v_previous integer;
  v_next integer;
  v_applied integer;
  v_actor_display_name text;
  v_action_id uuid;
begin
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;

  if p_delta is null or p_delta = 0 or p_delta < -99 or p_delta > 99 then
    raise exception 'Ajuste de Fabula Points inválido.';
  end if;

  select
    combatants.battle_id,
    battles.room_id,
    combatants.controller_user_id,
    combatants.character_id,
    combatants.name,
    combatants.hp,
    combatants.fabula_points
  into
    v_battle_id,
    v_room_id,
    v_controller_user_id,
    v_character_id,
    v_name,
    v_hp,
    v_previous
  from public.combatants as combatants
  join public.battles as battles
    on battles.id = combatants.battle_id
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

  v_next := greatest(0, least(99, v_previous + p_delta));
  v_applied := v_next - v_previous;

  if v_applied = 0 then
    return query
    select null::uuid, p_combatant_id, v_previous, v_next, 0;
    return;
  end if;

  update public.combatants as combatants
  set fabula_points = v_next
  where combatants.id = p_combatant_id;

  if v_character_id is not null then
    update public.characters as characters
    set
      source_data = jsonb_set(
        coalesce(characters.source_data, '{}'::jsonb),
        '{info,fabulapoints}',
        to_jsonb(v_next),
        true
      ),
      updated_at = now()
    where characters.id = v_character_id;
  end if;

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
    'fabula',
    v_previous,
    v_next
  )
  returning id into v_action_id;

  return query
  select v_action_id, p_combatant_id, v_previous, v_next, v_applied;
end;
$adjust_fp$;

revoke all on function public.adjust_combatant_fabula_points(uuid, integer)
  from public, anon;
grant execute on function public.adjust_combatant_fabula_points(uuid, integer)
  to authenticated;

-- ---------------------------------------------------------------------------
-- Scene clocks
-- ---------------------------------------------------------------------------

create table if not exists public.scene_clocks (
  id uuid primary key default gen_random_uuid(),
  battle_id uuid not null references public.battles(id) on delete cascade,
  name text not null,
  current_segments integer not null default 0,
  max_segments integer not null default 6,
  created_by uuid not null default auth.uid()
    references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint scene_clocks_name_check
    check (char_length(trim(name)) between 1 and 80),
  constraint scene_clocks_max_segments_check
    check (max_segments between 2 and 20),
  constraint scene_clocks_current_segments_check
    check (
      current_segments >= 0
      and current_segments <= max_segments
    )
);

create index if not exists scene_clocks_battle_created_idx
  on public.scene_clocks (battle_id, created_at);

alter table public.scene_clocks enable row level security;

revoke all on table public.scene_clocks from anon, authenticated;
grant select on table public.scene_clocks to authenticated;

drop policy if exists "Room members can read scene clocks"
  on public.scene_clocks;

create policy "Room members can read scene clocks"
  on public.scene_clocks
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.battles as battles
      where battles.id = scene_clocks.battle_id
        and private.is_room_member(battles.room_id)
    )
  );

create or replace function public.create_scene_clock(
  p_battle_id uuid,
  p_name text,
  p_max_segments integer default 6
)
returns table (
  clock_id uuid,
  battle_id uuid,
  clock_name text,
  current_segments integer,
  max_segments integer
)
language plpgsql
security definer
set search_path = ''
as $create_clock$
declare
  v_room_id uuid;
  v_id uuid;
  v_name text := nullif(trim(p_name), '');
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  select battles.room_id
  into v_room_id
  from public.battles as battles
  where battles.id = p_battle_id;

  if v_room_id is null then
    raise exception 'Cena não encontrada.';
  end if;

  if not private.is_room_host(v_room_id) then
    raise exception 'Apenas o GM pode criar Clocks.';
  end if;

  if v_name is null or char_length(v_name) > 80 then
    raise exception 'Nome do Clock inválido.';
  end if;

  if p_max_segments < 2 or p_max_segments > 20 then
    raise exception 'O Clock deve ter entre 2 e 20 segmentos.';
  end if;

  insert into public.scene_clocks (
    battle_id,
    name,
    max_segments
  )
  values (
    p_battle_id,
    v_name,
    p_max_segments
  )
  returning id into v_id;

  return query
  select v_id, p_battle_id, v_name, 0, p_max_segments;
end;
$create_clock$;

revoke all on function public.create_scene_clock(uuid, text, integer)
  from public, anon;
grant execute on function public.create_scene_clock(uuid, text, integer)
  to authenticated;

create or replace function public.adjust_scene_clock(
  p_clock_id uuid,
  p_delta integer
)
returns table (
  clock_id uuid,
  current_segments integer,
  max_segments integer
)
language plpgsql
security definer
set search_path = ''
as $adjust_clock$
declare
  v_room_id uuid;
  v_current integer;
  v_max integer;
  v_next integer;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  if p_delta is null or p_delta = 0 or p_delta < -20 or p_delta > 20 then
    raise exception 'Ajuste de Clock inválido.';
  end if;

  select
    battles.room_id,
    clocks.current_segments,
    clocks.max_segments
  into
    v_room_id,
    v_current,
    v_max
  from public.scene_clocks as clocks
  join public.battles as battles
    on battles.id = clocks.battle_id
  where clocks.id = p_clock_id
  for update of clocks;

  if v_room_id is null then
    raise exception 'Clock não encontrado.';
  end if;

  if not private.is_room_host(v_room_id) then
    raise exception 'Apenas o GM pode alterar Clocks.';
  end if;

  v_next := greatest(0, least(v_max, v_current + p_delta));

  update public.scene_clocks as clocks
  set
    current_segments = v_next,
    updated_at = now()
  where clocks.id = p_clock_id;

  return query
  select p_clock_id, v_next, v_max;
end;
$adjust_clock$;

revoke all on function public.adjust_scene_clock(uuid, integer)
  from public, anon;
grant execute on function public.adjust_scene_clock(uuid, integer)
  to authenticated;

create or replace function public.delete_scene_clock(
  p_clock_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $delete_clock$
declare
  v_room_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  select battles.room_id
  into v_room_id
  from public.scene_clocks as clocks
  join public.battles as battles
    on battles.id = clocks.battle_id
  where clocks.id = p_clock_id;

  if v_room_id is null then
    raise exception 'Clock não encontrado.';
  end if;

  if not private.is_room_host(v_room_id) then
    raise exception 'Apenas o GM pode remover Clocks.';
  end if;

  delete from public.scene_clocks as clocks
  where clocks.id = p_clock_id;
end;
$delete_clock$;

revoke all on function public.delete_scene_clock(uuid)
  from public, anon;
grant execute on function public.delete_scene_clock(uuid)
  to authenticated;

do $publication$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'scene_clocks'
  ) then
    execute 'alter publication supabase_realtime add table public.scene_clocks';
  end if;
end
$publication$;
