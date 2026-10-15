-- Persistent character library independent from battle participation.
-- Imported source data is preserved verbatim while combat_profile contains the
-- normalized subset understood by the current authoritative combat engine.

create table if not exists public.characters (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms(id) on delete cascade,
  created_by uuid not null default auth.uid()
    references auth.users(id) on delete cascade,
  owner_user_id uuid references auth.users(id) on delete set null,
  name text not null,
  kind text not null default 'character'
    check (kind in ('character', 'npc')),
  source text not null default 'native'
    check (source in ('native', 'fultimator', 'foundry', 'roll20')),
  source_data jsonb not null default '{}'::jsonb,
  combat_profile jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists characters_room_idx
  on public.characters (room_id, created_at);

alter table public.characters enable row level security;

revoke all on table public.characters from anon, authenticated;
grant select on table public.characters to authenticated;

drop policy if exists "Room members can read characters"
  on public.characters;
create policy "Room members can read characters"
  on public.characters
  for select
  to authenticated
  using (private.is_room_member(characters.room_id));

alter table public.combatants
  add column if not exists character_id uuid
    references public.characters(id) on delete set null;

create unique index if not exists combatants_character_unique_idx
  on public.combatants (character_id)
  where character_id is not null;

create or replace function public.create_character_record(
  p_room_id uuid,
  p_name text,
  p_kind text,
  p_source text,
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
as $character_create$
declare
  v_user_id uuid := auth.uid();
  v_character_id uuid;
  v_name text := nullif(trim(p_name), '');
  v_role text;
begin
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;

  if not private.is_room_member(p_room_id) then
    raise exception 'Você não pertence a esta sala.';
  end if;

  select members.role
  into v_role
  from public.room_members as members
  where members.room_id = p_room_id
    and members.user_id = v_user_id;

  if v_name is null then
    raise exception 'O personagem precisa de um nome.';
  end if;

  if p_kind not in ('character', 'npc') then
    raise exception 'Tipo de personagem inválido.';
  end if;

  if p_source not in ('native', 'fultimator', 'foundry', 'roll20') then
    raise exception 'Fonte de importação inválida.';
  end if;

  if p_kind = 'npc' and v_role <> 'host' then
    raise exception 'Apenas o GM pode importar NPCs.';
  end if;

  if jsonb_typeof(coalesce(p_combat_profile, '{}'::jsonb)) <> 'object' then
    raise exception 'Perfil de combate inválido.';
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
    p_room_id,
    v_user_id,
    case when p_kind = 'character' then v_user_id else null end,
    v_name,
    p_kind,
    p_source,
    coalesce(p_source_data, '{}'::jsonb),
    coalesce(p_combat_profile, '{}'::jsonb)
  )
  returning id into v_character_id;

  return query
  select v_character_id, v_name;
end;
$character_create$;

revoke all on function public.create_character_record(
  uuid, text, text, text, jsonb, jsonb
) from public, anon;
grant execute on function public.create_character_record(
  uuid, text, text, text, jsonb, jsonb
) to authenticated;

create or replace function public.add_character_to_battle(
  p_character_id uuid,
  p_battle_id uuid
)
returns table (
  combatant_id uuid,
  character_id uuid
)
language plpgsql
security definer
set search_path = ''
as $character_add$
declare
  v_room_id uuid;
  v_character_room_id uuid;
  v_character_name text;
  v_kind text;
  v_owner_user_id uuid;
  v_profile jsonb;
  v_combatant_id uuid;
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
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  select battles.room_id
  into v_room_id
  from public.battles as battles
  where battles.id = p_battle_id;

  if v_room_id is null then
    raise exception 'Batalha não encontrada.';
  end if;

  if not private.is_room_host(v_room_id) then
    raise exception 'Apenas o GM pode adicionar personagens à cena.';
  end if;

  select
    characters.room_id,
    characters.name,
    characters.kind,
    characters.owner_user_id,
    characters.combat_profile
  into
    v_character_room_id,
    v_character_name,
    v_kind,
    v_owner_user_id,
    v_profile
  from public.characters as characters
  where characters.id = p_character_id;

  if v_character_room_id is null then
    raise exception 'Personagem não encontrado.';
  end if;

  if v_character_room_id <> v_room_id then
    raise exception 'O personagem pertence a outra sala.';
  end if;

  if exists (
    select 1
    from public.combatants as combatants
    where combatants.character_id = p_character_id
  ) then
    raise exception 'Este personagem já está em uma cena.';
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
    least(
      v_max_hp,
      coalesce((v_profile #>> '{hp,current}')::integer, v_max_hp)
    )
  );

  v_max_mp := greatest(0, coalesce((v_profile #>> '{mp,max}')::integer, 0));
  v_mp := greatest(
    0,
    least(
      v_max_mp,
      coalesce((v_profile #>> '{mp,current}')::integer, v_max_mp)
    )
  );

  v_max_ip := greatest(0, coalesce((v_profile #>> '{ip,max}')::integer, 0));
  v_ip := greatest(
    0,
    least(
      v_max_ip,
      coalesce((v_profile #>> '{ip,current}')::integer, v_max_ip)
    )
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
  v_mdef := greatest(
    0,
    coalesce((v_profile ->> 'magicDefense')::integer, v_ins)
  );

  select coalesce(array_agg(value), array[]::text[])
  into v_statuses
  from jsonb_array_elements_text(
    coalesce(v_profile -> 'statuses', '[]'::jsonb)
  ) as status(value)
  where value in (
    'slow', 'dazed', 'weak', 'shaken', 'enraged', 'poisoned'
  );

  insert into public.combatants (
    battle_id,
    character_id,
    controller_user_id,
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
    sort_order
  )
  values (
    p_battle_id,
    p_character_id,
    case
      when v_kind = 'character'
        and exists (
          select 1
          from public.room_members as members
          where members.room_id = v_room_id
            and members.user_id = v_owner_user_id
        )
      then v_owner_user_id
      else null
    end,
    v_character_name,
    v_side,
    v_hp,
    v_max_hp,
    v_mp,
    v_max_mp,
    v_ip,
    v_max_ip,
    v_dex,
    v_ins,
    v_mig,
    v_wlp,
    v_dex,
    v_ins,
    v_mig,
    v_wlp,
    v_def,
    v_mdef,
    v_statuses,
    coalesce(
      (
        select max(combatants.sort_order) + 1
        from public.combatants as combatants
        where combatants.battle_id = p_battle_id
          and combatants.side = v_side
      ),
      0
    )
  )
  returning id into v_combatant_id;

  for v_attack in
    select value
    from jsonb_array_elements(
      coalesce(v_profile -> 'attacks', '[]'::jsonb)
    )
  loop
    if coalesce(v_attack ->> 'name', '') <> '' then
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
          when v_attack ->> 'accuracyAttributeA'
            in ('dex', 'ins', 'mig', 'wlp')
          then v_attack ->> 'accuracyAttributeA'
          else 'dex'
        end,
        case
          when v_attack ->> 'accuracyAttributeB'
            in ('dex', 'ins', 'mig', 'wlp')
          then v_attack ->> 'accuracyAttributeB'
          else 'mig'
        end,
        coalesce((v_attack ->> 'accuracyBonus')::integer, 0),
        coalesce((v_attack ->> 'damageBonus')::integer, 0),
        case
          when v_attack ->> 'damageType'
            in (
              'physical', 'air', 'bolt', 'dark', 'earth',
              'fire', 'ice', 'light', 'poison'
            )
          then v_attack ->> 'damageType'
          else 'physical'
        end,
        coalesce((v_attack ->> 'sortOrder')::integer, 0)
      );
    end if;
  end loop;

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
      )
      on conflict (combatant_id, damage_type)
      do update set affinity = excluded.affinity;
    end if;
  end loop;

  perform private.refresh_combatant_status_dice(v_combatant_id);

  return query
  select v_combatant_id, p_character_id;
end;
$character_add$;

revoke all on function public.add_character_to_battle(uuid, uuid)
  from public, anon;
grant execute on function public.add_character_to_battle(uuid, uuid)
  to authenticated;
