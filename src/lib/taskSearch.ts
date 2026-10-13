import type { Category, Subcategory, Task } from '@/db/types'

/*
 * Open-task search (chunk 73, UX audit #7). Pure: the dialog loads the rows
 * and passes them in. Matches on the task title and its list name; completed
 * tasks, notes and list names on their own are out of scope.
 */

export type TaskSearchHit = { task: Task; subName: string; catName: string }

/** Open tasks matching every whitespace-separated term of `query`. */
export function searchTasks(
  query: string,
  data: { categories: Category[]; subcategories: Subcategory[]; tasks: Task[] },
  limit = 20,
): TaskSearchHit[] {
  const terms = query.toLowerCase().split(/\s+/).filter((t) => t.length > 0)
  if (terms.length === 0) return []

  const catName = new Map(data.categories.map((c) => [c.id, c.name]))
  const liveSubs = new Map(
    data.subcategories.filter((s) => s.archivedAt === null).map((s) => [s.id, s]),
  )

  const hits: TaskSearchHit[] = []
  for (const task of data.tasks) {
    if (task.completedAt !== null) continue
    const sub = liveSubs.get(task.subcategoryId)
    if (!sub) continue
    const haystack = `${task.title} ${sub.name}`.toLowerCase()
    if (!terms.every((t) => haystack.includes(t))) continue
    hits.push({ task, subName: sub.name, catName: catName.get(sub.categoryId) ?? '' })
  }

  // Titles starting with the first term lead; oldest first within each group.
  const leads = (h: TaskSearchHit) => (h.task.title.toLowerCase().startsWith(terms[0]) ? 0 : 1)
  hits.sort(
    (a, b) => leads(a) - leads(b) || a.task.createdAt.localeCompare(b.task.createdAt),
  )
  return hits.slice(0, limit)
}
