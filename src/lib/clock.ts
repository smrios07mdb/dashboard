import { formatInTimeZone, fromZonedTime } from 'date-fns-tz'

/**
 * Single source of truth for "today" and "start-of-day in the user's
 * timezone" used by the routines streak, the 14-day dot grid, and
 * anything else that needs to honor `settings.timezone` (ARCH §11).
 *
 * `today()` and `startOfDayIso()` accept `timezone` as an explicit
 * parameter. The default `'America/New_York'` matches the schema
 * default for `settings.timezone` (ARCH §4); callers should pass the
 * user's loaded setting so the value flows from the source of truth.
 *
 * DEV-only escape hatch: `__clockOverride` (module-level, gated behind
 * `import.meta.env.DEV`) lets the test harness pin `today()` to a
 * specific dateKey without timezone gymnastics. Production builds
 * collapse the `import.meta.env.DEV ? … : undefined` ternary to
 * `undefined`, and tree-shaking drops the unused export — verified
 * by grepping the prod bundle for `__clockOverride`. The chunk-10
 * smoke pass needed this affordance and chunks 13 / 14 (calendar,
 * notifications) will need it too, resolving the 2026-05-27 "add a
 * hatch later only if a recurring need surfaces" deferral. See
 * PROGRESS.md Revisions 2026-05-27.
 */

const DEFAULT_TZ = 'America/New_York'

let __override: string | null = null

/** Returns `YYYY-MM-DD` for today in the given timezone. */
export function today(timezone: string = DEFAULT_TZ): string {
  if (import.meta.env.DEV && __override) {
    return __override
  }
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

/**
 * DEV-only override of `today()`. From the DevTools console:
 *
 *   window.__clockOverride.set('2026-05-30')   // pin today
 *   window.__clockOverride.clear()             // restore real today
 *   window.__clockOverride.get()               // current override (or null)
 *
 * `set` validates `YYYY-MM-DD` format and throws on anything else. The
 * override is session-only — not persisted to settings, localStorage,
 * or anywhere else. Absent from production builds: the ternary
 * collapses to `undefined` and tree-shaking removes the export.
 */
export const __clockOverride = import.meta.env.DEV
  ? {
      set(dateKey: string) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) {
          throw new Error(
            `__clockOverride.set expects YYYY-MM-DD, got: ${dateKey}`,
          )
        }
        __override = dateKey
      },
      clear() {
        __override = null
      },
      get() {
        return __override
      },
    }
  : undefined
