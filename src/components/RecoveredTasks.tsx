import { useId } from 'react'

import type { Category, Subcategory, Task } from '@/db/types'

/*
 * Recovered tasks (chunk 70 — UX audit #4).
 *
 * Open tasks whose subcategory is archived or missing are filtered out of every
 * list, so nothing could reach them. This card is the one place they surface:
 * each row can be moved into a live list or marked done. Prop-driven — the
 * Dashboard derives the orphans and owns both mutations.
 */

type RecoveredTasksProps = {
  tasks: Task[]
  /** Names of every subcategory, archived ones included. */
  subNameById: Record<string, string>
  liveSubcategories: Subcategory[]
  categories: Category[]
  onMove: (taskId: string, subcategoryId: string) => void
  onComplete: (taskId: string) => void
}

export default function RecoveredTasks({
  tasks,
  subNameById,
  liveSubcategories,
  categories,
  onMove,
  onComplete,
}: RecoveredTasksProps) {
  const headingId = useId()
  if (tasks.length === 0) return null

  const subsOf = (categoryId: string) =>
    liveSubcategories
      .filter((s) => s.categoryId === categoryId)
      .sort((a, b) => a.sortOrder - b.sortOrder)

  return (
    <section
      aria-labelledby={headingId}
      className="mb-6 border border-line bg-surface px-5 py-4 shadow-md"
      style={{ borderRadius: 'var(--radius-lg)' }}
    >
      <div className="flex items-baseline gap-2">
        <h2
          id={headingId}
          className="m-0 font-display text-[16px] font-semibold text-ink"
        >
          Recovered
        </h2>
        <span className="num text-[12px] text-ink-3">{tasks.length}</span>
      </div>
      <p className="mt-1 text-[13px] leading-relaxed text-ink-3">
        These open tasks were in lists that have since been deleted. Move each
        into a list, or mark it done.
      </p>
      <ul className="m-0 mt-2 list-none p-0">
        {tasks.map((task) => (
          <li
            key={task.id}
            className="flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-line py-2.5"
          >
            <div className="min-w-0 flex-[1_1_200px]">
              <div className="break-words text-[14px] text-ink">
                {task.title}
              </div>
              <div className="text-[12px] text-ink-3">
                from {subNameById[task.subcategoryId] ?? 'a deleted list'}
              </div>
            </div>
            <select
              aria-label={`Move ${task.title} to`}
              value=""
              onChange={(e) => {
                if (e.target.value) onMove(task.id, e.target.value)
              }}
              className="min-h-11 max-w-full rounded-md border border-line bg-bg px-2.5 text-base text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:text-[13px]"
            >
              <option value="" disabled>
                Move to…
              </option>
              {categories.map((cat) => (
                <optgroup key={cat.id} label={cat.name}>
                  {subsOf(cat.id).map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
            <button
              type="button"
              aria-label={`Mark ${task.title} done`}
              onClick={() => onComplete(task.id)}
              className="min-h-11 rounded-md border border-line bg-bg px-3.5 text-[13px] font-semibold text-ink hover:bg-bg-alt focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              Done
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}
