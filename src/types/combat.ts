export type CombatSide = 'heroes' | 'enemies'

export type AttributeName = 'dex' | 'ins' | 'mig' | 'wlp'
export type DieSize = 6 | 8 | 10 | 12

export type InventoryItem = 'remedy' | 'elixir' | 'tonic'

export type StatusEffect =
  | 'slow'
  | 'dazed'
  | 'weak'
  | 'shaken'
  | 'enraged'
  | 'poisoned'

export type DamageType =
  | 'physical'
  | 'air'
  | 'bolt'
  | 'dark'
  | 'earth'
  | 'fire'
  | 'ice'
  | 'light'
  | 'poison'

export type DamageAffinity =
  | 'vulnerable'
  | 'resistant'
  | 'immune'
  | 'absorbs'

export type CombatAttack = {
  id: string
  name: string
  accuracyAttributeA: AttributeName
  accuracyAttributeB: AttributeName
  accuracyBonus: number
  damageBonus: number
  damageType: DamageType
}

export type AbilityEffectType = 'damage' | 'heal' | 'status' | 'manual'
export type AbilityTargetRelation = 'enemy' | 'ally' | 'self' | 'any'
export type AbilityCheckDefense = 'def' | 'mdef' | 'none' | 'auto'

export type CombatAbility = {
  id: string
  name: string
  effectType: AbilityEffectType
  targetRelation: AbilityTargetRelation
  checkAttributeA: AttributeName
  checkAttributeB: AttributeName
  checkBonus: number
  mpCost: number
  damageBonus: number
  damageType: DamageType | null
  healAmount: number
  statusEffect: StatusEffect | null
  description?: string | null
  checkDefense?: AbilityCheckDefense
}

export type Combatant = {
  id: string
  characterId?: string | null
  name: string
  side: CombatSide
  hp: number
  maxHp: number
  mp: number
  maxMp: number
  ip: number
  maxIp: number
  dexDie: DieSize
  insDie: DieSize
  migDie: DieSize
  wlpDie: DieSize
  baseDexDie: DieSize
  baseInsDie: DieSize
  baseMigDie: DieSize
  baseWlpDie: DieSize
  statuses: StatusEffect[]
  defense: number
  magicDefense: number
  attacks: CombatAttack[]
  abilities: CombatAbility[]
  affinities: Partial<Record<DamageType, DamageAffinity>>
  lastActedRound?: number
  guardStartedRound?: number | null
  isActive?: boolean
  controllerUserId?: string | null
}

export type ResourceName = 'HP' | 'MP' | 'IP'
