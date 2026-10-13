import type { Subcategory, Task } from '@/db/types'
import { ageDays } from '@/lib/taskAge'

/*
 * The weekly review of old tasks (chunk 74). Pure apart from the two storage
 * helpers at the bottom.
 *
 * The last-review date is per device on purpose (`localStorage`, no schema
 * change): a second device may ask once more that week.
 */

export const REVIEW_AGE_DAYS = 90
export const REVIEW_EVERY_DAYS = 7
export const REVIEW_KEY = 'hup:lastReview'

const DAY_MS = 24 * 60 * 60 * 1000

/** Open tasks under a live subcategory, not in today's plan, at least 90 days old; oldest createdAt first, then id. */
export function reviewCandidates(
  data: { subcategories: Subcategory[]; tasks: Task[] },
  todaySet: ReadonlySet<string>,
  timeZone: string,
  now: Date,
): Task[] {
  const live = new Set<string>()
  for (const s of data.subcategories) {
    if (s.archivedAt === null) live.add(s.id)
  }
  return data.tasks
    .filter((t) => {
      if (t.completedAt !== null) return false
      if (!live.has(t.subcategoryId)) return false
      if (todaySet.has(t.id)) return false
      const days = ageDays(t.createdAt, timeZone, now)
      return days !== null && days >= REVIEW_AGE_DAYS
    })
    .sort(
      (a, b) =>
        Date.parse(a.createdAt) - Date.parse(b.createdAt) ||
        (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    )
}

/** True when lastIso is null or unparsable, or at least 7 × 24 h before now. */
export function isReviewDue(lastIso: string | null, now: Date): boolean {
  if (lastIso === null) return true
  const last = Date.parse(lastIso)
  if (Number.isNaN(last)) return true
  return now.getTime() - last >= REVIEW_EVERY_DAYS * DAY_MS
}

export function loadLastReview(): string | null {
  try {
    return localStorage.getItem(REVIEW_KEY)
  } catch {
    return null
  }
}

export function storeLastReview(now: Date): void {
  try {
    localStorage.setItem(REVIEW_KEY, now.toISOString())
  } catch {
    // Private mode / quota — the prompt just asks again next load.
  }
}
