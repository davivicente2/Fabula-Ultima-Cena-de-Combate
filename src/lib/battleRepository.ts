import { supabase } from './supabase'
import type {
  AttributeName,
  CombatAttack,
  Combatant,
  CombatSide,
  DamageAffinity,
  DamageType,
  DieSize,
  ResourceName,
} from '../types/combat'

export type CombatAttackSeed = Omit<CombatAttack, 'id'>
export type CombatantSeed = Omit<Combatant, 'id' | 'attacks' | 'affinities'> & {
  attacks: CombatAttackSeed[]
  affinities: Partial<Record<DamageType, DamageAffinity>>
}

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
  controller_user_id: string | null
  dex_die: DieSize
  ins_die: DieSize
  mig_die: DieSize
  wlp_die: DieSize
  defense: number
  magic_defense: number
  last_acted_round: number
  guard_started_round: number | null
}

type CombatAttackRow = {
  id: string
  combatant_id: string
  name: string
  accuracy_attribute_a: AttributeName
  accuracy_attribute_b: AttributeName
  accuracy_bonus: number
  damage_bonus: number
  damage_type: DamageType
  sort_order: number
}

type CombatantAffinityRow = {
  combatant_id: string
  damage_type: DamageType
  affinity: DamageAffinity
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
  conflict_started: boolean
  round_number: number
  initiative_side: CombatSide | null
  current_side: CombatSide | null
  turn_revision: number
}

type BattleTurnRpcRow = {
  battle_id: string
  conflict_started: boolean
  round_number: number
  initiative_side: CombatSide | null
  current_side: CombatSide | null
}

type EndTurnRpcRow = {
  battle_id: string
  combatant_id: string
  acted_round: number
  next_round: number
  next_side: CombatSide | null
}

type PlayerIdentityRpcRow = {
  user_id: string
  role: PlayerRole
  display_name: string
}

type CombatantAssignmentRpcRow = {
  combatant_id: string
  controller_user_id: string | null
}

type CombatantResourceActionRpcRow = {
  action_id: string | null
  combatant_id: string
  resource_name: 'mp' | 'ip'
  previous_value: number
  value: number
  max_value: number
  applied_delta: number
}

type CombatantHpActionRpcRow = {
  action_id: string | null
  combatant_id: string
  previous_hp: number
  hp: number
  max_hp: number
  applied_delta: number
}

type CombatActionRow = {
  id: string
  battle_id: string
  actor_user_id: string | null
  actor_display_name: string | null
  target_combatant_id: string | null
  target_name: string | null
  action_type:
    | 'hp_adjustment'
    | 'attack'
    | 'turn_end'
    | 'guard'
    | 'resource_adjustment'
  requested_delta: number
  applied_delta: number
  previous_hp: number
  resulting_hp: number
  attacker_combatant_id: string | null
  attacker_name: string | null
  attack_name: string | null
  roll_a: number | null
  roll_b: number | null
  check_total: number | null
  high_roll: number | null
  target_defense: number | null
  is_hit: boolean | null
  is_critical: boolean | null
  is_fumble: boolean | null
  damage: number | null
  damage_type: DamageType | null
  damage_affinity: DamageAffinity | 'neutral' | null
  round_number: number | null
  guard_applied: boolean | null
  resource_name: 'mp' | 'ip' | null
  previous_resource: number | null
  resulting_resource: number | null
  created_at: string
}

type CombatAttackRpcRow = {
  action_id: string
  attacker_id: string
  target_id: string
  attack_name: string
  roll_a: number
  roll_b: number
  check_total: number
  high_roll: number
  target_defense: number
  is_hit: boolean
  is_critical: boolean
  is_fumble: boolean
  damage: number
  damage_type: DamageType
  damage_affinity: DamageAffinity | 'neutral'
  previous_hp: number
  resulting_hp: number
}

export type BattleTurnState = {
  started: boolean
  roundNumber: number
  initiativeSide: CombatSide | null
  currentSide: CombatSide | null
  turnRevision: number
}

export type LoadedBattle = {
  id: string
  name: string
  roomId: string
  roomCode: string
  combatants: Combatant[]
  turnState: BattleTurnState
}

export type PlayerRole = 'host' | 'player'

export type PlayerIdentity = {
  userId: string
  role: PlayerRole
  displayName: string | null
}

export type CombatAction = {
  id: string
  battleId: string
  actorUserId: string | null
  actorDisplayName: string | null
  targetCombatantId: string | null
  targetName: string | null
  actionType:
    | 'hp_adjustment'
    | 'attack'
    | 'turn_end'
    | 'guard'
    | 'resource_adjustment'
  requestedDelta: number
  appliedDelta: number
  previousHp: number
  resultingHp: number
  attackerCombatantId: string | null
  attackerName: string | null
  attackName: string | null
  rollA: number | null
  rollB: number | null
  checkTotal: number | null
  highRoll: number | null
  targetDefense: number | null
  isHit: boolean | null
  isCritical: boolean | null
  isFumble: boolean | null
  damage: number | null
  damageType: DamageType | null
  damageAffinity: DamageAffinity | 'neutral' | null
  roundNumber: number | null
  guardApplied: boolean | null
  resourceName: 'mp' | 'ip' | null
  previousResource: number | null
  resultingResource: number | null
  createdAt: string
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

function toCombatant(
  row: CombatantRow,
  attacks: CombatAttack[] = [],
  affinities: Partial<Record<DamageType, DamageAffinity>> = {},
): Combatant {
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
    dexDie: row.dex_die,
    insDie: row.ins_die,
    migDie: row.mig_die,
    wlpDie: row.wlp_die,
    defense: row.defense,
    magicDefense: row.magic_defense,
    attacks,
    affinities,
    lastActedRound: row.last_acted_round,
    guardStartedRound: row.guard_started_round,
    isActive: row.is_active,
    controllerUserId: row.controller_user_id,
  }
}

function toCombatAttack(row: CombatAttackRow): CombatAttack {
  return {
    id: row.id,
    name: row.name,
    accuracyAttributeA: row.accuracy_attribute_a,
    accuracyAttributeB: row.accuracy_attribute_b,
    accuracyBonus: row.accuracy_bonus,
    damageBonus: row.damage_bonus,
    damageType: row.damage_type,
  }
}

function toCombatAction(row: CombatActionRow): CombatAction {
  return {
    id: row.id,
    battleId: row.battle_id,
    actorUserId: row.actor_user_id,
    actorDisplayName: row.actor_display_name,
    targetCombatantId: row.target_combatant_id,
    targetName: row.target_name,
    actionType: row.action_type,
    requestedDelta: row.requested_delta,
    appliedDelta: row.applied_delta,
    previousHp: row.previous_hp,
    resultingHp: row.resulting_hp,
    attackerCombatantId: row.attacker_combatant_id,
    attackerName: row.attacker_name,
    attackName: row.attack_name,
    rollA: row.roll_a,
    rollB: row.roll_b,
    checkTotal: row.check_total,
    highRoll: row.high_roll,
    targetDefense: row.target_defense,
    isHit: row.is_hit,
    isCritical: row.is_critical,
    isFumble: row.is_fumble,
    damage: row.damage,
    damageType: row.damage_type,
    damageAffinity: row.damage_affinity,
    roundNumber: row.round_number,
    guardApplied: row.guard_applied,
    resourceName: row.resource_name,
    previousResource: row.previous_resource,
    resultingResource: row.resulting_resource,
    createdAt: row.created_at,
  }
}

async function loadCombatants(battleId: string) {
  const { data, error } = await supabase
    .from('combatants')
    .select(
      'id, name, side, hp, max_hp, mp, max_mp, ip, max_ip, is_active, sort_order, controller_user_id, dex_die, ins_die, mig_die, wlp_die, defense, magic_defense, last_acted_round, guard_started_round',
    )
    .eq('battle_id', battleId)
    .order('sort_order', { ascending: true })

  if (error) throw error

  const rows = data as CombatantRow[]
  if (rows.length === 0) return []

  const combatantIds = rows.map((row) => row.id)

  const [attacksResult, affinitiesResult] = await Promise.all([
    supabase
      .from('combatant_attacks')
      .select(
        'id, combatant_id, name, accuracy_attribute_a, accuracy_attribute_b, accuracy_bonus, damage_bonus, damage_type, sort_order',
      )
      .in('combatant_id', combatantIds)
      .order('sort_order', { ascending: true }),
    supabase
      .from('combatant_affinities')
      .select('combatant_id, damage_type, affinity')
      .in('combatant_id', combatantIds),
  ])

  if (attacksResult.error) throw attacksResult.error
  if (affinitiesResult.error) throw affinitiesResult.error

  const attacks = attacksResult.data as CombatAttackRow[]
  const affinities = affinitiesResult.data as CombatantAffinityRow[]

  return rows.map((row) => {
    const combatantAffinities = affinities
      .filter((affinity) => affinity.combatant_id === row.id)
      .reduce<Partial<Record<DamageType, DamageAffinity>>>(
        (current, affinity) => ({
          ...current,
          [affinity.damage_type]: affinity.affinity,
        }),
        {},
      )

    return toCombatant(
      row,
      attacks
        .filter((attack) => attack.combatant_id === row.id)
        .map(toCombatAttack),
      combatantAffinities,
    )
  })
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
    dex_die: combatant.dexDie,
    ins_die: combatant.insDie,
    mig_die: combatant.migDie,
    wlp_die: combatant.wlpDie,
    defense: combatant.defense,
    magic_defense: combatant.magicDefense,
    is_active: combatant.isActive ?? false,
    sort_order: index,
  }))

  const { data, error } = await supabase
    .from('combatants')
    .insert(rows)
    .select('id, sort_order')

  if (error) throw error

  const inserted = data as { id: string; sort_order: number }[]
  const attackRows = inserted.flatMap((row) => {
    const seed = seeds[row.sort_order]
    return seed.attacks.map((attack, index) => ({
      combatant_id: row.id,
      name: attack.name,
      accuracy_attribute_a: attack.accuracyAttributeA,
      accuracy_attribute_b: attack.accuracyAttributeB,
      accuracy_bonus: attack.accuracyBonus,
      damage_bonus: attack.damageBonus,
      damage_type: attack.damageType,
      sort_order: index,
    }))
  })

  if (attackRows.length > 0) {
    const { error: attackError } = await supabase
      .from('combatant_attacks')
      .insert(attackRows)

    if (attackError) throw attackError
  }

  const affinityRows = inserted.flatMap((row) => {
    const seed = seeds[row.sort_order]
    return Object.entries(seed.affinities).map(([damageType, affinity]) => ({
      combatant_id: row.id,
      damage_type: damageType as DamageType,
      affinity,
    }))
  })

  if (affinityRows.length > 0) {
    const { error: affinityError } = await supabase
      .from('combatant_affinities')
      .insert(affinityRows)

    if (affinityError) throw affinityError
  }
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

function toBattleTurnState(row: {
  conflict_started: boolean
  round_number: number
  initiative_side: CombatSide | null
  current_side: CombatSide | null
  turn_revision: number
}): BattleTurnState {
  return {
    started: row.conflict_started,
    roundNumber: row.round_number,
    initiativeSide: row.initiative_side,
    currentSide: row.current_side,
    turnRevision: row.turn_revision,
  }
}

async function loadBattleTurnState(
  battleId: string,
): Promise<BattleTurnState> {
  const { data, error } = await supabase
    .from('battles')
    .select(
      'conflict_started, round_number, initiative_side, current_side, turn_revision',
    )
    .eq('id', battleId)
    .single()

  if (error) throw error

  return toBattleTurnState(data as BattleRow)
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
    turnState: toBattleTurnState(battle),
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
    turnState: await loadBattleTurnState(row.battle_id),
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
    .select(
      'id, name, room_id, conflict_started, round_number, initiative_side, current_side, turn_revision',
    )
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

  const row = data as PlayerIdentityRpcRow

  return {
    userId: row.user_id,
    role: row.role,
    displayName: row.display_name,
  }
}

export async function assignCombatantController(
  combatantId: string,
  userId: string | null,
) {
  const { data, error } = await supabase
    .rpc('assign_combatant_controller', {
      p_combatant_id: combatantId,
      p_user_id: userId,
    })
    .single()

  if (error) throw error

  const row = data as CombatantAssignmentRpcRow

  return {
    combatantId: row.combatant_id,
    controllerUserId: row.controller_user_id,
  }
}

export async function applyCombatantHpDelta(
  combatantId: string,
  delta: number,
) {
  const { data, error } = await supabase
    .rpc('apply_combatant_hp_delta', {
      p_combatant_id: combatantId,
      p_delta: delta,
    })
    .single()

  if (error) throw error

  const row = data as CombatantHpActionRpcRow

  return {
    actionId: row.action_id,
    combatantId: row.combatant_id,
    previousHp: row.previous_hp,
    hp: row.hp,
    maxHp: row.max_hp,
    appliedDelta: row.applied_delta,
  }
}

export async function adjustCombatantResource(
  combatantId: string,
  resource: Extract<ResourceName, 'MP' | 'IP'>,
  delta: number,
) {
  const { data, error } = await supabase
    .rpc('adjust_combatant_resource', {
      p_combatant_id: combatantId,
      p_resource: resource.toLowerCase(),
      p_delta: delta,
    })
    .single()

  if (error) throw error

  const row = data as CombatantResourceActionRpcRow

  return {
    actionId: row.action_id,
    combatantId: row.combatant_id,
    resourceName: row.resource_name,
    previousValue: row.previous_value,
    value: row.value,
    maxValue: row.max_value,
    appliedDelta: row.applied_delta,
  }
}

export async function loadCombatActions(
  battleId: string,
  limit = 20,
): Promise<CombatAction[]> {
  const { data, error } = await supabase
    .from('combat_actions')
    .select(
      'id, battle_id, actor_user_id, actor_display_name, target_combatant_id, target_name, action_type, requested_delta, applied_delta, previous_hp, resulting_hp, attacker_combatant_id, attacker_name, attack_name, roll_a, roll_b, check_total, high_roll, target_defense, is_hit, is_critical, is_fumble, damage, damage_type, damage_affinity, round_number, guard_applied, resource_name, previous_resource, resulting_resource, created_at',
    )
    .eq('battle_id', battleId)
    .order('created_at', { ascending: false })
    .limit(limit)

  if (error) throw error

  return (data as CombatActionRow[]).map(toCombatAction)
}

export async function startBattleTurns(
  battleId: string,
  firstSide: CombatSide,
): Promise<BattleTurnState> {
  const { error } = await supabase
    .rpc('start_battle_turns', {
      p_battle_id: battleId,
      p_first_side: firstSide,
    })
    .single()

  if (error) throw error

  return loadBattleTurnState(battleId)
}

export async function stopBattleTurns(
  battleId: string,
): Promise<BattleTurnState> {
  const { error } = await supabase
    .rpc('stop_battle_turns', {
      p_battle_id: battleId,
    })
    .single()

  if (error) throw error

  return loadBattleTurnState(battleId)
}

export async function endCombatantTurn(
  combatantId: string,
  expectedRevision: number,
) {
  const { data, error } = await supabase
    .rpc('end_combatant_turn', {
      p_combatant_id: combatantId,
      p_expected_revision: expectedRevision,
    })
    .single()

  if (error) throw error

  const row = data as EndTurnRpcRow

  return {
    battleId: row.battle_id,
    combatantId: row.combatant_id,
    actedRound: row.acted_round,
    nextRound: row.next_round,
    nextSide: row.next_side,
  }
}

export async function performGuard(
  combatantId: string,
  expectedRevision: number,
) {
  const { data, error } = await supabase
    .rpc('perform_guard', {
      p_combatant_id: combatantId,
      p_expected_revision: expectedRevision,
    })
    .single()

  if (error) throw error

  const row = data as EndTurnRpcRow

  return {
    battleId: row.battle_id,
    combatantId: row.combatant_id,
    actedRound: row.acted_round,
    nextRound: row.next_round,
    nextSide: row.next_side,
  }
}

export async function performCombatantAttack(
  attackId: string,
  targetId: string,
  expectedRevision: number,
) {
  const { data, error } = await supabase
    .rpc('perform_combatant_attack', {
      p_attack_id: attackId,
      p_target_id: targetId,
      p_expected_revision: expectedRevision,
    })
    .single()

  if (error) throw error

  const row = data as CombatAttackRpcRow

  return {
    actionId: row.action_id,
    attackerId: row.attacker_id,
    targetId: row.target_id,
    attackName: row.attack_name,
    rollA: row.roll_a,
    rollB: row.roll_b,
    checkTotal: row.check_total,
    highRoll: row.high_roll,
    targetDefense: row.target_defense,
    isHit: row.is_hit,
    isCritical: row.is_critical,
    isFumble: row.is_fumble,
    damage: row.damage,
    damageType: row.damage_type,
    damageAffinity: row.damage_affinity,
    previousHp: row.previous_hp,
    resultingHp: row.resulting_hp,
  }
}

export function subscribeToCombatActions(
  battleId: string,
  onInsert: (action: CombatAction) => void,
) {
  const channel = supabase
    .channel(`combat-actions-${battleId}`)
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'combat_actions',
        filter: `battle_id=eq.${battleId}`,
      },
      (payload) => {
        onInsert(toCombatAction(payload.new as CombatActionRow))
      },
    )
    .subscribe()

  return () => {
    void supabase.removeChannel(channel)
  }
}

export function subscribeToBattleTurnState(
  battleId: string,
  onUpdate: (state: BattleTurnState) => void,
) {
  const channel = supabase
    .channel(`battle-turns-${battleId}`)
    .on(
      'postgres_changes',
      {
        event: 'UPDATE',
        schema: 'public',
        table: 'battles',
        filter: `id=eq.${battleId}`,
      },
      (payload) => {
        onUpdate(toBattleTurnState(payload.new as BattleRow))
      },
    )
    .subscribe()

  return () => {
    void supabase.removeChannel(channel)
  }
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
