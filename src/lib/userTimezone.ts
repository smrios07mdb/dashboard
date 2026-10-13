import { repo } from '@/db/repo'
import { supabase } from '@/lib/supabase'

/*
 * The one resolver for "which zone do Insights and reminder entry use"
 * (chunk 61). `settings.timezone` when it can be read; the browser's zone
 * otherwise — so when settings are unreadable both surfaces behave exactly as
 * they did before this chunk. Routines and Dashboard keep their own
 * `'America/New_York'` default (lib/clock.ts) and do not use this.
 */

/** The device's IANA zone, or `'UTC'` when the runtime cannot say. */
export function browserTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  } catch {
    return 'UTC'
  }
}

/**
 * `settings.timezone` for the signed-in user. Reads the session from
 * `supabase.auth.getSession()` rather than `useSession()`, which has no user
 * on its first render (chunk 59a F1). `repo.settings.get` falls back to Dexie
 * offline, so this resolves from cache without a network. No session, a null
 * row, a blank `timezone`, or any throw → `browserTimezone()`. Never rejects.
 */
export async function loadUserTimezone(): Promise<string> {
  try {
    const { data } = await supabase.auth.getSession()
    const userId = data?.session?.user?.id
    if (!userId) return browserTimezone()
    const settings = await repo.settings.get(userId)
    const timezone = settings?.timezone?.trim()
    return timezone || browserTimezone()
  } catch {
    return browserTimezone()
  }
}
