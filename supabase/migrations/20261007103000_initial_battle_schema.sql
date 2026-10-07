-- Initial persistence schema for the combat prototype.
-- Anonymous Supabase Auth users are treated as authenticated users.
-- RLS restricts each user to battles they own.

create table public.battles (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null default 'Nova batalha',
  created_at timestamptz not null default now()
);

create table public.combatants (
  id uuid primary key default gen_random_uuid(),
  battle_id uuid not null references public.battles(id) on delete cascade,
  name text not null,
  side text not null check (side in ('heroes', 'enemies')),

  hp integer not null check (hp >= 0),
  max_hp integer not null check (max_hp > 0),
  mp integer not null check (mp >= 0),
  max_mp integer not null check (max_mp >= 0),
  ip integer not null check (ip >= 0),
  max_ip integer not null check (max_ip >= 0),

  is_active boolean not null default false,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),

  constraint combatants_hp_within_max check (hp <= max_hp),
  constraint combatants_mp_within_max check (mp <= max_mp),
  constraint combatants_ip_within_max check (ip <= max_ip)
);

create index combatants_battle_id_idx
  on public.combatants (battle_id);

alter table public.battles enable row level security;
alter table public.combatants enable row level security;

-- Do not allow unauthenticated/public requests to access these tables.
revoke all on table public.battles from anon;
revoke all on table public.combatants from anon;

grant select, insert, update, delete on table public.battles to authenticated;
grant select, insert, update, delete on table public.combatants to authenticated;

create policy "Users can read their own battles"
  on public.battles
  for select
  to authenticated
  using (owner_id = auth.uid());

create policy "Users can create their own battles"
  on public.battles
  for insert
  to authenticated
  with check (owner_id = auth.uid());

create policy "Users can update their own battles"
  on public.battles
  for update
  to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

create policy "Users can delete their own battles"
  on public.battles
  for delete
  to authenticated
  using (owner_id = auth.uid());

create policy "Users can read combatants from their own battles"
  on public.combatants
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.battles
      where battles.id = combatants.battle_id
        and battles.owner_id = auth.uid()
    )
  );

create policy "Users can create combatants in their own battles"
  on public.combatants
  for insert
  to authenticated
  with check (
    exists (
      select 1
      from public.battles
      where battles.id = combatants.battle_id
        and battles.owner_id = auth.uid()
    )
  );

create policy "Users can update combatants in their own battles"
  on public.combatants
  for update
  to authenticated
  using (
    exists (
      select 1
      from public.battles
      where battles.id = combatants.battle_id
        and battles.owner_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1
      from public.battles
      where battles.id = combatants.battle_id
        and battles.owner_id = auth.uid()
    )
  );

create policy "Users can delete combatants from their own battles"
  on public.combatants
  for delete
  to authenticated
  using (
    exists (
      select 1
      from public.battles
      where battles.id = combatants.battle_id
        and battles.owner_id = auth.uid()
    )
  );
