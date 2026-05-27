import { useEffect, useRef, useState } from 'react'
import { useDraggable } from '@dnd-kit/core'
import { CSS } from '@dnd-kit/utilities'
import { Bell, GripVertical, Trash2 } from 'lucide-react'

import DeleteConfirm from '@/components/DeleteConfirm'
import SetReminderPopover from '@/components/SetReminderPopover'
import TaskMenu from '@/components/TaskMenu'
import { Checkbox } from '@/components/ui/checkbox'
import type { Category, Subcategory, Task } from '@/db/types'
import { useIsTouchDevice } from '@/lib/useIsTouchDevice'
import { cn } from '@/lib/utils'

/*
 * One task row.
 *
 * Title click → inline edit; minutes click → numeric input
 * (chunks 7+8 patterns kept verbatim).
 *
 * Chunk 9 additions:
 *   - The bell icon is now the SetReminderPopover trigger. It also
 *     serves as the popover's positioning anchor when the menu item
 *     "Set reminder…" opens the popover programmatically. The open
 *     state lives here (two entry points: bell icon, menu item).
 *   - The placeholder three-dot button is replaced by <TaskMenu />.
 *   - On desktop (`!useIsTouchDevice()`), the row is a `useDraggable`
 *     source. A small grip handle appears between the checkbox and
 *     title; the rest of the row stays click-friendly so inline
 *     title/minutes edit still works. Touch devices hide the grip
 *     and rely on the three-dot menu's Move-to picker.
 *
 * Why a dedicated grip handle and not row-level drag listeners: the
 * row contains buttons (checkbox, title, minutes, bell, trash, menu)
 * whose clicks must not start drags. `@dnd-kit`'s PointerSensor has
 * a 5px activation distance, which mostly works, but attaching
 * listeners only to the grip eliminates the conflict entirely. The
 * pattern mirrors chunk-8's SubcategoryHeader drag handle.
 *
 * Standalone trash button is kept alongside the menu's Delete item
 * because the design canon (design/src/screens/dashboard.jsx) shows
 * both: a fast-path icon button + a menu entry. The duplication is
 * intentional UX.
 *
 * Validation is silent: empty title / out-of-range minutes show a
 * visible invalid border and an aria-invalid flag. Enter is a no-op
 * on invalid input, Escape reverts. No toasts on rejection.
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
  /**
   * Categories + subcategories visible to this user — needed by the
   * three-dot menu's MoveToPicker. Same list everywhere; passed by
   * the screen that owns the load.
   */
  categories: Category[]
  subcategories: Subcategory[]
  onComplete: (id: string, completed: boolean) => void | Promise<void>
  onEditTitle: (id: string, title: string) => void | Promise<void>
  onEditMinutes: (id: string, minutes: number) => void | Promise<void>
  onDelete: (id: string) => void | Promise<void>
  onMoveToSubcategory: (
    id: string,
    targetSubcategoryId: string,
  ) => void | Promise<void>
  onSetReminder: (
    id: string,
    remindAt: string | null,
  ) => void | Promise<void>
  onEditNotes: (id: string, notes: string | null) => void | Promise<void>
  /**
   * Optional bulk-select adornments. When `selectable` is true, a
   * second checkbox renders to the left of the completion checkbox.
   * SubcategoryView is the only chunk-9 consumer; Dashboard and
   * CategoryView leave both off.
   */
  selectable?: boolean
  selected?: boolean
  onToggleSelected?: (id: string) => void
  /**
   * Disables drag wiring for views that don't want task drag
   * (SubcategoryView). Defaults to true; explicit false bypasses
   * useDraggable entirely.
   */
  dragEnabled?: boolean
}

export default function TaskRow({
  task,
  categories,
  subcategories,
  onComplete,
  onEditTitle,
  onEditMinutes,
  onDelete,
  onMoveToSubcategory,
  onSetReminder,
  onEditNotes,
  selectable = false,
  selected = false,
  onToggleSelected,
  dragEnabled = true,
}: TaskRowProps) {
  const isTouch = useIsTouchDevice()
  const canDrag = dragEnabled && !isTouch
  const completed = !!task.completedAt
  const [reminderOpen, setReminderOpen] = useState(false)

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    isDragging,
  } = useDraggable({
    id: `task:${task.id}`,
    data: { taskId: task.id, currentSubcategoryId: task.subcategoryId },
    disabled: !canDrag,
  })

  // Grid template columns differ by selection mode + drag handle.
  // Built inline because Tailwind's JIT only sees static class names
  // at build time, so a dynamic `[grid-template-columns:...]` string
  // wouldn't get compiled.
  const gridTemplateColumns = [
    selectable ? '18px' : null, // selection checkbox
    '18px',                     // completion checkbox
    canDrag ? '14px' : null,    // grip
    '1fr',                      // title
    'auto',                     // minutes
    'auto',                     // bell
    'auto',                     // trash
    'auto',                     // three-dot menu
  ]
    .filter(Boolean)
    .join(' ')

  const style: React.CSSProperties = {
    transform: CSS.Translate.toString(transform),
    opacity: isDragging ? 0.5 : undefined,
    gridTemplateColumns,
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        'grid items-center gap-3 border-t border-border px-3 py-2 transition-colors hover:bg-secondary/40',
        completed && 'opacity-50',
        selected && 'bg-secondary/50',
      )}
    >
      {selectable && (
        <Checkbox
          checked={selected}
          aria-label={selected ? 'Deselect task' : 'Select task'}
          onCheckedChange={() => onToggleSelected?.(task.id)}
          className="rounded-sm"
        />
      )}
      <Checkbox
        checked={completed}
        aria-label={completed ? 'Mark task incomplete' : 'Mark task complete'}
        onCheckedChange={(next) => {
          if (typeof next === 'boolean') void onComplete(task.id, next)
        }}
      />
      {canDrag && (
        <button
          type="button"
          aria-label={`Drag to move "${task.title}"`}
          {...attributes}
          {...listeners}
          onClick={(e) => e.stopPropagation()}
          className="inline-flex h-6 w-3.5 cursor-grab items-center justify-center rounded-sm text-muted-foreground/60 hover:bg-secondary hover:text-foreground active:cursor-grabbing focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <GripVertical className="size-3" aria-hidden />
        </button>
      )}
      <TitleField
        task={task}
        onCommit={(title) => onEditTitle(task.id, title)}
      />
      <MinutesField
        task={task}
        onCommit={(minutes) => onEditMinutes(task.id, minutes)}
      />
      <SetReminderPopover
        open={reminderOpen}
        onOpenChange={setReminderOpen}
        remindAt={task.remindAt}
        trigger={
          <button
            type="button"
            aria-label={task.remindAt ? 'Edit reminder' : 'Set reminder'}
            title={task.remindAt ? 'Edit reminder' : 'Set reminder'}
            className={cn(
              'inline-flex h-6 w-6 items-center justify-center rounded-sm hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              task.remindAt
                ? 'text-[var(--accent-ink)]'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            <Bell className="size-3.5" />
          </button>
        }
        onSave={(iso) => onSetReminder(task.id, iso)}
        onClear={() => onSetReminder(task.id, null)}
      />
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
      <TaskMenu
        task={task}
        categories={categories}
        subcategories={subcategories}
        onMoveToSubcategoryId={(targetId) =>
          onMoveToSubcategory(task.id, targetId)
        }
        onOpenReminder={() => setReminderOpen(true)}
        onEditNotes={(notes) => onEditNotes(task.id, notes)}
        onDelete={() => onDelete(task.id)}
      />
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
      setDraft(null)
      return
    }
    if (trimmed === task.title) {
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
