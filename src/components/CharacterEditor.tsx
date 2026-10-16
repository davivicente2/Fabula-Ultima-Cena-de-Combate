import { useMemo, useState } from 'react'
import {
  createCharacterRecord,
  updateCharacterRecord,
} from '../lib/characterRepository'
import type {
  CharacterKind,
  CharacterRecord,
} from '../lib/characterRepository'
import type {
  NormalizedCombatAbility,
  NormalizedCombatAttack,
  NormalizedCombatProfile,
} from '../lib/fultimatorImport'
import type {
  AbilityEffectType,
  AbilityTargetRelation,
  AttributeName,
  DamageAffinity,
  DamageType,
  DieSize,
  StatusEffect,
} from '../types/combat'

type CharacterEditorProps = {
  roomId: string
  character?: CharacterRecord | null
  createKind?: CharacterKind
  onClose: () => void
  onSaved: () => Promise<void> | void
}

const ATTRIBUTES: { value: AttributeName; label: string }[] = [
  { value: 'dex', label: 'DEX' },
  { value: 'ins', label: 'INS' },
  { value: 'mig', label: 'MIG' },
  { value: 'wlp', label: 'WLP' },
]

const DIE_SIZES: DieSize[] = [6, 8, 10, 12]

const DAMAGE_TYPES: { value: DamageType; label: string }[] = [
  { value: 'physical', label: 'Físico' },
  { value: 'air', label: 'Ar' },
  { value: 'bolt', label: 'Raio' },
  { value: 'dark', label: 'Trevas' },
  { value: 'earth', label: 'Terra' },
  { value: 'fire', label: 'Fogo' },
  { value: 'ice', label: 'Gelo' },
  { value: 'light', label: 'Luz' },
  { value: 'poison', label: 'Veneno' },
]

const STATUS_EFFECTS: { value: StatusEffect; label: string }[] = [
  { value: 'slow', label: 'Slow' },
  { value: 'dazed', label: 'Dazed' },
  { value: 'weak', label: 'Weak' },
  { value: 'shaken', label: 'Shaken' },
  { value: 'enraged', label: 'Enraged' },
  { value: 'poisoned', label: 'Poisoned' },
]

const AFFINITIES: {
  value: DamageAffinity | 'neutral'
  label: string
}[] = [
  { value: 'neutral', label: 'Neutro' },
  { value: 'vulnerable', label: 'Vulnerável' },
  { value: 'resistant', label: 'Resistente' },
  { value: 'immune', label: 'Imune' },
  { value: 'absorbs', label: 'Absorve' },
]

function defaultAttack(index = 0): NormalizedCombatAttack {
  return {
    name: index === 0 ? 'Ataque' : `Ataque ${index + 1}`,
    accuracyAttributeA: 'dex',
    accuracyAttributeB: 'mig',
    accuracyBonus: 0,
    damageBonus: 0,
    damageType: 'physical',
    sortOrder: index,
  }
}

function defaultAbility(index = 0): NormalizedCombatAbility {
  return {
    name: `Habilidade ${index + 1}`,
    effectType: 'damage',
    targetRelation: 'enemy',
    checkAttributeA: 'ins',
    checkAttributeB: 'wlp',
    checkBonus: 0,
    mpCost: 0,
    damageBonus: 0,
    damageType: 'physical',
    healAmount: 0,
    statusEffect: null,
    sortOrder: index,
  }
}

function defaultProfile(kind: CharacterKind): NormalizedCombatProfile {
  return {
    side: kind === 'npc' ? 'enemies' : 'heroes',
    hp: { current: 40, max: 40 },
    mp: { current: 40, max: 40 },
    ip: { current: 6, max: 6 },
    attributes: {
      dex: 8,
      ins: 8,
      mig: 8,
      wlp: 8,
    },
    defense: 8,
    magicDefense: 8,
    statuses: [],
    affinities: {},
    attacks: [defaultAttack()],
    abilities: [],
  }
}

function cloneProfile(
  character: CharacterRecord | null | undefined,
  kind: CharacterKind,
): NormalizedCombatProfile {
  if (!character) return defaultProfile(kind)

  const profile = structuredClone(character.combatProfile)

  return {
    ...defaultProfile(character.kind),
    ...profile,
    hp: { ...defaultProfile(character.kind).hp, ...profile.hp },
    mp: { ...defaultProfile(character.kind).mp, ...profile.mp },
    ip: { ...defaultProfile(character.kind).ip, ...profile.ip },
    attributes: {
      ...defaultProfile(character.kind).attributes,
      ...profile.attributes,
    },
    affinities: { ...(profile.affinities ?? {}) },
    statuses: [...(profile.statuses ?? [])],
    attacks: [...(profile.attacks ?? [])].map((attack, index) => ({
      ...attack,
      sortOrder: index,
    })),
    abilities: [...(profile.abilities ?? [])].map((ability, index) => ({
      ...ability,
      sortOrder: index,
    })),
  }
}

function numeric(value: string, fallback = 0) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function sourceDataWithProfile(
  original: Record<string, unknown>,
  name: string,
  profile: NormalizedCombatProfile,
) {
  const next = structuredClone(original)
  const oldAttributes =
    next.attributes &&
    typeof next.attributes === 'object' &&
    !Array.isArray(next.attributes)
      ? (next.attributes as Record<string, unknown>)
      : {}
  const oldStats =
    next.stats &&
    typeof next.stats === 'object' &&
    !Array.isArray(next.stats)
      ? (next.stats as Record<string, unknown>)
      : {}

  next.name = name
  next.attributes = {
    ...oldAttributes,
    dexterity: profile.attributes.dex,
    insight: profile.attributes.ins,
    might: profile.attributes.mig,
    willpower: profile.attributes.wlp,
  }
  next.stats = {
    ...oldStats,
    hp: { ...profile.hp },
    mp: { ...profile.mp },
    ip: { ...profile.ip },
  }

  return next
}

function sanitizeProfile(profile: NormalizedCombatProfile) {
  const hpMax = Math.max(1, Math.trunc(profile.hp.max))
  const mpMax = Math.max(0, Math.trunc(profile.mp.max))
  const ipMax = Math.max(0, Math.trunc(profile.ip.max))

  const attacks = profile.attacks
    .filter((attack) => attack.name.trim())
    .map((attack, index) => ({
      ...attack,
      name: attack.name.trim(),
      accuracyBonus: Math.trunc(attack.accuracyBonus),
      damageBonus: Math.trunc(attack.damageBonus),
      sortOrder: index,
    }))

  const abilities = (profile.abilities ?? [])
    .filter((ability) => ability.name.trim())
    .map((ability, index) => {
      const effectType = ability.effectType
      return {
        ...ability,
        name: ability.name.trim(),
        checkBonus: Math.trunc(ability.checkBonus),
        mpCost: Math.max(0, Math.trunc(ability.mpCost)),
        damageBonus:
          effectType === 'damage' ? Math.trunc(ability.damageBonus) : 0,
        damageType:
          effectType === 'damage'
            ? (ability.damageType ?? 'physical')
            : null,
        healAmount:
          effectType === 'heal'
            ? Math.max(1, Math.trunc(ability.healAmount || 1))
            : 0,
        statusEffect:
          effectType === 'status'
            ? (ability.statusEffect ?? 'slow')
            : null,
        sortOrder: index,
      }
    })

  return {
    ...profile,
    hp: {
      max: hpMax,
      current: Math.min(hpMax, Math.max(0, Math.trunc(profile.hp.current))),
    },
    mp: {
      max: mpMax,
      current: Math.min(mpMax, Math.max(0, Math.trunc(profile.mp.current))),
    },
    ip: {
      max: ipMax,
      current: Math.min(ipMax, Math.max(0, Math.trunc(profile.ip.current))),
    },
    defense: Math.max(0, Math.trunc(profile.defense)),
    magicDefense: Math.max(0, Math.trunc(profile.magicDefense)),
    attacks,
    abilities,
  } satisfies NormalizedCombatProfile
}

export function CharacterEditor({
  roomId,
  character,
  createKind = 'character',
  onClose,
  onSaved,
}: CharacterEditorProps) {
  const kind = character?.kind ?? createKind
  const [name, setName] = useState(
    character?.name ?? (kind === 'npc' ? 'Novo inimigo' : 'Novo personagem'),
  )
  const [profile, setProfile] = useState<NormalizedCombatProfile>(() =>
    cloneProfile(character, kind),
  )
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const title = character
    ? `Editar ${character.name}`
    : kind === 'npc'
      ? 'Criar NPC'
      : 'Criar personagem'

  const isImported = character?.source === 'fultimator'

  const affinityRows = useMemo(
    () => DAMAGE_TYPES.map(({ value, label }) => ({ value, label })),
    [],
  )

  function updateAttack(
    index: number,
    patch: Partial<NormalizedCombatAttack>,
  ) {
    setProfile((current) => ({
      ...current,
      attacks: current.attacks.map((attack, attackIndex) =>
        attackIndex === index ? { ...attack, ...patch } : attack,
      ),
    }))
  }

  function updateAbility(
    index: number,
    patch: Partial<NormalizedCombatAbility>,
  ) {
    setProfile((current) => ({
      ...current,
      abilities: (current.abilities ?? []).map((ability, abilityIndex) =>
        abilityIndex === index ? { ...ability, ...patch } : ability,
      ),
    }))
  }

  async function handleSave() {
    const trimmedName = name.trim()
    if (!trimmedName || saving) return

    setSaving(true)
    setError(null)

    try {
      const cleanProfile = sanitizeProfile(profile)
      const sourceData = sourceDataWithProfile(
        character?.sourceData ?? {
          lvl: 5,
          info: {
            identity: '',
            theme: '',
            origin: '',
            description: '',
            fabulapoints: 3,
            exp: 0,
            zenit: 0,
            bonds: [],
          },
          classes: [],
          notes: [],
        },
        trimmedName,
        cleanProfile,
      )

      if (character) {
        await updateCharacterRecord({
          characterId: character.id,
          name: trimmedName,
          sourceData,
          combatProfile: cleanProfile,
        })
      } else {
        await createCharacterRecord({
          roomId,
          name: trimmedName,
          kind,
          source: 'native',
          sourceData,
          combatProfile: cleanProfile,
        })
      }

      await onSaved()
      onClose()
    } catch (reason) {
      console.error(reason)
      setError(
        reason instanceof Error
          ? reason.message
          : 'Não foi possível salvar a ficha.',
      )
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      className="character-editor-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target) onClose()
      }}
    >
      <section
        className="character-editor"
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <header className="character-editor__header">
          <div>
            <span className="character-editor__eyebrow">
              {kind === 'npc' ? 'NPC' : 'Personagem'} · editor do VTT
            </span>
            <h2>{title}</h2>
            <small>
              {isImported
                ? 'A origem Fultimator é preservada; estas alterações passam a controlar o perfil de combate do VTT.'
                : 'Configure apenas o necessário para jogar. Classes e progressão completa podem continuar fora do VTT por enquanto.'}
            </small>
          </div>
          <button type="button" onClick={onClose} aria-label="Fechar editor">
            ×
          </button>
        </header>

        <div className="character-editor__body">
          <section className="character-editor__section">
            <h3>Base</h3>
            <div className="character-editor__grid">
              <label className="character-editor__wide">
                Nome
                <input
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  maxLength={80}
                />
              </label>

              {ATTRIBUTES.map(({ value, label }) => (
                <label key={value}>
                  {label}
                  <select
                    value={profile.attributes[value]}
                    onChange={(event) =>
                      setProfile((current) => ({
                        ...current,
                        attributes: {
                          ...current.attributes,
                          [value]: Number(event.target.value) as DieSize,
                        },
                      }))
                    }
                  >
                    {DIE_SIZES.map((dieSize) => (
                      <option value={dieSize} key={dieSize}>
                        d{dieSize}
                      </option>
                    ))}
                  </select>
                </label>
              ))}

              {(['hp', 'mp', 'ip'] as const).flatMap((resource) => [
                <label key={`${resource}-current`}>
                  {resource.toUpperCase()} atual
                  <input
                    type="number"
                    min={0}
                    value={profile[resource].current}
                    onChange={(event) =>
                      setProfile((current) => ({
                        ...current,
                        [resource]: {
                          ...current[resource],
                          current: numeric(event.target.value),
                        },
                      }))
                    }
                  />
                </label>,
                <label key={`${resource}-max`}>
                  {resource.toUpperCase()} máximo
                  <input
                    type="number"
                    min={resource === 'hp' ? 1 : 0}
                    value={profile[resource].max}
                    onChange={(event) =>
                      setProfile((current) => ({
                        ...current,
                        [resource]: {
                          ...current[resource],
                          max: numeric(event.target.value),
                        },
                      }))
                    }
                  />
                </label>,
              ])}

              <label>
                DEF
                <input
                  type="number"
                  min={0}
                  value={profile.defense}
                  onChange={(event) =>
                    setProfile((current) => ({
                      ...current,
                      defense: numeric(event.target.value),
                    }))
                  }
                />
              </label>

              <label>
                MDEF
                <input
                  type="number"
                  min={0}
                  value={profile.magicDefense}
                  onChange={(event) =>
                    setProfile((current) => ({
                      ...current,
                      magicDefense: numeric(event.target.value),
                    }))
                  }
                />
              </label>
            </div>
          </section>

          <section className="character-editor__section">
            <div className="character-editor__section-title">
              <div>
                <h3>Ataques</h3>
                <small>Check + bônus de precisão; dano usa HR + bônus.</small>
              </div>
              <button
                type="button"
                onClick={() =>
                  setProfile((current) => ({
                    ...current,
                    attacks: [
                      ...current.attacks,
                      defaultAttack(current.attacks.length),
                    ],
                  }))
                }
              >
                + Ataque
              </button>
            </div>

            <div className="character-editor__cards">
              {profile.attacks.length === 0 ? (
                <span className="character-editor__empty">
                  Nenhum ataque configurado.
                </span>
              ) : null}

              {profile.attacks.map((attack, index) => (
                <article className="character-editor__card" key={index}>
                  <div className="character-editor__card-title">
                    <strong>Ataque {index + 1}</strong>
                    <button
                      type="button"
                      className="is-danger"
                      onClick={() =>
                        setProfile((current) => ({
                          ...current,
                          attacks: current.attacks.filter(
                            (_, attackIndex) => attackIndex !== index,
                          ),
                        }))
                      }
                    >
                      Remover
                    </button>
                  </div>

                  <div className="character-editor__grid">
                    <label className="character-editor__wide">
                      Nome
                      <input
                        value={attack.name}
                        onChange={(event) =>
                          updateAttack(index, { name: event.target.value })
                        }
                      />
                    </label>
                    <label>
                      Atributo 1
                      <select
                        value={attack.accuracyAttributeA}
                        onChange={(event) =>
                          updateAttack(index, {
                            accuracyAttributeA: event.target
                              .value as AttributeName,
                          })
                        }
                      >
                        {ATTRIBUTES.map((attribute) => (
                          <option
                            value={attribute.value}
                            key={attribute.value}
                          >
                            {attribute.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Atributo 2
                      <select
                        value={attack.accuracyAttributeB}
                        onChange={(event) =>
                          updateAttack(index, {
                            accuracyAttributeB: event.target
                              .value as AttributeName,
                          })
                        }
                      >
                        {ATTRIBUTES.map((attribute) => (
                          <option
                            value={attribute.value}
                            key={attribute.value}
                          >
                            {attribute.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Bônus do check
                      <input
                        type="number"
                        value={attack.accuracyBonus}
                        onChange={(event) =>
                          updateAttack(index, {
                            accuracyBonus: numeric(event.target.value),
                          })
                        }
                      />
                    </label>
                    <label>
                      Bônus de dano
                      <input
                        type="number"
                        value={attack.damageBonus}
                        onChange={(event) =>
                          updateAttack(index, {
                            damageBonus: numeric(event.target.value),
                          })
                        }
                      />
                    </label>
                    <label>
                      Tipo de dano
                      <select
                        value={attack.damageType}
                        onChange={(event) =>
                          updateAttack(index, {
                            damageType: event.target.value as DamageType,
                          })
                        }
                      >
                        {DAMAGE_TYPES.map((type) => (
                          <option value={type.value} key={type.value}>
                            {type.label}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                </article>
              ))}
            </div>
          </section>

          <section className="character-editor__section">
            <div className="character-editor__section-title">
              <div>
                <h3>Habilidades</h3>
                <small>
                  Automação inicial: dano, cura ou aplicação de status.
                </small>
              </div>
              <button
                type="button"
                onClick={() =>
                  setProfile((current) => ({
                    ...current,
                    abilities: [
                      ...(current.abilities ?? []),
                      defaultAbility((current.abilities ?? []).length),
                    ],
                  }))
                }
              >
                + Habilidade
              </button>
            </div>

            <div className="character-editor__cards">
              {(profile.abilities ?? []).length === 0 ? (
                <span className="character-editor__empty">
                  Nenhuma habilidade configurada.
                </span>
              ) : null}

              {(profile.abilities ?? []).map((ability, index) => (
                <article className="character-editor__card" key={index}>
                  <div className="character-editor__card-title">
                    <strong>Habilidade {index + 1}</strong>
                    <button
                      type="button"
                      className="is-danger"
                      onClick={() =>
                        setProfile((current) => ({
                          ...current,
                          abilities: (current.abilities ?? []).filter(
                            (_, abilityIndex) => abilityIndex !== index,
                          ),
                        }))
                      }
                    >
                      Remover
                    </button>
                  </div>

                  <div className="character-editor__grid">
                    <label className="character-editor__wide">
                      Nome
                      <input
                        value={ability.name}
                        onChange={(event) =>
                          updateAbility(index, { name: event.target.value })
                        }
                      />
                    </label>

                    <label>
                      Efeito
                      <select
                        value={ability.effectType}
                        onChange={(event) => {
                          const effectType = event.target
                            .value as AbilityEffectType
                          updateAbility(index, {
                            effectType,
                            targetRelation:
                              effectType === 'heal' ? 'ally' : 'enemy',
                            damageType:
                              effectType === 'damage'
                                ? (ability.damageType ?? 'physical')
                                : null,
                            healAmount:
                              effectType === 'heal'
                                ? Math.max(1, ability.healAmount || 1)
                                : 0,
                            statusEffect:
                              effectType === 'status'
                                ? (ability.statusEffect ?? 'slow')
                                : null,
                          })
                        }}
                      >
                        <option value="damage">Dano</option>
                        <option value="heal">Cura</option>
                        <option value="status">Status</option>
                      </select>
                    </label>

                    <label>
                      Relação do alvo
                      <select
                        value={ability.targetRelation}
                        onChange={(event) =>
                          updateAbility(index, {
                            targetRelation: event.target
                              .value as AbilityTargetRelation,
                          })
                        }
                      >
                        <option value="enemy">Inimigo</option>
                        <option value="ally">Aliado</option>
                      </select>
                    </label>

                    <label>
                      Custo MP
                      <input
                        type="number"
                        min={0}
                        value={ability.mpCost}
                        onChange={(event) =>
                          updateAbility(index, {
                            mpCost: numeric(event.target.value),
                          })
                        }
                      />
                    </label>

                    {ability.effectType !== 'heal' ? (
                      <>
                        <label>
                          Atributo 1
                          <select
                            value={ability.checkAttributeA}
                            onChange={(event) =>
                              updateAbility(index, {
                                checkAttributeA: event.target
                                  .value as AttributeName,
                              })
                            }
                          >
                            {ATTRIBUTES.map((attribute) => (
                              <option
                                value={attribute.value}
                                key={attribute.value}
                              >
                                {attribute.label}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label>
                          Atributo 2
                          <select
                            value={ability.checkAttributeB}
                            onChange={(event) =>
                              updateAbility(index, {
                                checkAttributeB: event.target
                                  .value as AttributeName,
                              })
                            }
                          >
                            {ATTRIBUTES.map((attribute) => (
                              <option
                                value={attribute.value}
                                key={attribute.value}
                              >
                                {attribute.label}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label>
                          Bônus do check
                          <input
                            type="number"
                            value={ability.checkBonus}
                            onChange={(event) =>
                              updateAbility(index, {
                                checkBonus: numeric(event.target.value),
                              })
                            }
                          />
                        </label>
                      </>
                    ) : null}

                    {ability.effectType === 'damage' ? (
                      <>
                        <label>
                          Bônus de dano
                          <input
                            type="number"
                            value={ability.damageBonus}
                            onChange={(event) =>
                              updateAbility(index, {
                                damageBonus: numeric(event.target.value),
                              })
                            }
                          />
                        </label>
                        <label>
                          Tipo de dano
                          <select
                            value={ability.damageType ?? 'physical'}
                            onChange={(event) =>
                              updateAbility(index, {
                                damageType: event.target.value as DamageType,
                              })
                            }
                          >
                            {DAMAGE_TYPES.map((type) => (
                              <option value={type.value} key={type.value}>
                                {type.label}
                              </option>
                            ))}
                          </select>
                        </label>
                      </>
                    ) : ability.effectType === 'heal' ? (
                      <label>
                        Cura
                        <input
                          type="number"
                          min={1}
                          value={ability.healAmount}
                          onChange={(event) =>
                            updateAbility(index, {
                              healAmount: numeric(event.target.value, 1),
                            })
                          }
                        />
                      </label>
                    ) : (
                      <label>
                        Status
                        <select
                          value={ability.statusEffect ?? 'slow'}
                          onChange={(event) =>
                            updateAbility(index, {
                              statusEffect: event.target
                                .value as StatusEffect,
                            })
                          }
                        >
                          {STATUS_EFFECTS.map((status) => (
                            <option value={status.value} key={status.value}>
                              {status.label}
                            </option>
                          ))}
                        </select>
                      </label>
                    )}
                  </div>
                </article>
              ))}
            </div>
          </section>

          <section className="character-editor__section">
            <h3>Afinidades</h3>
            <div className="character-editor__affinities">
              {affinityRows.map((type) => (
                <label key={type.value}>
                  {type.label}
                  <select
                    value={profile.affinities[type.value] ?? 'neutral'}
                    onChange={(event) => {
                      const affinity = event.target
                        .value as DamageAffinity | 'neutral'
                      setProfile((current) => {
                        const affinities = { ...current.affinities }
                        if (affinity === 'neutral') {
                          delete affinities[type.value]
                        } else {
                          affinities[type.value] = affinity
                        }
                        return { ...current, affinities }
                      })
                    }}
                  >
                    {AFFINITIES.map((affinity) => (
                      <option value={affinity.value} key={affinity.value}>
                        {affinity.label}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
          </section>

          <section className="character-editor__section">
            <h3>Status atuais</h3>
            <div className="character-editor__statuses">
              {STATUS_EFFECTS.map((status) => (
                <label key={status.value}>
                  <input
                    type="checkbox"
                    checked={profile.statuses.includes(status.value)}
                    onChange={(event) =>
                      setProfile((current) => ({
                        ...current,
                        statuses: event.target.checked
                          ? [...current.statuses, status.value]
                          : current.statuses.filter(
                              (value) => value !== status.value,
                            ),
                      }))
                    }
                  />
                  {status.label}
                </label>
              ))}
            </div>
          </section>

          {error ? <p className="character-editor__error">{error}</p> : null}
        </div>

        <footer className="character-editor__footer">
          <small>
            Fichas que já estão em uma cena só podem ser editadas com o
            conflito encerrado.
          </small>
          <div>
            <button type="button" onClick={onClose} disabled={saving}>
              Cancelar
            </button>
            <button
              type="button"
              className="is-primary"
              onClick={() => void handleSave()}
              disabled={saving || !name.trim()}
            >
              {saving ? 'Salvando…' : character ? 'Salvar alterações' : 'Criar'}
            </button>
          </div>
        </footer>
      </section>
    </div>
  )
}
