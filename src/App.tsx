import { useMemo, useState } from 'react'
import { CombatantCard } from './components/CombatantCard'
import type { Combatant } from './types/combat'

const initialCombatants: Combatant[] = [
  {
    id: 'hero-aurora',
    name: 'Aurora',
    side: 'heroes',
    hp: 42,
    maxHp: 42,
    mp: 28,
    maxMp: 32,
    ip: 5,
    maxIp: 6,
    isActive: true,
  },
  {
    id: 'hero-cael',
    name: 'Cael',
    side: 'heroes',
    hp: 34,
    maxHp: 38,
    mp: 18,
    maxMp: 24,
    ip: 4,
    maxIp: 6,
  },
  {
    id: 'enemy-wolf',
    name: 'Lobo de Cinzas',
    side: 'enemies',
    hp: 30,
    maxHp: 30,
    mp: 10,
    maxMp: 10,
    ip: 0,
    maxIp: 1,
  },
  {
    id: 'enemy-boss',
    name: 'Cavaleiro Rubro',
    side: 'enemies',
    hp: 78,
    maxHp: 90,
    mp: 36,
    maxMp: 40,
    ip: 0,
    maxIp: 1,
  },
]

export default function App() {
  // useState é a "memória" desta tela.
  // Quando combatants muda, o React atualiza a interface.
  const [combatants, setCombatants] =
    useState<Combatant[]>(initialCombatants)
  const [selectedId, setSelectedId] = useState(initialCombatants[0].id)

  const selected = useMemo(
    () => combatants.find((combatant) => combatant.id === selectedId),
    [combatants, selectedId],
  )

  const heroes = combatants.filter((combatant) => combatant.side === 'heroes')
  const enemies = combatants.filter((combatant) => combatant.side === 'enemies')

  function changeHp(amount: number) {
    if (!selected) return

    setCombatants((current) =>
      current.map((combatant) =>
        combatant.id === selected.id
          ? {
              ...combatant,
              hp: Math.max(
                0,
                Math.min(combatant.maxHp, combatant.hp + amount),
              ),
            }
          : combatant,
      ),
    )
  }

  return (
    <main className="game">
      <header className="game__topbar">
        <div>
          <span className="eyebrow">Protótipo local · v0.1</span>
          <h1>Cena de Combate</h1>
        </div>

        <div className="connection-pill">
          <span className="connection-pill__dot" />
          Offline por enquanto
        </div>
      </header>

      <section className="battlefield">
        <div className="battlefield__backdrop" />

        <div className="formation formation--enemies">
          {enemies.map((combatant) => (
            <CombatantCard
              key={combatant.id}
              combatant={combatant}
              selected={combatant.id === selectedId}
              onSelect={setSelectedId}
            />
          ))}
        </div>

        <div className="battlefield__turn">
          <span>Turno atual</span>
          <strong>
            {combatants.find((combatant) => combatant.isActive)?.name ?? '—'}
          </strong>
        </div>

        <div className="formation formation--heroes">
          {heroes.map((combatant) => (
            <CombatantCard
              key={combatant.id}
              combatant={combatant}
              selected={combatant.id === selectedId}
              onSelect={setSelectedId}
            />
          ))}
        </div>
      </section>

      <section className="command-panel">
        <div>
          <span className="eyebrow">Selecionado</span>
          <h2>{selected?.name ?? 'Nenhum combatente'}</h2>
          <p>
            Estes botões ainda alteram somente o estado deste navegador.
            Depois, essa mudança virá do servidor e será sincronizada com todos.
          </p>
        </div>

        <div className="command-panel__buttons">
          <button type="button" onClick={() => changeHp(-5)}>
            Dano −5
          </button>
          <button type="button" onClick={() => changeHp(5)}>
            Cura +5
          </button>
          <button type="button" disabled>
            Atacar
          </button>
          <button type="button" disabled>
            Habilidade
          </button>
        </div>
      </section>
    </main>
  )
}
