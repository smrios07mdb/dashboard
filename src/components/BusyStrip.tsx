import { useEffect, useState } from 'react'
import { formatInTimeZone } from 'date-fns-tz'

import ReconnectBanner from '@/components/ReconnectBanner'
import { Skeleton } from '@/components/ui/skeleton'
import { repo } from '@/db/repo'
import type { BusyRange, CaldavStatus } from '@/db/types'
import { useSession } from '@/lib/auth'
import { isAuthFailed } from '@/lib/calendarApi'
import { getBusyDay } from '@/lib/busyCache'
import { today as clockToday } from '@/lib/clock'
import { withSessionRetry } from '@/lib/session'

/*
 * Dashboard busy strip (ARCHITECTURE.md §7, chunk-13 prompt).
 *
 * - caldav_status 'unconfigured' → renders nothing (no nag).
 * - caldav_status 'auth_failed'  → renders the ReconnectBanner in its place.
 * - caldav_status 'ok'           → fetches today's busy ranges (cache-first,
 *   5-min TTL) on mount, on window focus, and every 5 minutes; shows a merged
 *   compact strip. Day boundaries are computed in settings.timezone, never the
 *   browser's (resolution 6).
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

export default function BusyStrip() {
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

  // Render nothing until settings load, and for the unconfigured case.
  if (caldavStatus === null || caldavStatus === 'unconfigured') return null
  if (caldavStatus === 'auth_failed') return <ReconnectBanner className="mb-6" />

  const tz = timezone ?? 'America/New_York'
  return (
    <div className="mb-6 flex flex-wrap items-center gap-2 rounded-md border border-border bg-card px-4 py-3">
      <span className="label">Busy</span>
      {phase.status === 'loading' && <Skeleton className="h-4 w-44" />}
      {phase.status === 'ready' && (
        <span className="font-mono text-[13px] text-muted-foreground">
          {phase.ranges.length > 0
            ? formatBusyRanges(phase.ranges, tz)
            : 'No busy times today'}
        </span>
      )}
      {phase.status === 'error' && (
        <span className="text-[13px] text-muted-foreground">
          Couldn’t load busy times — retry on next refresh.
        </span>
      )}
    </div>
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
