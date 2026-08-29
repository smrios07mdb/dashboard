import { useState } from 'react'

import BusyBlock from '@/components/planner/BusyBlock'
import BusyPopover from '@/components/planner/BusyPopover'
import TaskBlock from '@/components/planner/TaskBlock'
import type { GridTaskBlock } from '@/components/planner/WeekGrid'
import WindowRail from '@/components/planner/WindowRail'
import {
  expandedWindow,
  fmtClock,
  hiddenCounts,
  PLANNER,
  type WeekBusyBlock,
} from '@/lib/plannerGeometry'
import type { WeekScheduledBlock } from '@/lib/plannerSchedule'

/*
 * Mobile single-day timeline (chunk 36 geometry, chunk 37 blocks): 48px
 * hour, 46px gutter, same rails / busy overlays / popover as the desktop
 * grid, plus the selected day's task blocks in `touch` mode — no drag,
 * tap opens the block action sheet. Rails count task blocks too (D10).
 */

export type DayTimelineProps = {
  /** Busy blocks for the selected day only. */
  busy: WeekBusyBlock[]
  /** Scheduled blocks (joined with tasks) for the selected day only. */
  scheduled?: GridTaskBlock[]
  isToday: boolean
  nowMin: number
  stale: boolean
  staleTime: string | null
  fetchedAt: number | null
  loading: boolean
  errorMessage: string | null
  onOpenActions?: (block: WeekScheduledBlock) => void
  onToggleDone?: (block: WeekScheduledBlock) => void
}

export default function DayTimeline({
  busy,
  scheduled = [],
  isToday,
  nowMin,
  stale,
  staleTime,
  fetchedAt,
  loading,
  errorMessage,
  onOpenActions,
  onToggleDone,
}: DayTimelineProps) {
  const [topExpanded, setTopExpanded] = useState(false)
  const [botExpanded, setBotExpanded] = useState(false)
  const [openBusy, setOpenBusy] = useState<{
    block: WeekBusyBlock
    top: number
    syncedAgoMin: number | null
  } | null>(null)

  // Expanded bounds stretch past 07:00/21:00 when data falls outside them,
  // so every block the rails count is reachable by expanding.
  const all = [...busy, ...scheduled.map((g) => g.block)]
  const win = expandedWindow(all)
  const h0 = topExpanded ? win.start : PLANNER.winCollapsedStart
  const h1 = botExpanded ? win.end : PLANNER.winCollapsedEnd
  const gridH = ((h1 - h0) / 60) * PLANNER.mHourH
  const hidden = hiddenCounts(all)
  // Mobile rail labels are hour-only: `07 – 08`.
  const hh = (m: number) => fmtClock(m).slice(0, 2)

  const hours: number[] = []
  for (let m = h0; m <= h1; m += 60) hours.push(m)

  const emptyDay = busy.length === 0 && scheduled.length === 0 && !loading

  return (
    <div className={loading ? 'opacity-50' : undefined}>
      {errorMessage && (
        <p className="pb-2 text-[12px] text-ink-3">
          {errorMessage} The timeline is shown without calendar overlays.
        </p>
      )}
      {emptyDay && (
        <p className="pb-2 text-[12px]" style={{ color: 'var(--ink-3)' }}>
          Tap an unscheduled task to give it a time.
        </p>
      )}
      <WindowRail
        side="top"
        expanded={topExpanded}
        onToggle={() => setTopExpanded((x) => !x)}
        label={`${hh(win.start)} – ${hh(PLANNER.winCollapsedStart)}`}
        hiddenCount={hidden.top}
      />
      <div
        className="relative grid border-t border-line-strong"
        style={{ gridTemplateColumns: `${PLANNER.mGutter}px 1fr` }}
        onClick={() => setOpenBusy(null)}
      >
        <div className="relative" style={{ height: gridH }}>
          {hours.map((m) => (
            <span
              key={m}
              className="num mono absolute right-2 text-[9px] text-ink-3"
              style={{
                top:
                  ((m - h0) / 60) * PLANNER.mHourH -
                  (m === h0 ? 0 : m === h1 ? 13 : 6),
              }}
            >
              {fmtClock(m)}
            </span>
          ))}
        </div>
        <div
          className="relative mr-3 border-l border-line"
          style={{
            height: gridH,
            backgroundImage: `repeating-linear-gradient(to bottom, var(--line) 0 1px, transparent 1px ${PLANNER.mHourH}px)`,
          }}
        >
          {busy.map((b, j) => (
            <BusyBlock
              key={j}
              block={b}
              hourH={PLANNER.mHourH}
              windowStartMin={h0}
              windowEndMin={h1}
              stale={stale}
              staleTime={staleTime}
              onOpen={(block, pos) =>
                setOpenBusy({
                  block,
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
          {isToday && nowMin >= h0 && nowMin <= h1 && (
            <div
              aria-hidden
              className="absolute inset-x-0"
              style={{
                zIndex: 2,
                top: ((nowMin - h0) / 60) * PLANNER.mHourH,
              }}
            >
              <div
                style={{ height: 2, background: 'var(--work)', borderRadius: 1 }}
              />
              <span
                className="absolute rounded-full"
                style={{
                  left: -3,
                  top: -2.5,
                  width: 7,
                  height: 7,
                  background: 'var(--work)',
                }}
              />
            </div>
          )}
          {scheduled.map((g) => (
            <TaskBlock
              key={`${g.block.id}-${g.block.startMin}`}
              block={g.block}
              task={g.task}
              catName={g.catName}
              hourH={PLANNER.mHourH}
              windowStartMin={h0}
              windowEndMin={h1}
              done={g.done}
              touch
              onOpenActions={onOpenActions}
              onToggleDone={onToggleDone}
            />
          ))}
          {openBusy && (
            <BusyPopover
              block={openBusy.block}
              stale={stale}
              staleTime={staleTime}
              syncedAgoMin={openBusy.syncedAgoMin}
              top={openBusy.top}
              alignRight={false}
              onClose={() => setOpenBusy(null)}
            />
          )}
        </div>
      </div>
      <WindowRail
        side="bottom"
        expanded={botExpanded}
        onToggle={() => setBotExpanded((x) => !x)}
        label={`${hh(PLANNER.winCollapsedEnd)} – ${hh(win.end)}`}
        hiddenCount={hidden.bottom}
      />
    </div>
  )
}
