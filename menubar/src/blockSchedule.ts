/*
 * A block group's schedule as epoch-ms windows (chunk 99, D17). Pure.
 *
 * For each local day from yesterday to today + 13 whose `getDay()` is in
 * `scheduleDays`: `[from, to]` on that day, `to` on the next day when it is
 * at or before `from` (past midnight belongs to its start day; `from == to`
 * is 24 hours). Windows already ended are dropped, overlapping ones merged.
 * The Mac's own clock decides (the meditation rule); DST is the platform's.
 * The shell takes these as they are and never sees a weekday or a time.
 */
import type { BlockGroup } from '@/db/types'

export type Window = [number, number]

type Schedule = Pick<
  BlockGroup,
  'blockOnSchedule' | 'scheduleDays' | 'scheduleFrom' | 'scheduleTo'
>

function hm(t: string): [number, number] {
  const [h = 0, m = 0] = t.split(':').map(Number)
  return [h, m]
}

export function windowsFor(group: Schedule, now: Date): Window[] {
  if (!group.blockOnSchedule) return []
  const days = new Set(group.scheduleDays)
  const [fh, fm] = hm(group.scheduleFrom)
  const [th, tm] = hm(group.scheduleTo)
  const sameDay = th * 60 + tm > fh * 60 + fm
  const y = now.getFullYear()
  const mo = now.getMonth()
  const d0 = now.getDate()
  const nowMs = now.getTime()

  const raw: Window[] = []
  for (let k = -1; k <= 13; k++) {
    const day = new Date(y, mo, d0 + k)
    if (!days.has(day.getDay())) continue
    const start = new Date(y, mo, d0 + k, fh, fm).getTime()
    const end = new Date(y, mo, d0 + k + (sameDay ? 0 : 1), th, tm).getTime()
    if (end <= nowMs || end <= start) continue
    raw.push([start, end])
  }

  raw.sort((a, b) => a[0] - b[0])
  const merged: Window[] = []
  for (const w of raw) {
    const last = merged[merged.length - 1]
    if (last && w[0] <= last[1]) last[1] = Math.max(last[1], w[1])
    else merged.push([w[0], w[1]])
  }
  return merged
}
