import { formatInTimeZone, fromZonedTime } from 'date-fns-tz'

/**
 * Single source of truth for "today" and "start-of-day in the user's
 * timezone" used by the routines streak, the 14-day dot grid, and
 * anything else that needs to honor `settings.timezone` (ARCH §11).
 *
 * Pure functions — no module-level state, no `let _override` escape
 * hatch. Tests stub the module via Vitest's `vi.mock`. If a browser-
 * console smoke pass needs to manipulate "today", it can either
 * temporarily monkey-patch this module or import the patch hook from
 * the smoke harness. Adding an `__override` escape hatch here would
 * widen the surface area of the production bundle for a once-in-a-
 * sprint dev affordance, so it stays out.
 *
 * `today()` and `startOfDayIso()` accept `timezone` as an explicit
 * parameter. The default `'America/New_York'` matches the schema
 * default for `settings.timezone` (ARCH §4); callers should pass the
 * user's loaded setting so the value flows from the source of truth.
 */

const DEFAULT_TZ = 'America/New_York'

/** Returns `YYYY-MM-DD` for today in the given timezone. */
export function today(timezone: string = DEFAULT_TZ): string {
  return formatInTimeZone(new Date(), timezone, 'yyyy-MM-dd')
}

/**
 * Returns the ISO timestamp (UTC) for 00:00:00 on `dateKey` in
 * `timezone`. Used for the `createdAt < startOfDay(date)` comparison
 * in streak calculations.
 *
 * Example: `startOfDayIso('2026-05-27', 'America/New_York')` →
 * `'2026-05-27T04:00:00.000Z'` (EDT is UTC-4 in May).
 */
export function startOfDayIso(
  dateKey: string,
  timezone: string = DEFAULT_TZ,
): string {
  return fromZonedTime(`${dateKey}T00:00:00.000`, timezone).toISOString()
}

/**
 * Returns the dateKey N days before `dateKey`. Calendar arithmetic
 * is timezone-independent (subtracting one calendar day from
 * "2026-05-27" gives "2026-05-26" in any tz), so we use UTC-midnight
 * Date arithmetic and skim the leading 10 chars.
 *
 * `daysAgo` accepts negative values to step forward (`-1` = tomorrow),
 * though chunk-10's only consumer steps backward.
 */
export function dateKeyDaysAgo(dateKey: string, daysAgo: number): string {
  const d = new Date(`${dateKey}T00:00:00.000Z`)
  d.setUTCDate(d.getUTCDate() - daysAgo)
  return d.toISOString().slice(0, 10)
}
