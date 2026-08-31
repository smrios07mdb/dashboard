/*
 * Today-membership state for the dashboard.
 *
 * Membership is a `Set<taskId>` seeded from `autoTodayIds(tasks)` plus the
 * user's manual deltas — pins and removals — and mutated by the sun toggle
 * (on both the Today rows and the main-list rows — one shared set). It is
 * client-local view state, NOT a persisted DB field: chunk 43 resolved the
 * persistence deferral by storing the deltas per-device in localStorage
 * (the `todayList` pattern — no schema, no sync, quiet failure in private
 * mode). Only the deltas persist, never the resolved set, so auto signals
 * keep flowing as tasks change; the stored entry is day-scoped (local
 * midnight, same frame as `lib/today`) so yesterday's plan never resurfaces
 * today.
 *
 * "Changes identity" is detected by the set of task IDs, so:
 *   - in-place edits (title, minutes, completion) never disturb the plan — which
 *     is what lets a just-completed task linger and keep counting toward
 *     done/total;
 *   - a created/deleted/swapped task triggers an incremental reconcile that adds
 *     newly-signalled tasks and drops deleted ones while preserving the user's
 *     manual pins and removals (see `reconcileTodayMembership`), and prunes
 *     stored delta ids whose task no longer exists.
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

/** The user's manual intent, layered over the auto derivation. */
export type TodayDeltas = {
  pinned: Set<string>
  removed: Set<string>
}

const STORAGE_KEY = 'hup:todayPlan'

/** Local-calendar day key (YYYY-MM-DD) — the `lib/today` local-midnight frame. */
function dayKey(now: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`
}

function emptyDeltas(): TodayDeltas {
  return { pinned: new Set(), removed: new Set() }
}

/** Stored deltas for today, or empty ones — a stale-dated or bad entry is discarded. */
export function readTodayDeltas(now: Date = new Date()): TodayDeltas {
  if (typeof localStorage === 'undefined') return emptyDeltas()
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return emptyDeltas()
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return emptyDeltas()
    const { date, pinned, removed } = parsed as Record<string, unknown>
    if (date !== dayKey(now)) return emptyDeltas()
    const ids = (v: unknown) =>
      new Set(
        Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [],
      )
    return { pinned: ids(pinned), removed: ids(removed) }
  } catch {
    return emptyDeltas()
  }
}

function writeTodayDeltas(deltas: TodayDeltas, now: Date = new Date()): void {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        date: dayKey(now),
        pinned: [...deltas.pinned],
        removed: [...deltas.removed],
      }),
    )
  } catch {
    // Private mode / quota / SSR shim — this session still works from memory;
    // the plan just won't survive a remount. Same stance as `todayList`.
  }
}

/** Resolved membership = (auto ∪ pinned) − removed. */
export function applyTodayDeltas(
  auto: Set<string>,
  deltas: TodayDeltas,
): Set<string> {
  const next = new Set(auto)
  for (const id of deltas.pinned) next.add(id)
  for (const id of deltas.removed) next.delete(id)
  return next
}

export function useTodayPlan(tasks: Task[]): TodayPlan {
  // One mutable deltas object for the hook's lifetime; every mutation is
  // followed by a `writeTodayDeltas` so storage tracks it.
  const [deltas] = useState<TodayDeltas>(() => readTodayDeltas())
  const [membership, setMembership] = useState<Set<string>>(() =>
    applyTodayDeltas(autoTodayIds(tasks), deltas),
  )
  // The task-id set from the render that last seeded/reconciled membership.
  const idsRef = useRef<Set<string>>(new Set(tasks.map((t) => t.id)))
  // Current membership for the toggle's synchronous read (no updater-side
  // effects — StrictMode double-invokes updaters).
  const membershipRef = useRef(membership)
  useEffect(() => {
    membershipRef.current = membership
  }, [membership])

  // Reconcile only when the task-id set changes identity (added, removed, or
  // swapped) — not on in-place field edits (which keep the same ids) or reorder.
  // That's what lets a just-completed task linger in the plan and keep counting
  // toward done/total. Runs in an effect (post-commit) so refs aren't touched
  // during render; the conditional setState mirrors the SubcategorySection
  // linger idiom. `tasks` is the only live dep — the ref read/write stays here.
  useEffect(() => {
    const curIds = tasks.map((t) => t.id)
    const prevIds = idsRef.current
    const changed =
      curIds.length !== prevIds.size ||
      curIds.some((id) => !prevIds.has(id))
    if (!changed) return
    idsRef.current = new Set(curIds)
    // Prune delta ids whose task is gone — but never against an empty list,
    // which is the still-loading state and would wipe the stored plan.
    if (curIds.length > 0) {
      const cur = idsRef.current
      let pruned = false
      for (const set of [deltas.pinned, deltas.removed]) {
        for (const id of [...set]) {
          if (!cur.has(id)) {
            set.delete(id)
            pruned = true
          }
        }
      }
      if (pruned) writeTodayDeltas(deltas)
    }
    setMembership((cur) =>
      applyTodayDeltas(reconcileTodayMembership(cur, prevIds, tasks), deltas),
    )
  }, [tasks, deltas])

  const toggleToday = useCallback(
    (id: string, force?: boolean) => {
      const cur = membershipRef.current
      const want = force === undefined ? !cur.has(id) : force
      if (want === cur.has(id)) return
      if (want) {
        deltas.pinned.add(id)
        deltas.removed.delete(id)
      } else {
        deltas.removed.add(id)
        deltas.pinned.delete(id)
      }
      writeTodayDeltas(deltas)
      const next = new Set(cur)
      if (want) next.add(id)
      else next.delete(id)
      membershipRef.current = next
      setMembership(next)
    },
    [deltas],
  )

  return { todaySet: membership, toggleToday }
}
