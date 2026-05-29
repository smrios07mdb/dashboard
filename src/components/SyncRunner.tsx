import { useEffect } from 'react'

import { useSession } from '@/lib/auth'
import { startSyncRunner } from '@/lib/syncRunner'

/**
 * Headless. Starts the outbox replay runner once a user is authed and stops it
 * on sign-out / unmount. Mounted at the app root beside <InAppReminders/> and
 * gated on the session the same way (chunk 3 auth → chunk 15 replay).
 *
 * The runner drains the Dexie outbox on load / window.online / auth-refresh /
 * a 60s safety net (ARCHITECTURE.md §6). It's a second auth-scoped 60s interval
 * alongside chunk 14's reminder poller — independent, and each cleared by its
 * own owner on sign-out.
 */
export default function SyncRunner() {
  const { user } = useSession()
  const userId = user?.id ?? null

  useEffect(() => {
    if (!userId) return
    const runner = startSyncRunner()
    return () => runner.stop()
  }, [userId])

  return null
}
