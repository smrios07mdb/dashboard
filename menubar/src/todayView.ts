/*
 * Menu bar Today view (chunk 91) — data in, rows + counts + tray title out.
 *
 * Pure. Every rule here is the app's own, imported, never re-implemented:
 *   - live lists / live tasks: the Dashboard's filter (archived lists out);
 *   - membership `(auto ∪ pins) − removes`, marks dated today in the Settings
 *     zone: `autoTodayIds`, `resolveTodayDeltas`, `applyTodayDeltas`;
 *   - row order and the done-sinks-last rule: `resolveToday`;
 *   - the when-chip: `lib/whenLabel`, a due date winning over a reminder and
 *     none on a completed row (the TaskRow rule).
 *
 * This is the membership the Dashboard resolves on a fresh load. Like the
 * Dashboard, a task completed during the session stays in the plan, struck,
 * until the next start: the popover passes those ids as `keep` (chunk 92).
 */
import type { Category, Subcategory, Task, TodayMark } from '@/db/types'
import { dateKeyIn } from '@/lib/clock'
import { autoTodayIds, resolveToday } from '@/lib/today'
import { dueLabel, reminderLabel, type WhenLabel } from '@/lib/whenLabel'
import { applyTodayDeltas, resolveTodayDeltas } from '@/state/todayPlan'

export type TodayViewInput = {
  categories: Category[]
  subcategories: Subcategory[]
  tasks: Task[]
  marks: TodayMark[]
  timeZone: string
  /** Completed in this session: stay in Today though no longer auto. */
  keep?: ReadonlySet<string>
}

export type TodayViewRow = {
  id: string
  /** The source row — what a check-off and its Undo act on (chunk 92). */
  task: Task
  title: string
  catName: string
  priority: 1 | 2 | 3 | null
  when: WhenLabel | null
  minutes: number
  done: boolean
}

export type TodayView = {
  rows: TodayViewRow[]
  done: number
  total: number
  open: number
  /** The tray title: the open count, `''` at zero. */
  trayTitle: string
}

export const EMPTY_TODAY_VIEW: TodayView = {
  rows: [],
  done: 0,
  total: 0,
  open: 0,
  trayTitle: '',
}

function priorityOf(task: Task): 1 | 2 | 3 | null {
  return task.priority === 1 || task.priority === 2 || task.priority === 3
    ? task.priority
    : null
}

function whenOf(task: Task, timeZone: string, now: Date): WhenLabel | null {
  if (task.completedAt) return null
  if (task.dueAt) return dueLabel(task.dueAt, timeZone, now)
  if (task.remindAt) return reminderLabel(task.remindAt, timeZone, now)
  return null
}

export function buildTodayView(
  input: TodayViewInput,
  now: Date = new Date(),
): TodayView {
  const { categories, timeZone } = input
  const subcategories = input.subcategories.filter((s) => !s.archivedAt)
  const liveSubIds = new Set(subcategories.map((s) => s.id))
  const tasks = input.tasks.filter((t) => liveSubIds.has(t.subcategoryId))

  const day = dateKeyIn(now, timeZone)
  const deltas = resolveTodayDeltas(input.marks, tasks, day, new Map())
  const membership = applyTodayDeltas(autoTodayIds(tasks, timeZone, now), deltas)
  for (const id of input.keep ?? []) {
    if (!deltas.removed.has(id)) membership.add(id)
  }

  const rows = resolveToday(
    { categories, subcategories, tasks },
    membership,
    timeZone,
    now,
  ).map(
    ({ task, catName }): TodayViewRow => ({
      id: task.id,
      task,
      title: task.title,
      catName,
      priority: priorityOf(task),
      when: whenOf(task, timeZone, now),
      minutes: task.estimateMinutes,
      done: !!task.completedAt,
    }),
  )

  return withCounts(rows)
}

function withCounts(rows: TodayViewRow[]): TodayView {
  const done = rows.filter((r) => r.done).length
  const open = rows.length - done
  return {
    rows,
    done,
    total: rows.length,
    open,
    trayTitle: open > 0 ? String(open) : '',
  }
}

/**
 * Show in-flight check-offs (chunk 92): each id in `optimistic` takes the
 * done state given. Order is left alone — the refresh after the write
 * re-sorts.
 */
export function applyOptimistic(
  view: TodayView,
  optimistic: ReadonlyMap<string, boolean>,
): TodayView {
  if (optimistic.size === 0) return view
  const rows = view.rows.map((r) => {
    const done = optimistic.get(r.id)
    if (done === undefined || done === r.done) return r
    return { ...r, done, when: done ? null : r.when }
  })
  return withCounts(rows)
}
