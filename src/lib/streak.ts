import { dateKeyDaysAgo, startOfDayIso } from '@/lib/clock'
import type { RoutineItem, RoutineLog } from '@/db/types'

/**
 * Routines streak calculation and per-day "what was required" helper.
 *
 * Canon: ARCHITECTURE.md §11. Restated here so the rules don't drift
 * between this file and the renderers:
 *
 *   1. An item is REQUIRED for `date` iff it was created before `date`
 *      began in the user's timezone — `createdAt < startOfDay(date)` —
 *      and was not archived before `date` ended (`archivedAt is null`
 *      or `archivedAt >= startOfDay(date + 1 day)`). Archival takes
 *      effect from the day of archival forward: an item archived
 *      during day D is NOT required for D. See ARCH §11.
 *   2. A day is COMPLETE iff (a) at least one item was required, and
 *      (b) every required item has a `completed: true` log for that
 *      `date_key`. A day with zero required items is NOT complete —
 *      a routine that didn't exist yet can't be on a streak.
 *   3. Streak = consecutive complete days, counted back from today
 *      (or from yesterday if today isn't yet complete). First non-
 *      complete day breaks the streak.
 *
 * Pre-flight note #4: `requiredItemsByDay` is exported from this same
 * module rather than a separate `routine-requirements.ts`. Both
 * consumers (this file's streak calc and RoutineDotGrid.tsx) live in
 * the same conceptual neighborhood — keeping the helper here avoids a
 * second import in every routines-area file.
 *
 * Pre-flight note #6: no `new Date()` / `Date.now()` calls in this
 * file. Today is always passed in from the caller (which reads from
 * `clock.today(timezone)`), and date arithmetic flows through
 * `clock.dateKeyDaysAgo`. This keeps the module trivially mockable
 * via `vi.mock('@/lib/clock', …)` and the streak tests deterministic.
 */

/** How far back we look when computing a streak. */
const STREAK_LOOKBACK_DAYS = 60

/** How far back the dot grid renders. */
export const DOT_GRID_DAYS = 14

/**
 * For each `dateKey` in `dateKeys`, returns the set of item ids that
 * were required on that day (per the rule above). Returns a Map so
 * lookups stay O(1) for the caller's iteration.
 *
 * The check uses `startOfDayIso(dateKey, timezone)` for the creation
 * boundary and `startOfDayIso(dateKey + 1, timezone)` for the archival
 * boundary, so `createdAt` / `archivedAt` (both ISO timestamps in UTC)
 * compare lexically against equally-formatted ISO strings — `<` on ISO
 * strings is timestamp ordering when both are in UTC. The "+1 day"
 * step flows through `dateKeyDaysAgo(dateKey, -1)` so the boundary is
 * DST-safe (raw ms arithmetic would skew across spring/fall
 * transitions in the `settings.timezone`).
 */
export function requiredItemsByDay(
  items: RoutineItem[],
  dateKeys: string[],
  timezone: string,
): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>()
  for (const dateKey of dateKeys) {
    const startBoundary = startOfDayIso(dateKey, timezone)
    // End-of-day boundary = start of the next day. ARCH §11: items
    // archived during `dateKey` are not required for `dateKey`.
    // `dateKeyDaysAgo(_, -1)` steps one calendar day forward; see clock.ts.
    const endBoundary = startOfDayIso(dateKeyDaysAgo(dateKey, -1), timezone)
    const req = new Set<string>()
    for (const item of items) {
      if (item.createdAt >= startBoundary) continue
      if (item.archivedAt && item.archivedAt < endBoundary) continue
      req.add(item.id)
    }
    out.set(dateKey, req)
  }
  return out
}

/**
 * Build a Map<dateKey, Set<itemId>> of "completed logs for this day"
 * from a flat log array. Skips logs where `completed === false`.
 */
function completedItemsByDay(
  logs: RoutineLog[],
): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>()
  for (const log of logs) {
    if (!log.completed) continue
    let set = out.get(log.dateKey)
    if (!set) {
      set = new Set<string>()
      out.set(log.dateKey, set)
    }
    set.add(log.routineItemId)
  }
  return out
}

/**
 * Returns true iff every required item for `dateKey` has a
 * completed log. False when no items were required (rule 2).
 */
export function isDayComplete(
  dateKey: string,
  required: Map<string, Set<string>>,
  completed: Map<string, Set<string>>,
): boolean {
  const req = required.get(dateKey)
  if (!req || req.size === 0) return false
  const done = completed.get(dateKey)
  if (!done) return false
  for (const id of req) {
    if (!done.has(id)) return false
  }
  return true
}

/**
 * Compute the streak count for `routine`. Items are filtered to the
 * given routine (`morning` or `night`); other items in the input are
 * ignored so the same item array can be passed for either side.
 */
export function calcStreak(
  routine: 'morning' | 'night',
  items: RoutineItem[],
  logs: RoutineLog[],
  todayKey: string,
  timezone: string,
): number {
  const my = items.filter((i) => i.routine === routine)

  const dateKeys: string[] = []
  for (let d = 0; d < STREAK_LOOKBACK_DAYS; d += 1) {
    dateKeys.push(dateKeyDaysAgo(todayKey, d))
  }

  const required = requiredItemsByDay(my, dateKeys, timezone)
  const completed = completedItemsByDay(logs)

  const check = (dateKey: string) => isDayComplete(dateKey, required, completed)

  let streak = 0
  if (check(dateKeys[0])) streak = 1
  // Either way, count back through earlier days while complete. If today
  // didn't count, the streak still extends from yesterday.
  for (let i = 1; i < dateKeys.length; i += 1) {
    if (check(dateKeys[i])) streak += 1
    else break
  }
  return streak
}
