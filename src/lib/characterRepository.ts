import { supabase } from './supabase'
import type { NormalizedCombatProfile } from './fultimatorImport'

export type CharacterSource = 'native' | 'fultimator' | 'foundry' | 'roll20'
export type CharacterKind = 'character' | 'npc'

export type CharacterRecord = {
  id: string
  roomId: string
  ownerUserId: string | null
  name: string
  kind: CharacterKind
  source: CharacterSource
  sourceData: Record<string, unknown>
  combatProfile: NormalizedCombatProfile
  createdAt: string
}

type CharacterRow = {
  id: string
  room_id: string
  owner_user_id: string | null
  name: string
  kind: CharacterKind
  source: CharacterSource
  source_data: Record<string, unknown>
  combat_profile: NormalizedCombatProfile
  created_at: string
}

function toCharacterRecord(row: CharacterRow): CharacterRecord {
  return {
    id: row.id,
    roomId: row.room_id,
    ownerUserId: row.owner_user_id,
    name: row.name,
    kind: row.kind,
    source: row.source,
    sourceData: row.source_data,
    combatProfile: row.combat_profile,
    createdAt: row.created_at,
  }
}

export async function listCharacters(roomId: string) {
  const { data, error } = await supabase
    .from('characters')
    .select(
      'id, room_id, owner_user_id, name, kind, source, source_data, combat_profile, created_at',
    )
    .eq('room_id', roomId)
    .order('created_at', { ascending: true })

  if (error) throw error

  return (data as CharacterRow[]).map(toCharacterRecord)
}

export async function createCharacterRecord(input: {
  roomId: string
  name: string
  kind: CharacterKind
  source: CharacterSource
  sourceData: Record<string, unknown>
  combatProfile: NormalizedCombatProfile
}) {
  const { data, error } = await supabase
    .rpc('create_character_record', {
      p_room_id: input.roomId,
      p_name: input.name,
      p_kind: input.kind,
      p_source: input.source,
      p_source_data: input.sourceData,
      p_combat_profile: input.combatProfile,
    })
    .single()

  if (error) throw error

  return data as {
    character_id: string
    character_name: string
  }
}

export async function addCharacterToBattle(
  characterId: string,
  battleId: string,
) {
  const { data, error } = await supabase
    .rpc('add_character_to_battle', {
      p_character_id: characterId,
      p_battle_id: battleId,
    })
    .single()

  if (error) throw error

  return data as {
    combatant_id: string
    character_id: string
  }
}
