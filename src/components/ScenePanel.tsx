import { useEffect, useMemo, useState } from 'react'
import {
  createBattleScene,
  listBattleScenes,
  loadBattleScene,
  moveCombatantToScene,
  renameBattleScene,
  subscribeToBattleScenes,
  switchBattleScene,
} from '../lib/battleRepository'
import type {
  BattleScene,
  LoadedBattle,
} from '../lib/battleRepository'
import type { Combatant } from '../types/combat'

type ScenePanelProps = {
  roomId: string | null
  battleId: string | null
  selected: Combatant | null
  isHost: boolean
  onBattleLoaded: (battle: LoadedBattle) => Promise<void> | void
  onError: (message: string) => void
}

export function ScenePanel({
  roomId,
  battleId,
  selected,
  isHost,
  onBattleLoaded,
  onError,
}: ScenePanelProps) {
  const [scenes, setScenes] = useState<BattleScene[]>([])
  const [newSceneName, setNewSceneName] = useState('')
  const [renaming, setRenaming] = useState(false)
  const [renameValue, setRenameValue] = useState('')
  const [switchingScene, setSwitchingScene] = useState(false)
  const [creatingScene, setCreatingScene] = useState(false)
  const [movingCombatant, setMovingCombatant] = useState(false)
  const [savingName, setSavingName] = useState(false)

  const currentScene = useMemo(
    () => scenes.find((scene) => scene.id === battleId) ?? null,
    [scenes, battleId],
  )

  useEffect(() => {
    if (!roomId) {
      setScenes([])
      return
    }

    let cancelled = false

    void listBattleScenes(roomId)
      .then((nextScenes) => {
        if (!cancelled) setScenes(nextScenes)
      })
      .catch((reason) => {
        console.error(reason)
        if (!cancelled) {
          onError(
            reason instanceof Error
              ? reason.message
              : 'Não foi possível carregar as cenas.',
          )
        }
      })

    const unsubscribe = subscribeToBattleScenes(roomId, (nextScenes) => {
      if (!cancelled) setScenes(nextScenes)
    })

    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [roomId])

  useEffect(() => {
    if (!renaming) {
      setRenameValue(currentScene?.name ?? '')
    }
  }, [currentScene?.name, renaming])

  async function refreshScenes() {
    if (!roomId) return
    setScenes(await listBattleScenes(roomId))
  }

  async function handleSwitch(nextBattleId: string) {
    if (
      !nextBattleId ||
      nextBattleId === battleId ||
      switchingScene
    ) {
      return
    }

    setSwitchingScene(true)

    try {
      const battle = await switchBattleScene(nextBattleId)
      await onBattleLoaded(battle)
    } catch (reason) {
      console.error(reason)
      onError(
        reason instanceof Error
          ? reason.message
          : 'Não foi possível trocar de cena.',
      )
    } finally {
      setSwitchingScene(false)
    }
  }

  async function handleCreate() {
    if (!roomId || !isHost || creatingScene) return

    setCreatingScene(true)

    try {
      const battle = await createBattleScene(
        roomId,
        newSceneName.trim() || 'Nova cena',
      )
      setNewSceneName('')
      await refreshScenes()
      await onBattleLoaded(battle)
    } catch (reason) {
      console.error(reason)
      onError(
        reason instanceof Error
          ? reason.message
          : 'Não foi possível criar a cena.',
      )
    } finally {
      setCreatingScene(false)
    }
  }

  async function handleRename() {
    if (
      !battleId ||
      !isHost ||
      !renameValue.trim() ||
      savingName
    ) {
      return
    }

    setSavingName(true)

    try {
      await renameBattleScene(battleId, renameValue.trim())
      await refreshScenes()
      await onBattleLoaded(await loadBattleScene(battleId))
      setRenaming(false)
    } catch (reason) {
      console.error(reason)
      onError(
        reason instanceof Error
          ? reason.message
          : 'Não foi possível renomear a cena.',
      )
    } finally {
      setSavingName(false)
    }
  }

  async function handleMove(destinationBattleId: string) {
    if (
      !selected ||
      !battleId ||
      !destinationBattleId ||
      destinationBattleId === battleId ||
      !isHost ||
      movingCombatant
    ) {
      return
    }

    setMovingCombatant(true)

    try {
      await moveCombatantToScene(selected.id, destinationBattleId)
      await refreshScenes()
      await onBattleLoaded(await loadBattleScene(battleId))
    } catch (reason) {
      console.error(reason)
      onError(
        reason instanceof Error
          ? reason.message
          : 'Não foi possível mover o participante.',
      )
    } finally {
      setMovingCombatant(false)
    }
  }

  return (
    <section className="scene-panel-v2">
      <div className="scene-panel-v2__current">
        <div>
          <span className="scene-panel-v2__label">Cena ativa</span>
          {renaming && isHost ? (
            <div className="scene-panel-v2__rename">
              <input
                value={renameValue}
                onChange={(event) => setRenameValue(event.target.value)}
                maxLength={64}
                autoFocus
              />
              <button
                type="button"
                onClick={() => void handleRename()}
                disabled={savingName || !renameValue.trim()}
              >
                {savingName ? 'Salvando…' : 'Salvar'}
              </button>
              <button
                type="button"
                onClick={() => {
                  setRenameValue(currentScene?.name ?? '')
                  setRenaming(false)
                }}
                disabled={savingName}
              >
                Cancelar
              </button>
            </div>
          ) : (
            <div className="scene-panel-v2__scene-row">
              <select
                value={battleId ?? ''}
                onChange={(event) => void handleSwitch(event.target.value)}
                disabled={switchingScene || scenes.length === 0}
              >
                {scenes.map((scene) => (
                  <option value={scene.id} key={scene.id}>
                    {scene.name}
                    {scene.conflictStarted
                      ? ` · conflito R${scene.roundNumber}`
                      : ''}
                  </option>
                ))}
              </select>

              {isHost && currentScene ? (
                <button
                  type="button"
                  onClick={() => setRenaming(true)}
                >
                  Renomear
                </button>
              ) : null}
            </div>
          )}
          <small>
            Cada jogador pode observar uma cena diferente. Mover um personagem
            atribuído faz o jogador acompanhar esse personagem.
          </small>
        </div>

        <div className="scene-panel-v2__status">
          <span>{scenes.length} cena(s)</span>
          {currentScene?.conflictStarted ? (
            <strong>Conflito ativo</strong>
          ) : (
            <strong>Exploração</strong>
          )}
        </div>
      </div>

      {isHost ? (
        <div className="scene-panel-v2__gm">
          <label>
            Criar cena
            <div>
              <input
                value={newSceneName}
                onChange={(event) => setNewSceneName(event.target.value)}
                placeholder="Ex.: Câmara da armadilha"
                maxLength={64}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault()
                    void handleCreate()
                  }
                }}
              />
              <button
                type="button"
                onClick={() => void handleCreate()}
                disabled={creatingScene}
              >
                {creatingScene ? 'Criando…' : 'Criar'}
              </button>
            </div>
          </label>

          {selected && scenes.length > 1 ? (
            <label>
              Mover {selected.name}
              <select
                value=""
                onChange={(event) => {
                  const destination = event.target.value
                  if (destination) {
                    void handleMove(destination)
                  }
                }}
                disabled={movingCombatant}
              >
                <option value="">Escolher cena…</option>
                {scenes
                  .filter((scene) => scene.id !== battleId)
                  .map((scene) => (
                    <option value={scene.id} key={scene.id}>
                      {scene.name}
                      {scene.conflictStarted ? ' · conflito ativo' : ''}
                    </option>
                  ))}
              </select>
              <small>
                Por segurança, encerre conflitos nas duas cenas antes da
                transferência.
              </small>
            </label>
          ) : null}
        </div>
      ) : null}
    </section>
  )
}
