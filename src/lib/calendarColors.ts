import type { ReadCalendar } from '@/db/types'
import type { BusySource, BusySources } from '@/lib/calendarApi'

/*
 * Per-calendar colors for the busy overlay (chunk 51b, Outlook in 51c).
 *
 * Every iCloud calendar in the read set gets its own color so busy blocks
 * are tellable apart at a glance: the calendar's own `calendar-color` from
 * iCloud when it reported one (so the Planner matches Calendar.app), else
 * the next unused entry of `CALENDAR_PALETTE`. Colors are made DISTINCT in
 * read-set order — a second calendar whose iCloud color repeats an earlier
 * one is re-assigned from the palette rather than allowed to collide.
 *
 * The Outlook feed is one more calendar in the color sense (chunk 51c): the
 * Planner passes it as an *extra* entry, colored after the read set under
 * the same distinctness rule, so the work feed has an identity next to the
 * iCloud calendars. Its map key is namespaced (`outlookColorKey`) because
 * the feed's display name can repeat an iCloud calendar's — an Outlook
 * published calendar and iCloud's default are both commonly "Calendar".
 * The hatch stays the *source* cue; the color is the *identity* cue.
 *
 * The proxy tags each iCloud interval `color` from the read set;
 * `withCalendarColors` fills the gap for intervals that arrive untagged (a
 * calendar with no iCloud color, or a proxy older than the read set's
 * `color` field) by joining on the calendar name, and colors Outlook
 * intervals from the feed entry when one is given.
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

/** Display name of the Outlook feed: its `X-WR-CALNAME`, else "Outlook". */
export function outlookColorName(sources: BusySources | null | undefined): string {
  return sources?.outlook.feedName ?? 'Outlook'
}

/** Map key for the Outlook feed — namespaced so it can never alias an
 *  iCloud calendar of the same display name. */
export function outlookColorKey(name: string): string {
  return `outlook:${name}`
}

/**
 * Calendar display name → distinct `#rrggbb`. iCloud's color wins when it is
 * not already taken by an earlier calendar; otherwise the first unused
 * palette entry; once the palette is exhausted, colors cycle. `extras` are
 * further keys (the Outlook feed, `outlookColorKey`) colored after the read
 * set from the palette, under the same rule.
 */
export function calendarColorMap(
  calendars: readonly ReadCalendar[] | null | undefined,
  extras?: readonly string[],
): Map<string, string> {
  const out = new Map<string, string>()
  const used = new Set<string>()
  let cursor = 0
  const nextUnused = (): string => {
    for (let i = 0; i < CALENDAR_PALETTE.length; i++) {
      const candidate = CALENDAR_PALETTE[(cursor + i) % CALENDAR_PALETTE.length]!
      if (!used.has(candidate)) {
        cursor = (cursor + i + 1) % CALENDAR_PALETTE.length
        return candidate
      }
    }
    return CALENDAR_PALETTE[cursor++ % CALENDAR_PALETTE.length]!
  }
  for (const c of calendars ?? []) {
    if (!c.name || out.has(c.name)) continue
    let color = c.color?.toLowerCase()
    if (!color || used.has(color)) color = nextUnused()
    used.add(color)
    out.set(c.name, color)
  }
  for (const key of extras ?? []) {
    if (!key || out.has(key)) continue
    const color = nextUnused()
    used.add(color)
    out.set(key, color)
  }
  return out
}

/**
 * Give every interval a color. iCloud: the map's entry for its calendar
 * when one exists (the read set is the authority — it is what the picker
 * shows), else whatever the proxy tagged. Outlook: the map's entry under
 * `outlookKey` when given. Untouched when neither applies.
 */
export function withCalendarColors<T extends Pick<BusySource, 'source' | 'calendar' | 'color'>>(
  busy: readonly T[],
  colors: Map<string, string>,
  outlookKey?: string,
): T[] {
  return busy.map((b) => {
    let color: string | undefined
    if (b.source === 'outlook') {
      if (!outlookKey) return b
      color = colors.get(outlookKey)
    } else {
      if (!b.calendar) return b
      color = colors.get(b.calendar) ?? b.color
    }
    if (!color || color === b.color) return b
    return { ...b, color }
  })
}
