import type { ReadCalendar } from '@/db/types'
import type { BusySource } from '@/lib/calendarApi'

/*
 * Per-calendar colors for the busy overlay (chunk 51b).
 *
 * Every iCloud calendar in the read set gets its own color so busy blocks
 * are tellable apart at a glance: the calendar's own `calendar-color` from
 * iCloud when it reported one (so the Planner matches Calendar.app), else
 * the next unused entry of `CALENDAR_PALETTE`. Colors are made DISTINCT in
 * read-set order — a second calendar whose iCloud color repeats an earlier
 * one is re-assigned from the palette rather than allowed to collide.
 *
 * The proxy tags each interval `color` from the read set; `withCalendarColors`
 * fills the gap for intervals that arrive untagged (a calendar with no iCloud
 * color, or a proxy older than the read set's `color` field) by joining on
 * the calendar name. Outlook intervals are never colored — they keep their
 * hatched treatment.
 */

/** Apple-like hues, ordered so neighbours contrast. */
export const CALENDAR_PALETTE: readonly string[] = [
  '#1badf8', // blue
  '#ff9500', // orange
  '#63da38', // green
  '#cc73e1', // purple
  '#ff2968', // pink
  '#ffcc00', // yellow
  '#5ac8fa', // teal
  '#ff3b30', // red
  '#a2845e', // brown
  '#8e8e93', // gray
]

/**
 * Calendar display name → distinct `#rrggbb`. iCloud's color wins when it is
 * not already taken by an earlier calendar; otherwise the first unused
 * palette entry; once the palette is exhausted, colors cycle.
 */
export function calendarColorMap(
  calendars: readonly ReadCalendar[] | null | undefined,
): Map<string, string> {
  const out = new Map<string, string>()
  if (!calendars) return out
  const used = new Set<string>()
  let cursor = 0
  for (const c of calendars) {
    if (!c.name || out.has(c.name)) continue
    let color = c.color?.toLowerCase()
    if (!color || used.has(color)) {
      color = undefined
      for (let i = 0; i < CALENDAR_PALETTE.length; i++) {
        const candidate = CALENDAR_PALETTE[(cursor + i) % CALENDAR_PALETTE.length]
        if (!used.has(candidate)) {
          color = candidate
          cursor = (cursor + i + 1) % CALENDAR_PALETTE.length
          break
        }
      }
      if (!color) {
        color = CALENDAR_PALETTE[cursor % CALENDAR_PALETTE.length]
        cursor++
      }
    }
    used.add(color)
    out.set(c.name, color)
  }
  return out
}

/**
 * Give every iCloud interval a color: the map's entry for its calendar when
 * one exists (the read set is the authority — it is what the picker shows),
 * else whatever the proxy tagged. Untouched when neither applies.
 */
export function withCalendarColors<T extends Pick<BusySource, 'source' | 'calendar' | 'color'>>(
  busy: readonly T[],
  colors: Map<string, string>,
): T[] {
  return busy.map((b) => {
    if (b.source !== 'icloud' || !b.calendar) return b
    const color = colors.get(b.calendar) ?? b.color
    if (!color || color === b.color) return b
    return { ...b, color }
  })
}
