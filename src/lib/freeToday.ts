/*
 * Free time left today (chunk 87, UX audit #9). Sizes Today's suggestions.
 *
 * The window is the Planner's working day, 09:00–18:00 in the Settings zone,
 * every day of the week: the Planner's Mon–Fri rule is about week capacity,
 * this is about today. Counting starts at now rounded up to 15 minutes, as the
 * Planner's `computeDayFree` does. Planner blocks are not subtracted: `/busy`
 * excludes `hupo-block-` events and the Dashboard loads no blocks.
 *
 * Pure: `now` is injected.
 */
import { formatInTimeZone } from 'date-fns-tz'

import type { BusyRange } from '@/db/types'
import { WORK_END_MIN, WORK_START_MIN } from '@/lib/workDay'
import { zonedWallToDate } from '@/lib/zonedTime'

const MIN_MS = 60_000
const QUARTER_MS = 15 * MIN_MS

/** Minutes since midnight → `HH:MM`, the wall-time form `zonedWallToDate` reads. */
const wall = (m: number): string =>
  `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`

/**
 * Merge overlapping/adjacent ranges into sorted [startMs, endMs] tuples.
 * Shared with `BusyStrip`'s formatter so the line and the figure agree.
 */
export function mergeRanges(ranges: BusyRange[]): Array<[number, number]> {
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

/** Whole minutes free between now (rounded up to 15 min) and 18:00 today. */
export function freeMinutesToday(
  ranges: BusyRange[],
  timezone: string,
  now: Date,
): number {
  const day = formatInTimeZone(now, timezone, 'yyyy-MM-dd')
  const windowStart = zonedWallToDate(`${day}T${wall(WORK_START_MIN)}`, timezone)
  const windowEnd = zonedWallToDate(`${day}T${wall(WORK_END_MIN)}`, timezone)
  if (!windowStart || !windowEnd) return 0

  // Every real zone offset is a multiple of 15 min, so rounding the instant
  // matches `ceil15` on wall minutes.
  const nowCeil = Math.ceil(now.getTime() / QUARTER_MS) * QUARTER_MS
  const start = Math.max(windowStart.getTime(), nowCeil)
  const end = windowEnd.getTime()
  if (end <= start) return 0

  let busy = 0
  for (const [s, e] of mergeRanges(ranges)) {
    const from = Math.max(s, start)
    const to = Math.min(e, end)
    if (to > from) busy += to - from
  }
  return Math.max(0, Math.floor((end - start - busy) / MIN_MS))
}
