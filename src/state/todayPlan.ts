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
    if (date !== dayKey(now)) {
      // Yesterday's plan is over — drop the entry rather than leaving the
      // string on disk for a device that is opened, untouched and closed
      // (chunk 46, D7). Only the stale-date branch prunes; a parse failure
      // on an entry dated today is left alone. A removal failure (private
      // mode) must not break the read, so it rides the outer try/catch —
      // the discard has already happened either way.
      localStorage.removeItem(STORAGE_KEY)
      return emptyDeltas()
    }
    const ids = (v: unknown) =>
      new Set(
        Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [],
      )
    return { pinned: ids(pinned), removed: ids(removed) }
  } catch {
    return emptyDeltas()
  }
}

function writeTodayDeltas(deltas: TodayDeltas, day: string): void {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        date: day,
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
  // followed by a `writeTodayDeltas` so storage tracks it. `day` is the local
  // day the deltas were read for — every write stamps THIS key, not the wall
  // clock, so a tab open across midnight can never re-stamp yesterday's
  // deltas with today's date (the write-path half of the day scoping; the
  // read half is `readTodayDeltas`' stale-date discard).
  const [{ deltas, day: initialDay }] = useState(() => {
    const now = new Date()
    return { deltas: readTodayDeltas(now), day: dayKey(now) }
  })
  const dayRef = useRef(initialDay)
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
  // Latest tasks for the toggle's rollover re-seed (a roll invalidates the
  // resolved set in `membershipRef`, so it re-derives from the auto signals).
  const tasksRef = useRef(tasks)
  useEffect(() => {
    tasksRef.current = tasks
  })

  // Day rollover, observed lazily on the next interaction or task refresh —
  // deliberately no timer/interval/visibility listener (the app has no
  // day-tick). When the local day has changed since the deltas were read,
  // yesterday's plan is over: clear both delta sets in place and persist the
  // now-empty entry under the new day.
  const rollIfNewDay = useCallback(
    (now: Date): boolean => {
      const key = dayKey(now)
      if (key === dayRef.current) return false
      deltas.pinned.clear()
      deltas.removed.clear()
      dayRef.current = key
      writeTodayDeltas(deltas, key)
      return true
    },
    [deltas],
  )

  // Reconcile only when the task-id set changes identity (added, removed, or
  // swapped) — not on in-place field edits (which keep the same ids) or reorder.
  // That's what lets a just-completed task linger in the plan and keep counting
  // toward done/total. Runs in an effect (post-commit) so refs aren't touched
  // during render; the conditional setState mirrors the SubcategorySection
  // linger idiom. `tasks` is the only live dep — the ref read/write stays here.
  useEffect(() => {
    const rolled = rollIfNewDay(new Date())
    const curIds = tasks.map((t) => t.id)
    const prevIds = idsRef.current
    const changed =
      curIds.length !== prevIds.size ||
      curIds.some((id) => !prevIds.has(id))
    if (!changed && !rolled) return
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
      if (pruned) writeTodayDeltas(deltas, dayRef.current)
    }
    // After a roll the previous membership is yesterday's resolved set —
    // re-seed from the auto signals rather than layering the (now empty)
    // deltas over it.
    setMembership((cur) =>
      rolled
        ? applyTodayDeltas(autoTodayIds(tasks), deltas)
        : applyTodayDeltas(reconcileTodayMembership(cur, prevIds, tasks), deltas),
    )
  }, [tasks, deltas, rollIfNewDay])

  const toggleToday = useCallback(
    (id: string, force?: boolean) => {
      const rolled = rollIfNewDay(new Date())
      const cur = rolled
        ? applyTodayDeltas(autoTodayIds(tasksRef.current), deltas)
        : membershipRef.current
      const want = force === undefined ? !cur.has(id) : force
      if (want === cur.has(id)) {
        if (rolled) {
          membershipRef.current = cur
          setMembership(cur)
        }
        return
      }
      if (want) {
        deltas.pinned.add(id)
        deltas.removed.delete(id)
      } else {
        deltas.removed.add(id)
        deltas.pinned.delete(id)
      }
      writeTodayDeltas(deltas, dayRef.current)
      const next = new Set(cur)
      if (want) next.add(id)
      else next.delete(id)
      membershipRef.current = next
      setMembership(next)
    },
    [deltas, rollIfNewDay],
  )

  return { todaySet: membership, toggleToday }
}
