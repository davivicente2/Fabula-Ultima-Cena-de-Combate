-- Add shareable rooms and Realtime access for combatants.

create table public.rooms (
  id uuid primary key default gen_random_uuid(),
  host_id uuid not null references auth.users(id) on delete cascade,
  code text not null unique default upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10)),
  name text not null default 'Sala de combate',
  created_at timestamptz not null default now()
);

create table public.room_members (
  room_id uuid not null references public.rooms(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'player' check (role in ('host', 'player')),
  joined_at timestamptz not null default now(),
  primary key (room_id, user_id)
);

create index room_members_user_id_idx
  on public.room_members (user_id);

alter table public.battles
  add column room_id uuid;

-- Migrate existing single-user battles into one room each.
update public.battles
set room_id = gen_random_uuid()
where room_id is null;

insert into public.rooms (id, host_id, name, created_at)
select
  battles.room_id,
  battles.owner_id,
  battles.name,
  battles.created_at
from public.battles
on conflict (id) do nothing;

insert into public.room_members (room_id, user_id, role)
select
  battles.room_id,
  battles.owner_id,
  'host'
from public.battles
on conflict (room_id, user_id) do nothing;

alter table public.battles
  add constraint battles_room_id_fkey
  foreign key (room_id) references public.rooms(id) on delete cascade;

alter table public.battles
  alter column room_id set not null;

alter table public.rooms enable row level security;
alter table public.room_members enable row level security;

revoke all on table public.rooms from anon, authenticated;
revoke all on table public.room_members from anon, authenticated;

grant select, update, delete on table public.rooms to authenticated;
grant select on table public.room_members to authenticated;

create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated;

create or replace function private.is_room_member(p_room_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.room_members
    where room_members.room_id = p_room_id
      and room_members.user_id = auth.uid()
  );
$$;

create or replace function private.is_room_host(p_room_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.rooms
    where rooms.id = p_room_id
      and rooms.host_id = auth.uid()
  );
$$;

revoke all on function private.is_room_member(uuid) from public;
revoke all on function private.is_room_host(uuid) from public;
grant execute on function private.is_room_member(uuid) to authenticated;
grant execute on function private.is_room_host(uuid) to authenticated;

create policy "Room members can read their room"
  on public.rooms
  for select
  to authenticated
  using (private.is_room_member(id));

create policy "Room hosts can update their room"
  on public.rooms
  for update
  to authenticated
  using (private.is_room_host(id))
  with check (private.is_room_host(id));

create policy "Room hosts can delete their room"
  on public.rooms
  for delete
  to authenticated
  using (private.is_room_host(id));

create policy "Room members can read memberships"
  on public.room_members
  for select
  to authenticated
  using (private.is_room_member(room_id));

drop policy if exists "Users can read their own battles" on public.battles;
drop policy if exists "Users can create their own battles" on public.battles;
drop policy if exists "Users can update their own battles" on public.battles;
drop policy if exists "Users can delete their own battles" on public.battles;

create policy "Room members can read battles"
  on public.battles
  for select
  to authenticated
  using (private.is_room_member(room_id));

create policy "Room hosts can create battles"
  on public.battles
  for insert
  to authenticated
  with check (
    owner_id = auth.uid()
    and private.is_room_host(room_id)
  );

create policy "Room hosts can update battles"
  on public.battles
  for update
  to authenticated
  using (private.is_room_host(room_id))
  with check (private.is_room_host(room_id));

create policy "Room hosts can delete battles"
  on public.battles
  for delete
  to authenticated
  using (private.is_room_host(room_id));

drop policy if exists "Users can read combatants from their own battles" on public.combatants;
drop policy if exists "Users can create combatants in their own battles" on public.combatants;
drop policy if exists "Users can update combatants in their own battles" on public.combatants;
drop policy if exists "Users can delete combatants from their own battles" on public.combatants;

create policy "Room members can read combatants"
  on public.combatants
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.battles
      where battles.id = combatants.battle_id
        and private.is_room_member(battles.room_id)
    )
  );

-- Temporary MVP policy: every room member may change combatants.
-- Later this will be replaced by character ownership and server-side actions.
create policy "Room members can create combatants"
  on public.combatants
  for insert
  to authenticated
  with check (
    exists (
      select 1
      from public.battles
      where battles.id = combatants.battle_id
        and private.is_room_member(battles.room_id)
    )
  );

create policy "Room members can update combatants"
  on public.combatants
  for update
  to authenticated
  using (
    exists (
      select 1
      from public.battles
      where battles.id = combatants.battle_id
        and private.is_room_member(battles.room_id)
    )
  )
  with check (
    exists (
      select 1
      from public.battles
      where battles.id = combatants.battle_id
        and private.is_room_member(battles.room_id)
    )
  );

create policy "Room members can delete combatants"
  on public.combatants
  for delete
  to authenticated
  using (
    exists (
      select 1
      from public.battles
      where battles.id = combatants.battle_id
        and private.is_room_member(battles.room_id)
    )
  );

create or replace function public.create_room_with_battle(
  p_name text default 'Batalha de teste'
)
returns table (
  room_id uuid,
  room_code text,
  battle_id uuid,
  battle_name text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_room_id uuid;
  v_room_code text;
  v_battle_id uuid;
  v_battle_name text := coalesce(nullif(trim(p_name), ''), 'Batalha de teste');
begin
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;

  insert into public.rooms (host_id, name)
  values (v_user_id, v_battle_name)
  returning id, code into v_room_id, v_room_code;

  insert into public.room_members (room_id, user_id, role)
  values (v_room_id, v_user_id, 'host');

  insert into public.battles (owner_id, room_id, name)
  values (v_user_id, v_room_id, v_battle_name)
  returning id into v_battle_id;

  return query
  select v_room_id, v_room_code, v_battle_id, v_battle_name;
end;
$$;

create or replace function public.join_room(p_code text)
returns table (
  room_id uuid,
  room_code text,
  battle_id uuid,
  battle_name text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_room_id uuid;
  v_room_code text;
  v_battle_id uuid;
  v_battle_name text;
begin
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;

  select rooms.id, rooms.code
  into v_room_id, v_room_code
  from public.rooms
  where upper(rooms.code) = upper(trim(p_code))
  limit 1;

  if v_room_id is null then
    raise exception 'Sala não encontrada.';
  end if;

  insert into public.room_members (room_id, user_id, role)
  values (v_room_id, v_user_id, 'player')
  on conflict on constraint room_members_pkey do nothing;

  select battles.id, battles.name
  into v_battle_id, v_battle_name
  from public.battles
  where battles.room_id = v_room_id
  order by battles.created_at
  limit 1;

  if v_battle_id is null then
    raise exception 'A sala não possui uma batalha.';
  end if;

  return query
  select v_room_id, v_room_code, v_battle_id, v_battle_name;
end;
$$;

revoke all on function public.create_room_with_battle(text) from public, anon;
revoke all on function public.join_room(text) from public, anon;
grant execute on function public.create_room_with_battle(text) to authenticated;
grant execute on function public.join_room(text) to authenticated;

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'combatants'
  ) then
    execute 'alter publication supabase_realtime add table public.combatants';
  end if;
end
$$;
