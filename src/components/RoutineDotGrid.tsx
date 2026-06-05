import { useMemo, type CSSProperties } from 'react'

import { dateKeyDaysAgo } from '@/lib/clock'
import type { RoutineItem, RoutineLog } from '@/db/types'
import { DOT_GRID_DAYS, requiredItemsByDay } from '@/lib/streak'

/**
 * 14-day dot grid going back from today (oldest on the left, today on
 * the right).
 *
 * States (matches the design canon at
 * design/src/screens/routines.jsx → `DayGrid`):
 *   - 'faded':   no items existed yet — dashed empty circle
 *   - 'full':    every required item completed — filled circle
 *   - 'partial': some required items completed — subtle tint
 *   - 'empty':   items existed but none completed — outlined dot
 *
 * The dot grid and the streak calc share `requiredItemsByDay` so any
 * rule changes (ARCH §11 amendments, archival semantics) propagate to
 * both surfaces from one place. See `src/lib/streak.ts` for the rule
 * restatement.
 *
 * The component takes `todayKey` rather than calling `clock.today()`
 * itself so it remains testable and mockable without bypassing the
 * pre-flight #6 contract.
 */

const DOW_SHORT = ['S', 'M', 'T', 'W', 'T', 'F', 'S'] as const

type DotState = 'faded' | 'empty' | 'partial' | 'full'

/**
 * Per-state dot style (matches the prototype `DayGrid`). The accent math
 * (`color-mix`, a tinted drop-shadow) can't be expressed as Tailwind utilities,
 * so the stateful paint lives inline while the size/shape stays in className.
 */
function dotStyle(
  state: DotState,
  accent: string,
  isToday: boolean,
): CSSProperties {
  const today: CSSProperties = isToday
    ? { outline: '2px solid var(--ink)', outlineOffset: 2 }
    : {}
  switch (state) {
    case 'full':
      return {
        ...today,
        background: accent,
        boxShadow: `0 2px 8px -2px ${accent}`,
        border: 'none',
      }
    case 'partial':
      return {
        ...today,
        background: `color-mix(in srgb, ${accent} 28%, transparent)`,
        border: '1px solid var(--line)',
      }
    case 'empty':
      return { ...today, background: 'var(--bg-alt)', border: '1px solid var(--line)' }
    case 'faded':
      return { ...today, background: 'transparent', border: '1px dashed var(--line)' }
  }
}

type Cell = {
  dateKey: string
  dow: string
  state: DotState
  isToday: boolean
}

export type RoutineDotGridProps = {
  routine: 'morning' | 'night'
  items: RoutineItem[]
  logs: RoutineLog[]
  todayKey: string
  timezone: string
}

export default function RoutineDotGrid({
  routine,
  items,
  logs,
  todayKey,
  timezone,
}: RoutineDotGridProps) {
  const cells = useMemo<Cell[]>(() => {
    const myItems = items.filter((i) => i.routine === routine)

    const dateKeys: string[] = []
    // Oldest first so the grid reads left → right as time forward.
    for (let d = DOT_GRID_DAYS - 1; d >= 0; d -= 1) {
      dateKeys.push(dateKeyDaysAgo(todayKey, d))
    }

    const required = requiredItemsByDay(myItems, dateKeys, timezone)
    const completedByDay = new Map<string, Set<string>>()
    for (const log of logs) {
      if (!log.completed) continue
      let set = completedByDay.get(log.dateKey)
      if (!set) {
        set = new Set<string>()
        completedByDay.set(log.dateKey, set)
      }
      set.add(log.routineItemId)
    }

    return dateKeys.map((dateKey, idx) => {
      const req = required.get(dateKey) ?? new Set<string>()
      const done = completedByDay.get(dateKey) ?? new Set<string>()
      let state: DotState
      if (req.size === 0) {
        state = 'faded'
      } else {
        let allDone = true
        let anyDone = false
        for (const id of req) {
          if (done.has(id)) anyDone = true
          else allDone = false
        }
        state = allDone ? 'full' : anyDone ? 'partial' : 'empty'
      }
      // Parse "YYYY-MM-DD" as UTC midnight — getUTCDay matches the
      // calendar day-of-week we already encoded via `dateKey`.
      const dow = DOW_SHORT[new Date(`${dateKey}T00:00:00.000Z`).getUTCDay()]
      return {
        dateKey,
        dow,
        state,
        isToday: idx === DOT_GRID_DAYS - 1,
      }
    })
  }, [routine, items, logs, todayKey, timezone])

  const accent =
    routine === 'morning' ? 'var(--jewel-gold)' : 'var(--jewel-amethyst)'

  return (
    <div
      role="list"
      aria-label={`${routine} last ${DOT_GRID_DAYS} days`}
      className="grid grid-cols-14 gap-1.5"
      style={{ gridTemplateColumns: `repeat(${DOT_GRID_DAYS}, minmax(0, 1fr))` }}
    >
      {cells.map((c) => (
        <div
          key={c.dateKey}
          role="listitem"
          aria-label={`${c.dateKey} ${c.state}${c.isToday ? ' (today)' : ''}`}
          className="flex flex-col items-center gap-1"
        >
          <span
            aria-hidden
            className="h-5 w-5 rounded-full transition-colors"
            style={dotStyle(c.state, accent, c.isToday)}
          />
          <span className="num text-[10px] text-ink-4">{c.dow}</span>
        </div>
      ))}
    </div>
  )
}
