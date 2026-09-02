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
  | 'bad_feed' // Outlook ICS verification failed (422); message carries the specific reason

/**
 * Proxy 422 verification kinds → user-readable toasts (chunk 35). Only the
 * `POST /api/calendar/outlook` endpoint 422s, so the mapping is keyed by its
 * three documented error codes.
 */
const OUTLOOK_FEED_MESSAGES: Record<string, string> = {
  invalid_url: "That doesn't look like a valid https ICS link.",
  unreachable: "The feed didn't respond — check the link.",
  invalid_feed: "That URL isn't an iCalendar feed.",
}

const DEFAULT_MESSAGES: Record<CalendarErrorKind, string> = {
  auth_failed: 'Apple Calendar disconnected — reconnect in Settings.',
  bad_credentials:
    'Could not connect — check your Apple ID and app-specific password.',
  signed_out: 'Your session expired — sign in again.',
  not_configured: 'Apple Calendar is not set up yet.',
  network: 'Could not reach the calendar service — retry.',
  bad_response: 'Unexpected response from the calendar service.',
  bad_feed: "That feed couldn't be verified — check the link and retry.",
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
  if (res.status === 422) {
    // Outlook ICS verification failure — the code picks the message; an
    // unknown code falls back to the generic bad_feed default.
    throw new CalendarError('bad_feed', OUTLOOK_FEED_MESSAGES[code])
  }
  throw new CalendarError(
    'network',
    body
      ? `Calendar request failed (${res.status}: ${code}).`
      : `Calendar request failed (${res.status}).`,
  )
}

// ── public API ─────────────────────────────────────────────────────────

export type DiscoveredCalendar = {
  url: string
  name: string
  /** `#rrggbb` from iCloud's `calendar-color` (chunk 51b), when present. */
  color?: string
  /** A subscription (holidays, any webcal feed) — read-only upstream. */
  subscribed?: boolean
}

/** Keep only the documented fields of a discovered calendar (or drop it). */
function toDiscoveredCalendar(c: unknown): DiscoveredCalendar | null {
  if (typeof c !== 'object' || c === null) return null
  const { url, name, color, subscribed } = c as Record<string, unknown>
  if (typeof url !== 'string' || typeof name !== 'string') return null
  const out: DiscoveredCalendar = { url, name }
  if (typeof color === 'string' && /^#[0-9a-f]{6}$/i.test(color))
    out.color = color.toLowerCase()
  if (subscribed === true) out.subscribed = true
  return out
}

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

/**
 * List the account's event calendars using the STORED credentials (chunk 51,
 * `GET /api/calendar/calendars`) — the Planner's calendar picker uses this to
 * initialize and refresh the read set. `writeTargetUrl` is the current
 * `caldav_calendar_url` so the picker can tag the write-target row. Errors map
 * like `getBusy`: 412 → `not_configured`, 401 auth_failed → `auth_failed`.
 */
export async function listCalendars(): Promise<{
  calendars: DiscoveredCalendar[]
  writeTargetUrl: string | null
}> {
  const body = await callProxy('/api/calendar/calendars', { method: 'GET' })
  markVerified()
  return {
    calendars: Array.isArray(body.calendars)
      ? (body.calendars as unknown[])
          .map(toDiscoveredCalendar)
          .filter((c): c is DiscoveredCalendar => c !== null)
      : [],
    writeTargetUrl:
      typeof body.writeTargetUrl === 'string' ? body.writeTargetUrl : null,
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

/** One merged busy interval; `source` says which calendar it came from
 *  (chunk 35 — the proxy now merges iCloud CalDAV + the Outlook ICS feed). */
export interface BusySource extends BusyRange {
  source: 'icloud' | 'outlook'
  title?: string
  /** iCloud only (chunk 51): display name of the calendar it came from.
   *  Absent from a pre-chunk-51 proxy and on the legacy single-calendar read. */
  calendar?: string
  /** iCloud only (chunk 51b): that calendar's `#rrggbb` from the read set. */
  color?: string
}

/** Per-source health from the busy endpoint. `outlook.status === 'stale'`
 *  means cached data is being served because the feed stopped responding. */
export interface BusySources {
  icloud: {
    configured: boolean
    ok: boolean
    /** Per-calendar outcome of the read-set fan-out (chunk 51). Optional:
     *  a pre-chunk-51 proxy omits it. */
    calendars?: { url: string; name: string; ok: boolean }[]
  }
  outlook: {
    configured: boolean
    status: 'ok' | 'stale' | 'unconfigured'
    fetchedAt: string | null
    feedName: string | null
  }
}

/**
 * A planner-block mirror on the iCloud calendar (chunk 39). The proxy keeps
 * these out of `busy` (the planner already counts the block as scheduled)
 * and lists them here so the app can reconcile orphans and time drift.
 */
export interface PlannerEvent {
  uid: string
  start: string
  end: string
}

/**
 * An array of busy intervals (assignable to `BusyRange[]`, so pre-chunk-35
 * consumers like `busyCache` compile untouched) with the proxy's per-source
 * health attached as an optional `sources` property, and — chunk 39 — the
 * optional `plannerEvents` side channel. Both optional so plain-array
 * mocks, older callsites, and a pre-chunk-39 proxy stay valid.
 */
export type GetBusyResult = BusySource[] & {
  sources?: BusySources
  plannerEvents?: PlannerEvent[]
}

/** Merged busy intervals between two ISO instants, across both sources. */
export async function getBusy(args: {
  from: string
  to: string
}): Promise<GetBusyResult> {
  const qs = new URLSearchParams({ from: args.from, to: args.to }).toString()
  const body = await callProxy(`/api/calendar/busy?${qs}`, { method: 'GET' })
  markVerified()
  const result: GetBusyResult = Array.isArray(body.busy)
    ? (body.busy.slice() as GetBusyResult)
    : []
  if (body.sources && typeof body.sources === 'object') {
    result.sources = body.sources as BusySources
  }
  if (Array.isArray(body.plannerEvents)) {
    result.plannerEvents = body.plannerEvents.filter(
      (e): e is PlannerEvent =>
        typeof e === 'object' &&
        e !== null &&
        typeof (e as PlannerEvent).uid === 'string' &&
        typeof (e as PlannerEvent).start === 'string' &&
        typeof (e as PlannerEvent).end === 'string',
    )
  }
  return result
}

/**
 * Verify + persist the published Outlook ICS link. The proxy AES-GCM-encrypts
 * the URL and writes `outlook_status='ok'` / feed name / fetched-at
 * server-side — callers read those back via settings (never set them
 * optimistically). The URL itself is write-only: it leaves the client only as
 * this HTTPS body and is never read back (see db/types.ts).
 */
export async function saveOutlookFeed(args: {
  icsUrl: string
}): Promise<{ feedName: string | null; eventCount: number }> {
  const body = await callProxy('/api/calendar/outlook', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ icsUrl: args.icsUrl }),
  })
  return {
    feedName: typeof body.feedName === 'string' ? body.feedName : null,
    eventCount: typeof body.eventCount === 'number' ? body.eventCount : 0,
  }
}

/** Disconnect the Outlook feed (`{ icsUrl: null }` clears the stored URL and
 *  resets `outlook_status='unconfigured'` server-side). */
export async function disconnectOutlookFeed(): Promise<void> {
  await callProxy('/api/calendar/outlook', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ icsUrl: null }),
  })
}

/**
 * Create a VEVENT on the saved calendar; returns the generated UID.
 * `source: 'planner'` (chunk 39) makes the proxy tag the uid `hupo-block-…`
 * so `busy` excludes it; the Block Time sheet omits it and stays busy.
 */
export async function createEvent(args: {
  title: string
  start: string
  end: string
  description?: string
  source?: 'planner'
}): Promise<{ uid: string }> {
  const body = await callProxy('/api/calendar/events', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title: args.title,
      start: args.start,
      end: args.end,
      description: args.description,
      source: args.source,
    }),
  })
  return { uid: typeof body.uid === 'string' ? body.uid : '' }
}

/**
 * Rebuild the VEVENT at `uid` (chunk 39). The proxy rewrites the whole
 * object from these fields — all three of title/start/end are required.
 */
export async function updateEvent(args: {
  uid: string
  title: string
  start: string
  end: string
  description?: string
}): Promise<void> {
  await callProxy('/api/calendar/events', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      uid: args.uid,
      title: args.title,
      start: args.start,
      end: args.end,
      description: args.description,
    }),
  })
}

/**
 * Delete the VEVENT at `uid` (chunk 39). Idempotent: `missing: true` means
 * iCloud no longer had it — callers treat that as deleted.
 */
export async function deleteEvent(uid: string): Promise<{ missing: boolean }> {
  const qs = new URLSearchParams({ uid }).toString()
  const body = await callProxy(`/api/calendar/events?${qs}`, {
    method: 'DELETE',
  })
  return { missing: body.missing === true }
}
