import { useState } from 'react'

import BusyBlock from '@/components/planner/BusyBlock'
import BusyPopover from '@/components/planner/BusyPopover'
import WindowRail from '@/components/planner/WindowRail'
import {
  fmtClock,
  hiddenCounts,
  PLANNER,
  type WeekBusyBlock,
} from '@/lib/plannerGeometry'

/*
 * Mobile single-day timeline (chunk 36, README §2): 48px hour, 46px
 * gutter, same rails / busy overlays / popover as the desktop grid.
 * Read-only — no tap-to-schedule until chunk 37.
 */

export type DayTimelineProps = {
  /** Busy blocks for the selected day only. */
  busy: WeekBusyBlock[]
  isToday: boolean
  nowMin: number
  stale: boolean
  staleTime: string | null
  fetchedAt: number | null
  loading: boolean
  errorMessage: string | null
}

export default function DayTimeline({
  busy,
  isToday,
  nowMin,
  stale,
  staleTime,
  fetchedAt,
  loading,
  errorMessage,
}: DayTimelineProps) {
  const [topExpanded, setTopExpanded] = useState(false)
  const [botExpanded, setBotExpanded] = useState(false)
  const [openBusy, setOpenBusy] = useState<{
    block: WeekBusyBlock
    top: number
  } | null>(null)

  const h0 = topExpanded ? PLANNER.winFullStart : PLANNER.winCollapsedStart
  const h1 = botExpanded ? PLANNER.winFullEnd : PLANNER.winCollapsedEnd
  const gridH = ((h1 - h0) / 60) * PLANNER.mHourH
  const hidden = hiddenCounts(busy)

  const hours: number[] = []
  for (let m = h0; m <= h1; m += 60) hours.push(m)

  const syncedAgoMin =
    fetchedAt === null ? null : Math.floor((Date.now() - fetchedAt) / 60_000)

  return (
    <div className={loading ? 'opacity-50' : undefined}>
      {errorMessage && (
        <p className="pb-2 text-[12px] text-ink-3">
          {errorMessage} The timeline is shown without calendar overlays.
        </p>
      )}
      <WindowRail
        side="top"
        expanded={topExpanded}
        onToggle={() => setTopExpanded((x) => !x)}
        label="07 – 08"
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
          {openBusy && (
            <BusyPopover
              block={openBusy.block}
              stale={stale}
              staleTime={staleTime}
              syncedAgoMin={syncedAgoMin}
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
        label="19 – 21"
        hiddenCount={hidden.bottom}
      />
    </div>
  )
}
