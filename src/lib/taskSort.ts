import type { Task } from '@/db/types'

/*
 * Shared task-list comparator + sort preference (chunk 33).
 *
 * One global preference applies to every list (Dashboard columns and
 * both drill-downs), persisted under `hupo.taskSort`. Sort applies
 * within the open set only — completed rows keep whatever placement the
 * hosting list already gives them.
 *
 * Priority semantics (canonical for the planner series): 1 → 2 → 3 →
 * null, where null = "no priority set" and always sorts after P3.
 * Never coerce null to 3.
 */

export type TaskSortKey = 'priority' | 'due' | 'estimate'

export const TASK_SORT_STORAGE_KEY = 'hupo.taskSort'

export const DEFAULT_TASK_SORT: TaskSortKey = 'priority'

export const TASK_SORT_OPTIONS: { value: TaskSortKey; label: string }[] = [
  { value: 'priority', label: 'Priority' },
  { value: 'due', label: 'Due date' },
  { value: 'estimate', label: 'Estimate' },
]

function isTaskSortKey(v: unknown): v is TaskSortKey {
  return v === 'priority' || v === 'due' || v === 'estimate'
}

/** Read the persisted preference; falls back to 'priority'. */
export function loadTaskSortKey(): TaskSortKey {
  try {
    const raw = localStorage.getItem(TASK_SORT_STORAGE_KEY)
    return isTaskSortKey(raw) ? raw : DEFAULT_TASK_SORT
  } catch {
    return DEFAULT_TASK_SORT
  }
}

export function storeTaskSortKey(key: TaskSortKey): void {
  try {
    localStorage.setItem(TASK_SORT_STORAGE_KEY, key)
  } catch {
    // Private-mode / quota failures just lose persistence, not sorting.
  }
}

/** null priority ranks after P3. */
function priorityRank(p: Task['priority']): number {
  return p ?? 4
}

/**
 * null due_at ranks last. Invalid dates collapse to "no due date".
 * MAX_SAFE_INTEGER (not Infinity) so subtracting two no-due ranks stays
 * 0, not NaN.
 */
const NO_DUE = Number.MAX_SAFE_INTEGER
function dueRank(dueAt: Task['dueAt']): number {
  if (!dueAt) return NO_DUE
  const t = Date.parse(dueAt)
  return Number.isNaN(t) ? NO_DUE : t
}

/** ISO strings compare lexicographically in chronological order. */
function byCreated(a: Task, b: Task): number {
  return a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0
}

/**
 * Comparator factory for `Array.prototype.sort`.
 *
 *   priority — 1 → 2 → 3 → null; ties by due_at asc (nulls last), then
 *              created_at asc
 *   due      — due_at asc, nulls last; ties by priority, then created_at
 *   estimate — estimate_minutes asc; ties by priority, then created_at
 */
export function compareTasks(key: TaskSortKey): (a: Task, b: Task) => number {
  return (a, b) => {
    if (key === 'priority') {
      return (
        priorityRank(a.priority) - priorityRank(b.priority) ||
        dueRank(a.dueAt) - dueRank(b.dueAt) ||
        byCreated(a, b)
      )
    }
    if (key === 'due') {
      return (
        dueRank(a.dueAt) - dueRank(b.dueAt) ||
        priorityRank(a.priority) - priorityRank(b.priority) ||
        byCreated(a, b)
      )
    }
    return (
      a.estimateMinutes - b.estimateMinutes ||
      priorityRank(a.priority) - priorityRank(b.priority) ||
      byCreated(a, b)
    )
  }
}
