import { useEffect, useState } from 'react'
import { formatInTimeZone } from 'date-fns-tz'

import { Skeleton } from '@/components/ui/skeleton'
import { repo } from '@/db/repo'
import type { BusyRange, CaldavStatus } from '@/db/types'
import { useSession } from '@/lib/auth'
import { isAuthFailed } from '@/lib/calendarApi'
import { getBusyDay } from '@/lib/busyCache'
import { today as clockToday } from '@/lib/clock'
import { withSessionRetry } from '@/lib/session'

/*
 * Today's busy times on the Dashboard (ARCHITECTURE.md §7, chunk-13 prompt).
 *
 * `useBusyToday` owns the fetch; the Dashboard calls it once and renders the
 * result (chunk 74):
 * - caldav_status 'unconfigured' → `hidden` (no nag).
 * - caldav_status 'auth_failed'  → `reconnect`; the Dashboard shows the
 *   ReconnectBanner.
 * - caldav_status 'ok'           → fetches today's busy ranges (cache-first,
 *   5-min TTL) on mount, on window focus, and every 5 minutes. Day boundaries
 *   are computed in settings.timezone, never the browser's (resolution 6).
 *
 * `BusyInline` is the line in the Today header; `BusyStrip` is the standalone
 * card, used only on first run and with the Today list off.
 *
 * If a fetch comes back `auth_failed`, the proxy has already flipped
 * caldav_status server-side, so we refetch settings (never set it optimistically
 * — resolution 4) and swap to the banner.
 */

const REFRESH_MS = 5 * 60 * 1000

type Phase =
  | { status: 'loading' }
  | { status: 'ready'; ranges: BusyRange[] }
  | { status: 'error' }

export type BusyToday =
  | { kind: 'hidden' } // settings not loaded yet, or unconfigured
  | { kind: 'reconnect' } // caldav_status auth_failed
  | { kind: 'loading' }
  | { kind: 'ready'; text: string } // formatBusyRanges(...), '' when there are no ranges
  | { kind: 'error' }

// eslint-disable-next-line react-refresh/only-export-components -- the fetch stays beside its two views (chunk 74)
export function useBusyToday(): BusyToday {
  const { user } = useSession()
  const userId = user?.id ?? null

  const [caldavStatus, setCaldavStatus] = useState<CaldavStatus | null>(null)
  const [timezone, setTimezone] = useState<string | null>(null)
  const [phase, setPhase] = useState<Phase>({ status: 'loading' })

  // Load the calendar config (status + timezone). Re-runs on sign-in.
  useEffect(() => {
    if (!userId) return
    let cancelled = false
    repo.settings
      .get(userId)
      .then((settings) => {
        if (cancelled) return
        setCaldavStatus(settings?.caldavStatus ?? 'unconfigured')
        setTimezone(settings?.timezone ?? 'America/New_York')
      })
      .catch((e) => {
        console.error('BusyStrip: load settings failed', e)
        if (!cancelled) setCaldavStatus('unconfigured')
      })
    return () => {
      cancelled = true
    }
  }, [userId])

  // Fetch busy ranges while connected: on mount, on focus, every 5 minutes.
  useEffect(() => {
    if (caldavStatus !== 'ok' || !timezone || !userId) return
    let cancelled = false

    const load = async () => {
      try {
        // withSessionRetry refreshes the Supabase JWT once and retries if the
        // proxy rejects a stale token (signed_out, resolution 3 source #2).
        const ranges = await withSessionRetry(() =>
          getBusyDay(clockToday(timezone), timezone),
        )
        if (!cancelled) setPhase({ status: 'ready', ranges })
      } catch (e) {
        if (cancelled) return
        if (isAuthFailed(e)) {
          // Proxy already wrote caldav_status='auth_failed'; reflect the
          // server's value rather than guessing (resolution 4).
          const fresh = await repo.settings.get(userId).catch(() => null)
          if (!cancelled) setCaldavStatus(fresh?.caldavStatus ?? 'auth_failed')
        } else {
          // Includes a signed_out that survived a refresh attempt: the now-null
          // session drives <Protected> to <Login/>; this error phase is the
          // transient fallback until that swap happens.
          console.error('BusyStrip: load busy failed', e)
          setPhase({ status: 'error' })
        }
      }
    }

    void load()
    const onFocus = () => void load()
    window.addEventListener('focus', onFocus)
    const id = window.setInterval(() => void load(), REFRESH_MS)
    return () => {
      cancelled = true
      window.removeEventListener('focus', onFocus)
      window.clearInterval(id)
    }
  }, [caldavStatus, timezone, userId])

  // Hidden until settings load, and for the unconfigured case.
  if (caldavStatus === null || caldavStatus === 'unconfigured') {
    return { kind: 'hidden' }
  }
  if (caldavStatus === 'auth_failed') return { kind: 'reconnect' }
  if (phase.status === 'loading') return { kind: 'loading' }
  if (phase.status === 'error') return { kind: 'error' }
  return {
    kind: 'ready',
    text: formatBusyRanges(phase.ranges, timezone ?? 'America/New_York'),
  }
}

/** The standalone card: first run, and with the Today list off. */
export default function BusyStrip({ busy }: { busy: BusyToday }) {
  if (busy.kind === 'hidden' || busy.kind === 'reconnect') return null
  return (
    <div className="mb-6 flex flex-wrap items-center gap-2 rounded-md border border-border bg-card px-4 py-3">
      <span className="label">Busy</span>
      {busy.kind === 'loading' && <Skeleton className="h-4 w-44" />}
      {busy.kind === 'ready' && (
        <span className="font-mono text-[13px] text-muted-foreground">
          {busy.text || 'No busy times today'}
        </span>
      )}
      {busy.kind === 'error' && (
        <span className="text-[13px] text-muted-foreground">
          Couldn’t load busy times — retry on next refresh.
        </span>
      )}
    </div>
  )
}

/** One line for the Today header (chunk 74). */
export function BusyInline({ busy }: { busy: BusyToday }) {
  if (busy.kind === 'hidden' || busy.kind === 'reconnect') return null
  if (busy.kind === 'loading') return <Skeleton className="h-3 w-24" />
  return (
    <span className="whitespace-nowrap font-mono text-[12px] text-ink-3">
      {busy.kind === 'error'
        ? 'Busy times unavailable'
        : busy.text
          ? `Busy ${busy.text}`
          : 'No busy times'}
    </span>
  )
}

// ── pure formatting helpers ──────────────────────────────────────────────

/** Merge overlapping/adjacent ranges into sorted [startMs, endMs] tuples. */
function mergeRanges(ranges: BusyRange[]): Array<[number, number]> {
  const parsed = ranges
    .map((r) => [Date.parse(r.start), Date.parse(r.end)] as [number, number])
    .filter(([s, e]) => Number.isFinite(s) && Number.isFinite(e) && e > s)
    .sort((a, b) => a[0] - b[0])
  const merged: Array<[number, number]> = []
  for (const [s, e] of parsed) {
    const last = merged[merged.length - 1]
    if (last && s <= last[1]) last[1] = Math.max(last[1], e)
    else merged.push([s, e])
  }
  return merged
}

/** "9–11, 14–15" — 24h local time, dropping :00 minutes, en-dash separated. */
function formatBusyRanges(ranges: BusyRange[], timezone: string): string {
  const fmt = (ms: number): string => {
    const hm = formatInTimeZone(new Date(ms), timezone, 'H:mm')
    return hm.endsWith(':00') ? hm.slice(0, -3) : hm
  }
  return mergeRanges(ranges)
    .map(([s, e]) => `${fmt(s)}–${fmt(e)}`)
    .join(', ')
}
