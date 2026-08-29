/*
 * Week Planner scheduling math (chunk 37).
 *
 * Pure functions only — the sibling of `plannerGeometry.ts` (untouched)
 * for everything the scheduling chunk adds: scheduled-block ↔ grid
 * mapping, slot finding, overlap, pointer→slot hit-testing, tray split.
 * Ported from the handoff prototype's `planner-primitives.jsx`
 * (`findOpenSlots`, `dayOcc`, `overlapBusy`, `snap15`) and
 * `WeekPlannerDesktop.jsx` (`posFromEvent`).
 *
 * All day/time math is browser-local (chunk-36 D6 / chunk-37 D3):
 * instants → local `day/startMin/endMin`, and placement converts local
 * `(weekStart, day, minute)` back to an instant with the local Date
 * constructor. `settings.timezone` is never consulted here.
 */

import type { ScheduledBlock, Task } from '@/db/types'
import {
  addDays,
  ceil15,
  minutesOfDay,
  type WeekBusyBlock,
} from '@/lib/plannerGeometry'

/** A scheduled block placed on the week grid, in local wall-clock minutes. */
export type WeekScheduledBlock = {
  id: string
  taskId: string
  /** 0=Mon … 6=Sun within the displayed week. */
  day: number
  startMin: number
  endMin: number
  done: boolean
}

/** Any interval on a week-day index (busy or scheduled). */
export type DayInterval = { day: number; startMin: number; endMin: number }

// ── snapping / durations ─────────────────────────────────────────────────

/** Round to the nearest 15-minute boundary (drag/drop snap). */
export function snap15(minutes: number): number {
  return Math.round(minutes / 15) * 15
}

/**
 * Block length when a task is placed (D4): the estimate rounded up to 15m
 * (min 15), or 30m when the task has no estimate (`estimate_minutes = 0`
 * is the schema default — real data hits it constantly).
 */
export function blockDurationMin(estimateMinutes: number): number {
  return estimateMinutes > 0 ? Math.max(15, ceil15(estimateMinutes)) : 30
}

/** Minimum block length a resize can reach. */
export const MIN_BLOCK_MIN = 15

// ── instant ↔ grid mapping ───────────────────────────────────────────────

/**
 * Map scheduled blocks onto the week starting at `start`, splitting blocks
 * that cross local midnight into per-day segments (same behavior as
 * `busyToWeekBlocks`). Invalid or non-overlapping ranges drop out.
 */
export function scheduledToWeekBlocks(
  blocks: ScheduledBlock[],
  start: Date,
): WeekScheduledBlock[] {
  const out: WeekScheduledBlock[] = []
  const dayStarts = Array.from({ length: 8 }, (_, i) => addDays(start, i))
  for (const b of blocks) {
    const s = new Date(b.startAt)
    const e = new Date(b.endAt)
    if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime())) continue
    if (e.getTime() <= s.getTime()) continue
    for (let i = 0; i < 7; i++) {
      const dayStart = dayStarts[i]
      const dayEnd = dayStarts[i + 1]
      const os = Math.max(s.getTime(), dayStart.getTime())
      const oe = Math.min(e.getTime(), dayEnd.getTime())
      if (oe <= os) continue
      const startMin = os === dayStart.getTime() ? 0 : minutesOfDay(new Date(os))
      const endMin = oe === dayEnd.getTime() ? 24 * 60 : minutesOfDay(new Date(oe))
      if (endMin <= startMin) continue
      out.push({
        id: b.id,
        taskId: b.taskId,
        day: i,
        startMin,
        endMin,
        done: b.done,
      })
    }
  }
  return out
}

/** Local `(weekStart, day, minute)` → ISO instant (D3). */
export function toInstant(weekStart: Date, day: number, minute: number): string {
  return new Date(
    weekStart.getFullYear(),
    weekStart.getMonth(),
    weekStart.getDate() + day,
    0,
    minute,
  ).toISOString()
}

// ── slot finding (Schedule sheet) ────────────────────────────────────────

/** Merged occupied ranges for a day, sorted by start (prototype `dayOcc`). */
function dayOcc(
  day: number,
  busy: DayInterval[],
  scheduled: DayInterval[],
): Array<[number, number]> {
  return [...busy, ...scheduled]
    .filter((o) => o.day === day)
    .map((o): [number, number] => [o.startMin, o.endMin])
    .sort((a, b) => a[0] - b[0])
}

export type OpenSlot = { startMin: number; endMin: number; until: number }

/** Sheet slot window: 08:00–20:00 (prototype). */
const SLOT_START = 8 * 60
const SLOT_END = 20 * 60

/**
 * Up to 3 open slots of `dur` minutes on `day`, around busy + already
 * scheduled ranges, inside 08:00–20:00. Today starts at `ceil15(now + 10)`.
 * Exact port of the prototype's `findOpenSlots`, including the
 * `max(dur, 60) + 60` stride between trailing slots.
 */
export function findOpenSlots(
  day: number,
  dur: number,
  busy: DayInterval[],
  scheduled: DayInterval[],
  isToday: boolean,
  nowMin: number,
): OpenSlot[] {
  const occ = dayOcc(day, busy, scheduled)
  let cur = isToday ? Math.max(SLOT_START, ceil15(nowMin + 10)) : SLOT_START
  cur = ceil15(cur)
  const out: OpenSlot[] = []
  for (const [s, e] of occ) {
    if (s - cur >= dur && out.length < 3) {
      out.push({ startMin: cur, endMin: cur + dur, until: s })
    }
    cur = ceil15(Math.max(cur, e))
  }
  while (out.length < 3 && cur + dur <= SLOT_END) {
    out.push({ startMin: cur, endMin: cur + dur, until: SLOT_END })
    cur += Math.max(dur, 60) + 60
  }
  return out.slice(0, 3)
}

// ── overlap (advisory, never blocking — D8) ──────────────────────────────

export type BusyOverlap = { title: string | null; mins: number }

/**
 * Largest busy overlap for a candidate range on `day`, or null. `title` is
 * null when the winning busy block carries none (the preview then says
 * `CONFLICTS WITH BUSY`).
 */
export function overlapBusy(
  day: number,
  startMin: number,
  endMin: number,
  busy: WeekBusyBlock[],
): BusyOverlap | null {
  let best: BusyOverlap | null = null
  for (const b of busy) {
    if (b.day !== day) continue
    const m = Math.max(0, Math.min(endMin, b.endMin) - Math.max(startMin, b.startMin))
    if (m > 0 && (!best || m > best.mins)) {
      best = { title: b.title?.trim() ? b.title : null, mins: m }
    }
  }
  return best
}

// ── pointer → slot hit-testing (desktop grid) ────────────────────────────

/** Column width units: five weekdays at 1, half-width weekends at .55. */
export const COLUMN_UNITS = [1, 1, 1, 1, 1, 0.55, 0.55] as const
const UNITS_TOTAL = COLUMN_UNITS.reduce((a, b) => a + b, 0)

export type GridPoint = {
  /** Pointer position relative to the grid element's top-left. */
  x: number
  y: number
  /** Grid element width (px). */
  width: number
  gutter: number
  hourH: number
  /** Visible window bounds (minutes). */
  h0: number
  h1: number
}

/**
 * Exact port of the prototype's `posFromEvent`: null when the pointer is
 * left of the gutter, more than 40px right of the grid, or more than 20px
 * above/below it; otherwise the day column (weekday/weekend unit widths)
 * and the 15m-snapped minute, clamped to the visible window.
 */
export function gridPointToSlot(p: GridPoint): { day: number; minute: number } | null {
  const gridH = ((p.h1 - p.h0) / 60) * p.hourH
  if (p.x < p.gutter || p.x > p.width + 40 || p.y < -20 || p.y > gridH + 20) {
    return null
  }
  const unit = (p.width - p.gutter) / UNITS_TOTAL
  let acc = 0
  let day = 6
  for (let i = 0; i < 7; i++) {
    const cw = unit * COLUMN_UNITS[i]
    if (p.x - p.gutter < acc + cw) {
      day = i
      break
    }
    acc += cw
  }
  const minute =
    p.h0 + snap15((Math.max(0, Math.min(p.y, gridH)) / p.hourH) * 60)
  return { day, minute }
}

// ── tray ─────────────────────────────────────────────────────────────────

/** Open tasks that have no scheduled block (the tray, D5). */
export function splitTray(tasks: Task[], blocks: ScheduledBlock[]): Task[] {
  const blocked = new Set(blocks.map((b) => b.taskId))
  return tasks.filter((t) => !t.completedAt && !blocked.has(t.id))
}
