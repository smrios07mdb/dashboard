import { isSignedOut } from '@/lib/calendarApi'
import { supabase } from '@/lib/supabase'

/*
 * Recovery for a `signed_out` calendar error (resolution 3, source #2): the
 * proxy rejected our Supabase JWT while the local session still *looks* valid
 * (the common ~1h stale-access-token case). There is no `/login` route — the
 * login gate is the reactive <Protected> guard (`!session → <Login/>`), so the
 * fix is to make the session state reflect reality, not to navigate.
 */

export type RecoverOutcome = 'recovered' | 'signed-out'

// De-dupe concurrent recoveries: if BusyStrip and BlockTimeSheet both 401 at
// once, they await the same refresh rather than firing several. Cleared once
// settled so a later, genuine refresh (e.g. the next 5-min cadence) can run.
let inFlight: Promise<RecoverOutcome> | null = null

/**
 * Refresh the Supabase session exactly once.
 * - `'recovered'`: a valid session was obtained — the caller may retry.
 * - `'signed-out'`: refresh failed or returned no session. The now-null session
 *   propagates via `onAuthStateChange`, so `<Protected>` renders `<Login/>`.
 *   No manual navigation.
 */
async function attemptRefresh(): Promise<RecoverOutcome> {
  try {
    const { data, error } = await supabase.auth.refreshSession()
    return error || !data?.session ? 'signed-out' : 'recovered'
  } catch {
    return 'signed-out'
  }
}

export function recoverSignedOut(): Promise<RecoverOutcome> {
  if (inFlight) return inFlight
  const p = attemptRefresh()
  inFlight = p
  void p.finally(() => {
    if (inFlight === p) inFlight = null
  })
  return p
}

/**
 * Run `action`; if it fails with a `signed_out` CalendarError, refresh the
 * session once (deduped) and retry `action` exactly once. A failed refresh, or
 * a second `signed_out`, propagates so the caller's normal error handling runs
 * and the auth guard can take over. Never refreshes more than once per call —
 * the retry's result (success or any error) is returned/thrown as-is.
 */
export async function withSessionRetry<T>(action: () => Promise<T>): Promise<T> {
  try {
    return await action()
  } catch (e) {
    if (!isSignedOut(e)) throw e
    const outcome = await recoverSignedOut()
    if (outcome !== 'recovered') throw e
    return action() // retry once; a 2nd signed_out throws out (no re-recovery)
  }
}
