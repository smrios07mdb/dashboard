import { ChevronRight } from '@/components/icons'
import PriorityChip from '@/components/PriorityChip'
import TaskSortControl from '@/components/TaskSortControl'
import { Pill } from '@/components/ui/pill'
import type { Task } from '@/db/types'
import { catColor, fmtMin } from '@/lib/cat'
import { compareTasks, type TaskSortKey } from '@/lib/taskSort'

/*
 * Unscheduled-task tray (chunk 36, README §1 left tray + §2 mobile rows).
 *
 * Read-only this chunk: every open task lives here (no `scheduled_blocks`
 * until 37), cards are static — no drag handles, no grab cursors. Sorting
 * reuses the chunk-33 global preference via the shared `TaskSortControl`
 * trigger (locked decision D4); the prototype's segmented control is
 * deliberately not rebuilt. Grouped `P1 — URGENT` headers render only
 * under the priority sort; Due/Estimate sorts render flat.
 */

export type TrayItem = {
  task: Task
  /** Category name for the meta dot ('Work' | 'Personal'). */
  catName: string
  overdue: boolean
  /** `Tue 5` / `May 12`-style due fragment; null when no due date. */
  dueText: string | null
  dueToday: boolean
}

const GROUPS: Array<{
  p: 1 | 2 | 3 | null
  label: string
  color: string
}> = [
  { p: 1, label: 'P1 — Urgent', color: 'hsl(var(--destructive))' },
  {
    p: 2,
    label: 'P2 — Soon',
    color: 'color-mix(in srgb, var(--warn) 62%, var(--ink))',
  },
  { p: 3, label: 'P3 — Whenever', color: 'var(--ink-3)' },
  { p: null, label: 'No priority', color: 'var(--ink-3)' },
]

function sortItems(items: TrayItem[], sortKey: TaskSortKey): TrayItem[] {
  const cmp = compareTasks(sortKey)
  return [...items].sort((a, b) => cmp(a.task, b.task))
}

function TrayCard({ item }: { item: TrayItem }) {
  const { task, catName, overdue, dueText, dueToday } = item
  return (
    <div
      className="rounded border border-line bg-surface shadow-sm"
      style={{
        borderLeft: overdue ? '3px solid hsl(var(--destructive))' : undefined,
        padding: overdue ? '10px 12px 10px 10px' : '10px 12px',
      }}
    >
      <div className="flex items-start gap-2">
        {task.priority !== null && (
          <PriorityChip priority={task.priority} className="mt-px" />
        )}
        <span className="min-w-0 flex-1 text-[13px] font-medium leading-[1.35] text-ink">
          {task.title}
        </span>
      </div>
      <div className="mt-[7px] flex items-center gap-[7px]">
        <span
          aria-hidden
          className="shrink-0 rounded-[3px]"
          style={{ width: 8, height: 8, background: catColor(catName) }}
        />
        {dueText && (
          <span
            className="text-[11px]"
            style={{
              color: overdue
                ? 'hsl(var(--destructive))'
                : dueToday
                  ? 'var(--ink-2)'
                  : 'var(--ink-3)',
              fontWeight: overdue || dueToday ? 500 : 400,
            }}
          >
            {overdue ? `Overdue · ${dueText}` : `Due ${dueText}`}
          </span>
        )}
        <span className="ml-auto" />
        <span className="num mono text-[11px] text-ink-2">
          {fmtMin(task.estimateMinutes)}
        </span>
      </div>
    </div>
  )
}

export type PlannerTrayProps = {
  items: TrayItem[]
  sortKey: TaskSortKey
  onChangeSortKey: (key: TaskSortKey) => void
}

/** Desktop left tray: 300px, 1px right rule. */
export default function PlannerTray({
  items,
  sortKey,
  onChangeSortKey,
}: PlannerTrayProps) {
  const sorted = sortItems(items, sortKey)
  const overdueN = items.filter((i) => i.overdue).length
  const groups =
    sortKey === 'priority'
      ? GROUPS.map((g) => ({
          ...g,
          items: sorted.filter((i) => i.task.priority === g.p),
        })).filter((g) => g.items.length > 0)
      : [{ p: null, label: null, color: '', items: sorted }]

  return (
    <aside className="w-[300px] shrink-0 border-r border-line pr-6">
      <div className="mb-3 flex items-center gap-2">
        <span className="label">Unscheduled</span>
        <Pill tone="neutral">
          <span className="num mono">{items.length}</span>
        </Pill>
        {overdueN > 0 && (
          <span
            className="label"
            style={{ fontSize: 9, color: 'hsl(var(--destructive))' }}
          >
            {overdueN} OVERDUE
          </span>
        )}
        <span className="ml-auto" />
        <TaskSortControl value={sortKey} onChange={onChangeSortKey} />
      </div>
      {items.length === 0 ? (
        <div className="mt-3.5 rounded-md border border-dashed border-line-strong px-[18px] py-[26px] text-center">
          <div className="text-[13px] text-ink-2">No unscheduled tasks.</div>
          <div className="mt-1 text-[12px] text-ink-3">
            New tasks wait here until you place them.
          </div>
        </div>
      ) : (
        groups.map((g, gi) => (
          <div key={gi} className="mt-4">
            {g.label && (
              <div className="mb-2 flex items-baseline gap-2">
                <span className="label" style={{ color: g.color }}>
                  {g.label}
                </span>
                <span className="num mono text-[10px] text-ink-4">
                  {g.items.length}
                </span>
              </div>
            )}
            <div className="flex flex-col gap-2">
              {g.items.map((item) => (
                <TrayCard key={item.task.id} item={item} />
              ))}
            </div>
          </div>
        ))
      )}
    </aside>
  )
}

/**
 * Mobile `UNSCHEDULED (N)` section — compact read-only rows. Inert this
 * chunk (tap-to-schedule is chunk 37's Schedule sheet), so rows are plain
 * divs, not buttons.
 */
export function MobileUnscheduledList({
  items,
  sortKey,
}: {
  items: TrayItem[]
  sortKey: TaskSortKey
}) {
  const sorted = sortItems(items, sortKey)
  return (
    <section className="pb-6">
      <div className="mb-1 flex items-center gap-2 pt-4">
        <span className="label">Unscheduled ({items.length})</span>
      </div>
      {sorted.length === 0 ? (
        <div className="py-3 text-[12px] text-ink-3">No unscheduled tasks.</div>
      ) : (
        sorted.map((item) => (
          <div
            key={item.task.id}
            className="grid w-full grid-cols-[auto_1fr_auto_auto_auto] items-center gap-[9px] border-b border-line px-0.5 py-[11px] text-left"
          >
            {item.task.priority !== null ? (
              <PriorityChip priority={item.task.priority} />
            ) : (
              <span />
            )}
            <span className="flex min-w-0 items-center gap-[7px]">
              <span className="overflow-hidden text-ellipsis whitespace-nowrap text-[13px] font-medium text-ink">
                {item.task.title}
              </span>
              {item.overdue && (
                <span
                  className="label"
                  style={{ fontSize: 8, color: 'hsl(var(--destructive))' }}
                >
                  OVERDUE
                </span>
              )}
            </span>
            <span
              aria-hidden
              className="shrink-0 rounded-[3px]"
              style={{ width: 8, height: 8, background: catColor(item.catName) }}
            />
            <span className="num mono text-[11px] text-ink-2">
              {fmtMin(item.task.estimateMinutes)}
            </span>
            <ChevronRight size={13} className="text-ink-4" aria-hidden />
          </div>
        ))
      )}
    </section>
  )
}
