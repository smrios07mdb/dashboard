import { useEffect, useState, type PointerEvent } from 'react'

import BusyBlock from '@/components/planner/BusyBlock'
import BusyPopover from '@/components/planner/BusyPopover'
import DropSlot from '@/components/planner/DropSlot'
import TaskBlock from '@/components/planner/TaskBlock'
import type { DragState } from '@/components/planner/usePlannerDrag'
import WindowRail from '@/components/planner/WindowRail'
import type { Task } from '@/db/types'
import { fmtMin } from '@/lib/cat'
import {
  DAY_LABELS,
  expandedWindow,
  fmtClock,
  hiddenCounts,
  PLANNER,
  type WeekBusyBlock,
} from '@/lib/plannerGeometry'
import { overlapBusy, type WeekScheduledBlock } from '@/lib/plannerSchedule'

/*
 * Desktop week grid (chunk 36 geometry, chunk 37 scheduling).
 *
 * 56px gutter, `repeat(5,1fr) repeat(2,.55fr)` columns with 1px `--line`
 * left rules, 52px hours, hour rules via repeating-linear-gradient, 1px
 * `--line-strong` header separator, weekend 45% `--bg-alt` wash, today
 * 60% `--surface` lift + emerald dot, SHOW/HIDE collapsed-hour rails.
 *
 * Z-order per DESIGN_NOTES: busy (z1) → now-line (z2) → task blocks (z3)
 * → drop slot (z4) → empty-week copy (z5). Rails and the expanded window
 * count task blocks as well as busy (D10). The drag state comes from the
 * screen's `usePlannerDrag`: a resize previews live on the block itself,
 * a tray/move drag renders the dashed `DropSlot` (destructive when the
 * candidate range overlaps busy — advisory, D8).
 *
 * The visible-window flags (top/bottom expanded) are local UI state,
 * reported upward via `onWindowChange` so the drag hook can clamp.
 */

const COLS = `${PLANNER.gutter}px repeat(5, 1fr) repeat(2, .55fr)`

const hourLines = (hourH: number) =>
  `repeating-linear-gradient(to bottom, var(--line) 0 1px, transparent 1px ${hourH}px)`

/** Data-freshness phase shared by `WeekGrid` and `DayTimeline` (R3). */
export type GridPhase = 'cold' | 'refreshing' | 'ready'

/** A scheduled block joined with its task for rendering. */
export type GridTaskBlock = {
  block: WeekScheduledBlock
  task: Task
  catName: string
  /** `blockIsDone(task)` — from `task.completedAt` only (chunk 37 R1). */
  done: boolean
}

function DayHeader({
  date,
  label,
  isToday,
  free,
}: {
  date: Date
  label: string
  isToday: boolean
  free: number | null | undefined
}) {
  return (
    <div className="pb-2 pl-3">
      <div className="flex items-baseline gap-[7px]">
        <span className="label" style={isToday ? { color: 'var(--ink-2)' } : undefined}>
          {label}
        </span>
        <span
          className="num mono text-[15px]"
          style={{
            fontWeight: isToday ? 600 : 500,
            color: isToday ? 'var(--ink)' : 'var(--ink-2)',
          }}
        >
          {date.getDate()}
        </span>
        {isToday && (
          <span
            aria-hidden
            className="self-center rounded-full"
            style={{ width: 5, height: 5, background: 'var(--work)' }}
          />
        )}
      </div>
      <div
        className="num mono mt-0.5 min-h-3 text-[9px]"
        style={{ color: isToday ? 'var(--ink-2)' : 'var(--ink-3)' }}
      >
        {free == null ? '—' : `${fmtMin(free)} free`}
      </div>
    </div>
  )
}

function NowLine({
  nowMin,
  hourH,
  windowStartMin,
  windowEndMin,
}: {
  nowMin: number
  hourH: number
  windowStartMin: number
  windowEndMin: number
}) {
  if (nowMin < windowStartMin || nowMin > windowEndMin) return null
  return (
    <div
      aria-hidden
      className="absolute inset-x-0"
      style={{ zIndex: 2, top: ((nowMin - windowStartMin) / 60) * hourH }}
    >
      <div style={{ height: 2, background: 'var(--work)', borderRadius: 1 }} />
      <span
        className="absolute rounded-full"
        style={{ left: -3, top: -2.5, width: 7, height: 7, background: 'var(--work)' }}
      />
    </div>
  )
}

export type WeekGridProps = {
  days: Date[]
  /** Index of today within the week; may fall outside 0–6. */
  todayIdx: number
  /** Local minutes since midnight (drives the now-line). */
  nowMin: number
  busy: WeekBusyBlock[]
  stale: boolean
  staleTime: string | null
  /** Epoch ms of the busy fetch (popover "Synced Xm ago"), null pre-fetch. */
  fetchedAt: number | null
  /**
   * `cold` = no data yet for the visible week (dims to 50%); `refreshing`
   * = a background refetch (realtime echo, TTL, focus) with current data
   * still on screen at full opacity; `ready` = settled.
   */
  phase: GridPhase
  /** CalendarError message for the quiet inline notice; null when healthy. */
  errorMessage: string | null
  /** Per-day free minutes (Mon–Fri); null = past day, undefined = weekend
   *  (outside the planning window) — both render the `—` placeholder. */
  dayFree: Array<number | null | undefined>
  /** Scheduled blocks joined with their tasks (chunk 37). */
  scheduled?: GridTaskBlock[]
  /** Live drag state from `usePlannerDrag`; null when idle. */
  drag?: DragState | null
  /** Touch device — blocks get tap-to-open-actions, no drag handlers. */
  touch?: boolean
  onGridRef?: (el: HTMLDivElement | null) => void
  onWindowChange?: (w: { h0: number; h1: number }) => void
  onBlockPointerDown?: (
    e: PointerEvent<HTMLElement>,
    block: WeekScheduledBlock,
    catName: string,
  ) => void
  onResizePointerDown?: (e: PointerEvent<HTMLElement>, block: WeekScheduledBlock) => void
  onToggleDone?: (block: WeekScheduledBlock) => void
  onUnschedule?: (block: WeekScheduledBlock) => void
  onOpenActions?: (block: WeekScheduledBlock) => void
}

type OpenBusy = {
  block: WeekBusyBlock
  day: number
  top: number
  syncedAgoMin: number | null
}

export default function WeekGrid({
  days,
  todayIdx,
  nowMin,
  busy,
  stale,
  staleTime,
  fetchedAt,
  phase,
  errorMessage,
  dayFree,
  scheduled = [],
  drag = null,
  touch = false,
  onGridRef,
  onWindowChange,
  onBlockPointerDown,
  onResizePointerDown,
  onToggleDone,
  onUnschedule,
  onOpenActions,
}: WeekGridProps) {
  const [topExpanded, setTopExpanded] = useState(false)
  const [botExpanded, setBotExpanded] = useState(false)
  const [openBusy, setOpenBusy] = useState<OpenBusy | null>(null)

  // Expanded bounds stretch past 07:00/21:00 when data falls outside them,
  // so every block the rails count is reachable by expanding (D10: task
  // blocks count too).
  const all = [...busy, ...scheduled.map((g) => g.block)]
  const win = expandedWindow(all)
  const h0 = topExpanded ? win.start : PLANNER.winCollapsedStart
  const h1 = botExpanded ? win.end : PLANNER.winCollapsedEnd
  const gridH = ((h1 - h0) / 60) * PLANNER.hourH
  const hidden = hiddenCounts(all)

  useEffect(() => {
    onWindowChange?.({ h0, h1 })
  }, [h0, h1, onWindowChange])

  const hours: number[] = []
  for (let m = h0; m <= h1; m += 60) hours.push(m)

  // Live resize preview lands on the block itself (prototype `displaySched`).
  const displayed: GridTaskBlock[] =
    drag?.kind === 'resize'
      ? scheduled.map((g) =>
          g.block.id === drag.block.id
            ? { ...g, block: { ...g.block, endMin: drag.over.endMin } }
            : g,
        )
      : scheduled
  const draggingBlockId = drag?.kind === 'move' ? drag.block.id : null

  // Drop preview for tray/move drags; conflict variant on busy overlap.
  const dropOver = drag && drag.kind !== 'resize' && drag.over ? drag.over : null
  const dropCat = drag && drag.kind !== 'resize' ? drag.catName : ''
  const conflict = dropOver
    ? overlapBusy(dropOver.day, dropOver.startMin, dropOver.endMin, busy)
    : null
  const conflictNote = conflict?.title
    ? `OVERLAPS ${conflict.title.toUpperCase()} · ${conflict.mins}M`
    : null

  // Gated on scheduled blocks only (R4): a week of meetings with nothing
  // planned still gets the nudge; the copy sits at z5 over the overlays.
  const cold = phase === 'cold'
  const emptyWeek = scheduled.length === 0 && !cold && !drag

  return (
    <div data-testid="week-grid-root" className={cold ? 'opacity-50' : undefined}>
      {errorMessage && (
        <p className="mb-2 text-[12px] text-ink-3">
          {errorMessage} The grid is shown without calendar overlays.
        </p>
      )}

      <div className="grid" style={{ gridTemplateColumns: COLS }}>
        <div />
        {days.map((d, i) => (
          <DayHeader
            key={i}
            date={d}
            label={DAY_LABELS[i]}
            isToday={i === todayIdx}
            free={dayFree[i]}
          />
        ))}
      </div>

      <WindowRail
        side="top"
        expanded={topExpanded}
        onToggle={() => setTopExpanded((x) => !x)}
        label={`${fmtClock(win.start)} – ${fmtClock(PLANNER.winCollapsedStart)}`}
        hiddenCount={hidden.top}
      />

      <div
        ref={onGridRef}
        data-testid="week-grid"
        className="relative grid border-t border-line-strong"
        style={{ gridTemplateColumns: COLS }}
        onClick={() => setOpenBusy(null)}
      >
        {/* time gutter */}
        <div className="relative" style={{ height: gridH }}>
          {hours.map((m) => (
            <span
              key={m}
              className="num mono absolute right-2.5 text-[9.5px] text-ink-3"
              style={{
                top:
                  ((m - h0) / 60) * PLANNER.hourH -
                  (m === h0 ? 0 : m === h1 ? 13 : 6),
              }}
            >
              {fmtClock(m)}
            </span>
          ))}
        </div>

        {days.map((_, i) => {
          const wash =
            i === todayIdx
              ? ', linear-gradient(color-mix(in srgb, var(--surface) 60%, transparent), color-mix(in srgb, var(--surface) 60%, transparent))'
              : i >= 5
                ? ', linear-gradient(color-mix(in srgb, var(--bg-alt) 45%, transparent), color-mix(in srgb, var(--bg-alt) 45%, transparent))'
                : ''
          return (
            <div
              key={i}
              className="relative border-l border-line"
              style={{
                height: gridH,
                backgroundImage: hourLines(PLANNER.hourH) + wash,
              }}
            >
              {busy
                .filter((b) => b.day === i)
                .map((b, j) => (
                  <BusyBlock
                    key={j}
                    block={b}
                    hourH={PLANNER.hourH}
                    windowStartMin={h0}
                    windowEndMin={h1}
                    stale={stale}
                    staleTime={staleTime}
                    onOpen={(block, pos) =>
                      setOpenBusy({
                        block,
                        day: i,
                        top: Math.min(pos.top + pos.height + 4, gridH - 150),
                        // Computed in the handler — `Date.now()` stays out of render.
                        syncedAgoMin:
                          fetchedAt === null
                            ? null
                            : Math.floor((Date.now() - fetchedAt) / 60_000),
                      })
                    }
                  />
                ))}
              {i === todayIdx && (
                <NowLine
                  nowMin={nowMin}
                  hourH={PLANNER.hourH}
                  windowStartMin={h0}
                  windowEndMin={h1}
                />
              )}
              {displayed
                .filter((g) => g.block.day === i)
                .map((g) => (
                  <TaskBlock
                    key={`${g.block.id}-${g.block.startMin}`}
                    block={g.block}
                    task={g.task}
                    catName={g.catName}
                    hourH={PLANNER.hourH}
                    windowStartMin={h0}
                    windowEndMin={h1}
                    done={g.done}
                    dimmed={g.block.id === draggingBlockId}
                    touch={touch}
                    onBodyPointerDown={
                      onBlockPointerDown
                        ? (e, block) => onBlockPointerDown(e, block, g.catName)
                        : undefined
                    }
                    onResizePointerDown={onResizePointerDown}
                    onToggleDone={onToggleDone}
                    onUnschedule={onUnschedule}
                    onOpenActions={onOpenActions}
                  />
                ))}
              {dropOver && dropOver.day === i && (
                <DropSlot
                  startMin={dropOver.startMin}
                  endMin={dropOver.endMin}
                  catName={dropCat}
                  kind={conflict ? 'conflict' : 'valid'}
                  hourH={PLANNER.hourH}
                  windowStartMin={h0}
                  windowEndMin={h1}
                  note={conflictNote}
                />
              )}
              {openBusy && openBusy.day === i && (
                <BusyPopover
                  block={openBusy.block}
                  stale={stale}
                  staleTime={staleTime}
                  syncedAgoMin={openBusy.syncedAgoMin}
                  top={openBusy.top}
                  alignRight={i >= 4}
                  onClose={() => setOpenBusy(null)}
                />
              )}
            </div>
          )
        })}

        {emptyWeek && (
          <div
            className="pointer-events-none absolute right-0 text-center"
            style={{ left: PLANNER.gutter, top: gridH * 0.38, zIndex: 5 }}
          >
            <div className="serif text-[17px]" style={{ color: 'var(--ink-2)' }}>
              Nothing planned yet.
            </div>
            <div className="mt-[5px] text-[12px]" style={{ color: 'var(--ink-3)' }}>
              Drag a task from the tray onto a time.
            </div>
          </div>
        )}
      </div>

      <WindowRail
        side="bottom"
        expanded={botExpanded}
        onToggle={() => setBotExpanded((x) => !x)}
        label={`${fmtClock(PLANNER.winCollapsedEnd)} – ${fmtClock(win.end)}`}
        hiddenCount={hidden.bottom}
      />
    </div>
  )
}
