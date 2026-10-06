export type CombatSide = 'heroes' | 'enemies'

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
  isActive?: boolean
}

export type ResourceName = 'HP' | 'MP' | 'IP'
