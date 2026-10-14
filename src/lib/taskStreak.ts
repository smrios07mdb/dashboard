import { dateKeyDaysAgo, dateKeyIn } from '@/lib/clock'
import type { Task } from '@/db/types'

/**
 * The hero's task streak (chunk 78). Canon: ARCHITECTURE.md §11.
 *
 *   1. A day is COMPLETE iff at least one task has a `completedAt` whose
 *      calendar day in `timeZone` is that day.
 *   2. Streak = consecutive complete days counted back from today, or from
 *      yesterday while today has no completion yet, so the streak survives
 *      until the day ends. The first incomplete day breaks it.
 *
 * No `new Date()` / `Date.now()` here: today is passed in (the caller reads
 * `clock.today(timeZone)`, which keeps the DEV `__clockOverride`), and days
 * step through `clock.dateKeyDaysAgo`, which is DST-safe. No lookback cap:
 * the walk stops at the first gap, and it can't pass the number of
 * distinct completion days.
 */
export function taskStreak(
  tasks: Pick<Task, 'completedAt'>[],
  todayKey: string,
  timeZone: string,
): number {
  const days = new Set<string>()
  for (const t of tasks) {
    if (t.completedAt) days.add(dateKeyIn(t.completedAt, timeZone))
  }
  let day = days.has(todayKey) ? todayKey : dateKeyDaysAgo(todayKey, 1)
  let streak = 0
  while (days.has(day)) {
    streak++
    day = dateKeyDaysAgo(day, 1)
  }
  return streak
}
