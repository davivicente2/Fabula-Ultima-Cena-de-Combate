import { useEffect, useState } from 'react'
import {
  adjustFabulaPoints,
  adjustSceneClock,
  createSceneClock,
  deleteSceneClock,
  listSceneClocks,
  performCombatantCheck,
  subscribeToSceneClocks,
} from '../lib/tableToolsRepository'
import type {
  CombatantCheckResult,
  SceneClock,
} from '../lib/tableToolsRepository'
import type {
  AttributeName,
  Combatant,
} from '../types/combat'

type TableToolsPanelProps = {
  battleId: string | null
  selected: Combatant | null
  canControlSelected: boolean
  isHost: boolean
  onFabulaPointsChange: (
    combatantId: string,
    value: number,
  ) => void
  onError: (message: string) => void
}

const ATTRIBUTES: { value: AttributeName; label: string }[] = [
  { value: 'dex', label: 'DEX' },
  { value: 'ins', label: 'INS' },
  { value: 'mig', label: 'MIG' },
  { value: 'wlp', label: 'WLP' },
]

const CLOCK_SIZES = [4, 6, 8, 10, 12]

export function TableToolsPanel({
  battleId,
  selected,
  canControlSelected,
  isHost,
  onFabulaPointsChange,
  onError,
}: TableToolsPanelProps) {
  const [attributeA, setAttributeA] =
    useState<AttributeName>('dex')
  const [attributeB, setAttributeB] =
    useState<AttributeName>('ins')
  const [bonus, setBonus] = useState(0)
  const [difficulty, setDifficulty] = useState('')
  const [checkName, setCheckName] = useState('')
  const [rolling, setRolling] = useState(false)
  const [lastCheck, setLastCheck] =
    useState<CombatantCheckResult | null>(null)
  const [adjustingFp, setAdjustingFp] = useState(false)

  const [clocks, setClocks] = useState<SceneClock[]>([])
  const [clockName, setClockName] = useState('')
  const [clockSize, setClockSize] = useState(6)
  const [creatingClock, setCreatingClock] = useState(false)
  const [changingClockId, setChangingClockId] =
    useState<string | null>(null)

  useEffect(() => {
    if (!battleId) {
      setClocks([])
      return
    }

    let cancelled = false

    void listSceneClocks(battleId)
      .then((next) => {
        if (!cancelled) setClocks(next)
      })
      .catch((reason) => {
        console.error(reason)
        if (!cancelled) {
          onError(
            reason instanceof Error
              ? reason.message
              : 'Não foi possível carregar os Clocks.',
          )
        }
      })

    const unsubscribe = subscribeToSceneClocks(
      battleId,
      (next) => {
        if (!cancelled) setClocks(next)
      },
    )

    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [battleId])

  async function handleCheck() {
    if (!selected || !canControlSelected || rolling) return

    const parsedDifficulty =
      difficulty.trim() === ''
        ? null
        : Number(difficulty)

    if (
      parsedDifficulty !== null &&
      (!Number.isFinite(parsedDifficulty) ||
        parsedDifficulty < 1 ||
        parsedDifficulty > 99)
    ) {
      onError('A dificuldade deve ficar entre 1 e 99.')
      return
    }

    setRolling(true)

    try {
      const result = await performCombatantCheck({
        combatantId: selected.id,
        attributeA,
        attributeB,
        bonus,
        difficulty: parsedDifficulty,
        name: checkName.trim() || null,
      })
      setLastCheck(result)
    } catch (reason) {
      console.error(reason)
      onError(
        reason instanceof Error
          ? reason.message
          : 'Não foi possível realizar o check.',
      )
    } finally {
      setRolling(false)
    }
  }

  async function handleFabulaPoints(delta: number) {
    if (
      !selected ||
      !canControlSelected ||
      adjustingFp
    ) {
      return
    }

    setAdjustingFp(true)

    try {
      const result = await adjustFabulaPoints(
        selected.id,
        delta,
      )
      onFabulaPointsChange(
        result.combatant_id,
        result.value,
      )
    } catch (reason) {
      console.error(reason)
      onError(
        reason instanceof Error
          ? reason.message
          : 'Não foi possível alterar Fabula Points.',
      )
    } finally {
      setAdjustingFp(false)
    }
  }

  async function handleCreateClock() {
    if (
      !battleId ||
      !isHost ||
      !clockName.trim() ||
      creatingClock
    ) {
      return
    }

    setCreatingClock(true)

    try {
      await createSceneClock(
        battleId,
        clockName.trim(),
        clockSize,
      )
      setClockName('')
      setClocks(await listSceneClocks(battleId))
    } catch (reason) {
      console.error(reason)
      onError(
        reason instanceof Error
          ? reason.message
          : 'Não foi possível criar o Clock.',
      )
    } finally {
      setCreatingClock(false)
    }
  }

  async function handleClockDelta(
    clock: SceneClock,
    delta: number,
  ) {
    if (!isHost || changingClockId) return

    setChangingClockId(clock.id)

    try {
      await adjustSceneClock(clock.id, delta)
      if (battleId) {
        setClocks(await listSceneClocks(battleId))
      }
    } catch (reason) {
      console.error(reason)
      onError(
        reason instanceof Error
          ? reason.message
          : 'Não foi possível alterar o Clock.',
      )
    } finally {
      setChangingClockId(null)
    }
  }

  async function handleDeleteClock(clock: SceneClock) {
    if (!isHost || changingClockId) return

    setChangingClockId(clock.id)

    try {
      await deleteSceneClock(clock.id)
      if (battleId) {
        setClocks(await listSceneClocks(battleId))
      }
    } catch (reason) {
      console.error(reason)
      onError(
        reason instanceof Error
          ? reason.message
          : 'Não foi possível remover o Clock.',
      )
    } finally {
      setChangingClockId(null)
    }
  }

  return (
    <details className="table-tools">
      <summary>
        <span>Ferramentas de mesa</span>
        <small>
          Checks · Fabula Points · Clocks
        </small>
      </summary>

      <div className="table-tools__body">
        <section className="table-tools__section">
          <div className="table-tools__title">
            <div>
              <strong>Check livre</strong>
              <small>Não consome turno.</small>
            </div>
            {selected ? (
              <span>{selected.name}</span>
            ) : null}
          </div>

          <div className="table-tools__check-grid">
            <label>
              Nome
              <input
                value={checkName}
                onChange={(event) =>
                  setCheckName(event.target.value)
                }
                placeholder="Ex.: investigar ruínas"
              />
            </label>

            <label>
              Atributo 1
              <select
                value={attributeA}
                onChange={(event) =>
                  setAttributeA(
                    event.target.value as AttributeName,
                  )
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
                value={attributeB}
                onChange={(event) =>
                  setAttributeB(
                    event.target.value as AttributeName,
                  )
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
              Bônus
              <input
                type="number"
                value={bonus}
                onChange={(event) =>
                  setBonus(Number(event.target.value) || 0)
                }
              />
            </label>

            <label>
              Dificuldade
              <input
                type="number"
                min={1}
                max={99}
                value={difficulty}
                onChange={(event) =>
                  setDifficulty(event.target.value)
                }
                placeholder="Opcional"
              />
            </label>

            <button
              type="button"
              onClick={() => void handleCheck()}
              disabled={
                !selected ||
                !canControlSelected ||
                rolling
              }
            >
              {rolling ? 'Rolando…' : 'Rolar check'}
            </button>
          </div>

          {lastCheck ? (
            <div className="table-tools__result">
              <strong>
                {lastCheck.rollA} + {lastCheck.rollB}
                {' = '}
                {lastCheck.checkTotal}
              </strong>
              <span>
                HR {lastCheck.highRoll}
                {lastCheck.isFumble
                  ? ' · falha crítica'
                  : lastCheck.isCritical
                    ? ' · crítico'
                    : lastCheck.difficulty === null
                      ? ' · check livre'
                      : lastCheck.isSuccess
                        ? ' · sucesso'
                        : ' · falha'}
              </span>
            </div>
          ) : null}
        </section>

        <section className="table-tools__section">
          <div className="table-tools__title">
            <div>
              <strong>Fabula Points</strong>
              <small>Persistem junto da ficha.</small>
            </div>
          </div>

          {selected ? (
            <div className="table-tools__fabula">
              <button
                type="button"
                onClick={() => void handleFabulaPoints(-1)}
                disabled={
                  !canControlSelected ||
                  adjustingFp ||
                  selected.fabulaPoints <= 0
                }
              >
                −
              </button>
              <strong>{selected.fabulaPoints}</strong>
              <button
                type="button"
                onClick={() => void handleFabulaPoints(1)}
                disabled={
                  !canControlSelected ||
                  adjustingFp ||
                  selected.fabulaPoints >= 99
                }
              >
                +
              </button>
              <span>{selected.name}</span>
            </div>
          ) : (
            <small>Selecione um personagem.</small>
          )}
        </section>

        <section className="table-tools__section">
          <div className="table-tools__title">
            <div>
              <strong>Clocks da cena</strong>
              <small>
                Sincronizados para todos nesta cena.
              </small>
            </div>
          </div>

          {clocks.length > 0 ? (
            <div className="table-tools__clocks">
              {clocks.map((clock) => (
                <article
                  className="table-clock"
                  key={clock.id}
                >
                  <div className="table-clock__header">
                    <strong>{clock.name}</strong>
                    <span>
                      {clock.currentSegments}/
                      {clock.maxSegments}
                    </span>
                  </div>

                  <div className="table-clock__segments">
                    {Array.from({
                      length: clock.maxSegments,
                    }).map((_, index) => (
                      <span
                        key={index}
                        className={
                          index < clock.currentSegments
                            ? 'is-filled'
                            : ''
                        }
                      />
                    ))}
                  </div>

                  {isHost ? (
                    <div className="table-clock__controls">
                      <button
                        type="button"
                        onClick={() =>
                          void handleClockDelta(clock, -1)
                        }
                        disabled={
                          changingClockId !== null ||
                          clock.currentSegments <= 0
                        }
                      >
                        −
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          void handleClockDelta(clock, 1)
                        }
                        disabled={
                          changingClockId !== null ||
                          clock.currentSegments >=
                            clock.maxSegments
                        }
                      >
                        +
                      </button>
                      <button
                        type="button"
                        className="is-danger"
                        onClick={() =>
                          void handleDeleteClock(clock)
                        }
                        disabled={changingClockId !== null}
                      >
                        Remover
                      </button>
                    </div>
                  ) : null}
                </article>
              ))}
            </div>
          ) : (
            <small>Nenhum Clock nesta cena.</small>
          )}

          {isHost ? (
            <div className="table-tools__clock-create">
              <input
                value={clockName}
                onChange={(event) =>
                  setClockName(event.target.value)
                }
                placeholder="Novo Clock"
                maxLength={80}
              />
              <select
                value={clockSize}
                onChange={(event) =>
                  setClockSize(Number(event.target.value))
                }
              >
                {CLOCK_SIZES.map((size) => (
                  <option value={size} key={size}>
                    {size} segmentos
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => void handleCreateClock()}
                disabled={
                  creatingClock || !clockName.trim()
                }
              >
                {creatingClock ? 'Criando…' : 'Criar'}
              </button>
            </div>
          ) : null}
        </section>
      </div>
    </details>
  )
}
