import { useEffect, useRef, useState } from 'react'
import { Bell, MoreHorizontal, Trash2 } from 'lucide-react'

import DeleteConfirm from '@/components/DeleteConfirm'
import { Checkbox } from '@/components/ui/checkbox'
import type { Task } from '@/db/types'
import { cn } from '@/lib/utils'

/*
 * One task row.
 *
 * Click the title → input; Enter/blur commits, Escape reverts.
 * Click the minutes pill → numeric input; same Enter/blur/Escape.
 * Checkbox toggles `completedAt` via the parent's `onComplete` handler.
 * Trash button opens DeleteConfirm; confirm fires `onDelete`.
 *
 * Bell and three-dot menu are intentionally rendered as static
 * placeholders — chunk 14 wires reminders, chunk 9 wires the menu.
 *
 * Validation is silent: empty title / out-of-range minutes show a
 * visible invalid border and an aria-invalid flag. Enter is a no-op on
 * invalid input, Escape reverts. No toasts on rejection. Toasts are
 * reserved for completed operations.
 *
 * Realtime echoes that arrive mid-edit do not clobber the in-flight
 * draft — the draft is stored locally and only the read-only
 * (non-editing) branches re-render from props. A coincidental realtime
 * tick during a different field's edit may momentarily flicker; that's
 * acceptable for chunk 7 per the chunk's pre-flight notes.
 */

const MAX_MINUTES = 24 * 60

function formatMinutes(mins: number): string {
  if (!mins) return '0m'
  if (mins < 60) return `${mins}m`
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return m ? `${h}h ${m}m` : `${h}h`
}

function isValidMinutesString(s: string): boolean {
  if (!/^\d+$/.test(s.trim())) return false
  const n = Number(s)
  return Number.isInteger(n) && n >= 0 && n <= MAX_MINUTES
}

export type TaskRowProps = {
  task: Task
  onComplete: (id: string, completed: boolean) => void | Promise<void>
  onEditTitle: (id: string, title: string) => void | Promise<void>
  onEditMinutes: (id: string, minutes: number) => void | Promise<void>
  onDelete: (id: string) => void | Promise<void>
}

export default function TaskRow({
  task,
  onComplete,
  onEditTitle,
  onEditMinutes,
  onDelete,
}: TaskRowProps) {
  const completed = !!task.completedAt
  return (
    <div
      className={cn(
        'grid items-center gap-3 border-t border-border px-3 py-2 transition-colors hover:bg-secondary/40',
        '[grid-template-columns:18px_1fr_auto_auto_auto_auto]',
        completed && 'opacity-50',
      )}
    >
      <Checkbox
        checked={completed}
        aria-label={completed ? 'Mark task incomplete' : 'Mark task complete'}
        onCheckedChange={(next) => {
          if (typeof next === 'boolean') void onComplete(task.id, next)
        }}
      />
      <TitleField
        task={task}
        onCommit={(title) => onEditTitle(task.id, title)}
      />
      <MinutesField
        task={task}
        onCommit={(minutes) => onEditMinutes(task.id, minutes)}
      />
      {task.remindAt ? (
        <span
          aria-label="Reminder set"
          title="Reminder set"
          className="inline-flex h-6 w-6 items-center justify-center text-[var(--accent-ink)]"
        >
          <Bell className="size-3.5" />
        </span>
      ) : (
        <span aria-hidden className="inline-block h-6 w-6" />
      )}
      <DeleteConfirm
        trigger={
          <button
            type="button"
            aria-label={`Delete task "${task.title}"`}
            className="inline-flex h-6 w-6 items-center justify-center rounded-sm text-muted-foreground hover:bg-secondary hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Trash2 className="size-3.5" />
          </button>
        }
        title="Delete this task?"
        description="This cannot be undone."
        onConfirm={() => onDelete(task.id)}
      />
      {/* Placeholder three-dot menu — chunk 9 wires real actions. */}
      <button
        type="button"
        aria-label="Task actions"
        className="inline-flex h-6 w-6 items-center justify-center rounded-sm text-muted-foreground hover:bg-secondary hover:text-secondary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <MoreHorizontal className="size-3.5" />
      </button>
    </div>
  )
}

// ---------- title field ----------

function TitleField({
  task,
  onCommit,
}: {
  task: Task
  onCommit: (title: string) => void | Promise<void>
}) {
  const [draft, setDraft] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const editing = draft !== null

  useEffect(() => {
    if (editing) inputRef.current?.select()
  }, [editing])

  const completed = !!task.completedAt
  const trimmed = (draft ?? '').trim()
  const invalid = editing && trimmed.length === 0

  function commit() {
    if (!editing) return
    if (trimmed.length === 0) {
      // empty → revert (no save, exit edit mode silently)
      setDraft(null)
      return
    }
    if (trimmed === task.title) {
      // no-op change, just exit
      setDraft(null)
      return
    }
    void onCommit(trimmed)
    setDraft(null)
  }

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => setDraft(task.title)}
        className={cn(
          'min-w-0 truncate text-left text-[13px] leading-tight text-foreground hover:text-accent-foreground',
          completed && 'line-through decoration-muted-foreground',
        )}
        title={task.title}
      >
        {task.title}
      </button>
    )
  }

  return (
    <input
      ref={inputRef}
      autoFocus
      type="text"
      value={draft ?? ''}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault()
          if (!invalid) commit()
        } else if (e.key === 'Escape') {
          e.preventDefault()
          setDraft(null)
        }
      }}
      aria-invalid={invalid || undefined}
      aria-label="Task title"
      className={cn(
        'min-w-0 rounded-sm bg-background px-2 py-1 text-[13px] text-foreground shadow-[inset_0_0_0_1px_hsl(var(--ring))] outline-none focus:shadow-[inset_0_0_0_1px_hsl(var(--ring))]',
        invalid &&
          'shadow-[inset_0_0_0_1px_hsl(var(--destructive))] focus:shadow-[inset_0_0_0_1px_hsl(var(--destructive))]',
      )}
    />
  )
}

// ---------- minutes field ----------

function MinutesField({
  task,
  onCommit,
}: {
  task: Task
  onCommit: (minutes: number) => void | Promise<void>
}) {
  const [draft, setDraft] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const editing = draft !== null

  useEffect(() => {
    if (editing) inputRef.current?.select()
  }, [editing])

  const invalid = editing && !isValidMinutesString(draft ?? '')

  function commit() {
    if (!editing) return
    if (!isValidMinutesString(draft ?? '')) {
      // invalid → revert silently
      setDraft(null)
      return
    }
    const next = Number(draft)
    if (next === task.estimateMinutes) {
      setDraft(null)
      return
    }
    void onCommit(next)
    setDraft(null)
  }

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => setDraft(String(task.estimateMinutes))}
        aria-label="Edit minutes"
        className="rounded-sm px-1 font-mono text-[12px] text-muted-foreground tabular-nums hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      >
        {formatMinutes(task.estimateMinutes)}
      </button>
    )
  }

  return (
    <input
      ref={inputRef}
      autoFocus
      type="number"
      inputMode="numeric"
      min={0}
      max={MAX_MINUTES}
      step={5}
      value={draft ?? ''}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault()
          if (!invalid) commit()
        } else if (e.key === 'Escape') {
          e.preventDefault()
          setDraft(null)
        }
      }}
      aria-invalid={invalid || undefined}
      aria-label="Estimate minutes"
      className={cn(
        'w-16 rounded-sm bg-background px-2 py-1 text-right font-mono text-[12px] text-foreground shadow-[inset_0_0_0_1px_hsl(var(--ring))] outline-none',
        invalid &&
          'shadow-[inset_0_0_0_1px_hsl(var(--destructive))] focus:shadow-[inset_0_0_0_1px_hsl(var(--destructive))]',
      )}
    />
  )
}
