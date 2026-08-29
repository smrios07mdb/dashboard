import { useState } from 'react'

import DayStrip from '@/components/planner/DayStrip'
import PriorityChip from '@/components/PriorityChip'
import { Button } from '@/components/ui/button'
import { Pill } from '@/components/ui/pill'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import type { Task } from '@/db/types'
import { catColor, fmtMin } from '@/lib/cat'
import {
  DAY_LABELS,
  fmtClock,
  fmtRange,
  type WeekBusyBlock,
} from '@/lib/plannerGeometry'
import {
  blockDurationMin,
  findOpenSlots,
  type WeekScheduledBlock,
} from '@/lib/plannerSchedule'

/*
 * Schedule sheet (chunk 37, prototype `WPMScheduleSheet`) — shared by the
 * mobile tap-to-schedule flow and the desktop click/keyboard path (D7):
 * one component, bottom side on every breakpoint.
 *
 * Task summary card → up to 3 open slots (`findOpenSlots`, 08:00–20:00,
 * around busy + already-scheduled blocks on the chosen day) → custom time
 * row → `Add to {Weekday}`. Desktop callers show a compact day selector
 * (the mobile `DayStrip` itself) since there is no strip on that screen.
 * `onAdd(day, startMin)` — the screen does the write.
 *
 * Internal selection state lives in `Body`, keyed on the task + open
 * cycle so it resets naturally each time the sheet opens (no effect
 * syncing, per prompts/README "adjust state" guidance).
 */

const DAY_FULL = [
  'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday',
] as const

export type ScheduleSheetProps = {
  open: boolean
  task: Task | null
  catName: string
  overdue: boolean
  days: Date[]
  todayIdx: number
  /** Day the sheet opens on (mobile: the selected strip day; desktop: today or Monday). */
  initialDay: number
  nowMin: number
  busy: WeekBusyBlock[]
  scheduled: WeekScheduledBlock[]
  /** Desktop: render the 7-chip day selector. */
  showDaySelector: boolean
  onClose: () => void
  onAdd: (day: number, startMin: number) => void
}

function parseHHMM(v: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(v)
  if (!m) return null
  const h = Number(m[1])
  const mm = Number(m[2])
  if (h > 23 || mm > 59) return null
  return h * 60 + mm
}

type BodyProps = Omit<ScheduleSheetProps, 'open' | 'task'> & { task: Task }

function Body({
  task,
  catName,
  overdue,
  days,
  todayIdx,
  initialDay,
  nowMin,
  busy,
  scheduled,
  showDaySelector,
  onClose,
  onAdd,
}: BodyProps) {
  const [day, setDay] = useState(initialDay)
  const dur = blockDurationMin(task.estimateMinutes)
  const isToday = day === todayIdx
  const slots = findOpenSlots(day, dur, busy, scheduled, isToday, nowMin)
  const [sel, setSel] = useState<number | 'custom'>(0)
  const [custom, setCustom] = useState(
    slots[0] ? fmtClock(slots[0].startMin) : '09:00',
  )
  const customMin = parseHHMM(custom)
  const start =
    sel === 'custom'
      ? customMin
      : slots[sel as number]
        ? slots[sel as number].startMin
        : customMin
  const canAdd = start !== null

  const pickDay = (d: number) => {
    setDay(d)
    setSel(0)
  }

  return (
    <>
      <SheetHeader className="text-left">
        <SheetTitle className="text-[15px] font-semibold tracking-[-.01em]">
          Schedule
        </SheetTitle>
        <SheetDescription className="sr-only">
          Pick a time for {task.title}.
        </SheetDescription>
      </SheetHeader>

      <div className="rounded bg-bg-alt px-3.5 py-3">
        <div className="flex items-center gap-2">
          {task.priority !== null && <PriorityChip priority={task.priority} />}
          <span className="min-w-0 flex-1 text-[14px] font-medium">{task.title}</span>
        </div>
        <div className="mt-1.5 flex items-center gap-[7px]">
          <span
            aria-hidden
            className="shrink-0 rounded-[3px]"
            style={{ width: 8, height: 8, background: catColor(catName) }}
          />
          <span className="num mono text-[11px] text-ink-3">
            {fmtMin(task.estimateMinutes)} estimate
          </span>
          {overdue && (
            <span
              className="label"
              style={{ fontSize: 8.5, color: 'hsl(var(--destructive))' }}
            >
              OVERDUE
            </span>
          )}
        </div>
      </div>

      {showDaySelector && (
        <DayStrip days={days} selected={day} todayIdx={todayIdx} onSelect={pickDay} />
      )}

      <div>
        <span className="label block">
          Open slots — {DAY_LABELS[day]} {days[day]?.getDate() ?? ''}
        </span>
        <div className="mt-2 flex flex-col gap-2">
          {slots.map((s, i) => {
            const selected = sel === i
            return (
              <button
                key={i}
                type="button"
                aria-pressed={selected}
                onClick={() => setSel(i)}
                className="flex items-baseline gap-2.5 rounded px-3.5 py-3 text-left"
                style={{
                  border: `1px solid ${selected ? 'hsl(var(--accent))' : 'var(--line)'}`,
                  background: selected ? 'var(--accent-soft)' : 'var(--surface)',
                }}
              >
                <span className="num mono text-[15px] font-semibold text-ink">
                  {fmtRange(s.startMin, s.endMin)}
                </span>
                <span className="num mono text-[11px] text-ink-3">
                  free until {fmtClock(s.until)}
                </span>
                <span className="ml-auto" />
                {selected && <Pill tone="accent">Selected</Pill>}
              </button>
            )
          })}
          {slots.length === 0 && (
            <div className="px-1 py-3.5 text-[12px] text-ink-3">
              No open slot fits {fmtMin(dur)} {isToday ? 'today' : 'that day'}. Pick a
              time below.
            </div>
          )}
        </div>
      </div>

      <div className="border-t border-line pt-3">
        <span className="label">Custom</span>
        <div className="mt-2 flex items-center gap-2.5">
          <input
            type="time"
            aria-label="Custom start time"
            value={custom}
            onFocus={() => setSel('custom')}
            onChange={(e) => {
              setCustom(e.target.value)
              setSel('custom')
            }}
            className="mono h-[38px] rounded px-2.5 text-[13px] text-ink"
            style={{
              border: `1px solid ${sel === 'custom' ? 'hsl(var(--accent))' : 'var(--line)'}`,
              background: sel === 'custom' ? 'var(--accent-soft)' : 'var(--surface)',
            }}
          />
          <span className="num mono text-[11px] text-ink-3">+ {fmtMin(dur)}</span>
        </div>
      </div>

      <div className="flex justify-end gap-2 border-t border-line pt-3">
        <Button variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button
          disabled={!canAdd}
          onClick={() => {
            if (start !== null) onAdd(day, start)
          }}
        >
          Add to {DAY_FULL[day]}
        </Button>
      </div>
    </>
  )
}

export default function ScheduleSheet(props: ScheduleSheetProps) {
  const { open, task, onClose } = props
  return (
    <Sheet open={open && task !== null} onOpenChange={(o) => !o && onClose()}>
      <SheetContent
        side="bottom"
        className="flex max-h-[90vh] flex-col gap-4 overflow-y-auto rounded-t-xl"
        data-side="bottom"
      >
        {task && <Body key={task.id} {...props} task={task} />}
      </SheetContent>
    </Sheet>
  )
}
