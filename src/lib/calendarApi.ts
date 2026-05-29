import type { BusyRange } from '@/db/types'
import { supabase } from '@/lib/supabase'

/*
 * Client for the CalDAV proxy (ARCHITECTURE.md §7). Every call carries the
 * Supabase JWT and talks only to `VITE_CALDAV_PROXY_URL` — there is no
 * hardcoded fallback URL (per the chunk-13 brief).
 *
 * The app-specific password leaves the client ONLY as an HTTPS body to
 * test/save-credentials; it is never persisted client-side (it's not even in
 * the `Settings` type — see db/types.ts).
 *
 * Error model mirrors `lib/ai.ts`'s `AiError`: one typed `CalendarError` whose
 * `kind` drives UI behavior. The load-bearing one is `'auth_failed'` — the
 * proxy returns it (and flips `caldav_status` server-side) when the stored
 * iCloud credentials stop working, which is what surfaces the reconnect banner.
 */

const PROXY_URL = import.meta.env.VITE_CALDAV_PROXY_URL as string | undefined

const VERIFIED_AT_KEY = 'caldav:lastVerifiedAt'

export type CalendarErrorKind =
  | 'auth_failed' // stored iCloud creds rejected; proxy set caldav_status='auth_failed' → reconnect
  | 'bad_credentials' // creds entered in the Test step failed the proxy's pre-save check
  | 'signed_out' // Supabase JWT missing/rejected → re-auth (NOT an iCloud failure)
  | 'not_configured' // proxy has no saved credentials (412), or the proxy URL is unset
  | 'network' // transport failure, 5xx, or 502 upstream CalDAV error
  | 'bad_response' // non-JSON / unexpected response shape

const DEFAULT_MESSAGES: Record<CalendarErrorKind, string> = {
  auth_failed: 'Apple Calendar disconnected — reconnect in Settings.',
  bad_credentials:
    'Could not connect — check your Apple ID and app-specific password.',
  signed_out: 'Your session expired — sign in again.',
  not_configured: 'Apple Calendar is not set up yet.',
  network: 'Could not reach the calendar service — retry.',
  bad_response: 'Unexpected response from the calendar service.',
}

export class CalendarError extends Error {
  readonly kind: CalendarErrorKind
  constructor(kind: CalendarErrorKind, message?: string) {
    super(message ?? DEFAULT_MESSAGES[kind])
    this.name = 'CalendarError'
    this.kind = kind
  }
}

/**
 * True when an error means the stored iCloud credentials stopped working. The
 * proxy has already written `caldav_status='auth_failed'`, so the UI should
 * refetch settings (never set the status optimistically) and show the
 * reconnect banner (ARCH §7, resolution 4).
 */
export function isAuthFailed(err: unknown): boolean {
  return err instanceof CalendarError && err.kind === 'auth_failed'
}

/**
 * True when an error means our Supabase JWT was missing or rejected — a
 * sign-out / stale-token concern, distinct from an iCloud `auth_failed`. The
 * caller should attempt a session refresh (see `lib/session`) rather than
 * showing the reconnect banner.
 */
export function isSignedOut(err: unknown): boolean {
  return err instanceof CalendarError && err.kind === 'signed_out'
}

// ── verification timestamp (Settings "Connected · verified Xm ago") ──────
// Stored in localStorage and refreshed after every successful testCredentials
// or getBusy, per the chunk-13 prompt.

export function markVerified(at: number = Date.now()): void {
  try {
    localStorage.setItem(VERIFIED_AT_KEY, String(at))
  } catch {
    // localStorage unavailable (private mode) — the badge just won't render
    // the "verified Xm ago" suffix. Not worth surfacing.
  }
}

export function getVerifiedAt(): number | null {
  try {
    const raw = localStorage.getItem(VERIFIED_AT_KEY)
    if (!raw) return null
    const n = Number(raw)
    return Number.isFinite(n) ? n : null
  } catch {
    return null
  }
}

export function clearVerified(): void {
  try {
    localStorage.removeItem(VERIFIED_AT_KEY)
  } catch {
    // ignore
  }
}

// ── internals ────────────────────────────────────────────────────────────

async function authHeader(): Promise<string> {
  // Fetch the session per request: Supabase access tokens expire (~1h) and
  // refresh in the background, so caching the token at module load would make
  // calls start 401-ing after an hour for no apparent reason (resolution 3).
  const { data, error } = await supabase.auth.getSession()
  if (error || !data.session) {
    // A missing session means the user signed out mid-flight — an
    // auth-redirect concern, distinct from an iCloud `auth_failed`.
    throw new CalendarError('signed_out')
  }
  return `Bearer ${data.session.access_token}`
}

function endpoint(path: string): string {
  if (!PROXY_URL) {
    throw new CalendarError(
      'network',
      'VITE_CALDAV_PROXY_URL is not set — calendar features are unavailable.',
    )
  }
  return `${PROXY_URL.replace(/\/+$/, '')}${path}`
}

type Envelope = { ok?: boolean; error?: string; [k: string]: unknown }

async function callProxy(path: string, init: RequestInit): Promise<Envelope> {
  const url = endpoint(path) // throws CalendarError('network') if unconfigured
  const authorization = await authHeader() // throws CalendarError('signed_out')

  let res: Response
  try {
    res = await fetch(url, {
      ...init,
      headers: { ...(init.headers ?? {}), Authorization: authorization },
    })
  } catch {
    throw new CalendarError('network')
  }

  let body: Envelope | null
  try {
    body = (await res.json()) as Envelope
  } catch {
    body = null
  }

  if (res.ok && body?.ok) return body

  const code = body && typeof body.error === 'string' ? body.error : 'unknown'

  if (res.status === 401) {
    // busy/events → 'auth_failed' (iCloud creds dead, status flipped server-side);
    // test-credentials → 'auth' (creds just entered are wrong, status untouched);
    // anything else (e.g. 'unauthorized') → our Supabase JWT was rejected.
    if (code === 'auth_failed') throw new CalendarError('auth_failed')
    if (code === 'auth') throw new CalendarError('bad_credentials')
    throw new CalendarError('signed_out')
  }
  if (res.status === 412 || code === 'no_credentials') {
    throw new CalendarError('not_configured')
  }
  throw new CalendarError(
    'network',
    body
      ? `Calendar request failed (${res.status}: ${code}).`
      : `Calendar request failed (${res.status}).`,
  )
}

// ── public API ─────────────────────────────────────────────────────────

export type DiscoveredCalendar = { url: string; name: string }

/** Run CalDAV discovery against the entered credentials and return the user's
 *  calendars. Does NOT persist anything (proxy pre-save check). */
export async function testCredentials(args: {
  appleId: string
  appPassword: string
}): Promise<{ calendars: DiscoveredCalendar[] }> {
  const body = await callProxy('/api/calendar/test-credentials', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      apple_id: args.appleId,
      app_password: args.appPassword,
    }),
  })
  markVerified()
  return {
    calendars: Array.isArray(body.calendars)
      ? (body.calendars as DiscoveredCalendar[])
      : [],
  }
}

/** Persist credentials: the proxy AES-GCM-encrypts the password, writes the
 *  three caldav columns, and sets `caldav_status='ok'` server-side. */
export async function saveCredentials(args: {
  appleId: string
  appPassword: string
  calendarUrl: string
}): Promise<void> {
  await callProxy('/api/calendar/save-credentials', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      apple_id: args.appleId,
      app_password: args.appPassword,
      calendar_url: args.calendarUrl,
    }),
  })
}

/** Busy intervals between two ISO instants for the saved calendar. */
export async function getBusy(args: {
  from: string
  to: string
}): Promise<BusyRange[]> {
  const qs = new URLSearchParams({ from: args.from, to: args.to }).toString()
  const body = await callProxy(`/api/calendar/busy?${qs}`, { method: 'GET' })
  markVerified()
  return Array.isArray(body.busy) ? (body.busy as BusyRange[]) : []
}

/** Create a VEVENT on the saved calendar; returns the generated UID. */
export async function createEvent(args: {
  title: string
  start: string
  end: string
  description?: string
}): Promise<{ uid: string }> {
  const body = await callProxy('/api/calendar/events', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title: args.title,
      start: args.start,
      end: args.end,
      description: args.description,
    }),
  })
  return { uid: typeof body.uid === 'string' ? body.uid : '' }
}
