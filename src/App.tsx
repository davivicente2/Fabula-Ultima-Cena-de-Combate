import { useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { CombatantCard } from './components/CombatantCard'
import {
  joinBattleRoom,
  loadOrCreateBattle,
  saveCombatantHp,
  subscribeToCombatantUpdates,
} from './lib/battleRepository'
import type { LoadedBattle } from './lib/battleRepository'
import type { Combatant } from './types/combat'

const initialCombatants: Omit<Combatant, 'id'>[] = [
  {
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

type ConnectionStatus = 'connecting' | 'online' | 'error'

function setRoomInUrl(roomCode: string) {
  const url = new URL(window.location.href)
  url.searchParams.set('room', roomCode)
  window.history.replaceState(null, '', url)
}

export default function App() {
  const initializationStarted = useRef(false)

  const [combatants, setCombatants] = useState<Combatant[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [battleId, setBattleId] = useState<string | null>(null)
  const [battleName, setBattleName] = useState('Carregando batalha…')
  const [roomCode, setRoomCode] = useState('')
  const [joinCode, setJoinCode] = useState('')
  const [connectionStatus, setConnectionStatus] =
    useState<ConnectionStatus>('connecting')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [savingHp, setSavingHp] = useState(false)
  const [joiningRoom, setJoiningRoom] = useState(false)

  function applyBattle(battle: LoadedBattle) {
    setCombatants(battle.combatants)
    setSelectedId(battle.combatants[0]?.id ?? null)
    setBattleId(battle.id)
    setBattleName(battle.name)
    setRoomCode(battle.roomCode)
    setJoinCode('')
    setRoomInUrl(battle.roomCode)
  }

  useEffect(() => {
    if (initializationStarted.current) return
    initializationStarted.current = true

    async function initializeBattle() {
      try {
        const requestedRoomCode = new URL(window.location.href).searchParams.get(
          'room',
        )
        const battle = await loadOrCreateBattle(
          initialCombatants,
          requestedRoomCode,
        )

        applyBattle(battle)
        setConnectionStatus('online')
      } catch (error) {
        console.error(error)
        setConnectionStatus('error')
        setErrorMessage(
          error instanceof Error
            ? error.message
            : 'Falha desconhecida ao conectar ao Supabase.',
        )
      }
    }

    void initializeBattle()
  }, [])

  useEffect(() => {
    if (!battleId || connectionStatus !== 'online') return

    return subscribeToCombatantUpdates(battleId, (updatedCombatant) => {
      setCombatants((current) =>
        current.map((combatant) =>
          combatant.id === updatedCombatant.id
            ? updatedCombatant
            : combatant,
        ),
      )
    })
  }, [battleId, connectionStatus])

  const selected = useMemo(
    () => combatants.find((combatant) => combatant.id === selectedId),
    [combatants, selectedId],
  )

  const heroes = combatants.filter((combatant) => combatant.side === 'heroes')
  const enemies = combatants.filter((combatant) => combatant.side === 'enemies')

  async function changeHp(amount: number) {
    if (!selected || connectionStatus !== 'online' || savingHp) return

    const nextHp = Math.max(
      0,
      Math.min(selected.maxHp, selected.hp + amount),
    )

    if (nextHp === selected.hp) return

    setSavingHp(true)
    setErrorMessage(null)

    try {
      const savedHp = await saveCombatantHp(selected.id, nextHp)

      setCombatants((current) =>
        current.map((combatant) =>
          combatant.id === selected.id
            ? { ...combatant, hp: savedHp }
            : combatant,
        ),
      )
    } catch (error) {
      console.error(error)
      setErrorMessage(
        error instanceof Error
          ? error.message
          : 'Não foi possível salvar o HP no Supabase.',
      )
    } finally {
      setSavingHp(false)
    }
  }

  async function handleJoinRoom(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (joiningRoom) return

    setJoiningRoom(true)
    setErrorMessage(null)

    try {
      const battle = await joinBattleRoom(joinCode, initialCombatants)
      applyBattle(battle)
      setConnectionStatus('online')
    } catch (error) {
      console.error(error)
      setErrorMessage(
        error instanceof Error ? error.message : 'Não foi possível entrar na sala.',
      )
    } finally {
      setJoiningRoom(false)
    }
  }

  async function copyRoomLink() {
    if (!roomCode) return

    const url = new URL(window.location.href)
    url.searchParams.set('room', roomCode)

    try {
      await navigator.clipboard.writeText(url.toString())
    } catch (error) {
      console.error(error)
      setErrorMessage('Não foi possível copiar o link automaticamente.')
    }
  }

  const connectionLabel =
    connectionStatus === 'online'
      ? 'Supabase conectado'
      : connectionStatus === 'error'
        ? 'Erro de conexão'
        : 'Conectando ao Supabase…'

  return (
    <main className="game">
      <header className="game__topbar">
        <div>
          <span className="eyebrow">Sala compartilhada · v0.3</span>
          <h1>Cena de Combate</h1>
        </div>

        <div className="topbar__status">
          {roomCode ? (
            <div className="room-pill">
              Sala <strong>{roomCode}</strong>
            </div>
          ) : null}

          <div className="connection-pill" data-status={connectionStatus}>
            <span className="connection-pill__dot" />
            {connectionLabel}
          </div>
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
        <div className="command-panel__info">
          <span className="eyebrow">{battleName}</span>
          <h2>{selected?.name ?? 'Nenhum combatente'}</h2>
          <p>
            O HP é persistido no Supabase e alterações da mesma sala são
            recebidas em tempo real pelos outros navegadores conectados.
          </p>

          <div className="room-controls">
            <div>
              <span className="room-controls__label">Sua sala</span>
              <strong>{roomCode || '—'}</strong>
              <button
                type="button"
                className="room-controls__link"
                onClick={() => void copyRoomLink()}
                disabled={!roomCode}
              >
                Copiar link
              </button>
            </div>

            <form className="room-join" onSubmit={(event) => void handleJoinRoom(event)}>
              <label htmlFor="room-code">Entrar em outra sala</label>
              <div>
                <input
                  id="room-code"
                  value={joinCode}
                  onChange={(event) => setJoinCode(event.target.value.toUpperCase())}
                  placeholder="Código da sala"
                  maxLength={10}
                  autoComplete="off"
                />
                <button
                  type="submit"
                  disabled={!joinCode.trim() || joiningRoom}
                >
                  {joiningRoom ? 'Entrando…' : 'Entrar'}
                </button>
              </div>
            </form>
          </div>

          {errorMessage ? (
            <p className="connection-error">{errorMessage}</p>
          ) : null}
        </div>

        <div className="command-panel__buttons">
          <button
            type="button"
            onClick={() => void changeHp(-5)}
            disabled={!selected || connectionStatus !== 'online' || savingHp}
          >
            Dano −5
          </button>
          <button
            type="button"
            onClick={() => void changeHp(5)}
            disabled={!selected || connectionStatus !== 'online' || savingHp}
          >
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
