import { supabase } from './supabase'
import type { AttributeName } from '../types/combat'

export type CombatantCheckResult = {
  actionId: string
  combatantId: string
  combatantName: string
  rollA: number
  rollB: number
  checkTotal: number
  highRoll: number
  difficulty: number | null
  isSuccess: boolean | null
  isCritical: boolean
  isFumble: boolean
}

type CombatantCheckRpcRow = {
  action_id: string
  combatant_id: string
  combatant_name: string
  roll_a: number
  roll_b: number
  check_total: number
  high_roll: number
  difficulty: number | null
  is_success: boolean | null
  is_critical: boolean
  is_fumble: boolean
}

export type SceneClock = {
  id: string
  battleId: string
  name: string
  currentSegments: number
  maxSegments: number
  createdAt: string
}

type SceneClockRow = {
  id: string
  battle_id: string
  name: string
  current_segments: number
  max_segments: number
  created_at: string
}

function toSceneClock(row: SceneClockRow): SceneClock {
  return {
    id: row.id,
    battleId: row.battle_id,
    name: row.name,
    currentSegments: row.current_segments,
    maxSegments: row.max_segments,
    createdAt: row.created_at,
  }
}

export async function performCombatantCheck(input: {
  combatantId: string
  attributeA: AttributeName
  attributeB: AttributeName
  bonus: number
  difficulty: number | null
  name: string | null
}) {
  const { data, error } = await supabase
    .rpc('perform_combatant_check', {
      p_combatant_id: input.combatantId,
      p_attribute_a: input.attributeA,
      p_attribute_b: input.attributeB,
      p_bonus: input.bonus,
      p_difficulty: input.difficulty,
      p_name: input.name,
    })
    .single()

  if (error) throw error

  const row = data as CombatantCheckRpcRow

  return {
    actionId: row.action_id,
    combatantId: row.combatant_id,
    combatantName: row.combatant_name,
    rollA: row.roll_a,
    rollB: row.roll_b,
    checkTotal: row.check_total,
    highRoll: row.high_roll,
    difficulty: row.difficulty,
    isSuccess: row.is_success,
    isCritical: row.is_critical,
    isFumble: row.is_fumble,
  } satisfies CombatantCheckResult
}

export async function adjustFabulaPoints(
  combatantId: string,
  delta: number,
) {
  const { data, error } = await supabase
    .rpc('adjust_combatant_fabula_points', {
      p_combatant_id: combatantId,
      p_delta: delta,
    })
    .single()

  if (error) throw error

  return data as {
    action_id: string | null
    combatant_id: string
    previous_value: number
    value: number
    applied_delta: number
  }
}

export async function listSceneClocks(
  battleId: string,
): Promise<SceneClock[]> {
  const { data, error } = await supabase
    .from('scene_clocks')
    .select(
      'id, battle_id, name, current_segments, max_segments, created_at',
    )
    .eq('battle_id', battleId)
    .order('created_at', { ascending: true })

  if (error) throw error

  return (data as SceneClockRow[]).map(toSceneClock)
}

export async function createSceneClock(
  battleId: string,
  name: string,
  maxSegments: number,
) {
  const { error } = await supabase
    .rpc('create_scene_clock', {
      p_battle_id: battleId,
      p_name: name,
      p_max_segments: maxSegments,
    })
    .single()

  if (error) throw error
}

export async function adjustSceneClock(
  clockId: string,
  delta: number,
) {
  const { error } = await supabase
    .rpc('adjust_scene_clock', {
      p_clock_id: clockId,
      p_delta: delta,
    })
    .single()

  if (error) throw error
}

export async function deleteSceneClock(clockId: string) {
  const { error } = await supabase.rpc('delete_scene_clock', {
    p_clock_id: clockId,
  })

  if (error) throw error
}

export function subscribeToSceneClocks(
  battleId: string,
  onChange: (clocks: SceneClock[]) => void,
) {
  const refresh = () => {
    void listSceneClocks(battleId).then(onChange)
  }

  const channel = supabase
    .channel(`scene-clocks-${battleId}`)
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'scene_clocks',
      },
      refresh,
    )
    .subscribe()

  return () => {
    void supabase.removeChannel(channel)
  }
}
