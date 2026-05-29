/*
 * Sync runner (chunk 15 — ARCHITECTURE.md §6).
 *
 * Triggers `drainOutbox()` on the four occasions the outbox should be replayed:
 *   (a) app load (after auth),
 *   (b) the browser `online` event,
 *   (c) a successful Supabase auth refresh (TOKEN_REFRESHED / SIGNED_IN),
 *   (d) a 60s safety-net interval — but only when the outbox is non-empty.
 *
 * Idempotency lives in `drainOutbox()` itself (a shared in-flight promise), so
 * overlapping triggers can never double-apply a row. This runner is mounted by
 * the auth-gated headless <SyncRunner/> component and torn down on sign-out —
 * mirroring chunk-14's <InAppReminders/>. The two 60s intervals (reminders +
 * sync) are independent; both are auth-scoped and cleared by their owners.
 */
import { db } from '@/db/dexie'
import { drainOutbox } from '@/db/outbox'
import { supabase } from '@/lib/supabase'

export type SyncRunner = { stop: () => void }

const DEFAULT_INTERVAL_MS = 60_000

export function startSyncRunner(opts?: { intervalMs?: number }): SyncRunner {
  const intervalMs = opts?.intervalMs ?? DEFAULT_INTERVAL_MS
  let stopped = false

  const trigger = () => {
    if (!stopped) void drainOutbox()
  }

  const onOnline = () => trigger()
  if (typeof window !== 'undefined') {
    window.addEventListener('online', onOnline)
  }

  // Cheap 60s safety net — only spends a drain when there's queued work.
  const timer = setInterval(() => {
    if (stopped) return
    void db.outbox.count().then((n) => {
      if (n > 0) trigger()
    })
  }, intervalMs)

  // A successful token refresh re-establishes a valid session — replay anything
  // that failed while it was stale. SIGNED_OUT is ignored (the component tears
  // the whole runner down on sign-out).
  const { data: authSub } = supabase.auth.onAuthStateChange((event) => {
    if (event === 'TOKEN_REFRESHED' || event === 'SIGNED_IN') trigger()
  })

  // App-load trigger.
  trigger()

  return {
    stop() {
      stopped = true
      if (typeof window !== 'undefined') {
        window.removeEventListener('online', onOnline)
      }
      clearInterval(timer)
      authSub.subscription.unsubscribe()
    },
  }
}
