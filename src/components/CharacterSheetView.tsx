import { useEffect } from 'react'
import type { CharacterRecord } from '../lib/characterRepository'

type CharacterSheetViewProps = {
  character: CharacterRecord
  onClose: () => void
}

type UnknownRecord = Record<string, unknown>

function record(value: unknown): UnknownRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as UnknownRecord)
    : null
}

function list(value: unknown) {
  return Array.isArray(value) ? value : []
}

function valueText(value: unknown, fallback = '—') {
  if (typeof value === 'string' && value.trim()) return value.trim()
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return fallback
}

function truthy(value: unknown) {
  return value === true || value === 'true' || value === 'on'
}

function namedRecords(value: unknown) {
  return list(value)
    .map((entry) => record(entry))
    .filter((entry): entry is UnknownRecord => entry !== null)
}

function nestedEquipment(raw: UnknownRecord, key: string) {
  const topLevel = namedRecords(raw[key])
  if (topLevel.length > 0) return topLevel

  const equipment = record(raw.equipment)
  return equipment ? namedRecords(equipment[key]) : []
}

function fieldList(entry: UnknownRecord, keys: string[]) {
  return keys
    .map((key) => valueText(entry[key], ''))
    .filter(Boolean)
}

function sourceLabel(source: CharacterRecord['source']) {
  switch (source) {
    case 'fultimator':
      return 'Fultimator'
    case 'foundry':
      return 'Foundry / ProjectFU'
    case 'roll20':
      return 'Roll20'
    default:
      return 'Nativa'
  }
}

function statusLabel(status: string) {
  const labels: Record<string, string> = {
    slow: 'Lento',
    dazed: 'Atordoado',
    weak: 'Fraco',
    shaken: 'Abalado',
    enraged: 'Enfurecido',
    poisoned: 'Envenenado',
  }

  return labels[status] ?? status
}

function affinityLabel(value: unknown) {
  const labels: Record<string, string> = {
    vulnerable: 'Vulnerável',
    vulnerability: 'Vulnerável',
    resistant: 'Resistente',
    resistance: 'Resistente',
    immune: 'Imune',
    immunity: 'Imune',
    absorbs: 'Absorve',
    absorb: 'Absorve',
    absorption: 'Absorve',
    neutral: 'Neutro',
  }

  const normalized = valueText(value, '').toLowerCase()
  return labels[normalized] ?? valueText(value)
}

function CharacterClass({ entry }: { entry: UnknownRecord }) {
  const skills = namedRecords(entry.skills)
  const heroic = namedRecords(entry.heroic ?? entry.heroicSkills)
  const spells = namedRecords(entry.spells)
  const benefits = record(entry.benefits)

  return (
    <article className="character-sheet__class">
      <div className="character-sheet__class-title">
        <strong>{valueText(entry.name, 'Classe')}</strong>
        <span>
          Nv. {valueText(entry.lvl ?? entry.level, '—')}
        </span>
      </div>

      {benefits ? (
        <div className="character-sheet__chips">
          {Number(benefits.hpplus ?? 0) !== 0 ? (
            <span>HP +{valueText(benefits.hpplus)}</span>
          ) : null}
          {Number(benefits.mpplus ?? 0) !== 0 ? (
            <span>MP +{valueText(benefits.mpplus)}</span>
          ) : null}
          {Number(benefits.ipplus ?? 0) !== 0 ? (
            <span>IP +{valueText(benefits.ipplus)}</span>
          ) : null}
        </div>
      ) : null}

      {skills.length > 0 ? (
        <div className="character-sheet__subsection">
          <h4>Skills</h4>
          {skills.map((skill, index) => (
            <div className="character-sheet__text-entry" key={index}>
              <strong>
                {valueText(skill.name, 'Skill')}
                {skill.currentSL !== undefined || skill.currentLvl !== undefined
                  ? ` · SL ${valueText(skill.currentSL ?? skill.currentLvl)}${skill.maxSL !== undefined ? `/${valueText(skill.maxSL)}` : ''}`
                  : ''}
              </strong>
              {valueText(skill.description, '') ? (
                <p>{valueText(skill.description)}</p>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}

      {heroic.length > 0 ? (
        <div className="character-sheet__subsection">
          <h4>Heroic Skills</h4>
          {heroic.map((skill, index) => (
            <div className="character-sheet__text-entry" key={index}>
              <strong>{valueText(skill.name, 'Heroic Skill')}</strong>
              {valueText(skill.description, '') ? (
                <p>{valueText(skill.description)}</p>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}

      {spells.length > 0 ? (
        <div className="character-sheet__subsection">
          <h4>Spells</h4>
          {spells.map((spell, index) => {
            const effects = fieldList(spell, [
              'effect',
              'effect1',
              'effect2',
              'effect3',
              'effect4',
              'effect5',
              'effect6',
            ])

            return (
              <div className="character-sheet__spell" key={index}>
                <div>
                  <strong>{valueText(spell.name, 'Spell')}</strong>
                  <span>
                    {truthy(spell.isOffensive) ? 'Ofensiva' : 'Suporte'}
                    {spell.mpCostTarget !== undefined
                      ? ` · ${valueText(spell.mpCostTarget)} MP/alvo`
                      : ''}
                    {spell.maxTargets !== undefined
                      ? ` · até ${valueText(spell.maxTargets)} alvo(s)`
                      : ''}
                  </span>
                </div>

                {valueText(spell.attr1, '') || valueText(spell.attr2, '') ? (
                  <small>
                    Check: {valueText(spell.attr1, '—')} +{' '}
                    {valueText(spell.attr2, '—')}
                  </small>
                ) : null}

                {valueText(spell.targetDescription, '') ? (
                  <small>Alvo: {valueText(spell.targetDescription)}</small>
                ) : null}

                {valueText(spell.duration, '') ? (
                  <small>Duração: {valueText(spell.duration)}</small>
                ) : null}

                {effects.map((effect, effectIndex) => (
                  <p key={effectIndex}>{effect}</p>
                ))}
              </div>
            )
          })}
        </div>
      ) : null}
    </article>
  )
}

function EquipmentList({
  title,
  items,
}: {
  title: string
  items: UnknownRecord[]
}) {
  if (items.length === 0) return null

  return (
    <div className="character-sheet__subsection">
      <h4>{title}</h4>
      <div className="character-sheet__equipment-list">
        {items.map((item, index) => {
          const accuracy =
            valueText(item.att1 ?? record(item.accuracyCheck)?.att1, '') &&
            valueText(item.att2 ?? record(item.accuracyCheck)?.att2, '')
              ? `${valueText(item.att1 ?? record(item.accuracyCheck)?.att1)} + ${valueText(item.att2 ?? record(item.accuracyCheck)?.att2)}`
              : ''

          return (
            <div className="character-sheet__equipment" key={index}>
              <div>
                <strong>{valueText(item.name, title)}</strong>
                {truthy(item.isEquipped) ? <span>Equipado</span> : null}
              </div>
              <small>
                {[
                  valueText(item.category, ''),
                  valueText(item.quality, ''),
                  accuracy ? `Check ${accuracy}` : '',
                  item.prec !== undefined ? `Prec. +${valueText(item.prec)}` : '',
                  item.damage !== undefined || item.dmg !== undefined
                    ? `Dano +${valueText(item.damage ?? item.dmg)}`
                    : '',
                  valueText(item.type, ''),
                  item.def !== undefined ? `DEF +${valueText(item.def)}` : '',
                  item.mdef !== undefined ? `MDEF +${valueText(item.mdef)}` : '',
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </small>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export function CharacterSheetView({
  character,
  onClose,
}: CharacterSheetViewProps) {
  const raw = character.sourceData
  const profile = character.combatProfile
  const info = record(raw.info) ?? {}
  const classes = namedRecords(raw.classes)
  const bonds = namedRecords(info.bonds ?? raw.bonds)
  const notes = namedRecords(raw.notes)
  const items = namedRecords(raw.items)
  const consumables = namedRecords(raw.consumables)
  const affinities = record(raw.affinities) ?? {}

  const weapons = nestedEquipment(raw, 'weapons')
  const customWeapons = nestedEquipment(raw, 'customWeapons')
  const armor = nestedEquipment(raw, 'armor')
  const shields = nestedEquipment(raw, 'shields')
  const accessories = nestedEquipment(raw, 'accessories')

  const activeStatuses = profile.statuses

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  return (
    <div
      className="character-sheet-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target) onClose()
      }}
    >
      <section
        className="character-sheet"
        role="dialog"
        aria-modal="true"
        aria-label={`Ficha de ${character.name}`}
      >
        <header className="character-sheet__header">
          <div>
            <span className="character-sheet__source">
              {sourceLabel(character.source)}
            </span>
            <h2>{character.name}</h2>
            <p>
              Nv. {valueText(raw.lvl ?? raw.level)}
              {valueText(info.identity, '') ? ` · ${valueText(info.identity)}` : ''}
              {valueText(info.pronouns, '') ? ` · ${valueText(info.pronouns)}` : ''}
            </p>
          </div>

          <button
            className="character-sheet__close"
            type="button"
            onClick={onClose}
            aria-label="Fechar ficha"
          >
            ×
          </button>
        </header>

        <div className="character-sheet__body">
          <section className="character-sheet__overview">
            <div className="character-sheet__attributes">
              <span>DEX <strong>d{profile.attributes.dex}</strong></span>
              <span>INS <strong>d{profile.attributes.ins}</strong></span>
              <span>MIG <strong>d{profile.attributes.mig}</strong></span>
              <span>WLP <strong>d{profile.attributes.wlp}</strong></span>
            </div>

            <div className="character-sheet__resources">
              <span>HP <strong>{profile.hp.current}/{profile.hp.max}</strong></span>
              <span>MP <strong>{profile.mp.current}/{profile.mp.max}</strong></span>
              <span>IP <strong>{profile.ip.current}/{profile.ip.max}</strong></span>
              <span>DEF <strong>{profile.defense}</strong></span>
              <span>MDEF <strong>{profile.magicDefense}</strong></span>
            </div>

            <div className="character-sheet__chips">
              {info.fabulapoints !== undefined ? (
                <span>Fabula Points {valueText(info.fabulapoints)}</span>
              ) : null}
              {info.exp !== undefined ? (
                <span>EXP {valueText(info.exp)}</span>
              ) : null}
              {info.zenit !== undefined ? (
                <span>Zenit {valueText(info.zenit)}</span>
              ) : null}
              {activeStatuses.map((status) => (
                <span key={status}>{statusLabel(status)}</span>
              ))}
            </div>
          </section>

          {(valueText(info.origin, '') ||
            valueText(info.theme, '') ||
            valueText(info.description, '')) ? (
            <section className="character-sheet__section">
              <h3>Identidade</h3>
              <div className="character-sheet__identity-grid">
                {valueText(info.origin, '') ? (
                  <span><strong>Origem</strong>{valueText(info.origin)}</span>
                ) : null}
                {valueText(info.theme, '') ? (
                  <span><strong>Tema</strong>{valueText(info.theme)}</span>
                ) : null}
              </div>
              {valueText(info.description, '') ? (
                <p className="character-sheet__description">
                  {valueText(info.description)}
                </p>
              ) : null}
            </section>
          ) : null}

          <section className="character-sheet__section">
            <h3>Classes e habilidades</h3>
            {classes.length > 0 ? (
              <div className="character-sheet__classes">
                {classes.map((entry, index) => (
                  <CharacterClass entry={entry} key={index} />
                ))}
              </div>
            ) : (
              <span className="character-sheet__empty">
                Nenhuma classe encontrada no arquivo importado.
              </span>
            )}
          </section>

          <section className="character-sheet__section">
            <h3>Equipamento</h3>
            <div className="character-sheet__equipment-grid">
              <EquipmentList title="Armas" items={weapons} />
              <EquipmentList title="Armas customizadas" items={customWeapons} />
              <EquipmentList title="Armadura" items={armor} />
              <EquipmentList title="Escudos" items={shields} />
              <EquipmentList title="Acessórios" items={accessories} />
            </div>
          </section>

          <section className="character-sheet__section">
            <h3>Afinidades</h3>
            <div className="character-sheet__affinities">
              {Object.entries(affinities).length > 0 ? (
                Object.entries(affinities).map(([type, affinity]) => (
                  <span key={type}>
                    {type}: <strong>{affinityLabel(affinity)}</strong>
                  </span>
                ))
              ) : (
                Object.entries(profile.affinities).map(([type, affinity]) => (
                  <span key={type}>
                    {type}: <strong>{affinityLabel(affinity)}</strong>
                  </span>
                ))
              )}
            </div>
          </section>

          {(items.length > 0 || consumables.length > 0) ? (
            <section className="character-sheet__section">
              <h3>Inventário</h3>
              <div className="character-sheet__inventory-grid">
                {items.map((item, index) => (
                  <div className="character-sheet__text-entry" key={`item-${index}`}>
                    <strong>
                      {valueText(item.name, 'Item')}
                      {item.quantity !== undefined
                        ? ` ×${valueText(item.quantity)}`
                        : ''}
                    </strong>
                    {valueText(item.description, '') ? (
                      <p>{valueText(item.description)}</p>
                    ) : null}
                  </div>
                ))}
                {consumables.map((item, index) => (
                  <div className="character-sheet__text-entry" key={`consumable-${index}`}>
                    <strong>
                      {valueText(item.name, 'Consumível')}
                      {item.ipCost !== undefined
                        ? ` · ${valueText(item.ipCost)} IP`
                        : ''}
                    </strong>
                    {valueText(item.description, '') ? (
                      <p>{valueText(item.description)}</p>
                    ) : null}
                  </div>
                ))}
              </div>
            </section>
          ) : null}

          {bonds.length > 0 ? (
            <section className="character-sheet__section">
              <h3>Bonds</h3>
              <div className="character-sheet__bonds">
                {bonds.map((bond, index) => {
                  const feelings = [
                    'admiration',
                    'loyality',
                    'loyalty',
                    'affection',
                    'inferiority',
                    'mistrust',
                    'hatred',
                  ].filter((key) => truthy(bond[key]))

                  return (
                    <div key={index}>
                      <strong>{valueText(bond.name, 'Bond')}</strong>
                      <span>
                        {feelings.length > 0 ? feelings.join(', ') : '—'}
                      </span>
                    </div>
                  )
                })}
              </div>
            </section>
          ) : null}

          {notes.length > 0 ? (
            <section className="character-sheet__section">
              <h3>Notas</h3>
              <div className="character-sheet__notes">
                {notes.map((note, index) => (
                  <div className="character-sheet__text-entry" key={index}>
                    <strong>{valueText(note.name, 'Nota')}</strong>
                    <p>{valueText(note.description)}</p>
                  </div>
                ))}
              </div>
            </section>
          ) : null}

          <details className="character-sheet__raw">
            <summary>Dados originais importados</summary>
            <pre>{JSON.stringify(raw, null, 2)}</pre>
          </details>
        </div>
      </section>
    </div>
  )
}
