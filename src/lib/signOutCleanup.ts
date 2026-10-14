import type { AuthError } from '@supabase/supabase-js'
import { toast } from 'sonner'

import { db } from '@/db/dexie'
import { wipeLocalCache } from '@/db/localCache'
import { setOutboxUser } from '@/db/repo'
import { clearVerified } from '@/lib/calendarApi'
import { supabase } from '@/lib/supabase'
import { flushPendingDeletes, parkPendingDeletes } from '@/lib/taskUndo'

/*
 * Sign-out local-data hygiene (chunk 18 — AUTH-01 / PRIV-01 / PRIV-02).
 *
 * Before this chunk, sign-out cleared only the Supabase session — the Dexie
 * cache (task titles + notes, routine history, the cached settings row) stayed
 * on the device, readable by the next person on a shared/borrowed device. We
 * now wipe the cache mirror on SIGNED_OUT.
 *
 * `wipeLocalCache()` deliberately PRESERVES `db.outbox` (un-synced offline edits
 * must still drain), so we never silently drop queued writes — we keep them and
 * warn instead.
 */

/**
 * Clear the per-device cache mirror + the calendar "verified" flag on sign-out.
 * Returns the number of queued outbox writes that were preserved (0 when the
 * outbox was empty); `onPendingPreserved` fires only when that count is > 0.
 */
export async function clearLocalDataOnSignOut(opts?: {
  onPendingPreserved?: (count: number) => void
}): Promise<{ pendingPreserved: number }> {
  // Count BEFORE the wipe. wipeLocalCache preserves the outbox, so this is the
  // number of queued writes that survive sign-out.
  const pendingPreserved = await db.outbox.count()
  await wipeLocalCache()
  clearVerified()
  if (pendingPreserved > 0) opts?.onPendingPreserved?.(pendingPreserved)
  return { pendingPreserved }
}

/**
 * Install the single, app-wide SIGNED_OUT listener (wired once at startup in
 * main.tsx). Deliberately NOT attached inside `useSession` — that hook is
 * mounted by ~14 components, so the wipe (and toast) would fire once per mount.
 * A module-level listener also catches sign-outs the account-menu button can't:
 * token expiry and sign-out on another tab / device. Returns an unsubscribe.
 * Pending task deletes are parked first, synchronously (chunk 82): their
 * timers would otherwise commit with no session and match nothing under RLS.
 * Every event also records the signed-in user that offline writes are stamped
 * with (chunk 84), so the outbox replays each op only for its own user. An
 * event with no session other than SIGNED_OUT (INITIAL_SESSION offline with an
 * expired token) keeps the last-known user (chunk 85); only SIGNED_OUT clears it.
 */
export function installSignOutCleanup(): () => void {
  const { data } = supabase.auth.onAuthStateChange((event, session) => {
    if (session) setOutboxUser(session.user.id)
    if (event !== 'SIGNED_OUT') return
    setOutboxUser(undefined)
    parkPendingDeletes()
    void clearLocalDataOnSignOut({
      onPendingPreserved: (n) =>
        toast.warning(
          `Signed out with ${n} unsynced ${n === 1 ? 'change' : 'changes'} still queued. ` +
            'They’ll sync the next time you sign in on this device.',
        ),
    })
  })
  return () => data.subscription.unsubscribe()
}

/*
 * Sign out from the app's own buttons (chunk 81).
 *
 * A task deleted inside its undo window commits from `taskUndo`'s timer. If
 * the session ends first, that delete runs with no session, matches no rows
 * under RLS, and the task silently survives. So the account menu and Settings
 * commit pending deletes first and only then end the session.
 *
 * The wait is capped: a hung request must not trap the user signed in. On
 * timeout, a delete whose request is already in flight is not retried;
 * anything still waiting is parked by the `SIGNED_OUT` that follows (chunk 82)
 * and committed by `resumePendingDeletes` at the next signed-in start.
 */
export const SIGN_OUT_FLUSH_CAP_MS = 4000

export async function signOutUser(): Promise<{ error: AuthError | null }> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    await Promise.race([
      flushPendingDeletes(),
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, SIGN_OUT_FLUSH_CAP_MS)
      }),
    ])
  } catch {
    // `commit` already logs and toasts; a failed flush must not block sign-out.
  } finally {
    clearTimeout(timer)
  }
  const { error } = await supabase.auth.signOut()
  return { error }
}
