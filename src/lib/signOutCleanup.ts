import { toast } from 'sonner'

import { db } from '@/db/dexie'
import { wipeLocalCache } from '@/db/localCache'
import { clearVerified } from '@/lib/calendarApi'
import { supabase } from '@/lib/supabase'

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
 */
export function installSignOutCleanup(): () => void {
  const { data } = supabase.auth.onAuthStateChange((event) => {
    if (event !== 'SIGNED_OUT') return
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
