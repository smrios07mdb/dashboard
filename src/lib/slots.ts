import { formatInTimeZone, fromZonedTime } from 'date-fns-tz'

import type { BusyRange } from '@/db/types'

/*
 * Pure slot proposer for the "Block time" feature (ARCHITECTURE.md §8).
 *
 * No clock access, no I/O — `now` is injected so the function is fully
 * deterministic and unit-tested (slots.test.ts). The working-window math
 * runs in the user's `timezone` (resolution 6), never the browser's.
 *
 * Algorithm (§8):
 *   1. Working window 09:00–18:00 in `timezone`.
 *   2. 15-minute granularity.
 *   3. Earliest start = now + 15min buffer.
 *   4. Reject any candidate overlapping a busy range.
 *   5. Return the first 3 non-overlapping candidates within the next 24h.
 *      (Fewer than 3 → the caller renders "Limited availability".)
 */

export type ProposeSlotsArgs = {
  estimateMinutes: number
  busyRanges: BusyRange[]
  timezone: string
  /** Reference "now" — injected for determinism/testing. */
  now: Date
}

export type ProposedSlot = {
  start: string
  end: string
}

const WORK_START_HOUR = 9 // 09:00 local
const WORK_END_HOUR = 18 // 18:00 local
const STEP_MS = 15 * 60 * 1000 // 15-minute granularity
const BUFFER_MS = 15 * 60 * 1000 // now + 15min
const HORIZON_MS = 24 * 60 * 60 * 1000 // next 24h
const MAX_SLOTS = 3
const MS_PER_MIN = 60 * 1000

export function proposeSlots({
  estimateMinutes,
  busyRanges,
  timezone,
  now,
}: ProposeSlotsArgs): ProposedSlot[] {
  if (!Number.isFinite(estimateMinutes) || estimateMinutes <= 0) return []

  const durationMs = estimateMinutes * MS_PER_MIN
  const earliest = now.getTime() + BUFFER_MS
  const horizon = now.getTime() + HORIZON_MS

  // Pre-parse busy ranges to [startMs, endMs]; drop anything unparseable or
  // zero/negative length so a bad range can't silently swallow the day.
  const busy = busyRanges
    .map((r) => [Date.parse(r.start), Date.parse(r.end)] as const)
    .filter(([s, e]) => Number.isFinite(s) && Number.isFinite(e) && e > s)

  // Half-open overlap: a slot that *touches* a busy edge (slot.end ===
  // busy.start, or slot.start === busy.end) is allowed — back-to-back is fine.
  const overlapsBusy = (start: number, end: number): boolean =>
    busy.some(([bs, be]) => start < be && end > bs)

  const slots: ProposedSlot[] = []
  const todayKey = formatInTimeZone(now, timezone, 'yyyy-MM-dd')

  // The 24h horizon spans at most two local days: from any `now`, tomorrow's
  // 09:00 is the latest working-window start still within the next 24h.
  for (
    let dayOffset = 0;
    dayOffset <= 1 && slots.length < MAX_SLOTS;
    dayOffset++
  ) {
    const dateKey = addDays(todayKey, dayOffset)
    // Window bounds as absolute instants, anchored to the user's tz so the
    // 15-min grid lands on :00/:15/:30/:45 *local* even for :30/:45 offsets.
    const windowStart = fromZonedTime(
      `${dateKey}T${pad(WORK_START_HOUR)}:00:00`,
      timezone,
    ).getTime()
    const windowEnd = fromZonedTime(
      `${dateKey}T${pad(WORK_END_HOUR)}:00:00`,
      timezone,
    ).getTime()

    // Candidates step from the window start (a 15-min local boundary), so the
    // first one ≥ `earliest` is exactly "the next 15-min boundary after the
    // now+15min buffer" — no separate rounding needed.
    for (
      let start = windowStart;
      start + durationMs <= windowEnd && slots.length < MAX_SLOTS;
      start += STEP_MS
    ) {
      if (start < earliest) continue
      if (start > horizon) break
      const end = start + durationMs
      if (overlapsBusy(start, end)) continue
      slots.push({
        start: new Date(start).toISOString(),
        end: new Date(end).toISOString(),
      })
    }
  }

  return slots
}

// dateKey arithmetic is timezone-independent: adding one calendar day to
// "2026-05-28" yields "2026-05-29" in any zone. Step via UTC midnight.
function addDays(dateKey: string, days: number): string {
  const d = new Date(`${dateKey}T00:00:00.000Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

function pad(n: number): string {
  return String(n).padStart(2, '0')
}
