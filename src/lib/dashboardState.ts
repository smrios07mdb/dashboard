/*
 * Pure selector for the Dashboard's first-run / all-clear / normal states
 * (chunk 20 — UX-05; DESIGN_NOTES §3).
 *
 * First-run keys off non-archived *subcategories*, not tasks: signup seeds
 * the Work/Personal categories but no subcategories, and `tasks.subcategoryId`
 * is NOT NULL, so a brand-new account has nowhere to put a task. The first
 * real action is "create a list (subcategory)", which the first-run card
 * routes the user to. "Outstanding" mirrors the Dashboard's `openTasks`
 * (incomplete AND in a live subcategory), so the selected state always
 * matches what the columns actually render.
 */
import type { Subcategory, Task } from '@/db/types'

export type DashboardState = 'first-run' | 'all-clear' | 'normal'

export function selectDashboardState(
  subcategories: Subcategory[],
  tasks: Task[],
): DashboardState {
  const liveSubIds = new Set(
    subcategories.filter((s) => !s.archivedAt).map((s) => s.id),
  )
  if (liveSubIds.size === 0) return 'first-run'

  const hasOutstanding = tasks.some(
    (t) => !t.completedAt && liveSubIds.has(t.subcategoryId),
  )
  return hasOutstanding ? 'normal' : 'all-clear'
}
