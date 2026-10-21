/*
 * Sort General on demand (chunk 90, ARCHITECTURE.md §10 "General sorting").
 * Loaded on the button's first tap, so none of this is eager. One call to the
 * proxy's `POST /api/ai/sort`, which asks Claude (the user's saved Anthropic
 * key) and writes pending proposals; the app then reviews them in the
 * chunk-89 SortingSheet. Errors reuse the triage copy (`AiError`).
 */
import { toast } from 'sonner'
import { repo } from '@/db/repo'
import { AiError, type AiErrorKind } from '@/lib/ai'
import type { RoutingProposal } from '@/lib/sorting'
import { supabase } from '@/lib/supabase'

const PROXY_URL = import.meta.env.VITE_CALDAV_PROXY_URL as string | undefined
const SESSION_EXPIRED = 'Your session expired — sign in again.'

type SortReply = { ok?: boolean; error?: string; proposed: number; kept: number; remaining: number }

/**
 * `POST /api/ai/sort` with the session's JWT, mapped like triage
 * (`callAiProxy` in lib/ai): 401 → session expired, 412 → missing-key,
 * 422 → auth, 502 `malformed` → malformed, 502 `truncated` → truncated,
 * other 5xx / reject → network.
 * Kept here, not in the eager lib/ai, for the chunk-90 eager budget.
 */
async function postSort(): Promise<SortReply> {
  if (!PROXY_URL) throw new AiError('network')
  const { data, error } = await supabase.auth.getSession()
  if (error || !data?.session) throw new AiError('network', SESSION_EXPIRED)
  let res: Response
  try {
    res = await fetch(`${PROXY_URL.replace(/\/+$/, '')}/api/ai/sort`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${data.session.access_token}` },
    })
  } catch {
    throw new AiError('network')
  }
  if (res.status === 401) throw new AiError('network', SESSION_EXPIRED)
  const body = (await res.json().catch(() => null)) as SortReply | null
  const kind: AiErrorKind | null =
    res.status === 412
      ? 'missing-key'
      : res.status === 422
        ? 'auth'
        : res.status >= 500
          ? body?.error === 'malformed'
            ? 'malformed'
            : body?.error === 'truncated'
              ? 'truncated'
              : 'network'
          : body?.ok !== true
            ? 'malformed'
            : null
  if (kind) throw new AiError(kind)
  return body!
}

/** The toast after the sheet closes, when this press left tasks unsorted. */
export function remainingToast(n: number): void {
  if (n > 0) toast(`${n} more in General — tap Sort General again`)
}

/**
 * Run one press. Returns the fresh pending proposals and `done`, which the
 * caller runs when the sheet closes (Approve or Not now) to report what is
 * still unsorted — or null when there is nothing to review, in which case it
 * has already toasted why. Never rejects. `navigate` backs the toast's
 * Settings link for a missing or rejected key.
 */
export async function runSort(
  navigate: (to: string) => void,
): Promise<{ rows: RoutingProposal[]; done: () => void } | null> {
  try {
    const r = await postSort()
    if (r.proposed + r.kept === 0) {
      toast('Nothing to sort')
      return null
    }
    const rows = await repo.routing.pending()
    let left = r.remaining
    // Once-only: re-opening the sheet from the count chip does not repeat it.
    return {
      rows,
      done: () => {
        remainingToast(left)
        left = 0
      },
    }
  } catch (e) {
    const err = e instanceof AiError ? e : new AiError('network')
    const link = err.kind === 'missing-key' || err.kind === 'auth'
    toast.error(
      err.message,
      link
        ? { action: { label: 'Settings', onClick: () => navigate('/settings') } }
        : undefined,
    )
    return null
  }
}
