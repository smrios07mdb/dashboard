import { useState, type CSSProperties, type PointerEvent } from 'react'

import { Check, X } from '@/components/icons'
import PriorityChip from '@/components/PriorityChip'
import type { Task } from '@/db/types'
import { catColor } from '@/lib/cat'
import { blockPos, fmtClock, fmtRange } from '@/lib/plannerGeometry'
import type { WeekScheduledBlock } from '@/lib/plannerSchedule'

/*
 * Scheduled task block (chunk 37, prototype `SchedBlock` minus carryover —
 * hollow past-blocks and "move to next open slot" are chunk 38).
 *
 * The real content on the grid: white `--surface` card, 3px category edge
 * (45% mix when done), `--shadow-sm` (none when done), title + P1 chip +
 * mono range (title only under 40px), `↓ HH:MM` clip stamp, 72% opacity
 * when done, 30% while it is the block being moved.
 *
 * Hover (or `touch` + done) reveals the 16px action row: done-check and
 * `×` unschedule. A 7px bottom strip starts a resize (hidden when done).
 *
 * The root is a focusable `role="button"` div rather than a `<button>`:
 * the action controls inside it are real buttons, and a button may not
 * contain buttons. Enter/Space open the block action sheet (the keyboard
 * and touch equivalent of the hover row + drag).
 */

const clipMarkStyle: CSSProperties = {
  position: 'absolute',
  right: 5,
  bottom: 2,
  fontSize: 8,
  color: 'var(--ink-3)',
}

export type TaskBlockProps = {
  block: WeekScheduledBlock
  task: Task
  catName: string
  hourH: number
  windowStartMin: number
  windowEndMin: number
  /** `block.done || task.completedAt != null` — the screen decides (D5). */
  done: boolean
  /** The block currently being moved (rendered at 30%). */
  dimmed?: boolean
  /** Touch device: no hover row (unless done), no drag handlers. */
  touch?: boolean
  onBodyPointerDown?: (e: PointerEvent<HTMLElement>, block: WeekScheduledBlock) => void
  onResizePointerDown?: (e: PointerEvent<HTMLElement>, block: WeekScheduledBlock) => void
  onToggleDone?: (block: WeekScheduledBlock) => void
  onUnschedule?: (block: WeekScheduledBlock) => void
  /** Enter/Space (any device) or tap (touch) → block action sheet. */
  onOpenActions?: (block: WeekScheduledBlock) => void
}

export default function TaskBlock({
  block,
  task,
  catName,
  hourH,
  windowStartMin,
  windowEndMin,
  done,
  dimmed = false,
  touch = false,
  onBodyPointerDown,
  onResizePointerDown,
  onToggleDone,
  onUnschedule,
  onOpenActions,
}: TaskBlockProps) {
  const [hover, setHover] = useState(false)
  const pos = blockPos(
    block.startMin,
    block.endMin,
    hourH,
    windowStartMin,
    windowEndMin,
  )
  if (!pos) return null

  const c = catColor(catName)
  const tight = pos.height < 40
  const showActions = pos.height >= 24 && (touch ? done : hover || done)
  const range = fmtRange(block.startMin, block.endMin)
  const canDrag = !touch && !done && !!onBodyPointerDown

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`${task.title}, ${range}${done ? ', done' : ''}`}
      data-testid="task-block"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onPointerDown={
        canDrag ? (e) => onBodyPointerDown?.(e, block) : undefined
      }
      onClick={
        touch
          ? (e) => {
              e.stopPropagation()
              onOpenActions?.(block)
            }
          : (e) => e.stopPropagation()
      }
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          e.stopPropagation()
          onOpenActions?.(block)
        }
      }}
      className="absolute inset-x-[3px] flex flex-col gap-px overflow-hidden rounded border border-line bg-surface text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      style={{
        top: pos.top,
        height: pos.height,
        zIndex: 3,
        borderLeft: `3px solid ${done ? `color-mix(in srgb, ${c} 45%, transparent)` : c}`,
        opacity: dimmed ? 0.3 : done ? 0.72 : 1,
        boxShadow: done ? 'none' : 'var(--shadow-sm)',
        padding: tight ? '3px 7px' : '5px 8px',
        cursor: canDrag ? 'grab' : 'default',
        userSelect: 'none',
        touchAction: 'none',
      }}
    >
      <div className="flex min-w-0 items-center gap-1.5">
        <span
          className="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-[11.5px] font-medium leading-[1.25]"
          style={{
            color: done ? 'var(--ink-3)' : 'var(--ink)',
            textDecoration: done ? 'line-through' : 'none',
            textDecorationColor: 'var(--ink-3)',
          }}
        >
          {task.title}
        </span>
        {task.priority === 1 && !tight && !done && (
          <PriorityChip priority={1} className="px-1 py-px text-[9px]" />
        )}
        {showActions && onToggleDone && (
          <button
            type="button"
            title={done ? 'Mark not done' : 'Mark done'}
            aria-label={done ? 'Mark not done' : 'Mark done'}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation()
              onToggleDone(block)
            }}
            className="inline-flex size-4 shrink-0 items-center justify-center rounded"
            style={{
              border: `1.4px solid ${done ? c : 'var(--line-strong)'}`,
              background: done ? c : 'var(--surface)',
              color: 'var(--surface)',
            }}
          >
            {done && <Check size={10} aria-hidden />}
          </button>
        )}
        {showActions && onUnschedule && (
          <button
            type="button"
            title="Unschedule"
            aria-label="Unschedule"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation()
              onUnschedule(block)
            }}
            className="inline-flex size-4 shrink-0 items-center justify-center rounded border border-line-strong bg-surface text-ink-2"
          >
            <X size={10} aria-hidden />
          </button>
        )}
      </div>
      {!tight && (
        <span className="num mono text-[9.5px]" style={{ color: 'var(--ink-3)' }}>
          {range}
        </span>
      )}
      {pos.clipBottom && (
        <span className="num mono" style={clipMarkStyle}>
          ↓ {fmtClock(block.endMin)}
        </span>
      )}
      {!touch && !done && onResizePointerDown && (
        <div
          data-testid="resize-strip"
          aria-hidden
          onPointerDown={(e) => {
            e.stopPropagation()
            onResizePointerDown(e, block)
          }}
          className="absolute inset-x-0 bottom-0"
          style={{ height: 7, cursor: 'ns-resize' }}
        />
      )}
    </div>
  )
}
