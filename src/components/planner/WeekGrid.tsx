import { useState } from 'react'

import BusyBlock from '@/components/planner/BusyBlock'
import BusyPopover from '@/components/planner/BusyPopover'
import WindowRail from '@/components/planner/WindowRail'
import { fmtMin } from '@/lib/cat'
import {
  DAY_LABELS,
  expandedWindow,
  fmtClock,
  hiddenCounts,
  PLANNER,
  type WeekBusyBlock,
} from '@/lib/plannerGeometry'

/*
 * Desktop week grid (chunk 36, README §1 + DESIGN_NOTES geometry table).
 *
 * 56px gutter, `repeat(5,1fr) repeat(2,.55fr)` columns with 1px `--line`
 * left rules, 52px hours, hour rules via repeating-linear-gradient, 1px
 * `--line-strong` header separator, weekend 45% `--bg-alt` wash, today
 * 60% `--surface` lift + emerald dot, now-line (z2, today only), SHOW/HIDE
 * collapsed-hour rails. Busy overlays only — task blocks land in chunk 37.
 *
 * The visible-window flags (top/bottom expanded) are local UI state.
 */

const COLS = `${PLANNER.gutter}px repeat(5, 1fr) repeat(2, .55fr)`

const hourLines = (hourH: number) =>
  `repeating-linear-gradient(to bottom, var(--line) 0 1px, transparent 1px ${hourH}px)`

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
  loading: boolean
  /** CalendarError message for the quiet inline notice; null when healthy. */
  errorMessage: string | null
  /** Per-day free minutes (Mon–Fri); null = past day, undefined = weekend
   *  (outside the planning window) — both render the `—` placeholder. */
  dayFree: Array<number | null | undefined>
}

type OpenBusy = { block: WeekBusyBlock; day: number; top: number }

export default function WeekGrid({
  days,
  todayIdx,
  nowMin,
  busy,
  stale,
  staleTime,
  fetchedAt,
  loading,
  errorMessage,
  dayFree,
}: WeekGridProps) {
  const [topExpanded, setTopExpanded] = useState(false)
  const [botExpanded, setBotExpanded] = useState(false)
  const [openBusy, setOpenBusy] = useState<OpenBusy | null>(null)

  // Expanded bounds stretch past 07:00/21:00 when busy data falls outside
  // them, so every block the rails count is reachable by expanding.
  const win = expandedWindow(busy)
  const h0 = topExpanded ? win.start : PLANNER.winCollapsedStart
  const h1 = botExpanded ? win.end : PLANNER.winCollapsedEnd
  const gridH = ((h1 - h0) / 60) * PLANNER.hourH
  const hidden = hiddenCounts(busy)

  const hours: number[] = []
  for (let m = h0; m <= h1; m += 60) hours.push(m)

  const syncedAgoMin =
    fetchedAt === null ? null : Math.floor((Date.now() - fetchedAt) / 60_000)

  return (
    <div className={loading ? 'opacity-50' : undefined}>
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
              {openBusy && openBusy.day === i && (
                <BusyPopover
                  block={openBusy.block}
                  stale={stale}
                  staleTime={staleTime}
                  syncedAgoMin={syncedAgoMin}
                  top={openBusy.top}
                  alignRight={i >= 4}
                  onClose={() => setOpenBusy(null)}
                />
              )}
            </div>
          )
        })}
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
