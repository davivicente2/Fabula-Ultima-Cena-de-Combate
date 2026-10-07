import { supabase } from './supabase'
import type { Combatant, CombatSide } from '../types/combat'

type CombatantSeed = Omit<Combatant, 'id'>

type CombatantRow = {
  id: string
  name: string
  side: CombatSide
  hp: number
  max_hp: number
  mp: number
  max_mp: number
  ip: number
  max_ip: number
  is_active: boolean
  sort_order: number
}

type RoomBattleRpcRow = {
  room_id: string
  room_code: string
  battle_id: string
  battle_name: string
}

type BattleRow = {
  id: string
  name: string
  room_id: string
}

export type LoadedBattle = {
  id: string
  name: string
  roomId: string
  roomCode: string
  combatants: Combatant[]
}

export type PlayerRole = 'host' | 'player'

export type PlayerIdentity = {
  userId: string
  role: PlayerRole
  displayName: string | null
}

async function ensureAnonymousSession() {
  const {
    data: { session },
    error: sessionError,
  } = await supabase.auth.getSession()

  if (sessionError) throw sessionError
  if (session) return session.user.id

  const { data, error } = await supabase.auth.signInAnonymously()

  if (error) throw error
  if (!data.user) throw new Error('Supabase não retornou um usuário anônimo.')

  return data.user.id
}

function toCombatant(row: CombatantRow): Combatant {
  return {
    id: row.id,
    name: row.name,
    side: row.side,
    hp: row.hp,
    maxHp: row.max_hp,
    mp: row.mp,
    maxMp: row.max_mp,
    ip: row.ip,
    maxIp: row.max_ip,
    isActive: row.is_active,
  }
}

async function loadCombatants(battleId: string) {
  const { data, error } = await supabase
    .from('combatants')
    .select(
      'id, name, side, hp, max_hp, mp, max_mp, ip, max_ip, is_active, sort_order',
    )
    .eq('battle_id', battleId)
    .order('sort_order', { ascending: true })

  if (error) throw error

  return (data as CombatantRow[]).map(toCombatant)
}

async function seedCombatants(battleId: string, seeds: CombatantSeed[]) {
  const rows = seeds.map((combatant, index) => ({
    battle_id: battleId,
    name: combatant.name,
    side: combatant.side,
    hp: combatant.hp,
    max_hp: combatant.maxHp,
    mp: combatant.mp,
    max_mp: combatant.maxMp,
    ip: combatant.ip,
    max_ip: combatant.maxIp,
    is_active: combatant.isActive ?? false,
    sort_order: index,
  }))

  const { error } = await supabase.from('combatants').insert(rows)

  if (error) throw error
}

async function getRoomCode(roomId: string) {
  const { data, error } = await supabase
    .from('rooms')
    .select('code')
    .eq('id', roomId)
    .single()

  if (error) throw error

  return data.code as string
}

async function hydrateBattle(
  battle: BattleRow,
  initialCombatants: CombatantSeed[],
): Promise<LoadedBattle> {
  let combatants = await loadCombatants(battle.id)

  if (combatants.length === 0) {
    await seedCombatants(battle.id, initialCombatants)
    combatants = await loadCombatants(battle.id)
  }

  return {
    id: battle.id,
    name: battle.name,
    roomId: battle.room_id,
    roomCode: await getRoomCode(battle.room_id),
    combatants,
  }
}

async function loadBattleFromRpc(
  row: RoomBattleRpcRow,
  initialCombatants: CombatantSeed[],
): Promise<LoadedBattle> {
  let combatants = await loadCombatants(row.battle_id)

  if (combatants.length === 0) {
    await seedCombatants(row.battle_id, initialCombatants)
    combatants = await loadCombatants(row.battle_id)
  }

  return {
    id: row.battle_id,
    name: row.battle_name,
    roomId: row.room_id,
    roomCode: row.room_code,
    combatants,
  }
}

async function createBattleRoom(initialCombatants: CombatantSeed[]) {
  const { data, error } = await supabase
    .rpc('create_room_with_battle', { p_name: 'Batalha de teste' })
    .single()

  if (error) throw error

  return loadBattleFromRpc(data as RoomBattleRpcRow, initialCombatants)
}

export async function joinBattleRoom(
  code: string,
  initialCombatants: CombatantSeed[],
): Promise<LoadedBattle> {
  await ensureAnonymousSession()

  const normalizedCode = code.trim().toUpperCase()

  if (!normalizedCode) {
    throw new Error('Informe o código da sala.')
  }

  const { data, error } = await supabase
    .rpc('join_room', { p_code: normalizedCode })
    .single()

  if (error) throw error

  return loadBattleFromRpc(data as RoomBattleRpcRow, initialCombatants)
}

export async function loadOrCreateBattle(
  initialCombatants: CombatantSeed[],
  requestedRoomCode?: string | null,
): Promise<LoadedBattle> {
  await ensureAnonymousSession()

  if (requestedRoomCode) {
    return joinBattleRoom(requestedRoomCode, initialCombatants)
  }

  const { data: existingBattle, error: battleLookupError } = await supabase
    .from('battles')
    .select('id, name, room_id')
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()

  if (battleLookupError) throw battleLookupError

  if (existingBattle) {
    return hydrateBattle(existingBattle as BattleRow, initialCombatants)
  }

  return createBattleRoom(initialCombatants)
}

export async function loadCurrentPlayerIdentity(
  roomId: string,
): Promise<PlayerIdentity> {
  const userId = await ensureAnonymousSession()

  const { data, error } = await supabase
    .from('room_members')
    .select('user_id, role, display_name')
    .eq('room_id', roomId)
    .eq('user_id', userId)
    .single()

  if (error) throw error

  return {
    userId: data.user_id as string,
    role: data.role as PlayerRole,
    displayName: (data.display_name as string | null) ?? null,
  }
}

export async function savePlayerDisplayName(
  roomId: string,
  displayName: string,
): Promise<PlayerIdentity> {
  const { data, error } = await supabase
    .rpc('set_my_room_display_name', {
      p_room_id: roomId,
      p_display_name: displayName,
    })
    .single()

  if (error) throw error

  return {
    userId: data.user_id as string,
    role: data.role as PlayerRole,
    displayName: data.display_name as string,
  }
}

export async function saveCombatantHp(combatantId: string, hp: number) {
  const { data, error } = await supabase
    .from('combatants')
    .update({ hp })
    .eq('id', combatantId)
    .select('hp')
    .single()

  if (error) throw error

  return data.hp as number
}

export function subscribeToCombatantUpdates(
  battleId: string,
  onUpdate: (combatant: Combatant) => void,
) {
  const channel = supabase
    .channel(`battle-${battleId}`)
    .on(
      'postgres_changes',
      {
        event: 'UPDATE',
        schema: 'public',
        table: 'combatants',
        filter: `battle_id=eq.${battleId}`,
      },
      (payload) => {
        onUpdate(toCombatant(payload.new as CombatantRow))
      },
    )
    .subscribe()

  return () => {
    void supabase.removeChannel(channel)
  }
}
