export type CombatSide = 'heroes' | 'enemies'

export type AttributeName = 'dex' | 'ins' | 'mig' | 'wlp'
export type DieSize = 6 | 8 | 10 | 12

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

export type CombatAbility = {
  id: string
  name: string
  checkAttributeA: AttributeName
  checkAttributeB: AttributeName
  checkBonus: number
  mpCost: number
  damageBonus: number
  damageType: DamageType
}

export type Combatant = {
  id: string
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
