import { useEffect, useMemo, useState } from 'react'
import { CharacterEditor } from './CharacterEditor'
import { CharacterSheetView } from './CharacterSheetView'
import {
  addCharacterToBattle,
  createCharacterRecord,
  deleteCharacterRecord,
  duplicateCharacterRecord,
  duplicateCharacterToBattle,
  listCharacters,
  removeCharacterFromScene,
  subscribeToCharacterLibrary,
} from '../lib/characterRepository'
import type {
  CharacterKind,
  CharacterRecord,
} from '../lib/characterRepository'
import { importFultimatorCharacter } from '../lib/fultimatorImport'
import { loadBattleCombatants } from '../lib/battleRepository'
import type { Combatant } from '../types/combat'

type CharacterLibraryPanelProps = {
  roomId: string | null
  battleId: string | null
  currentUserId: string | null
  isHost: boolean
  combatants: Combatant[]
  onCombatantsChange: (combatants: Combatant[]) => void
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function characterLevel(character: CharacterRecord) {
  const raw = character.sourceData
  const value = raw.lvl ?? raw.level
  return typeof value === 'number' || typeof value === 'string'
    ? String(value)
    : '—'
}

function characterClasses(character: CharacterRecord) {
  const rawClasses = Array.isArray(character.sourceData.classes)
    ? character.sourceData.classes
    : []

  return rawClasses
    .map((entry) => record(entry))
    .filter((entry): entry is Record<string, unknown> => entry !== null)
    .map((entry) => {
      const name = typeof entry.name === 'string' ? entry.name : 'Classe'
      const level =
        typeof entry.lvl === 'number' || typeof entry.lvl === 'string'
          ? ` ${entry.lvl}`
          : typeof entry.level === 'number' || typeof entry.level === 'string'
            ? ` ${entry.level}`
            : ''
      return `${name}${level}`
    })
}

export function CharacterLibraryPanel({
  roomId,
  battleId,
  currentUserId,
  isHost,
  combatants,
  onCombatantsChange,
}: CharacterLibraryPanelProps) {
  const [characters, setCharacters] = useState<CharacterRecord[]>([])
  const [loading, setLoading] = useState(false)
  const [importing, setImporting] = useState(false)
  const [addingId, setAddingId] = useState<string | null>(null)
  const [lifecycleBusyId, setLifecycleBusyId] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [openCharacter, setOpenCharacter] = useState<CharacterRecord | null>(null)
  const [editorCharacter, setEditorCharacter] =
    useState<CharacterRecord | null>(null)
  const [editorCreateKind, setEditorCreateKind] =
    useState<CharacterKind | null>(null)

  const activeCharacterIds = useMemo(
    () =>
      new Set(
        combatants
          .map((combatant) => combatant.characterId)
          .filter((id): id is string => Boolean(id)),
      ),
    [combatants],
  )

  useEffect(() => {
    if (!roomId) {
      setCharacters([])
      return
    }

    let cancelled = false
    setLoading(true)

    void listCharacters(roomId)
      .then((records) => {
        if (!cancelled) setCharacters(records)
      })
      .catch((reason) => {
        console.error(reason)
        if (!cancelled) {
          setError(
            reason instanceof Error
              ? reason.message
              : 'Não foi possível carregar a biblioteca.',
          )
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    const unsubscribe = subscribeToCharacterLibrary(roomId, (records) => {
      if (!cancelled) setCharacters(records)
    })

    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [roomId])

  async function handleImport(file: File | null) {
    if (!file || !roomId || importing) return

    setImporting(true)
    setError(null)
    setMessage(null)

    try {
      const rawText = await file.text()
      const parsed = JSON.parse(rawText) as unknown
      const imported = importFultimatorCharacter(parsed)

      await createCharacterRecord({
        roomId,
        name: imported.name,
        kind: 'character',
        source: 'fultimator',
        sourceData: imported.sourceData,
        combatProfile: imported.combatProfile,
      })

      setCharacters(await listCharacters(roomId))

      const warningText =
        imported.warnings.length > 0
          ? ` Avisos: ${imported.warnings.join(' ')}`
          : ''

      setMessage(
        `${imported.name} importado do Fultimator.${warningText}`,
      )
    } catch (reason) {
      console.error(reason)
      setError(
        reason instanceof SyntaxError
          ? 'O arquivo não contém JSON válido.'
          : reason instanceof Error
            ? reason.message
            : 'Não foi possível importar a ficha.',
      )
    } finally {
      setImporting(false)
    }
  }

  async function handleAdd(character: CharacterRecord) {
    if (!battleId || !isHost || addingId) return

    setAddingId(character.id)
    setError(null)
    setMessage(null)

    try {
      await addCharacterToBattle(character.id, battleId)
      const nextCombatants = await loadBattleCombatants(battleId)
      onCombatantsChange(nextCombatants)
      setMessage(`${character.name} adicionado à cena.`)
    } catch (reason) {
      console.error(reason)
      setError(
        reason instanceof Error
          ? reason.message
          : 'Não foi possível adicionar o personagem à cena.',
      )
    } finally {
      setAddingId(null)
    }
  }


  async function refreshLibraryAndScene() {
    if (!roomId) return

    setCharacters(await listCharacters(roomId))

    if (battleId) {
      onCombatantsChange(await loadBattleCombatants(battleId))
    }
  }

  async function handleRemove(character: CharacterRecord) {
    if (!isHost || lifecycleBusyId) return

    const confirmed = window.confirm(
      `Remover ${character.name} desta cena? HP, MP, IP, Fabula Points e status atuais serão salvos na ficha.`,
    )

    if (!confirmed) return

    setLifecycleBusyId(character.id)
    setError(null)
    setMessage(null)

    try {
      await removeCharacterFromScene(character.id)
      await refreshLibraryAndScene()
      setMessage(`${character.name} removido da cena; a ficha foi preservada.`)
    } catch (reason) {
      console.error(reason)
      setError(
        reason instanceof Error
          ? reason.message
          : 'Não foi possível remover o personagem da cena.',
      )
    } finally {
      setLifecycleBusyId(null)
    }
  }

  async function handleDelete(character: CharacterRecord) {
    if (lifecycleBusyId) return

    const confirmed = window.confirm(
      `Excluir definitivamente a ficha de ${character.name}? Esta ação não pode ser desfeita.`,
    )

    if (!confirmed) return

    setLifecycleBusyId(character.id)
    setError(null)
    setMessage(null)

    try {
      await deleteCharacterRecord(character.id)
      setOpenCharacter((current) =>
        current?.id === character.id ? null : current,
      )
      setEditorCharacter((current) =>
        current?.id === character.id ? null : current,
      )
      await refreshLibraryAndScene()
      setMessage(`${character.name} excluído da biblioteca.`)
    } catch (reason) {
      console.error(reason)
      setError(
        reason instanceof Error
          ? reason.message
          : 'Não foi possível excluir a ficha.',
      )
    } finally {
      setLifecycleBusyId(null)
    }
  }

  async function handleDuplicate(
    character: CharacterRecord,
    addToScene: boolean,
  ) {
    if (!isHost || lifecycleBusyId) return

    setLifecycleBusyId(character.id)
    setError(null)
    setMessage(null)

    try {
      const result =
        addToScene && battleId
          ? await duplicateCharacterToBattle(character.id, battleId)
          : await duplicateCharacterRecord(character.id)

      await refreshLibraryAndScene()

      setMessage(
        addToScene
          ? `${result.character_name} criado e adicionado à cena.`
          : `${result.character_name} criado na biblioteca.`,
      )
    } catch (reason) {
      console.error(reason)
      setError(
        reason instanceof Error
          ? reason.message
          : 'Não foi possível duplicar a ficha.',
      )
    } finally {
      setLifecycleBusyId(null)
    }
  }

  return (
    <section className="character-library">
      <div className="character-library__header">
        <div>
          <span className="character-library__label">
            Biblioteca da sala
          </span>
          <strong>Personagens persistentes</strong>
          <small>
            A ficha existe fora do combate. Por enquanto o importador aceita
            JSON exportado pelo Fultimator.
          </small>
        </div>

        <div className="character-library__header-actions">
          <button
            type="button"
            onClick={() => {
              setEditorCharacter(null)
              setEditorCreateKind('character')
            }}
            disabled={!roomId}
          >
            + Personagem
          </button>

          {isHost ? (
            <button
              type="button"
              onClick={() => {
                setEditorCharacter(null)
                setEditorCreateKind('npc')
              }}
              disabled={!roomId}
            >
              + NPC
            </button>
          ) : null}

          <label className="character-library__import">
            {importing ? 'Importando…' : 'Importar Fultimator JSON'}
            <input
              type="file"
              accept=".json,application/json"
              disabled={!roomId || importing}
              onChange={(event) => {
                const file = event.currentTarget.files?.[0] ?? null
                void handleImport(file)
                event.currentTarget.value = ''
              }}
            />
          </label>
        </div>
      </div>

      {loading ? (
        <span className="character-library__empty">
          Carregando biblioteca…
        </span>
      ) : characters.length === 0 ? (
        <span className="character-library__empty">
          Nenhuma ficha importada nesta sala.
        </span>
      ) : (
        <div className="character-library__list">
          {characters.map((character) => {
            const profile = character.combatProfile
            const classes = characterClasses(character)
            const active = activeCharacterIds.has(character.id)
            const ownedByCurrentUser =
              character.ownerUserId !== null &&
              character.ownerUserId === currentUserId

            return (
              <article className="character-library__card" key={character.id}>
                <div className="character-library__card-header">
                  <div>
                    <strong>{character.name}</strong>
                    <span>
                      Nv. {characterLevel(character)} ·{' '}
                      {character.source === 'fultimator'
                        ? 'Fultimator'
                        : character.source}
                      {ownedByCurrentUser ? ' · sua ficha' : ''}
                    </span>
                  </div>

                  <div className="character-library__actions">
                    <button
                      type="button"
                      onClick={() => setOpenCharacter(character)}
                    >
                      Abrir ficha
                    </button>

                    {isHost || ownedByCurrentUser ? (
                      <button
                        type="button"
                        onClick={() => {
                          setEditorCreateKind(null)
                          setEditorCharacter(character)
                        }}
                        disabled={lifecycleBusyId === character.id}
                      >
                        Editar
                      </button>
                    ) : null}

                    {active ? (
                      <span className="character-library__active">
                        Na cena
                      </span>
                    ) : isHost ? (
                      <button
                        type="button"
                        onClick={() => void handleAdd(character)}
                        disabled={
                          !battleId ||
                          addingId !== null ||
                          lifecycleBusyId !== null
                        }
                      >
                        {addingId === character.id
                          ? 'Adicionando…'
                          : 'Adicionar à cena'}
                      </button>
                    ) : null}

                    {isHost || ownedByCurrentUser ? (
                      <details className="character-library__more">
                        <summary aria-label={`Mais ações para ${character.name}`}>
                          ⋯
                        </summary>
                        <div>
                          {isHost ? (
                            <button
                              type="button"
                              onClick={() =>
                                void handleDuplicate(character, false)
                              }
                              disabled={lifecycleBusyId !== null}
                            >
                              Duplicar ficha
                            </button>
                          ) : null}

                          {isHost &&
                          active &&
                          character.kind === 'npc' &&
                          battleId ? (
                            <button
                              type="button"
                              onClick={() =>
                                void handleDuplicate(character, true)
                              }
                              disabled={lifecycleBusyId !== null}
                            >
                              + Cópia nesta cena
                            </button>
                          ) : null}

                          {isHost && active ? (
                            <button
                              type="button"
                              onClick={() => void handleRemove(character)}
                              disabled={lifecycleBusyId !== null}
                            >
                              Remover da cena
                            </button>
                          ) : null}

                          {!active ? (
                            <button
                              type="button"
                              className="is-danger"
                              onClick={() => void handleDelete(character)}
                              disabled={lifecycleBusyId !== null}
                            >
                              Excluir ficha
                            </button>
                          ) : null}
                        </div>
                      </details>
                    ) : null}
                  </div>
                </div>

                <div className="character-library__stats">
                  <span>
                    DEX d{profile.attributes.dex}
                  </span>
                  <span>
                    INS d{profile.attributes.ins}
                  </span>
                  <span>
                    MIG d{profile.attributes.mig}
                  </span>
                  <span>
                    WLP d{profile.attributes.wlp}
                  </span>
                  <span>
                    HP {profile.hp.current}/{profile.hp.max}
                  </span>
                  <span>
                    MP {profile.mp.current}/{profile.mp.max}
                  </span>
                  <span>
                    IP {profile.ip.current}/{profile.ip.max}
                  </span>
                  <span>DEF {profile.defense}</span>
                  <span>MDEF {profile.magicDefense}</span>
                </div>

                <details className="character-library__details">
                  <summary>Ficha importada</summary>
                  <div>
                    <span>
                      <strong>Classes:</strong>{' '}
                      {classes.length > 0 ? classes.join(', ') : '—'}
                    </span>
                    <span>
                      <strong>Ataques automatizados:</strong>{' '}
                      {profile.attacks.map((attack) => attack.name).join(', ')}
                    </span>
                    <span>
                      <strong>Status importados:</strong>{' '}
                      {profile.statuses.length > 0
                        ? profile.statuses.join(', ')
                        : 'nenhum'}
                    </span>
                  </div>
                </details>
              </article>
            )
          })}
        </div>
      )}

      {message ? (
        <p className="character-library__message">{message}</p>
      ) : null}
      {error ? (
        <p className="character-library__error">{error}</p>
      ) : null}

      {openCharacter ? (
        <CharacterSheetView
          character={openCharacter}
          onClose={() => setOpenCharacter(null)}
        />
      ) : null}

      {roomId && (editorCharacter || editorCreateKind) ? (
        <CharacterEditor
          roomId={roomId}
          character={editorCharacter}
          createKind={editorCreateKind ?? undefined}
          onClose={() => {
            setEditorCharacter(null)
            setEditorCreateKind(null)
          }}
          onSaved={async () => {
            setCharacters(await listCharacters(roomId))
            if (battleId) {
              onCombatantsChange(await loadBattleCombatants(battleId))
            }
          }}
        />
      ) : null}
    </section>
  )
}
