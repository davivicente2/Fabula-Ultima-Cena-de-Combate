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
  performCombatantAbility,
  performCombatantAttack,
  performGuard,
  performInventoryItem,
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
  InventoryItem,
  StatusEffect,
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
    abilities: [
      {
        name: 'Vínculo Vital',
        effectType: 'heal',
        targetRelation: 'ally',
        checkAttributeA: 'ins',
        checkAttributeB: 'wlp',
        checkBonus: 0,
        mpCost: 10,
        damageBonus: 0,
        damageType: null,
        healAmount: 20,
        statusEffect: null,
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
    abilities: [
      {
        name: 'Pulso Arcano',
        effectType: 'damage',
        targetRelation: 'enemy',
        checkAttributeA: 'ins',
        checkAttributeB: 'wlp',
        checkBonus: 0,
        mpCost: 10,
        damageBonus: 10,
        damageType: 'bolt',
        healAmount: 0,
        statusEffect: null,
      },
      {
        name: 'Névoa Lenta',
        effectType: 'status',
        targetRelation: 'enemy',
        checkAttributeA: 'ins',
        checkAttributeB: 'wlp',
        checkBonus: 0,
        mpCost: 5,
        damageBonus: 0,
        damageType: null,
        healAmount: 0,
        statusEffect: 'slow',
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
    abilities: [],
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
    abilities: [],
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


function statusLabel(status: StatusEffect | null | undefined) {
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
    default:
      return 'Status'
  }
}


function inventoryItemLabel(item: InventoryItem | null | undefined) {
  switch (item) {
    case 'remedy':
      return 'Remedy'
    case 'elixir':
      return 'Elixir'
    case 'tonic':
      return 'Tonic'
    default:
      return 'Item'
  }
}

function inventoryItemCost(item: InventoryItem) {
  return item === 'tonic' ? 2 : 3
}

function inventoryItemEffect(item: InventoryItem) {
  switch (item) {
    case 'remedy':
      return 'Recupera 50 HP'
    case 'elixir':
      return 'Recupera 50 MP'
    case 'tonic':
      return 'Remove todos os status'
  }
}

function combatActionText(action: CombatAction) {
  const actor = action.actorDisplayName ?? 'Jogador'
  const target = action.targetName ?? 'combatente'

  if (action.actionType === 'inventory') {
    const user = action.attackerName ?? 'Combatente'
    const item = inventoryItemLabel(action.inventoryItem)
    const ipSpent =
      action.previousIp !== null && action.resultingIp !== null
        ? action.previousIp - action.resultingIp
        : 0

    if (action.inventoryItem === 'remedy') {
      return `${actor} · ${user} usou ${item} (${ipSpent} IP) em ${target}: recuperou ${Math.max(0, action.resultingHp - action.previousHp)} HP.`
    }

    if (action.inventoryItem === 'elixir') {
      const recovered =
        action.previousResource !== null && action.resultingResource !== null
          ? action.resultingResource - action.previousResource
          : 0
      return `${actor} · ${user} usou ${item} (${ipSpent} IP) em ${target}: recuperou ${Math.max(0, recovered)} MP.`
    }

    return `${actor} · ${user} usou ${item} (${ipSpent} IP) em ${target}: removeu ${action.statusesRemoved ?? 0} status.`
  }

  if (action.actionType === 'resource_adjustment') {
    const resource = action.resourceName?.toUpperCase() ?? 'Recurso'
    const combatant = action.targetName ?? 'combatente'

    if (action.appliedDelta < 0) {
      return `${actor} gastou ${Math.abs(action.appliedDelta)} ${resource} de ${combatant}.`
    }

    return `${actor} recuperou ${action.appliedDelta} ${resource} de ${combatant}.`
  }

  if (action.actionType === 'ability') {
    const caster = action.attackerName ?? 'Combatente'
    const ability = action.abilityName ?? 'habilidade'
    const mpSpent =
      action.previousResource !== null && action.resultingResource !== null
        ? action.previousResource - action.resultingResource
        : 0

    if (action.abilityEffectType === 'heal') {
      return `${actor} · ${caster} usou ${ability} (${mpSpent} MP) em ${target}: recuperou ${action.healing ?? 0} HP.`
    }

    if (action.abilityEffectType === 'status') {
      if (action.isFumble) {
        return `${actor} · ${caster} usou ${ability} (${mpSpent} MP) em ${target}: falha crítica.`
      }

      if (!action.isHit) {
        return `${actor} · ${caster} usou ${ability} (${mpSpent} MP) em ${target}: errou.`
      }

      return `${actor} · ${caster} usou ${ability} em ${target}: aplicou ${statusLabel(action.statusEffect)}.`
    }

    if (action.isFumble) {
      return `${actor} · ${caster} usou ${ability} (${mpSpent} MP) em ${target}: falha crítica.`
    }

    if (!action.isHit) {
      return `${actor} · ${caster} usou ${ability} (${mpSpent} MP) em ${target}: errou.`
    }

    const critical = action.isCritical ? ' Crítico!' : ''
    const rawDamage = action.damage ?? 0

    if (action.damageAffinity === 'immune') {
      return `${actor} · ${caster} usou ${ability} em ${target}: acertou, mas o alvo é imune a ${damageTypeLabel(action.damageType)}.${critical}`
    }

    if (action.damageAffinity === 'absorbs') {
      return `${actor} · ${caster} usou ${ability} em ${target}: ${rawDamage} de ${damageTypeLabel(action.damageType)}, absorvido pelo alvo (+${Math.max(0, action.appliedDelta)} HP).${critical}`
    }

    const hpLost = Math.max(0, -action.appliedDelta)
    const affinity =
      action.damageAffinity === 'vulnerable'
        ? ' Vulnerabilidade!'
        : action.damageAffinity === 'resistant'
          ? ' Resistência.'
          : ''
    const guard = action.guardApplied ? ' Guard ativo.' : ''

    return `${actor} · ${caster} usou ${ability}: ${rawDamage} de ${damageTypeLabel(action.damageType)} → ${hpLost} HP perdidos.${affinity}${guard}${critical}`
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
  const [actionMode, setActionMode] =
    useState<'attack' | 'ability' | 'inventory'>('attack')
  const [selectedAbilityId, setSelectedAbilityId] = useState('')
  const [abilityTargetId, setAbilityTargetId] = useState('')
  const [selectedInventoryItem, setSelectedInventoryItem] =
    useState<InventoryItem>('remedy')
  const [inventoryTargetId, setInventoryTargetId] = useState('')
  const [changingTurnState, setChangingTurnState] = useState(false)
  const [endingTurn, setEndingTurn] = useState(false)
  const [guarding, setGuarding] = useState(false)
  const [usingAbility, setUsingAbility] = useState(false)
  const [usingInventory, setUsingInventory] = useState(false)
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
                abilities: combatant.abilities,
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
  const selectedAbility =
    selected?.abilities.find((ability) => ability.id === selectedAbilityId) ??
    selected?.abilities[0] ??
    null
  const attackTargets = selected
    ? combatants.filter(
        (combatant) =>
          combatant.id !== selected.id && combatant.side !== selected.side,
      )
    : []
  const attackTarget = attackTargets.find(
    (combatant) => combatant.id === attackTargetId,
  )
  const abilityTargets =
    selected && selectedAbility
      ? combatants.filter((combatant) =>
          selectedAbility.targetRelation === 'ally'
            ? combatant.side === selected.side && combatant.hp > 0
            : combatant.side !== selected.side && combatant.hp > 0,
        )
      : []
  const abilityTarget = abilityTargets.find(
    (combatant) => combatant.id === abilityTargetId,
  )
  const inventoryTargets = selected
    ? combatants.filter(
        (combatant) =>
          combatant.side === selected.side && combatant.hp > 0,
      )
    : []
  const inventoryTarget = inventoryTargets.find(
    (combatant) => combatant.id === inventoryTargetId,
  )
  const activeTarget =
    actionMode === 'attack'
      ? attackTarget
      : actionMode === 'ability'
        ? abilityTarget
        : inventoryTarget
  const activeTargets =
    actionMode === 'attack'
      ? attackTargets
      : actionMode === 'ability'
        ? abilityTargets
        : inventoryTargets
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
  const combatActionBusy =
    attacking || guarding || usingAbility || usingInventory || endingTurn

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


  useEffect(() => {
    if (!selected) {
      setSelectedAbilityId('')
      return
    }

    if (!selected.abilities.some((ability) => ability.id === selectedAbilityId)) {
      setSelectedAbilityId(selected.abilities[0]?.id ?? '')
    }
  }, [selected, selectedAbilityId])


  useEffect(() => {
    if (!selected) return

    if (actionMode === 'attack' && !selectedAttack && selected.abilities.length > 0) {
      setActionMode('ability')
    }

    if (
      actionMode === 'ability' &&
      selected.abilities.length === 0 &&
      selectedAttack
    ) {
      setActionMode('attack')
    }
  }, [selected, selectedAttack, actionMode])

  useEffect(() => {
    if (!selectedAbility) {
      setAbilityTargetId('')
      return
    }

    if (!abilityTargets.some((combatant) => combatant.id === abilityTargetId)) {
      setAbilityTargetId(abilityTargets[0]?.id ?? '')
    }
  }, [selectedAbility, abilityTargets, abilityTargetId])


  useEffect(() => {
    if (!selected) {
      setInventoryTargetId('')
      return
    }

    if (!inventoryTargets.some((combatant) => combatant.id === inventoryTargetId)) {
      setInventoryTargetId(
        inventoryTargets.find((combatant) => combatant.id === selected.id)?.id ??
          inventoryTargets[0]?.id ??
          '',
      )
    }
  }, [selected, inventoryTargets, inventoryTargetId])

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

  async function handleInventory() {
    if (
      !selected ||
      !inventoryTarget ||
      !canActSelected ||
      selected.ip < inventoryItemCost(selectedInventoryItem) ||
      connectionStatus !== 'online' ||
      combatActionBusy
    ) {
      return
    }

    setUsingInventory(true)
    setErrorMessage(null)

    try {
      const result = await performInventoryItem(
        selected.id,
        inventoryTarget.id,
        selectedInventoryItem,
        turnState.turnRevision,
      )

      setCombatants((current) =>
        current.map((combatant) => {
          let next = combatant

          if (combatant.id === result.combatantId) {
            next = {
              ...next,
              ip: result.resultingIp,
              lastActedRound: result.actedRound,
              guardStartedRound:
                next.guardStartedRound !== null &&
                next.guardStartedRound !== undefined &&
                next.guardStartedRound < result.actedRound
                  ? null
                  : next.guardStartedRound,
            }
          }

          if (combatant.id === result.targetId) {
            const clearedStatuses = result.targetStatuses.length === 0

            next = {
              ...next,
              hp: result.resultingHp,
              mp: result.resultingMp,
              statuses: result.targetStatuses,
              ...(clearedStatuses
                ? {
                    dexDie: next.baseDexDie,
                    insDie: next.baseInsDie,
                    migDie: next.baseMigDie,
                    wlpDie: next.baseWlpDie,
                  }
                : {}),
            }
          }

          return next
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
          : 'Não foi possível usar o item de inventário.',
      )
    } finally {
      setUsingInventory(false)
    }
  }

  async function handleAbility() {
    if (
      !selected ||
      !selectedAbility ||
      !abilityTarget ||
      !canActSelected ||
      selected.mp < selectedAbility.mpCost ||
      connectionStatus !== 'online' ||
      combatActionBusy
    ) {
      return
    }

    setUsingAbility(true)
    setErrorMessage(null)

    try {
      const result = await performCombatantAbility(
        selectedAbility.id,
        abilityTarget.id,
        turnState.turnRevision,
      )

      setCombatants((current) =>
        current.map((combatant) => {
          if (combatant.id === result.casterId) {
            return {
              ...combatant,
              mp: result.resultingMp,
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
            const nextStatuses =
              selectedAbility.effectType === 'status' &&
              result.isHit &&
              selectedAbility.statusEffect &&
              !combatant.statuses.includes(selectedAbility.statusEffect)
                ? [...combatant.statuses, selectedAbility.statusEffect]
                : combatant.statuses

            return {
              ...combatant,
              hp: result.resultingHp,
              statuses: nextStatuses,
            }
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
          : 'Não foi possível usar a habilidade.',
      )
    } finally {
      setUsingAbility(false)
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
          <span className="eyebrow">Inventory autoritativo · v0.15</span>
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
            A ação Inventory agora gasta IP no backend e aplica Remedy,
            Elixir ou Tonic no mesmo fluxo autoritativo de turno.
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
              <div className="action-builder">
                <div className="action-builder__header">
                  <div>
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
                  </div>

                  <div
                    className="action-mode"
                    aria-label="Tipo de ação"
                  >
                    <button
                      type="button"
                      className={actionMode === 'attack' ? 'is-active' : ''}
                      onClick={() => setActionMode('attack')}
                      disabled={!selectedAttack || combatActionBusy}
                    >
                      Ataque
                    </button>
                    <button
                      type="button"
                      className={actionMode === 'ability' ? 'is-active' : ''}
                      onClick={() => setActionMode('ability')}
                      disabled={
                        selected.abilities.length === 0 || combatActionBusy
                      }
                    >
                      Habilidade
                    </button>
                    <button
                      type="button"
                      className={actionMode === 'inventory' ? 'is-active' : ''}
                      onClick={() => setActionMode('inventory')}
                      disabled={combatActionBusy}
                    >
                      Inventory
                    </button>
                  </div>
                </div>

                {actionMode === 'attack' ? (
                  <div className="action-builder__details">
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
                ) : actionMode === 'ability' ? (
                  <div className="action-builder__details">
                    {selected.abilities.length > 0 ? (
                      <label className="ability-picker">
                        Escolher habilidade
                        <select
                          value={selectedAbility?.id ?? ''}
                          onChange={(event) =>
                            setSelectedAbilityId(event.target.value)
                          }
                          disabled={!canActSelected || combatActionBusy}
                        >
                          {selected.abilities.map((ability) => (
                            <option key={ability.id} value={ability.id}>
                              {ability.name} · {ability.mpCost} MP
                            </option>
                          ))}
                        </select>
                      </label>
                    ) : (
                      <strong>Sem habilidades configuradas.</strong>
                    )}

                    {selectedAbility ? (
                      <small>
                        {selectedAbility.effectType === 'heal' ? (
                          <>
                            Cura {selectedAbility.healAmount} HP ·{' '}
                            {selectedAbility.mpCost} MP
                          </>
                        ) : (
                          <>
                            {selectedAbility.checkAttributeA.toUpperCase()} d
                            {attributeDie(
                              selected,
                              selectedAbility.checkAttributeA,
                            )}{' '}
                            + {selectedAbility.checkAttributeB.toUpperCase()} d
                            {attributeDie(
                              selected,
                              selectedAbility.checkAttributeB,
                            )}{' '}
                            {selectedAbility.checkBonus >= 0 ? '+' : ''}
                            {selectedAbility.checkBonus} ·{' '}
                            {selectedAbility.mpCost} MP
                            {selectedAbility.effectType === 'damage' ? (
                              <>
                                {' '}· HR +{selectedAbility.damageBonus} ·{' '}
                                {damageTypeLabel(selectedAbility.damageType)} vs
                                MDEF
                              </>
                            ) : (
                              <>
                                {' '}· aplica{' '}
                                {statusLabel(selectedAbility.statusEffect)} vs
                                MDEF
                              </>
                            )}
                          </>
                        )}
                      </small>
                    ) : null}
                  </div>
                ) : (
                  <div className="action-builder__details">
                    <label className="ability-picker">
                      Consumível
                      <select
                        value={selectedInventoryItem}
                        onChange={(event) =>
                          setSelectedInventoryItem(
                            event.target.value as InventoryItem,
                          )
                        }
                        disabled={!canActSelected || combatActionBusy}
                      >
                        <option value="remedy">Remedy · 3 IP</option>
                        <option value="elixir">Elixir · 3 IP</option>
                        <option value="tonic">Tonic · 2 IP</option>
                      </select>
                    </label>

                    <small>
                      {inventoryItemEffect(selectedInventoryItem)} ·{' '}
                      {inventoryItemCost(selectedInventoryItem)} IP · você tem{' '}
                      {selected.ip}/{selected.maxIp} IP
                    </small>
                  </div>
                )}

                <label className="action-target">
                  Alvo
                  <select
                    value={
                      actionMode === 'attack'
                        ? attackTargetId
                        : actionMode === 'ability'
                          ? abilityTargetId
                          : inventoryTargetId
                    }
                    onChange={(event) => {
                      if (actionMode === 'attack') {
                        setAttackTargetId(event.target.value)
                      } else if (actionMode === 'ability') {
                        setAbilityTargetId(event.target.value)
                      } else {
                        setInventoryTargetId(event.target.value)
                      }
                    }}
                    disabled={
                      !canActSelected ||
                      combatActionBusy ||
                      activeTargets.length === 0
                    }
                  >
                    {activeTargets.map((target) => (
                      <option key={target.id} value={target.id}>
                        {actionMode === 'attack'
                          ? `${target.name} · DEF ${target.defense} · MDEF ${target.magicDefense}`
                          : actionMode === 'ability'
                            ? `${target.name} · HP ${target.hp}/${target.maxHp} · MDEF ${target.magicDefense}`
                            : `${target.name} · HP ${target.hp}/${target.maxHp} · MP ${target.mp}/${target.maxMp} · ${target.statuses.length} status`}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
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
                      {(action.actionType === 'attack' ||
                        action.actionType === 'ability') &&
                      action.rollA !== null &&
                      action.rollB !== null ? (
                        <>
                          {' '}· Rolagem {action.rollA} + {action.rollB}
                          {action.checkTotal !== null
                            ? ` = ${action.checkTotal}`
                            : ''}
                          {action.targetDefense !== null
                            ? ` vs ${action.actionType === 'ability' ? 'MDEF' : 'DEF'} ${action.targetDefense}`
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
                        <>
                          {' '}· HP {action.previousHp} → {action.resultingHp}
                          {action.actionType === 'ability' &&
                          action.previousResource !== null &&
                          action.resultingResource !== null
                            ? ` · MP ${action.previousResource} → ${action.resultingResource}`
                            : ''}
                        </>
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
              className="command-action--primary"
              type="button"
              onClick={() =>
                void (
                  actionMode === 'attack'
                    ? handleAttack()
                    : actionMode === 'ability'
                      ? handleAbility()
                      : handleInventory()
                )
              }
              disabled={
                !selected ||
                !activeTarget ||
                !canActSelected ||
                connectionStatus !== 'online' ||
                combatActionBusy ||
                (actionMode === 'attack'
                  ? !selectedAttack
                  : actionMode === 'ability'
                    ? !selectedAbility ||
                      selected.mp < selectedAbility.mpCost
                    : selected.ip <
                      inventoryItemCost(selectedInventoryItem))
              }
            >
              {actionMode === 'attack'
                ? attacking
                  ? 'Atacando…'
                  : selectedAttack?.name ?? 'Atacar'
                : actionMode === 'ability'
                  ? usingAbility
                    ? 'Usando…'
                    : selectedAbility
                      ? `${selectedAbility.name} · ${selectedAbility.mpCost} MP`
                      : 'Habilidade'
                  : usingInventory
                    ? 'Usando item…'
                    : `${inventoryItemLabel(selectedInventoryItem)} · ${inventoryItemCost(selectedInventoryItem)} IP`}
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
