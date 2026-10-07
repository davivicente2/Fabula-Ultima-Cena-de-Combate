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

export type LoadedBattle = {
  id: string
  name: string
  combatants: Combatant[]
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

export async function loadOrCreateBattle(
  initialCombatants: CombatantSeed[],
): Promise<LoadedBattle> {
  await ensureAnonymousSession()

  const { data: existingBattle, error: battleLookupError } = await supabase
    .from('battles')
    .select('id, name')
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()

  if (battleLookupError) throw battleLookupError

  let battle = existingBattle

  if (!battle) {
    const { data: createdBattle, error: createBattleError } = await supabase
      .from('battles')
      .insert({ name: 'Batalha de teste' })
      .select('id, name')
      .single()

    if (createBattleError) throw createBattleError
    battle = createdBattle
  }

  let combatants = await loadCombatants(battle.id)

  if (combatants.length === 0) {
    await seedCombatants(battle.id, initialCombatants)
    combatants = await loadCombatants(battle.id)
  }

  return {
    id: battle.id,
    name: battle.name,
    combatants,
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
