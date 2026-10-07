-- Assign player-controlled combatants and enforce control at the database layer.

alter table public.combatants
  add column if not exists controller_user_id uuid
  references auth.users(id) on delete set null;

-- Players should not be able to directly assign controllers by updating the row.
-- Keep direct client updates limited to mutable battle resources.
revoke update on table public.combatants from authenticated;
grant update (hp, mp, ip, is_active) on table public.combatants to authenticated;

drop policy if exists "Room members can create combatants" on public.combatants;
drop policy if exists "Room members can update combatants" on public.combatants;
drop policy if exists "Room members can delete combatants" on public.combatants;

create policy "Room hosts can create combatants"
  on public.combatants
  for insert
  to authenticated
  with check (
    exists (
      select 1
      from public.battles
      where battles.id = combatants.battle_id
        and private.is_room_host(battles.room_id)
    )
  );

create policy "Hosts or assigned players can update combatants"
  on public.combatants
  for update
  to authenticated
  using (
    controller_user_id = auth.uid()
    or exists (
      select 1
      from public.battles
      where battles.id = combatants.battle_id
        and private.is_room_host(battles.room_id)
    )
  )
  with check (
    controller_user_id = auth.uid()
    or exists (
      select 1
      from public.battles
      where battles.id = combatants.battle_id
        and private.is_room_host(battles.room_id)
    )
  );

create policy "Room hosts can delete combatants"
  on public.combatants
  for delete
  to authenticated
  using (
    exists (
      select 1
      from public.battles
      where battles.id = combatants.battle_id
        and private.is_room_host(battles.room_id)
    )
  );

create or replace function public.assign_combatant_controller(
  p_combatant_id uuid,
  p_user_id uuid default null
)
returns table (
  combatant_id uuid,
  controller_user_id uuid
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_room_id uuid;
  v_side text;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  select battles.room_id, combatants.side
  into v_room_id, v_side
  from public.combatants
  join public.battles on battles.id = combatants.battle_id
  where combatants.id = p_combatant_id;

  if v_room_id is null then
    raise exception 'Combatente não encontrado.';
  end if;

  if not private.is_room_host(v_room_id) then
    raise exception 'Apenas o GM pode atribuir personagens.';
  end if;

  if v_side <> 'heroes' then
    raise exception 'Apenas heróis podem ser atribuídos a jogadores.';
  end if;

  if p_user_id is not null and not exists (
    select 1
    from public.room_members
    where room_members.room_id = v_room_id
      and room_members.user_id = p_user_id
  ) then
    raise exception 'O jogador não pertence a esta sala.';
  end if;

  return query
  update public.combatants
  set controller_user_id = p_user_id
  where id = p_combatant_id
  returning id, public.combatants.controller_user_id;
end;
$$;

revoke all on function public.assign_combatant_controller(uuid, uuid)
  from public, anon;
grant execute on function public.assign_combatant_controller(uuid, uuid)
  to authenticated;
