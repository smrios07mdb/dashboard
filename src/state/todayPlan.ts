/*
 * Today-membership state for the dashboard.
 *
 * Membership is a `Set<taskId>` seeded from `autoTodayIds(tasks)` and mutated by
 * the sun toggle (on both the Today rows and the main-list rows — one shared
 * set). It is UI state, held by the screen that owns the task load (the
 * Dashboard) and re-seeded when the task set changes identity — NOT a persisted
 * DB field (see the deferred persistence decision in the PR).
 *
 * "Changes identity" is detected by the set of task IDs, so:
 *   - in-place edits (title, minutes, completion) never disturb the plan — which
 *     is what lets a just-completed task linger and keep counting toward
 *     done/total;
 *   - a created/deleted/swapped task triggers an incremental reconcile that adds
 *     newly-signalled tasks and drops deleted ones while preserving the user's
 *     manual pins and removals (see `reconcileTodayMembership`).
 */
import { useCallback, useEffect, useRef, useState } from 'react'

import type { Task } from '@/db/types'
import { autoTodayIds, reconcileTodayMembership } from '@/lib/today'

export type TodayPlan = {
  /** The live membership set — shared by TodayPanel and the dashboard rows. */
  todaySet: Set<string>
  /** Add/remove a task. `force` sets an explicit state (true=add, false=remove). */
  toggleToday: (id: string, force?: boolean) => void
}

export function useTodayPlan(tasks: Task[]): TodayPlan {
  const [membership, setMembership] = useState<Set<string>>(() =>
    autoTodayIds(tasks),
  )
  // The task-id set from the render that last seeded/reconciled membership.
  const idsRef = useRef<Set<string>>(new Set(tasks.map((t) => t.id)))

  // Reconcile only when the task-id set changes identity (added, removed, or
  // swapped) — not on in-place field edits (which keep the same ids) or reorder.
  // That's what lets a just-completed task linger in the plan and keep counting
  // toward done/total. Runs in an effect (post-commit) so refs aren't touched
  // during render; the conditional setState mirrors the SubcategorySection
  // linger idiom. `tasks` is the only dep — the ref read/write stays in here.
  useEffect(() => {
    const curIds = tasks.map((t) => t.id)
    const prevIds = idsRef.current
    const changed =
      curIds.length !== prevIds.size ||
      curIds.some((id) => !prevIds.has(id))
    if (!changed) return
    idsRef.current = new Set(curIds)
    setMembership((cur) => reconcileTodayMembership(cur, prevIds, tasks))
  }, [tasks])

  const toggleToday = useCallback((id: string, force?: boolean) => {
    setMembership((cur) => {
      const want = force === undefined ? !cur.has(id) : force
      if (want === cur.has(id)) return cur
      const next = new Set(cur)
      if (want) next.add(id)
      else next.delete(id)
      return next
    })
  }, [])

  return { todaySet: membership, toggleToday }
}
