/*
 * Suggestions for a short Today plan (chunk 67, UX audit #9).
 *
 * Today fills only from Overdue / Due today / Priority 1 / a manual pin
 * (`lib/today`), so a task list with no priority, due date or reminder leaves
 * the panel empty. While the plan holds fewer than `TODAY_PLAN_TARGET` tasks,
 * `TodayPanel` offers the open tasks picked here; Add writes an ordinary pin.
 *
 * Pure and deterministic: no React, no I/O, no clock, no time zone. Ordering is
 * a function of the rows alone.
 */
import type { Category, Subcategory, Task } from '@/db/types'

/** The plan size below which the panel suggests tasks (done ones count). */
export const TODAY_PLAN_TARGET = 3

/** One suggested task plus its (sub)category names. */
export type TodaySuggestion = {
  task: Task
  subName: string
  catName: string
}

/** The dashboard slice the picker reads (the shape `TodayPanel` receives). */
export type TodaySuggestData = {
  categories: Category[]
  subcategories: Subcategory[]
  tasks: Task[]
}

/** null priority ranks after P3. Never coerce null to 3 (`taskSort.ts`). */
function priorityRank(p: Task['priority']): number {
  return p ?? 4
}

/**
 * Epoch ms of an ISO timestamp; absent or unparseable ranks last.
 * MAX_SAFE_INTEGER (not Infinity) so subtracting two absent ranks stays 0.
 */
const ABSENT = Number.MAX_SAFE_INTEGER
function timeRank(iso: string | null): number {
  if (!iso) return ABSENT
  const t = Date.parse(iso)
  return Number.isNaN(t) ? ABSENT : t
}

/** Priority 1 → 2 → 3 → null, soonest due, oldest created, then id. */
function compareCandidates(a: Task, b: Task): number {
  return (
    priorityRank(a.priority) - priorityRank(b.priority) ||
    timeRank(a.dueAt) - timeRank(b.dueAt) ||
    timeRank(a.createdAt) - timeRank(b.createdAt) ||
    (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  )
}

/**
 * Up to `limit` open tasks worth pinning to today, best first.
 *
 * Candidates are open tasks outside `todaySet` and `skipped` whose subcategory
 * is in `data.subcategories`. They are grouped by category and sorted within
 * each group; the groups are ordered by their best candidate and then take
 * turns, so one category never fills the list while another has open work.
 */
export function suggestToday(
  data: TodaySuggestData,
  todaySet: ReadonlySet<string>,
  skipped: ReadonlySet<string>,
  limit: number,
): TodaySuggestion[] {
  if (!(limit > 0)) return []

  const subById = new Map(data.subcategories.map((s) => [s.id, s]))
  const catNameById = new Map(data.categories.map((c) => [c.id, c.name]))

  const groups = new Map<string, Task[]>()
  for (const t of data.tasks) {
    if (t.completedAt !== null) continue
    if (todaySet.has(t.id) || skipped.has(t.id)) continue
    const sub = subById.get(t.subcategoryId)
    if (!sub) continue
    const group = groups.get(sub.categoryId)
    if (group) group.push(t)
    else groups.set(sub.categoryId, [t])
  }

  const ordered = [...groups.values()]
  for (const group of ordered) group.sort(compareCandidates)
  ordered.sort((a, b) => compareCandidates(a[0], b[0]))

  const out: TodaySuggestion[] = []
  for (let turn = 0; out.length < limit; turn++) {
    let took = false
    for (const group of ordered) {
      const t = group[turn]
      if (!t) continue
      took = true
      const sub = subById.get(t.subcategoryId)!
      out.push({
        task: t,
        subName: sub.name,
        catName: catNameById.get(sub.categoryId) ?? '',
      })
      if (out.length >= limit) break
    }
    if (!took) break
  }
  return out
}
