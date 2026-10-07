import { useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { CombatantCard } from './components/CombatantCard'
import {
  applyCombatantHpDelta,
  assignCombatantController,
  joinBattleRoom,
  loadCombatActions,
  loadCurrentPlayerIdentity,
  loadOrCreateBattle,
  performCombatantAttack,
  savePlayerDisplayName,
  subscribeToCombatActions,
  subscribeToCombatantUpdates,
} from './lib/battleRepository'
import type {
  CombatAction,
  CombatantSeed,
  LoadedBattle,
  PlayerIdentity,
} from './lib/battleRepository'
import {
  subscribeToRoomPresence,
} from './lib/presence'
import type { OnlinePlayer } from './lib/presence'
import type { AttributeName, Combatant } from './types/combat'

const initialCombatants: CombatantSeed[] = [
  {
    name: 'Aurora',
    side: 'heroes',
    hp: 42,
    maxHp: 42,
    mp: 28,
    maxMp: 32,
    ip: 5,
    maxIp: 6,
    dexDie: 10,
    insDie: 8,
    migDie: 8,
    wlpDie: 8,
    defense: 11,
    magicDefense: 10,
    attacks: [
      {
        name: 'Lâmina de Aurora',
        accuracyAttributeA: 'dex',
        accuracyAttributeB: 'mig',
        accuracyBonus: 1,
        damageBonus: 8,
        damageType: 'physical',
      },
    ],
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
    dexDie: 8,
    insDie: 10,
    migDie: 6,
    wlpDie: 10,
    defense: 9,
    magicDefense: 11,
    attacks: [
      {
        name: 'Disparo Arcano',
        accuracyAttributeA: 'dex',
        accuracyAttributeB: 'ins',
        accuracyBonus: 1,
        damageBonus: 8,
        damageType: 'physical',
      },
    ],
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
    dexDie: 10,
    insDie: 6,
    migDie: 8,
    wlpDie: 6,
    defense: 11,
    magicDefense: 8,
    attacks: [
      {
        name: 'Mordida',
        accuracyAttributeA: 'dex',
        accuracyAttributeB: 'mig',
        accuracyBonus: 0,
        damageBonus: 6,
        damageType: 'physical',
      },
    ],
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
    dexDie: 8,
    insDie: 8,
    migDie: 10,
    wlpDie: 8,
    defense: 12,
    magicDefense: 10,
    attacks: [
      {
        name: 'Espada Rubra',
        accuracyAttributeA: 'dex',
        accuracyAttributeB: 'mig',
        accuracyBonus: 1,
        damageBonus: 10,
        damageType: 'physical',
      },
    ],
  },
]

type ConnectionStatus = 'connecting' | 'online' | 'error'

const storedPlayerNameKey = 'fabula-player-name'

function setRoomInUrl(roomCode: string) {
  const url = new URL(window.location.href)
  url.searchParams.set('room', roomCode)
  window.history.replaceState(null, '', url)
}

function roleLabel(role: PlayerIdentity['role']) {
  return role === 'host' ? 'GM' : 'Jogador'
}

function combatActionText(action: CombatAction) {
  const actor = action.actorDisplayName ?? 'Jogador'
  const target = action.targetName ?? 'combatente'

  if (action.actionType === 'attack') {
    const attacker = action.attackerName ?? 'Combatente'
    const attack = action.attackName ?? 'ataque'

    if (action.isFumble) {
      return `${actor} · ${attacker} usou ${attack} em ${target}: falha crítica.`
    }

    if (!action.isHit) {
      return `${actor} · ${attacker} usou ${attack} em ${target}: errou.`
    }

    const critical = action.isCritical ? ' Crítico!' : ''
    return `${actor} · ${attacker} usou ${attack} em ${target}: ${action.damage ?? 0} de dano.${critical}`
  }

  if (action.appliedDelta < 0) {
    return `${actor} causou ${Math.abs(action.appliedDelta)} de dano em ${target}.`
  }

  return `${actor} curou ${target} em ${action.appliedDelta} HP.`
}

function attributeDie(combatant: Combatant, attribute: AttributeName) {
  switch (attribute) {
    case 'dex':
      return combatant.dexDie
    case 'ins':
      return combatant.insDie
    case 'mig':
      return combatant.migDie
    case 'wlp':
      return combatant.wlpDie
  }
}

function combatActionTime(createdAt: string) {
  return new Date(createdAt).toLocaleTimeString('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
  })
}

export default function App() {
  const initializationStarted = useRef(false)

  const [combatants, setCombatants] = useState<Combatant[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [battleId, setBattleId] = useState<string | null>(null)
  const [roomId, setRoomId] = useState<string | null>(null)
  const [battleName, setBattleName] = useState('Carregando batalha…')
  const [roomCode, setRoomCode] = useState('')
  const [joinCode, setJoinCode] = useState('')
  const [connectionStatus, setConnectionStatus] =
    useState<ConnectionStatus>('connecting')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [savingHp, setSavingHp] = useState(false)
  const [joiningRoom, setJoiningRoom] = useState(false)
  const [assigningController, setAssigningController] = useState(false)
  const [attacking, setAttacking] = useState(false)
  const [attackTargetId, setAttackTargetId] = useState('')

  const [playerIdentity, setPlayerIdentity] =
    useState<PlayerIdentity | null>(null)
  const [playerName, setPlayerName] = useState(
    () => localStorage.getItem(storedPlayerNameKey) ?? '',
  )
  const [savingPlayerName, setSavingPlayerName] = useState(false)
  const [onlinePlayers, setOnlinePlayers] = useState<OnlinePlayer[]>([])
  const [combatActions, setCombatActions] = useState<CombatAction[]>([])

  async function applyBattle(battle: LoadedBattle) {
    setCombatants(battle.combatants)
    setSelectedId(battle.combatants[0]?.id ?? null)
    setBattleId(battle.id)
    setRoomId(battle.roomId)
    setBattleName(battle.name)
    setRoomCode(battle.roomCode)
    setJoinCode('')
    setCombatActions([])
    setRoomInUrl(battle.roomCode)

    let identity = await loadCurrentPlayerIdentity(battle.roomId)
    const storedName = localStorage.getItem(storedPlayerNameKey)?.trim()

    if (!identity.displayName && storedName) {
      identity = await savePlayerDisplayName(battle.roomId, storedName)
    }

    setPlayerIdentity(identity)
    setPlayerName(identity.displayName ?? storedName ?? '')
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

        await applyBattle(battle)
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
            ? { ...updatedCombatant, attacks: combatant.attacks }
            : combatant,
        ),
      )
    })
  }, [battleId, connectionStatus])

  useEffect(() => {
    if (!battleId || connectionStatus !== 'online') {
      setCombatActions([])
      return
    }

    let cancelled = false

    void loadCombatActions(battleId)
      .then((actions) => {
        if (!cancelled) setCombatActions(actions)
      })
      .catch((error) => {
        console.error(error)
        if (!cancelled) {
          setErrorMessage(
            error instanceof Error
              ? error.message
              : 'Não foi possível carregar o log de combate.',
          )
        }
      })

    const unsubscribe = subscribeToCombatActions(battleId, (action) => {
      setCombatActions((current) => {
        if (current.some((entry) => entry.id === action.id)) return current
        return [action, ...current].slice(0, 20)
      })
    })

    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [battleId, connectionStatus])

  useEffect(() => {
    if (
      !roomId ||
      connectionStatus !== 'online' ||
      !playerIdentity?.displayName
    ) {
      setOnlinePlayers([])
      return
    }

    setOnlinePlayers([])

    return subscribeToRoomPresence(
      roomId,
      {
        ...playerIdentity,
        displayName: playerIdentity.displayName,
      },
      setOnlinePlayers,
    )
  }, [roomId, connectionStatus, playerIdentity])

  const selected = useMemo(
    () => combatants.find((combatant) => combatant.id === selectedId),
    [combatants, selectedId],
  )

  const heroes = combatants.filter((combatant) => combatant.side === 'heroes')
  const enemies = combatants.filter((combatant) => combatant.side === 'enemies')
  const assignablePlayers = onlinePlayers.filter(
    (player) => player.role === 'player',
  )
  const selectedController = selected?.controllerUserId
    ? onlinePlayers.find(
        (player) => player.userId === selected.controllerUserId,
      )
    : null
  const canControlSelected =
    playerIdentity?.role === 'host' ||
    (Boolean(selected?.controllerUserId) &&
      selected?.controllerUserId === playerIdentity?.userId)
  const selectedAttack = selected?.attacks[0] ?? null
  const attackTargets = selected
    ? combatants.filter(
        (combatant) =>
          combatant.id !== selected.id && combatant.side !== selected.side,
      )
    : []
  const attackTarget = attackTargets.find(
    (combatant) => combatant.id === attackTargetId,
  )

  useEffect(() => {
    if (!selected) {
      setAttackTargetId('')
      return
    }

    const targets = combatants.filter(
      (combatant) =>
        combatant.id !== selected.id && combatant.side !== selected.side,
    )

    if (!targets.some((combatant) => combatant.id === attackTargetId)) {
      setAttackTargetId(targets[0]?.id ?? '')
    }
  }, [selected, combatants, attackTargetId])

  async function changeHp(amount: number) {
    if (
      !selected ||
      !canControlSelected ||
      connectionStatus !== 'online' ||
      savingHp
    ) {
      return
    }

    setSavingHp(true)
    setErrorMessage(null)

    try {
      const result = await applyCombatantHpDelta(selected.id, amount)

      setCombatants((current) =>
        current.map((combatant) =>
          combatant.id === result.combatantId
            ? { ...combatant, hp: result.hp }
            : combatant,
        ),
      )
    } catch (error) {
      console.error(error)
      setErrorMessage(
        error instanceof Error
          ? error.message
          : 'Não foi possível aplicar a alteração de HP.',
      )
    } finally {
      setSavingHp(false)
    }
  }

  async function handleAttack() {
    if (
      !selected ||
      !selectedAttack ||
      !attackTarget ||
      !canControlSelected ||
      connectionStatus !== 'online' ||
      attacking
    ) {
      return
    }

    setAttacking(true)
    setErrorMessage(null)

    try {
      const result = await performCombatantAttack(
        selectedAttack.id,
        attackTarget.id,
      )

      setCombatants((current) =>
        current.map((combatant) =>
          combatant.id === result.targetId
            ? { ...combatant, hp: result.resultingHp }
            : combatant,
        ),
      )
    } catch (error) {
      console.error(error)
      setErrorMessage(
        error instanceof Error
          ? error.message
          : 'Não foi possível realizar o ataque.',
      )
    } finally {
      setAttacking(false)
    }
  }

  async function handleAssignController(userId: string | null) {
    if (
      !selected ||
      selected.side !== 'heroes' ||
      playerIdentity?.role !== 'host' ||
      assigningController
    ) {
      return
    }

    setAssigningController(true)
    setErrorMessage(null)

    try {
      const assignment = await assignCombatantController(selected.id, userId)

      setCombatants((current) =>
        current.map((combatant) =>
          combatant.id === assignment.combatantId
            ? {
                ...combatant,
                controllerUserId: assignment.controllerUserId,
              }
            : combatant,
        ),
      )
    } catch (error) {
      console.error(error)
      setErrorMessage(
        error instanceof Error
          ? error.message
          : 'Não foi possível atribuir o personagem.',
      )
    } finally {
      setAssigningController(false)
    }
  }

  async function handleJoinRoom(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (joiningRoom) return

    setJoiningRoom(true)
    setErrorMessage(null)
    setOnlinePlayers([])

    try {
      const battle = await joinBattleRoom(joinCode, initialCombatants)
      await applyBattle(battle)
      setConnectionStatus('online')
    } catch (error) {
      console.error(error)
      setErrorMessage(
        error instanceof Error
          ? error.message
          : 'Não foi possível entrar na sala.',
      )
    } finally {
      setJoiningRoom(false)
    }
  }

  async function handleSavePlayerName(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (!roomId || savingPlayerName) return

    const normalizedName = playerName.trim()

    if (!normalizedName) {
      setErrorMessage('Informe um nome para aparecer na sala.')
      return
    }

    setSavingPlayerName(true)
    setErrorMessage(null)

    try {
      const identity = await savePlayerDisplayName(roomId, normalizedName)
      localStorage.setItem(storedPlayerNameKey, normalizedName)
      setPlayerIdentity(identity)
      setPlayerName(normalizedName)
    } catch (error) {
      console.error(error)
      setErrorMessage(
        error instanceof Error
          ? error.message
          : 'Não foi possível salvar seu nome.',
      )
    } finally {
      setSavingPlayerName(false)
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
          <span className="eyebrow">Ataques autoritativos · v0.8</span>
          <h1>Cena de Combate</h1>
        </div>

        <div className="topbar__status">
          {roomCode ? (
            <div className="room-pill">
              Sala <strong>{roomCode}</strong>
            </div>
          ) : null}

          {playerIdentity?.displayName ? (
            <div className="room-pill">
              Online <strong>{onlinePlayers.length}</strong>
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
            Ataques agora são rolados e resolvidos no backend. O Supabase
            valida quem controla o atacante, rola os dados, compara com a
            Defesa do alvo, aplica o dano e registra tudo no combate.
          </p>

          <div className="player-session">
            <form
              className="player-identity"
              onSubmit={(event) => void handleSavePlayerName(event)}
            >
              <label htmlFor="player-name">Seu nome na sala</label>
              <div>
                <input
                  id="player-name"
                  value={playerName}
                  onChange={(event) => setPlayerName(event.target.value)}
                  placeholder="Ex.: Davi"
                  maxLength={32}
                  autoComplete="off"
                />
                <button
                  type="submit"
                  disabled={
                    !roomId ||
                    !playerName.trim() ||
                    savingPlayerName
                  }
                >
                  {savingPlayerName
                    ? 'Salvando…'
                    : playerIdentity?.displayName
                      ? 'Atualizar'
                      : 'Entrar'}
                </button>
              </div>
              {playerIdentity?.displayName ? (
                <span>
                  Você está como <strong>{roleLabel(playerIdentity.role)}</strong>.
                </span>
              ) : (
                <span>Defina um nome para aparecer como online.</span>
              )}
            </form>

            <div className="presence-panel">
              <span className="presence-panel__label">Online agora</span>
              <div className="presence-list">
                {onlinePlayers.length > 0 ? (
                  onlinePlayers.map((player) => (
                    <span className="presence-chip" key={player.userId}>
                      <span className="presence-chip__dot" />
                      {player.displayName}
                      {player.role === 'host' ? <small>GM</small> : null}
                    </span>
                  ))
                ) : (
                  <span className="presence-empty">
                    {playerIdentity?.displayName
                      ? 'Conectando ao Presence…'
                      : 'Defina seu nome primeiro.'}
                  </span>
                )}
              </div>
            </div>
          </div>

          {selected?.side === 'heroes' ? (
            <div className="assignment-panel">
              <span className="assignment-panel__label">
                Controle de {selected.name}
              </span>

              {playerIdentity?.role === 'host' ? (
                <select
                  value={selected.controllerUserId ?? ''}
                  onChange={(event) =>
                    void handleAssignController(event.target.value || null)
                  }
                  disabled={assigningController}
                >
                  <option value="">Somente GM</option>
                  {assignablePlayers.map((player) => (
                    <option key={player.userId} value={player.userId}>
                      {player.displayName}
                    </option>
                  ))}
                </select>
              ) : (
                <strong>
                  {selected.controllerUserId === playerIdentity?.userId
                    ? 'Este personagem é seu.'
                    : selectedController
                      ? `Controlado por ${selectedController.displayName}.`
                      : 'Controlado pelo GM.'}
                </strong>
              )}
            </div>
          ) : null}

          {selected ? (
            <div className="attack-panel">
              <div className="attack-panel__summary">
                <span className="attack-panel__label">Ataque básico</span>
                {selectedAttack ? (
                  <>
                    <strong>{selectedAttack.name}</strong>
                    <small>
                      {selectedAttack.accuracyAttributeA.toUpperCase()} d
                      {attributeDie(
                        selected,
                        selectedAttack.accuracyAttributeA,
                      )}{' '}
                      + {selectedAttack.accuracyAttributeB.toUpperCase()} d
                      {attributeDie(
                        selected,
                        selectedAttack.accuracyAttributeB,
                      )}{' '}
                      {selectedAttack.accuracyBonus >= 0 ? '+' : ''}
                      {selectedAttack.accuracyBonus} · HR +
                      {selectedAttack.damageBonus}
                    </small>
                  </>
                ) : (
                  <strong>Sem ataque configurado.</strong>
                )}
              </div>

              <label>
                Alvo
                <select
                  value={attackTargetId}
                  onChange={(event) => setAttackTargetId(event.target.value)}
                  disabled={!canControlSelected || attacking}
                >
                  {attackTargets.map((target) => (
                    <option key={target.id} value={target.id}>
                      {target.name} · DEF {target.defense}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          ) : null}

          <div className="combat-log">
            <div className="combat-log__header">
              <span className="combat-log__label">Registro de combate</span>
              <small>Últimas {combatActions.length || 0} ações</small>
            </div>

            <div className="combat-log__entries">
              {combatActions.length > 0 ? (
                combatActions.map((action) => (
                  <div className="combat-log__entry" key={action.id}>
                    <span>{combatActionText(action)}</span>
                    <small>
                      {combatActionTime(action.createdAt)}
                      {action.actionType === 'attack' ? (
                        <>
                          {' '}· Rolagem {action.rollA} + {action.rollB}
                          {action.checkTotal !== null
                            ? ` = ${action.checkTotal}`
                            : ''}
                          {action.targetDefense !== null
                            ? ` vs DEF ${action.targetDefense}`
                            : ''}
                        </>
                      ) : null}
                      {' '}· HP {action.previousHp} → {action.resultingHp}
                    </small>
                  </div>
                ))
              ) : (
                <span className="combat-log__empty">
                  Nenhuma ação registrada nesta batalha ainda.
                </span>
              )}
            </div>
          </div>

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

            <form
              className="room-join"
              onSubmit={(event) => void handleJoinRoom(event)}
            >
              <label htmlFor="room-code">Entrar em outra sala</label>
              <div>
                <input
                  id="room-code"
                  value={joinCode}
                  onChange={(event) =>
                    setJoinCode(event.target.value.toUpperCase())
                  }
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
            disabled={
              !selected ||
              !canControlSelected ||
              connectionStatus !== 'online' ||
              savingHp
            }
          >
            Dano −5
          </button>
          <button
            type="button"
            onClick={() => void changeHp(5)}
            disabled={
              !selected ||
              !canControlSelected ||
              connectionStatus !== 'online' ||
              savingHp
            }
          >
            Cura +5
          </button>
          <button
            type="button"
            onClick={() => void handleAttack()}
            disabled={
              !selected ||
              !selectedAttack ||
              !attackTarget ||
              !canControlSelected ||
              connectionStatus !== 'online' ||
              attacking
            }
          >
            {attacking ? 'Atacando…' : 'Atacar'}
          </button>
          <button type="button" disabled>
            Habilidade
          </button>
        </div>
      </section>
    </main>
  )
}
