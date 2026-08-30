import type { PointerEvent } from 'react'

import { ChevronRight } from '@/components/icons'
import PriorityChip from '@/components/PriorityChip'
import TaskSortControl from '@/components/TaskSortControl'
import { Pill } from '@/components/ui/pill'
import type { Task } from '@/db/types'
import { catColor, fmtMin } from '@/lib/cat'
import { compareTasks, type TaskSortKey } from '@/lib/taskSort'

/*
 * Unscheduled-task tray (chunk 36 shape, chunk 37 interactions).
 *
 * Tray = open tasks with no scheduled block (the screen splits them —
 * `splitTray`). Cards are `<button>`s: `pointerdown` hands off to the
 * screen's drag hook (desktop), a click without a drag opens the Schedule
 * sheet — the keyboard path (D7). The source card goes ghost while its
 * floating twin is being dragged. Sorting reuses the chunk-33 global
 * preference via `TaskSortControl`; grouped `P1 — URGENT` headers render
 * only under the priority sort.
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

export type TrayCardProps = {
  item: TrayItem
  /** Source card while its floating twin is dragged: dashed, 45%, no shadow. */
  ghost?: boolean
  /** Touch device: no grab cursor, tap opens the sheet. */
  touch?: boolean
  onPointerDown?: (e: PointerEvent<HTMLElement>, item: TrayItem) => void
  onClick?: (item: TrayItem) => void
  /** Presentational twin (floating card): no handlers, not focusable. */
  inert?: boolean
}

export function TrayCard({
  item,
  ghost = false,
  touch = false,
  onPointerDown,
  onClick,
  inert = false,
}: TrayCardProps) {
  const { task, catName, overdue, dueText, dueToday } = item
  const body = (
    <>
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
    </>
  )
  // Never put a CSS shorthand and one of its longhands in the same inline
  // style object (`border`/`borderLeft`, `textDecoration`/
  // `textDecorationColor`, …): React 19 logs a conflicting-style
  // `console.error` when both flip in one commit. Variant borders go
  // through class names; `borderLeft` is the only border key inline.
  const style = {
    borderLeft: overdue && !ghost ? '3px solid hsl(var(--destructive))' : undefined,
    padding: overdue && !ghost ? '10px 12px 10px 10px' : '10px 12px',
    opacity: ghost ? 0.45 : 1,
    boxShadow: ghost ? 'none' : undefined,
    cursor: inert ? 'grabbing' : touch ? 'default' : 'grab',
    userSelect: 'none' as const,
    touchAction: 'none' as const,
  }
  const cls = `w-full rounded border bg-surface text-left transition-colors ${
    ghost
      ? 'border-dashed border-line-strong'
      : 'border-line shadow-sm hover:border-line-strong'
  }`
  if (inert) {
    return (
      <div className={cls} style={style} aria-hidden>
        {body}
      </div>
    )
  }
  return (
    <button
      type="button"
      aria-label={`${task.title} — schedule`}
      className={`${cls} focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring`}
      style={style}
      onPointerDown={onPointerDown ? (e) => onPointerDown(e, item) : undefined}
      onClick={onClick ? () => onClick(item) : undefined}
    >
      {body}
    </button>
  )
}

export type PlannerTrayProps = {
  items: TrayItem[]
  sortKey: TaskSortKey
  onChangeSortKey: (key: TaskSortKey) => void
  /** Opens the Schedule sheet (click without drag / keyboard). */
  onSchedule?: (item: TrayItem) => void
  /** Starts a tray drag (desktop). */
  onCardPointerDown?: (e: PointerEvent<HTMLElement>, item: TrayItem) => void
  /** Task id currently being dragged — its card renders as a ghost. */
  draggingTaskId?: string | null
  touch?: boolean
}

/** Desktop left tray: 300px, 1px right rule. */
export default function PlannerTray({
  items,
  sortKey,
  onChangeSortKey,
  onSchedule,
  onCardPointerDown,
  draggingTaskId = null,
  touch = false,
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
                <TrayCard
                  key={item.task.id}
                  item={item}
                  ghost={item.task.id === draggingTaskId}
                  touch={touch}
                  onPointerDown={touch ? undefined : onCardPointerDown}
                  onClick={onSchedule}
                />
              ))}
            </div>
          </div>
        ))
      )}
    </aside>
  )
}

/**
 * Mobile `UNSCHEDULED (N)` section — compact rows; tap opens the Schedule
 * sheet for the selected day (chunk 37).
 */
export function MobileUnscheduledList({
  items,
  sortKey,
  onSchedule,
}: {
  items: TrayItem[]
  sortKey: TaskSortKey
  onSchedule?: (item: TrayItem) => void
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
          <button
            key={item.task.id}
            type="button"
            aria-label={`${item.task.title} — schedule`}
            onClick={() => onSchedule?.(item)}
            className="grid w-full grid-cols-[auto_1fr_auto_auto_auto] items-center gap-[9px] border-b border-line px-0.5 py-[11px] text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
          </button>
        ))
      )}
    </section>
  )
}
