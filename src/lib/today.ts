/*
 * "Today" — the day's plan, derived from task signals.
 *
 * Ported from `today_list_handoff/prototype/today.jsx` (the derivation block),
 * adapted to the repo's real `Task` / `Category` / `Subcategory` shapes. Pure,
 * dependency-free, and unit-tested (`today.test.ts`). No React, no I/O — the
 * membership Set and rendering live one layer up (`state/todayPlan`, `TodayPanel`).
 *
 * A task lands in Today when it is overdue, has a reminder due today, is flagged
 * Priority 1, OR the user pins it (the sun toggle → the synthetic `Pinned`
 * reason). Highest-precedence reason wins per task.
 *
 * Reconciliations honored from the build brief:
 *   - ONE color per row = the category color, applied by the view. The reason
 *     object carries only `key` / `label` / `rank` — the prototype's `color`
 *     field (which referenced the superseded `--jewel-rose`) is dropped here so
 *     nothing keys a hue off status.
 *   - Derivation depends only on model fields the schema already has:
 *     `remindAt`, `priority`, `completedAt`, `estimateMinutes`, `subcategoryId`.
 *
 * `now` is injectable on every entry point (defaults to `new Date()`) so the
 * local-midnight bounds are deterministic under test. Bounds use the browser's
 * local timezone via `setHours`, exactly like the prototype. (Whether "today"
 * should instead honor `settings.timezone`, and whether `Due today` should key
 * off `dueAt` once real due dates exist, are deferred decisions — see the PR.)
 */
import type { Category, Subcategory, Task } from '@/db/types'

export type TodayReasonKey = 'overdue' | 'due' | 'priority' | 'pinned'

/** Why a task is on today's plan. `color` is deliberately absent (see file header). */
export type TodayReason = {
  key: TodayReasonKey
  label: string
  rank: number
}

/** One resolved Today row: the task plus its reason and (sub)category names. */
export type TodayRow = {
  task: Task
  reason: TodayReason
  subName: string
  catName: string
}

/** The dashboard slice the resolver reads. */
export type TodayData = {
  categories: Category[]
  subcategories: Subcategory[]
  tasks: Task[]
}

// Shared, frozen reason singletons — labels + ranks only.
const OVERDUE: TodayReason = { key: 'overdue', label: 'Overdue', rank: 0 }
const DUE_TODAY: TodayReason = { key: 'due', label: 'Due today', rank: 1 }
const PRIORITY: TodayReason = { key: 'priority', label: 'Priority', rank: 2 }
/** Synthetic reason for a user-pinned task with no auto signal. */
export const PINNED: TodayReason = { key: 'pinned', label: 'Pinned', rank: 3 }

/** [start, end] epoch-ms for local midnight..end-of-day around `now`. */
function todayBounds(now: Date): [number, number] {
  const s = new Date(now.getTime())
  s.setHours(0, 0, 0, 0)
  const e = new Date(now.getTime())
  e.setHours(23, 59, 59, 999)
  return [s.getTime(), e.getTime()]
}

/**
 * The single highest-precedence reason a task belongs in Today, or `null`.
 * Completed tasks always return `null`. Precedence: Overdue → Due today →
 * Priority.
 */
export function todayReason(
  task: Task | null | undefined,
  now: Date = new Date(),
): TodayReason | null {
  if (!task || task.completedAt) return null
  const [start, end] = todayBounds(now)
  const nowMs = now.getTime()
  const r = task.remindAt ? new Date(task.remindAt).getTime() : null
  if (r != null && !Number.isNaN(r)) {
    if (r < nowMs) return OVERDUE
    if (r >= start && r <= end) return DUE_TODAY
  }
  if (task.priority === 1) return PRIORITY
  return null
}

/**
 * Ids the app auto-plans for today (before any manual pins/removes). This seeds
 * the membership Set.
 */
export function autoTodayIds(
  tasks: Task[] | null | undefined,
  now: Date = new Date(),
): Set<string> {
  const ids = new Set<string>()
  for (const t of tasks ?? []) {
    if (todayReason(t, now)) ids.add(t.id)
  }
  return ids
}

/**
 * Resolve the final, ordered Today rows given the live membership set. A task in
 * the set with no auto signal gets the synthetic `Pinned` reason. Completed
 * tasks are kept (so the done/total count and the linger animation work) and
 * sink to the bottom.
 *
 * Sort: incomplete-before-complete → reason rank → shortest estimate first.
 */
export function resolveToday(
  data: TodayData,
  todaySet: Set<string>,
  now: Date = new Date(),
): TodayRow[] {
  const subName: Record<string, string> = {}
  const catOfSub: Record<string, string> = {}
  for (const s of data.subcategories) {
    subName[s.id] = s.name
    const cat = data.categories.find((c) => c.id === s.categoryId)
    catOfSub[s.id] = cat ? cat.name : ''
  }

  const rows: TodayRow[] = data.tasks
    .filter((t) => todaySet.has(t.id))
    .map((t) => ({
      task: t,
      reason: todayReason(t, now) ?? PINNED,
      subName: subName[t.subcategoryId] ?? '',
      catName: catOfSub[t.subcategoryId] ?? '',
    }))

  rows.sort(
    (a, b) =>
      (a.task.completedAt ? 1 : 0) - (b.task.completedAt ? 1 : 0) ||
      a.reason.rank - b.reason.rank ||
      a.task.estimateMinutes - b.task.estimateMinutes,
  )
  return rows
}

/**
 * Reconcile a persistent membership Set against a changed task list, preserving
 * the user's manual intent:
 *
 *   - Members whose task still exists are kept (so a completed task lingers in
 *     the plan and keeps counting toward done/total — it is NOT re-derived out).
 *   - Tasks that were deleted drop out.
 *   - Tasks that newly appeared AND carry an auto signal are added, so a
 *     just-created Priority/overdue task joins the plan without wiping the
 *     user's existing pins/removes.
 *
 * `prevIds` is the task-id set from the render that last seeded/reconciled the
 * membership; it lets us tell "newly appeared" from "was already here". This is
 * the seed-per-load contract (README) applied incrementally rather than on
 * every in-place edit.
 */
export function reconcileTodayMembership(
  prev: Set<string>,
  prevIds: Set<string>,
  tasks: Task[],
  now: Date = new Date(),
): Set<string> {
  const curIds = new Set(tasks.map((t) => t.id))
  const next = new Set<string>()
  for (const id of prev) {
    if (curIds.has(id)) next.add(id)
  }
  for (const t of tasks) {
    if (!prevIds.has(t.id) && todayReason(t, now)) next.add(t.id)
  }
  return next
}
