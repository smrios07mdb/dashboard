import { useEffect } from 'react'

import { startRealtime, stopRealtime } from '@/db/realtime'
import { useSession } from '@/lib/auth'

/**
 * Bridges the existing auth session (chunk 3) to the realtime
 * lifecycle (chunk 5). Renders nothing.
 *
 * Reuses `useSession()` instead of attaching a second
 * onAuthStateChange listener — Supabase's client multiplexes those
 * internally but the architectural intent is "one listener of record."
 */
export default function RealtimeBridge() {
  const { user } = useSession()
  const userId = user?.id ?? null

  useEffect(() => {
    if (!userId) {
      stopRealtime()
      return
    }
    startRealtime(userId)
    return () => stopRealtime()
  }, [userId])

  return null
}
