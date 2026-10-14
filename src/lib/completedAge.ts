import type { Task } from '@/db/types'

/**
 * Chunk 86 (D2): how long a completion stays on the lists. Older completions
 * leave the Tasks lists and drill-downs and live only in Insights; the repo
 * still loads every task, so XP, the streak, search and export see them all.
 */
export const COMPLETED_VISIBLE_DAYS = 30

const HORIZON_MS = COMPLETED_VISIBLE_DAYS * 24 * 60 * 60 * 1000

/** True when the task was completed less than 30 × 24 h before `now`. */
export function isRecentCompletion(
  task: Pick<Task, 'completedAt'>,
  now: Date = new Date(),
): boolean {
  if (!task.completedAt) return false
  return now.getTime() - new Date(task.completedAt).getTime() < HORIZON_MS
}
