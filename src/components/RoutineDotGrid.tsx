import { useMemo } from 'react'

import { dateKeyDaysAgo } from '@/lib/clock'
import type { RoutineItem, RoutineLog } from '@/db/types'
import { DOT_GRID_DAYS, requiredItemsByDay } from '@/lib/streak'
import { cn } from '@/lib/utils'

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
            className={cn(
              'h-5 w-5 rounded-full transition-colors',
              c.state === 'faded' &&
                'border border-dashed border-border bg-transparent',
              c.state === 'empty' && 'border border-border bg-secondary/40',
              c.state === 'partial' &&
                (routine === 'morning'
                  ? 'border border-border bg-[hsl(40_70%_60%/0.25)]'
                  : 'border border-border bg-[hsl(260_75%_75%/0.25)]'),
              c.state === 'full' &&
                (routine === 'morning'
                  ? 'bg-[hsl(40_70%_60%)]'
                  : 'bg-[hsl(260_75%_75%)]'),
              c.isToday && 'ring-2 ring-offset-2 ring-foreground ring-offset-background',
            )}
          />
          <span className="font-mono text-[10px] text-muted-foreground">
            {c.dow}
          </span>
        </div>
      ))}
    </div>
  )
}
