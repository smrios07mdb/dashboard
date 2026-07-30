/*
 * Week Planner geometry + week math (chunk 36).
 *
 * Ported from the handoff prototype's `planner-primitives.jsx` (`PL`,
 * `blockPos`, clock formatters) plus the week helpers the prototype kept
 * in mock data (`weekLabel`, `weekMeta`, day list). Pure functions only —
 * the screen supplies dates and busy data.
 *
 * All day/time math is browser-local (chunk-36 locked decision D6): busy
 * instants render at local wall time, weeks start Monday, and "today" /
 * the now-line use the local clock. `settings.timezone` remains a
 * routines/streak concern.
 */

/** Grid constants (DESIGN_NOTES geometry table). Minutes since midnight. */
export const PLANNER = {
  /** Desktop hour height (px). */
  hourH: 52,
  /** Desktop time gutter (px). */
  gutter: 56,
  /** Mobile hour height (px). */
  mHourH: 48,
  /** Mobile time gutter (px). */
  mGutter: 46,
  /** Default visible window: 08:00–19:00. */
  winCollapsedStart: 8 * 60,
  winCollapsedEnd: 19 * 60,
  /** Fully expanded window: 07:00–21:00. */
  winFullStart: 7 * 60,
  winFullEnd: 21 * 60,
  /** Capacity working window: Mon–Fri 09:00–18:00. */
  workStart: 9 * 60,
  workEnd: 18 * 60,
} as const

// ── clock formatting (24h everywhere in the planner) ─────────────────────

const pad2 = (n: number): string => String(n).padStart(2, '0')

/** Minutes since midnight → `HH:MM` (24h). */
export function fmtClock(minutes: number): string {
  return `${pad2(Math.floor(minutes / 60))}:${pad2(minutes % 60)}`
}

/** `HH:MM–HH:MM` (en dash, no spaces — matches the prototype's block ranges). */
export function fmtRange(startMin: number, endMin: number): string {
  return `${fmtClock(startMin)}–${fmtClock(endMin)}`
}

/** Round up to the next 15-minute boundary. */
export function ceil15(minutes: number): number {
  return Math.ceil(minutes / 15) * 15
}

// ── block positioning ────────────────────────────────────────────────────

export type BlockPosition = {
  top: number
  height: number
  /** Block starts before the visible window (render the `↑ HH:MM` stamp). */
  clipTop: boolean
  /** Block ends after the visible window (render the `↓ HH:MM` stamp). */
  clipBottom: boolean
}

/**
 * Clamped position of a block within the visible window
 * [windowStartMin, windowEndMin]. DESIGN_NOTES formula:
 * `top = (start − windowStart)/60 × hourH + 1`, `height = dur/60 × hourH − 2`
 * (min 14px). Returns null when the block lies fully outside the window.
 */
export function blockPos(
  startMin: number,
  endMin: number,
  hourH: number,
  windowStartMin: number,
  windowEndMin: number,
): BlockPosition | null {
  const cs = Math.max(startMin, windowStartMin)
  const ce = Math.min(endMin, windowEndMin)
  if (ce <= windowStartMin || cs >= windowEndMin) return null
  return {
    top: ((cs - windowStartMin) / 60) * hourH + 1,
    height: Math.max(((ce - cs) / 60) * hourH - 2, 14),
    clipTop: startMin < windowStartMin,
    clipBottom: endMin > windowEndMin,
  }
}

// ── week helpers ─────────────────────────────────────────────────────────

const MONTHS_SHORT = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
] as const

/** `.label` day abbreviations, Monday-first (prototype day headers). */
export const DAY_LABELS = [
  'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN',
] as const

/** Monday 00:00 (local) of the week containing `date`. */
export function weekStart(date: Date): Date {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate())
  // getDay(): 0=Sun … 6=Sat → Monday-based offset.
  const offset = (d.getDay() + 6) % 7
  d.setDate(d.getDate() - offset)
  return d
}

/** `start` shifted by `n` local calendar days (00:00-normalized inputs stay so). */
export function addDays(date: Date, n: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + n)
}

/** The 7 local dates (Mon–Sun) of the week starting at `start`. */
export function weekDays(start: Date): Date[] {
  return Array.from({ length: 7 }, (_, i) => addDays(start, i))
}

/** ISO-8601 week number + week-year (weeks start Monday; week 1 holds Jan 4). */
export function isoWeek(date: Date): { week: number; year: number } {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()))
  const dayNum = d.getUTCDay() || 7
  d.setUTCDate(d.getUTCDate() + 4 - dayNum)
  const year = d.getUTCFullYear()
  const yearStart = Date.UTC(year, 0, 1)
  const week = Math.ceil(((d.getTime() - yearStart) / 86_400_000 + 1) / 7)
  return { week, year }
}

/** Header kicker: `WEEK 19 · 2026`. */
export function weekMetaLabel(start: Date): string {
  const { week, year } = isoWeek(start)
  return `WEEK ${week} · ${year}`
}

/** Header range: `May 4 – 10`, or `Apr 28 – May 4` across a month boundary. */
export function weekRangeLabel(start: Date): string {
  const end = addDays(start, 6)
  const m1 = MONTHS_SHORT[start.getMonth()]
  const m2 = MONTHS_SHORT[end.getMonth()]
  return m1 === m2
    ? `${m1} ${start.getDate()} – ${end.getDate()}`
    : `${m1} ${start.getDate()} – ${m2} ${end.getDate()}`
}

/**
 * Index (0=Mon … 6=Sun) of `now`'s local date within the week starting at
 * `start`. May be negative or > 6 when today falls outside that week —
 * callers compare against it for past/future day treatment.
 */
export function todayIndex(start: Date, now: Date): number {
  const day = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  return Math.round((day.getTime() - start.getTime()) / 86_400_000)
}

/** Local wall-clock minutes since midnight. */
export function minutesOfDay(date: Date): number {
  return date.getHours() * 60 + date.getMinutes()
}

// ── busy-instant → grid mapping ──────────────────────────────────────────

/** A busy interval placed on the week grid, in local wall-clock minutes. */
export type WeekBusyBlock = {
  /** 0=Mon … 6=Sun within the displayed week. */
  day: number
  startMin: number
  endMin: number
  source: 'icloud' | 'outlook'
  title?: string
}

/**
 * Map ISO busy intervals onto the week starting at `start`, splitting
 * intervals that cross local midnight into per-day segments. Times are
 * local wall-clock (D6); invalid or non-overlapping intervals drop out.
 */
export function busyToWeekBlocks(
  busy: Array<{
    start: string
    end: string
    source: 'icloud' | 'outlook'
    title?: string
  }>,
  start: Date,
): WeekBusyBlock[] {
  const out: WeekBusyBlock[] = []
  const dayStarts = Array.from({ length: 8 }, (_, i) => addDays(start, i))
  for (const b of busy) {
    const s = new Date(b.start)
    const e = new Date(b.end)
    if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime())) continue
    if (e.getTime() <= s.getTime()) continue
    for (let i = 0; i < 7; i++) {
      const dayStart = dayStarts[i]
      const dayEnd = dayStarts[i + 1]
      const os = Math.max(s.getTime(), dayStart.getTime())
      const oe = Math.min(e.getTime(), dayEnd.getTime())
      if (oe <= os) continue
      const osDate = new Date(os)
      const startMin = os === dayStart.getTime() ? 0 : minutesOfDay(osDate)
      const endMin = oe === dayEnd.getTime() ? 24 * 60 : minutesOfDay(new Date(oe))
      if (endMin <= startMin) continue
      out.push({
        day: i,
        startMin,
        endMin,
        source: b.source,
        title: b.title,
      })
    }
  }
  return out
}

// ── collapsed-hour rails ─────────────────────────────────────────────────

/**
 * How many blocks are (partly) hidden past each collapsed edge — feeds the
 * `SHOW 07:00–08:00 · N HIDDEN` rails. Counts blocks starting before the
 * collapsed window start (top) and ending after its end (bottom), exactly
 * like the prototype.
 */
export function hiddenCounts(
  blocks: Array<{ startMin: number; endMin: number }>,
  collapsedStart: number = PLANNER.winCollapsedStart,
  collapsedEnd: number = PLANNER.winCollapsedEnd,
): { top: number; bottom: number } {
  let top = 0
  let bottom = 0
  for (const b of blocks) {
    if (b.startMin < collapsedStart) top++
    if (b.endMin > collapsedEnd) bottom++
  }
  return { top, bottom }
}
