import { supabase } from './supabase'
import type { PlayerIdentity, PlayerRole } from './battleRepository'

type PresencePayload = {
  userId: string
  displayName: string
  role: PlayerRole
  onlineAt: string
}

export type OnlinePlayer = {
  userId: string
  displayName: string
  role: PlayerRole
}

function readOnlinePlayers(
  state: Record<string, PresencePayload[]>,
): OnlinePlayer[] {
  const unique = new Map<string, OnlinePlayer>()

  for (const presences of Object.values(state)) {
    for (const presence of presences) {
      unique.set(presence.userId, {
        userId: presence.userId,
        displayName: presence.displayName,
        role: presence.role,
      })
    }
  }

  return Array.from(unique.values()).sort((a, b) => {
    if (a.role !== b.role) return a.role === 'host' ? -1 : 1
    return a.displayName.localeCompare(b.displayName)
  })
}

export function subscribeToRoomPresence(
  roomId: string,
  player: PlayerIdentity & { displayName: string },
  onSync: (players: OnlinePlayer[]) => void,
) {
  const channel = supabase.channel(`presence-room-${roomId}`, {
    config: {
      presence: {
        key: player.userId,
      },
    },
  })

  const syncPresence = () => {
    const state = channel.presenceState() as unknown as Record<
      string,
      PresencePayload[]
    >
    onSync(readOnlinePlayers(state))
  }

  channel
    .on('presence', { event: 'sync' }, syncPresence)
    .on('presence', { event: 'join' }, syncPresence)
    .on('presence', { event: 'leave' }, syncPresence)
    .subscribe(async (status) => {
      if (status !== 'SUBSCRIBED') return

      await channel.track({
        userId: player.userId,
        displayName: player.displayName,
        role: player.role,
        onlineAt: new Date().toISOString(),
      })
    })

  return () => {
    void channel.untrack()
    void supabase.removeChannel(channel)
  }
}
