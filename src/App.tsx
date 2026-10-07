import { useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { CombatantCard } from './components/CombatantCard'
import {
  adjustCombatantResource,
  applyCombatantHpDelta,
  assignCombatantController,
  endCombatantTurn,
  joinBattleRoom,
  loadCombatActions,
  loadCurrentPlayerIdentity,
  loadOrCreateBattle,
  performCombatantAttack,
  performGuard,
  savePlayerDisplayName,
  startBattleTurns,
  stopBattleTurns,
  subscribeToBattleTurnState,
  subscribeToCombatActions,
  subscribeToCombatantUpdates,
} from './lib/battleRepository'
import type {
  BattleTurnState,
  CombatAction,
  CombatantSeed,
  LoadedBattle,
  PlayerIdentity,
} from './lib/battleRepository'
import {
  subscribeToRoomPresence,
} from './lib/presence'
import type { OnlinePlayer } from './lib/presence'
import type {
  AttributeName,
  Combatant,
  CombatSide,
  DamageAffinity,
  DamageType,
} from './types/combat'

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
    affinities: {
      physical: 'resistant',
      poison: 'immune',
    },
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
        damageType: 'bolt',
      },
    ],
    affinities: {
      physical: 'vulnerable',
      poison: 'absorbs',
    },
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
        damageType: 'poison',
      },
    ],
    affinities: {
      physical: 'vulnerable',
    },
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
    affinities: {
      physical: 'resistant',
      bolt: 'vulnerable',
    },
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

function sideLabel(side: CombatSide | null) {
  if (side === 'heroes') return 'Heróis'
  if (side === 'enemies') return 'Inimigos'
  return '—'
}

function damageTypeLabel(damageType: DamageType | null) {
  const labels: Record<DamageType, string> = {
    physical: 'Físico',
    air: 'Ar',
    bolt: 'Raio',
    dark: 'Trevas',
    earth: 'Terra',
    fire: 'Fogo',
    ice: 'Gelo',
    light: 'Luz',
    poison: 'Veneno',
  }

  return damageType ? labels[damageType] : '—'
}

function effectiveAffinity(
  affinity: DamageAffinity | undefined,
  guarding: boolean,
): DamageAffinity | 'neutral' {
  if (affinity === 'absorbs') return 'absorbs'
  if (affinity === 'immune') return 'immune'
  if (guarding && affinity === 'vulnerable') return 'neutral'
  if (guarding) return 'resistant'
  return affinity ?? 'neutral'
}

function affinityLabel(
  affinity: DamageAffinity | 'neutral' | null | undefined,
) {
  switch (affinity) {
    case 'vulnerable':
      return 'Vulnerabilidade'
    case 'resistant':
      return 'Resistência'
    case 'immune':
      return 'Imunidade'
    case 'absorbs':
      return 'Absorção'
    default:
      return 'Neutro'
  }
}

function combatActionText(action: CombatAction) {
  const actor = action.actorDisplayName ?? 'Jogador'
  const target = action.targetName ?? 'combatente'

  if (action.actionType === 'resource_adjustment') {
    const resource = action.resourceName?.toUpperCase() ?? 'Recurso'
    const combatant = action.targetName ?? 'combatente'

    if (action.appliedDelta < 0) {
      return `${actor} gastou ${Math.abs(action.appliedDelta)} ${resource} de ${combatant}.`
    }

    return `${actor} recuperou ${action.appliedDelta} ${resource} de ${combatant}.`
  }

  if (action.actionType === 'guard') {
    const combatant = action.attackerName ?? action.targetName ?? 'Combatente'
    return `${actor} · ${combatant} assumiu Guard e ganhou Resistência a todos os tipos de dano.`
  }

  if (action.actionType === 'turn_end') {
    const combatant = action.attackerName ?? action.targetName ?? 'Combatente'
    return `${actor} encerrou o turno de ${combatant} sem atacar.`
  }

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
    const rawDamage = action.damage ?? 0

    if (action.damageAffinity === 'immune') {
      return `${actor} · ${attacker} usou ${attack} em ${target}: acertou, mas o alvo é imune a ${damageTypeLabel(action.damageType)}.${critical}`
    }

    if (action.damageAffinity === 'absorbs') {
      return `${actor} · ${attacker} usou ${attack} em ${target}: ${rawDamage} de ${damageTypeLabel(action.damageType)}, absorvido pelo alvo (+${Math.max(0, action.appliedDelta)} HP).${critical}`
    }

    const hpLost = Math.max(0, -action.appliedDelta)
    const affinity =
      action.damageAffinity === 'vulnerable'
        ? ' Vulnerabilidade!'
        : action.damageAffinity === 'resistant'
          ? ' Resistência.'
          : ''
    const guard = action.guardApplied ? ' Guard ativo.' : ''

    return `${actor} · ${attacker} usou ${attack} em ${target}: ${rawDamage} de ${damageTypeLabel(action.damageType)} → ${hpLost} HP perdidos.${affinity}${guard}${critical}`
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
  const [changingTurnState, setChangingTurnState] = useState(false)
  const [endingTurn, setEndingTurn] = useState(false)
  const [guarding, setGuarding] = useState(false)
  const [adjustingResource, setAdjustingResource] = useState<
    'MP' | 'IP' | null
  >(null)
  const [turnState, setTurnState] = useState<BattleTurnState>({
    started: false,
    roundNumber: 0,
    initiativeSide: null,
    currentSide: null,
    turnRevision: 0,
  })

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
    setTurnState(battle.turnState)
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

    return subscribeToBattleTurnState(battleId, setTurnState)
  }, [battleId, connectionStatus])

  useEffect(() => {
    if (!battleId || connectionStatus !== 'online') return

    return subscribeToCombatantUpdates(battleId, (updatedCombatant) => {
      setCombatants((current) =>
        current.map((combatant) =>
          combatant.id === updatedCombatant.id
            ? {
                ...updatedCombatant,
                attacks: combatant.attacks,
                affinities: combatant.affinities,
              }
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
  const selectedHasActed =
    Boolean(selected) &&
    turnState.started &&
    (selected?.lastActedRound ?? 0) >= turnState.roundNumber
  const canActSelected =
    Boolean(selected) &&
    canControlSelected &&
    turnState.started &&
    selected?.side === turnState.currentSide &&
    !selectedHasActed &&
    (selected?.hp ?? 0) > 0
  const availableCurrentSide = turnState.currentSide
    ? combatants.filter(
        (combatant) =>
          combatant.side === turnState.currentSide &&
          combatant.hp > 0 &&
          (combatant.lastActedRound ?? 0) < turnState.roundNumber,
      )
    : []
  const combatActionBusy = attacking || guarding || endingTurn

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

  async function handleStartTurns(firstSide: CombatSide) {
    if (!battleId || playerIdentity?.role !== 'host' || changingTurnState) {
      return
    }

    setChangingTurnState(true)
    setErrorMessage(null)

    try {
      const state = await startBattleTurns(battleId, firstSide)
      setTurnState(state)
      setCombatants((current) =>
        current.map((combatant) => ({
          ...combatant,
          lastActedRound: 0,
          guardStartedRound: null,
        })),
      )
    } catch (error) {
      console.error(error)
      setErrorMessage(
        error instanceof Error
          ? error.message
          : 'Não foi possível iniciar o conflito.',
      )
    } finally {
      setChangingTurnState(false)
    }
  }

  async function handleStopTurns() {
    if (!battleId || playerIdentity?.role !== 'host' || changingTurnState) {
      return
    }

    setChangingTurnState(true)
    setErrorMessage(null)

    try {
      const state = await stopBattleTurns(battleId)
      setTurnState(state)
      setCombatants((current) =>
        current.map((combatant) => ({
          ...combatant,
          lastActedRound: 0,
          guardStartedRound: null,
        })),
      )
    } catch (error) {
      console.error(error)
      setErrorMessage(
        error instanceof Error
          ? error.message
          : 'Não foi possível encerrar o conflito.',
      )
    } finally {
      setChangingTurnState(false)
    }
  }

  async function handleEndTurn() {
    if (!selected || !canActSelected || combatActionBusy) return

    setEndingTurn(true)
    setErrorMessage(null)

    try {
      const result = await endCombatantTurn(
        selected.id,
        turnState.turnRevision,
      )

      setCombatants((current) =>
        current.map((combatant) =>
          combatant.id === result.combatantId
            ? { ...combatant, lastActedRound: result.actedRound }
            : combatant,
        ),
      )

      setTurnState((current) => ({
        ...current,
        started: result.nextSide !== null,
        roundNumber: result.nextRound,
        currentSide: result.nextSide,
        turnRevision: result.nextRevision,
      }))
    } catch (error) {
      console.error(error)
      setErrorMessage(
        error instanceof Error
          ? error.message
          : 'Não foi possível encerrar o turno.',
      )
    } finally {
      setEndingTurn(false)
    }
  }

  async function handleGuard() {
    if (!selected || !canActSelected || combatActionBusy) return

    setGuarding(true)
    setErrorMessage(null)

    try {
      const result = await performGuard(
        selected.id,
        turnState.turnRevision,
      )

      setCombatants((current) =>
        current.map((combatant) =>
          combatant.id === result.combatantId
            ? {
                ...combatant,
                lastActedRound: result.actedRound,
                guardStartedRound: result.actedRound,
              }
            : combatant,
        ),
      )

      setTurnState((current) => ({
        ...current,
        started: result.nextSide !== null,
        roundNumber: result.nextRound,
        currentSide: result.nextSide,
        turnRevision: result.nextRevision,
      }))
    } catch (error) {
      console.error(error)
      setErrorMessage(
        error instanceof Error
          ? error.message
          : 'Não foi possível usar Guard.',
      )
    } finally {
      setGuarding(false)
    }
  }

  async function changeResource(
    resource: 'MP' | 'IP',
    amount: number,
  ) {
    if (
      !selected ||
      !canControlSelected ||
      connectionStatus !== 'online' ||
      adjustingResource
    ) {
      return
    }

    setAdjustingResource(resource)
    setErrorMessage(null)

    try {
      const result = await adjustCombatantResource(
        selected.id,
        resource,
        amount,
      )

      setCombatants((current) =>
        current.map((combatant) =>
          combatant.id === result.combatantId
            ? {
                ...combatant,
                ...(result.resourceName === 'mp'
                  ? { mp: result.value }
                  : { ip: result.value }),
              }
            : combatant,
        ),
      )
    } catch (error) {
      console.error(error)
      setErrorMessage(
        error instanceof Error
          ? error.message
          : 'Não foi possível alterar o recurso.',
      )
    } finally {
      setAdjustingResource(null)
    }
  }

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
      !canActSelected ||
      connectionStatus !== 'online' ||
      combatActionBusy
    ) {
      return
    }

    setAttacking(true)
    setErrorMessage(null)

    try {
      const result = await performCombatantAttack(
        selectedAttack.id,
        attackTarget.id,
        turnState.turnRevision,
      )

      setCombatants((current) =>
        current.map((combatant) => {
          if (combatant.id === result.attackerId) {
            return {
              ...combatant,
              lastActedRound: result.actedRound,
              guardStartedRound:
                combatant.guardStartedRound !== null &&
                combatant.guardStartedRound !== undefined &&
                combatant.guardStartedRound < result.actedRound
                  ? null
                  : combatant.guardStartedRound,
            }
          }

          if (combatant.id === result.targetId) {
            return { ...combatant, hp: result.resultingHp }
          }

          return combatant
        }),
      )

      setTurnState((current) => ({
        ...current,
        started: result.nextSide !== null,
        roundNumber: result.nextRound,
        currentSide: result.nextSide,
        turnRevision: result.nextRevision,
      }))
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
          <span className="eyebrow">Recursos autoritativos · v0.12</span>
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
          <span>
            {turnState.started ? `Rodada ${turnState.roundNumber}` : 'Conflito'}
          </span>
          <strong>
            {turnState.started
              ? `Vez dos ${sideLabel(turnState.currentSide)}`
              : 'Não iniciado'}
          </strong>
          {turnState.started ? (
            <small>
              Disponíveis:{' '}
              {availableCurrentSide
                .map((combatant) => combatant.name)
                .join(', ') || '—'}
            </small>
          ) : null}
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
            MP e IP agora também são controlados pelo backend. Jogadores
            atribuídos podem gastar seus próprios recursos; recuperação manual
            é restrita ao GM e serve apenas para teste por enquanto.
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

          <div className="turn-panel">
            <div>
              <span className="turn-panel__label">Fluxo do conflito</span>
              {turnState.started ? (
                <strong>
                  Rodada {turnState.roundNumber} · Vez dos{' '}
                  {sideLabel(turnState.currentSide)}
                </strong>
              ) : (
                <strong>Aguardando iniciativa.</strong>
              )}
            </div>

            {playerIdentity?.role === 'host' ? (
              <div className="turn-panel__controls">
                {!turnState.started ? (
                  <>
                    <button
                      type="button"
                      onClick={() => void handleStartTurns('heroes')}
                      disabled={changingTurnState}
                    >
                      Heróis começam
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleStartTurns('enemies')}
                      disabled={changingTurnState}
                    >
                      Inimigos começam
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    onClick={() => void handleStopTurns()}
                    disabled={changingTurnState}
                  >
                    Encerrar conflito
                  </button>
                )}
              </div>
            ) : null}
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
                <span className="attack-panel__label">
                  {selectedHasActed
                    ? 'Já agiu nesta rodada'
                    : canActSelected
                      ? 'Pode agir agora'
                      : 'Aguardando turno'}
                </span>
                {selected.guardStartedRound !== null &&
                selected.guardStartedRound !== undefined ? (
                  <strong>Guard ativo · Resistência temporária</strong>
                ) : null}
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
                      {selectedAttack.damageBonus} ·{' '}
                      {damageTypeLabel(selectedAttack.damageType)}
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
                  disabled={!canActSelected || combatActionBusy}
                >
                  {attackTargets.map((target) => (
                    <option key={target.id} value={target.id}>
                      {target.name} · DEF {target.defense}
                      {selectedAttack
                        ? ` · ${affinityLabel(
                            effectiveAffinity(
                              target.affinities[selectedAttack.damageType],
                              target.guardStartedRound !== null &&
                                target.guardStartedRound !== undefined,
                            ),
                          )}${target.guardStartedRound !== null &&
                          target.guardStartedRound !== undefined
                            ? ' (Guard)'
                            : ''}`
                        : ''}
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
                      {action.roundNumber !== null
                        ? ` · R${action.roundNumber}`
                        : ''}
                      {action.actionType === 'attack' ? (
                        <>
                          {' '}· Rolagem {action.rollA} + {action.rollB}
                          {action.checkTotal !== null
                            ? ` = ${action.checkTotal}`
                            : ''}
                          {action.targetDefense !== null
                            ? ` vs DEF ${action.targetDefense}`
                            : ''}
                          {action.damageType
                            ? ` · ${damageTypeLabel(action.damageType)} / ${affinityLabel(action.damageAffinity)}`
                            : ''}
                          {action.guardApplied ? ' · Guard' : ''}
                        </>
                      ) : null}
                      {action.actionType === 'resource_adjustment' &&
                      action.resourceName &&
                      action.previousResource !== null &&
                      action.resultingResource !== null ? (
                        <>
                          {' '}· {action.resourceName.toUpperCase()}{' '}
                          {action.previousResource} → {action.resultingResource}
                        </>
                      ) : (
                        <> {' '}· HP {action.previousHp} → {action.resultingHp}</>
                      )}
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

        <aside className="command-panel__actions">
          <div className="command-actions__group">
            <span className="command-actions__label">Ações de combate</span>

            <button
              type="button"
              onClick={() => void handleAttack()}
              disabled={
                !selected ||
                !selectedAttack ||
                !attackTarget ||
                !canActSelected ||
                connectionStatus !== 'online' ||
                combatActionBusy
              }
            >
              {attacking ? 'Atacando…' : 'Atacar'}
            </button>

            <button
              type="button"
              onClick={() => void handleGuard()}
              disabled={!canActSelected || combatActionBusy}
            >
              {guarding ? 'Defendendo…' : 'Guard'}
            </button>

            <button
              type="button"
              onClick={() => void handleEndTurn()}
              disabled={!canActSelected || combatActionBusy}
            >
              {endingTurn ? 'Encerrando…' : 'Encerrar turno'}
            </button>

            <button type="button" disabled>
              Habilidade
            </button>
          </div>

          <div className="command-actions__group command-actions__group--debug">
            <span className="command-actions__label">Debug / GM</span>

            <div className="command-actions__grid">
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
                HP −5
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
                HP +5
              </button>

              <button
                type="button"
                onClick={() => void changeResource('MP', -5)}
                disabled={
                  !selected ||
                  !canControlSelected ||
                  connectionStatus !== 'online' ||
                  adjustingResource !== null
                }
              >
                MP −5
              </button>

              <button
                type="button"
                onClick={() => void changeResource('MP', 5)}
                disabled={
                  !selected ||
                  playerIdentity?.role !== 'host' ||
                  connectionStatus !== 'online' ||
                  adjustingResource !== null
                }
              >
                MP +5
              </button>

              <button
                type="button"
                onClick={() => void changeResource('IP', -1)}
                disabled={
                  !selected ||
                  !canControlSelected ||
                  connectionStatus !== 'online' ||
                  adjustingResource !== null
                }
              >
                IP −1
              </button>

              <button
                type="button"
                onClick={() => void changeResource('IP', 1)}
                disabled={
                  !selected ||
                  playerIdentity?.role !== 'host' ||
                  connectionStatus !== 'online' ||
                  adjustingResource !== null
                }
              >
                IP +1
              </button>
            </div>
          </div>
        </aside>
      </section>
    </main>
  )
}
