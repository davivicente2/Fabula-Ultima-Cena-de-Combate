import type { Combatant, StatusEffect } from '../types/combat'
import { ResourceBar } from './ResourceBar'

type CombatantCardProps = {
  combatant: Combatant
  selected: boolean
  onSelect: (id: string) => void
}

function statusLabel(status: StatusEffect) {
  switch (status) {
    case 'slow':
      return 'Lento'
    case 'dazed':
      return 'Atordoado'
    case 'weak':
      return 'Fraco'
    case 'shaken':
      return 'Abalado'
    case 'enraged':
      return 'Enfurecido'
    case 'poisoned':
      return 'Envenenado'
  }
}

export function CombatantCard({
  combatant,
  selected,
  onSelect,
}: CombatantCardProps) {
  return (
    <button
      className={[
        'combatant',
        `combatant--${combatant.side}`,
        combatant.isActive ? 'combatant--active' : '',
        selected ? 'combatant--selected' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      type="button"
      onClick={() => onSelect(combatant.id)}
    >
      <div className="combatant__portrait" aria-hidden="true">
        {combatant.side === 'heroes' ? '◆' : '▲'}
      </div>

      <strong>{combatant.name}</strong>

      <div className="combatant__statuses">
        {combatant.guardStartedRound !== null &&
        combatant.guardStartedRound !== undefined ? (
          <span className="combatant__status">Guard</span>
        ) : null}

        {combatant.statuses.map((status) => (
          <span className="combatant__status" key={status}>
            {statusLabel(status)}
          </span>
        ))}
      </div>

      <div className="combatant__resources">
        <ResourceBar label="HP" value={combatant.hp} max={combatant.maxHp} />
        <ResourceBar label="MP" value={combatant.mp} max={combatant.maxMp} />
        <ResourceBar label="IP" value={combatant.ip} max={combatant.maxIp} />
      </div>
    </button>
  )
}
