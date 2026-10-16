import type {
  AbilityCheckDefense,
  AbilityEffectType,
  AbilityTargetRelation,
  AttributeName,
  DamageAffinity,
  DamageType,
  DieSize,
  StatusEffect,
} from '../types/combat'

export type NormalizedCombatAbility = {
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
  sortOrder: number
}

export type NormalizedCombatAttack = {
  name: string
  accuracyAttributeA: AttributeName
  accuracyAttributeB: AttributeName
  accuracyBonus: number
  damageBonus: number
  damageType: DamageType
  sortOrder: number
}

export type NormalizedCombatProfile = {
  side: 'heroes' | 'enemies'
  hp: { current: number; max: number }
  mp: { current: number; max: number }
  ip: { current: number; max: number }
  attributes: {
    dex: DieSize
    ins: DieSize
    mig: DieSize
    wlp: DieSize
  }
  defense: number
  magicDefense: number
  statuses: StatusEffect[]
  affinities: Partial<Record<DamageType, DamageAffinity>>
  attacks: NormalizedCombatAttack[]
  abilities?: NormalizedCombatAbility[]
}

export type FultimatorImport = {
  name: string
  level: number | null
  sourceData: Record<string, unknown>
  combatProfile: NormalizedCombatProfile
  warnings: string[]
}

type UnknownRecord = Record<string, unknown>

const ATTRIBUTE_MAP: Record<string, AttributeName> = {
  dex: 'dex',
  dexterity: 'dex',
  ins: 'ins',
  insight: 'ins',
  mig: 'mig',
  might: 'mig',
  wlp: 'wlp',
  will: 'wlp',
  willpower: 'wlp',
}

const DAMAGE_MAP: Record<string, DamageType> = {
  physical: 'physical',
  air: 'air',
  wind: 'air',
  bolt: 'bolt',
  lightning: 'bolt',
  dark: 'dark',
  earth: 'earth',
  fire: 'fire',
  ice: 'ice',
  light: 'light',
  poison: 'poison',
}

const AFFINITY_MAP: Record<string, DamageAffinity | null> = {
  vulnerable: 'vulnerable',
  vulnerability: 'vulnerable',
  resistant: 'resistant',
  resistance: 'resistant',
  immune: 'immune',
  immunity: 'immune',
  absorbs: 'absorbs',
  absorb: 'absorbs',
  absorption: 'absorbs',
  neutral: null,
  normal: null,
}

const STATUS_KEYS: StatusEffect[] = [
  'slow',
  'dazed',
  'weak',
  'shaken',
  'enraged',
  'poisoned',
]

function isRecord(value: unknown): value is UnknownRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function number(value: unknown, fallback = 0) {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return fallback
}

function text(value: unknown, fallback = '') {
  return typeof value === 'string' ? value.trim() : fallback
}

function bool(value: unknown) {
  return value === true || value === 'true' || value === 'on'
}

function die(value: unknown, fallback: DieSize = 8): DieSize {
  const parsed = number(value, fallback)
  return parsed === 6 || parsed === 8 || parsed === 10 || parsed === 12
    ? parsed
    : fallback
}

function attribute(value: unknown, fallback: AttributeName): AttributeName {
  const key = text(value).toLowerCase()
  return ATTRIBUTE_MAP[key] ?? fallback
}

function damageType(value: unknown): DamageType {
  return DAMAGE_MAP[text(value).toLowerCase()] ?? 'physical'
}

function statPair(value: unknown, fallback: number) {
  if (isRecord(value)) {
    const max = Math.max(
      0,
      number(value.max, number(value.base, fallback)),
    )
    const current = Math.min(
      max,
      Math.max(0, number(value.current, max)),
    )
    return { current, max }
  }

  const parsed = Math.max(0, number(value, fallback))
  return { current: parsed, max: parsed }
}

function equipped<T extends UnknownRecord>(items: T[]) {
  const explicitlyEquipped = items.filter((item) => bool(item.isEquipped))
  return explicitlyEquipped.length > 0 ? explicitlyEquipped : []
}

function itemNumber(item: UnknownRecord | null, key: string) {
  return item ? number(item[key], 0) : 0
}

function calculateDefense(
  raw: UnknownRecord,
  dex: DieSize,
  ins: DieSize,
) {
  const armors = array(raw.armor).filter(isRecord)
  const shields = array(raw.shields).filter(isRecord)
  const accessories = array(raw.accessories).filter(isRecord)
  const weapons = array(raw.weapons).filter(isRecord)
  const customWeapons = array(raw.customWeapons).filter(isRecord)

  const armor =
    armors.find((item) => bool(item.isEquipped)) ?? null
  const equippedShields = equipped(shields)
  const accessory =
    accessories.find((item) => bool(item.isEquipped)) ?? null
  const equippedWeapons = equipped(weapons)
  const equippedCustomWeapons = equipped(customWeapons)
  const modifiers = isRecord(raw.modifiers) ? raw.modifiers : {}

  const armorMartial = armor ? bool(armor.martial ?? armor.isMartial) : false

  const baseDefense = armor
    ? armorMartial
      ? number(armor.def, dex)
      : dex + number(armor.def, 0)
    : dex

  const defense =
    baseDefense +
    equippedShields.reduce((sum, item) => sum + number(item.def, 0), 0) +
    number(modifiers.def, 0) +
    itemNumber(armor, 'defModifier') +
    equippedShields.reduce(
      (sum, item) => sum + number(item.defModifier, 0),
      0,
    ) +
    itemNumber(accessory, 'defModifier') +
    equippedWeapons.reduce(
      (sum, item) => sum + number(item.defModifier, 0),
      0,
    ) +
    equippedCustomWeapons.reduce(
      (sum, item) => sum + number(item.defModifier, 0),
      0,
    )

  // Fultimator treats MDEF from non-vehicle armor as INS + armor MDEF.
  const baseMagicDefense = armor
    ? ins + number(armor.mdef, 0)
    : ins

  const magicDefense =
    baseMagicDefense +
    equippedShields.reduce((sum, item) => sum + number(item.mdef, 0), 0) +
    number(modifiers.mdef, 0) +
    itemNumber(armor, 'mDefModifier') +
    equippedShields.reduce(
      (sum, item) => sum + number(item.mDefModifier, 0),
      0,
    ) +
    itemNumber(accessory, 'mDefModifier') +
    equippedWeapons.reduce(
      (sum, item) => sum + number(item.mDefModifier, 0),
      0,
    ) +
    equippedCustomWeapons.reduce(
      (sum, item) => sum + number(item.mDefModifier, 0),
      0,
    )

  return {
    defense: Math.max(0, defense),
    magicDefense: Math.max(0, magicDefense),
  }
}

function normalizeAttack(
  item: UnknownRecord,
  index: number,
): NormalizedCombatAttack | null {
  const name = text(item.name, text(item.category, 'Ataque'))
  if (!name) return null

  const base = isRecord(item.base) ? item.base : null
  const accuracyCheck = isRecord(item.accuracyCheck)
    ? item.accuracyCheck
    : null

  const attrA = attribute(
    item.att1 ??
      base?.att1 ??
      accuracyCheck?.att1,
    'dex',
  )
  const attrB = attribute(
    item.att2 ??
      base?.att2 ??
      accuracyCheck?.att2,
    'mig',
  )

  const accuracyBonus =
    number(item.prec, number(base?.prec, 0)) +
    number(item.precModifier, 0)

  const damageBonus =
    number(
      item.damage,
      number(item.dmg, number(base?.damage, 0)),
    ) + number(item.damageModifier, 0)

  return {
    name,
    accuracyAttributeA: attrA,
    accuracyAttributeB: attrB,
    accuracyBonus,
    damageBonus,
    damageType: damageType(
      item.customDamageType ??
        item.type ??
        base?.type,
    ),
    sortOrder: index,
  }
}

function normalizeAttacks(raw: UnknownRecord) {
  const standard = array(raw.weapons).filter(isRecord)
  const custom = array(raw.customWeapons).filter(isRecord)
  const combined = [...standard, ...custom]

  let candidates = combined.filter((item) => bool(item.isEquipped))
  if (candidates.length === 0 && combined.length > 0) {
    candidates = [combined[0]]
  }

  const attacks = candidates
    .map(normalizeAttack)
    .filter((attack): attack is NormalizedCombatAttack => attack !== null)

  if (attacks.length > 0) return attacks

  return [
    {
      name: 'Ataque desarmado',
      accuracyAttributeA: 'dex' as const,
      accuracyAttributeB: 'mig' as const,
      accuracyBonus: 0,
      damageBonus: 0,
      damageType: 'physical' as const,
      sortOrder: 0,
    },
  ]
}

function normalizeAffinities(raw: UnknownRecord) {
  const source = isRecord(raw.affinities) ? raw.affinities : {}
  const result: Partial<Record<DamageType, DamageAffinity>> = {}

  for (const [rawType, rawAffinity] of Object.entries(source)) {
    const type = DAMAGE_MAP[rawType.toLowerCase()]
    if (!type) continue

    const affinity = AFFINITY_MAP[text(rawAffinity).toLowerCase()]
    if (affinity) result[type] = affinity
  }

  return result
}

function normalizeStatuses(raw: UnknownRecord) {
  const source = isRecord(raw.statuses) ? raw.statuses : {}

  return STATUS_KEYS.filter((status) => bool(source[status]))
}

export function importFultimatorCharacter(value: unknown): FultimatorImport {
  if (!isRecord(value)) {
    throw new Error('O JSON não contém um personagem válido.')
  }

  const name = text(value.name)
  if (!name) {
    throw new Error('O JSON do Fultimator não possui nome de personagem.')
  }

  const attributes = isRecord(value.attributes) ? value.attributes : {}
  const dex = die(attributes.dexterity ?? attributes.dex, 8)
  const ins = die(attributes.insight ?? attributes.ins, 8)
  const mig = die(attributes.might ?? attributes.mig, 8)
  const wlp = die(
    attributes.willpower ?? attributes.will ?? attributes.wlp,
    8,
  )

  const stats = isRecord(value.stats) ? value.stats : {}
  const hp = statPair(stats.hp, 40)
  const mp = statPair(stats.mp, 40)
  const ip = statPair(stats.ip, 6)
  const { defense, magicDefense } = calculateDefense(value, dex, ins)

  const warnings: string[] = []

  if (!isRecord(value.attributes)) {
    warnings.push('Atributos ausentes; usando d8 como fallback.')
  }

  if (!isRecord(value.stats)) {
    warnings.push('HP/MP/IP ausentes; usando valores de fallback.')
  }

  if (array(value.weapons).length === 0 && array(value.customWeapons).length === 0) {
    warnings.push('Nenhuma arma encontrada; ataque desarmado criado.')
  }

  const sourceData = structuredClone(value) as Record<string, unknown>

  return {
    name,
    level:
      value.lvl === undefined && value.level === undefined
        ? null
        : number(value.lvl ?? value.level, 0),
    sourceData,
    combatProfile: {
      side: 'heroes',
      hp,
      mp,
      ip,
      attributes: { dex, ins, mig, wlp },
      defense,
      magicDefense,
      statuses: normalizeStatuses(value),
      affinities: normalizeAffinities(value),
      attacks: normalizeAttacks(value),
      abilities: [],
    },
    warnings,
  }
}
