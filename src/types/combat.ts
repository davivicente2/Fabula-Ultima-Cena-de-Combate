export type CombatSide = 'heroes' | 'enemies'

export type AttributeName = 'dex' | 'ins' | 'mig' | 'wlp'
export type DieSize = 6 | 8 | 10 | 12

export type CombatAttack = {
  id: string
  name: string
  accuracyAttributeA: AttributeName
  accuracyAttributeB: AttributeName
  accuracyBonus: number
  damageBonus: number
  damageType: string
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
  isActive?: boolean
  controllerUserId?: string | null
}

export type ResourceName = 'HP' | 'MP' | 'IP'
