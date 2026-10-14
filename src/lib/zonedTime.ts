/*
 * Wall time in a zone → instant (chunk 82).
 *
 * `date-fns-tz`'s `fromZonedTime` resolved a skipped midnight to the previous
 * day and picked between the two instants of a repeated wall time by the HOST
 * zone, so the same input stored different instants on different devices.
 * This helper reads wall times with `Intl.DateTimeFormat` only, which makes it
 * host-independent.
 *
 * Rule (Temporal's "compatible" disambiguation): read the wall's fields as a
 * UTC timestamp `U`, take the zone's offset a day before (`o1`) and a day
 * after (`o2`), and try `U − o1` and `U − o2`. Of the candidates whose wall
 * time in the zone equals the input, return the earliest — a repeated wall
 * time is its first occurrence. If neither matches, the wall time falls in a
 * gap: return `U − o1`, which shifts it forward by the gap's length.
 */

const WALL = /^\d{4}-\d\d-\d\dT\d\d:\d\d(:\d\d(\.\d{3})?)?$/

const DAY_MS = 86_400_000

const formatters = new Map<string, Intl.DateTimeFormat>()

function formatterFor(tz: string): Intl.DateTimeFormat {
  let f = formatters.get(tz)
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
    formatters.set(tz, f)
  }
  return f
}

/** The wall time of whole-second instant `t` in `f`'s zone, read as UTC ms. */
function wallMs(f: Intl.DateTimeFormat, t: number): number {
  const p: Record<string, number> = {}
  for (const { type, value } of f.formatToParts(t)) p[type] = +value
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second)
}

export function zonedWallToDate(wall: string, tz: string): Date | null {
  if (!WALL.test(wall)) return null
  const [y, mo, d, h, mi, s = 0, ms = 0] = wall.split(/\D/).map(Number)
  // Whole seconds; the milliseconds are added back at the end.
  const U = Date.UTC(y, mo - 1, d, h, mi, s)
  // Out-of-range fields (month 13, Feb 30, hour 24) roll over and no longer
  // print as the input.
  if (!new Date(U + ms).toISOString().startsWith(wall)) return null

  let f: Intl.DateTimeFormat
  try {
    f = formatterFor(tz)
  } catch {
    return null // unknown zone (RangeError)
  }

  const o1 = wallMs(f, U - DAY_MS) - (U - DAY_MS)
  const o2 = wallMs(f, U + DAY_MS) - (U + DAY_MS)
  const valid = [U - o1, U - o2].filter((c) => wallMs(f, c) === U)
  return new Date((valid.length > 0 ? Math.min(...valid) : U - o1) + ms)
}
