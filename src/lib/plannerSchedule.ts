/*
 * Week Planner scheduling math (chunk 37).
 *
 * Pure functions only — the sibling of `plannerGeometry.ts` (untouched)
 * for everything the scheduling chunk adds: scheduled-block ↔ grid
 * mapping, slot finding, overlap, pointer→slot hit-testing, tray split.
 * Ported from the handoff prototype's `planner-primitives.jsx`
 * (`findOpenSlots`, `dayOcc`, `overlapBusy`, `snap15`, and — chunk 38 —
 * `isPastBlock`, `nextOpenSlot`, `autoFill`) and `WeekPlannerDesktop.jsx`
 * (`posFromEvent`).
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
  PLANNER,
  type WeekBusyBlock,
} from '@/lib/plannerGeometry'
import { compareTasks } from '@/lib/taskSort'

/** A scheduled block placed on the week grid, in local wall-clock minutes. */
export type WeekScheduledBlock = {
  id: string
  taskId: string
  /** 0=Mon … 6=Sun within the displayed week. */
  day: number
  startMin: number
  endMin: number
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

/**
 * Merged occupied ranges for a day, sorted by start (prototype `dayOcc`).
 * `extra` = proposals placed so far by `autoFill` (chunk 38) — they occupy
 * exactly like scheduled blocks for the candidates that follow.
 */
export function dayOcc(
  day: number,
  busy: DayInterval[],
  scheduled: DayInterval[],
  extra: DayInterval[] = [],
): Array<[number, number]> {
  return [...busy, ...scheduled, ...extra]
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

// ── carryover + fill (chunk 38) ──────────────────────────────────────────

/**
 * A block whose segment has already ended: an earlier day of the visible
 * week, or today with `endMin <= nowMin`. Past + not-done = carryover
 * (hollow block with a "move to next open slot" control). `todayIdx` may
 * fall outside 0–6 — a past week makes every block past, a future week
 * none. For a midnight-split block the caller passes the last segment.
 */
export function isPastBlock(
  b: { day: number; endMin: number },
  todayIdx: number,
  nowMin: number,
): boolean {
  return b.day < todayIdx || (b.day === todayIdx && b.endMin <= nowMin)
}

/**
 * Earliest 09:00–18:00 gap of `dur` minutes on `day` at or after `cursor`
 * (the shared inner loop of `nextOpenSlot` / `autoFill`), or null.
 */
function firstGap(
  occ: Array<[number, number]>,
  cursor: number,
  dur: number,
): number | null {
  let cur = cursor
  for (const [s, e] of occ) {
    if (s - cur >= dur) return cur
    cur = ceil15(Math.max(cur, e))
  }
  return PLANNER.workEnd - cur >= dur ? cur : null
}

/** Day cursor: today starts at `ceil15(now + 10)`, other days at 09:00. */
function dayCursor(day: number, todayIdx: number, nowMin: number): number {
  return day === todayIdx
    ? Math.max(PLANNER.workStart, ceil15(nowMin + 10))
    : PLANNER.workStart
}

/**
 * First open slot of `dur` minutes from today → Sunday (weekends included,
 * as the prototype) inside the 09:00–18:00 window, around busy + scheduled.
 * Null when `todayIdx > 6` or nothing fits. Exact port of the prototype's
 * `nextOpenSlot`; the caller decides which week's data to scan (D5: always
 * the current week).
 */
export function nextOpenSlot(
  dur: number,
  busy: DayInterval[],
  scheduled: DayInterval[],
  todayIdx: number,
  nowMin: number,
): { day: number; startMin: number } | null {
  for (let d = Math.max(todayIdx, 0); d < 7; d++) {
    const start = firstGap(
      dayOcc(d, busy, scheduled),
      dayCursor(d, todayIdx, nowMin),
      dur,
    )
    if (start !== null) return { day: d, startMin: start }
  }
  return null
}

/** A Fill-my-week proposal — client-only, never persisted (D2). */
export type Proposal = {
  taskId: string
  day: number
  startMin: number
  endMin: number
}

/**
 * Fill my week: propose the earliest open weekday slot for every P1/P2
 * tray task, scanning `max(todayIdx, 0)` → Friday inside 09:00–18:00 and
 * packing sequentially — earlier proposals occupy for later candidates.
 * A weekend (`todayIdx >= 5`) or past week (`todayIdx > 6`) yields `[]`;
 * a future week starts at Monday. Port of the prototype's `autoFill` with
 * two deliberate substitutions: the sort is `compareTasks('priority')`
 * (priority → due asc nulls last → created_at) and the duration is
 * `blockDurationMin` so a 0-estimate task proposes 30m, not 0.
 */
export function autoFill(
  tray: Task[],
  busy: DayInterval[],
  scheduled: DayInterval[],
  todayIdx: number,
  nowMin: number,
): Proposal[] {
  const cands = tray
    .filter((t) => t.priority === 1 || t.priority === 2)
    .sort(compareTasks('priority'))
  const placed: Proposal[] = []
  for (const t of cands) {
    const dur = blockDurationMin(t.estimateMinutes)
    for (let d = Math.max(todayIdx, 0); d < 5; d++) {
      const start = firstGap(
        dayOcc(d, busy, scheduled, placed),
        dayCursor(d, todayIdx, nowMin),
        dur,
      )
      if (start !== null) {
        placed.push({ taskId: t.id, day: d, startMin: start, endMin: start + dur })
        break
      }
    }
  }
  return placed
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

// ── done (chunk 37 revisions, R1) ────────────────────────────────────────

/**
 * A scheduled block renders done iff its task is completed. `tasks.
 * completed_at` is the single source of truth; `scheduled_blocks.done` is a
 * trigger-maintained mirror the client never reads (migration 11).
 */
export function blockIsDone(task: Pick<Task, 'completedAt'>): boolean {
  return task.completedAt != null
}

// ── busy freshness (chunk 37 revisions, R2) ──────────────────────────────

/** Planner busy cache TTL — the ARCH §8 "every 5 minutes + on focus" model. */
export const BUSY_TTL_MS = 5 * 60_000

/** True while a cached per-week busy entry is inside the TTL. */
export function isBusyEntryFresh(
  entry: { fetchedAt: number } | null | undefined,
  now: number,
): boolean {
  return entry != null && now - entry.fetchedAt < BUSY_TTL_MS
}

// ── tray ─────────────────────────────────────────────────────────────────

/** Open tasks that have no scheduled block (the tray, D5). */
export function splitTray(tasks: Task[], blocks: ScheduledBlock[]): Task[] {
  const blocked = new Set(blocks.map((b) => b.taskId))
  return tasks.filter((t) => !t.completedAt && !blocked.has(t.id))
}
