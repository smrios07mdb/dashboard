import { useEffect, useRef, useState } from 'react'
import { useDraggable } from '@dnd-kit/core'
import { CSS } from '@dnd-kit/utilities'
import { Bell, GripVertical } from 'lucide-react'

import { Sun } from '@/components/icons'
import {
  useOpenTaskNotes,
  useTaskNotes,
} from '@/components/notebook/notesContext'
import PriorityChip from '@/components/PriorityChip'
import PriorityPicker from '@/components/PriorityPicker'
import SetDuePopover from '@/components/SetDuePopover'
import SetReminderPopover from '@/components/SetReminderPopover'
import TaskMenu from '@/components/TaskMenu'
import { Checkbox } from '@/components/ui/checkbox'
import type { Category, Subcategory, Task } from '@/db/types'
import { fmtMin } from '@/lib/cat'
import { taskXP } from '@/lib/gamify'
import { useIsTouchDevice } from '@/lib/useIsTouchDevice'
import { browserTimezone } from '@/lib/userTimezone'
import { cn } from '@/lib/utils'
import { dueLabel, reminderLabel, type WhenTone } from '@/lib/whenLabel'

/*
 * One task row.
 *
 * Title click → inline edit; minutes click → numeric input
 * (chunks 7+8 patterns kept verbatim).
 *
 * Chunk 71 — the row shows only what is read or used daily. Columns, left
 * to right: selection checkbox (`selectable`), completion checkbox, grip
 * (`canDrag`), title (up to two lines), priority chip, one "when" chip,
 * minutes, Today sun (`onToggleToday`), ⋯. Reminder, notes and delete live
 * only in <TaskMenu />; the row has no bell, no trash and no note column.
 *
 * The when chip (`lib/whenLabel`) shows the due date or, when there is
 * none, the reminder — one chip per row, none on completed rows. It is the
 * trigger of its own picker. A picker with no chip of its own (⋯ → "Set
 * reminder…" on a row whose chip is a due chip, or either picker on a row
 * with no chip) renders anchor-only in its own grid slot, and only while
 * open. Open state for all three pickers lives here.
 *
 * On desktop (`!useIsTouchDevice()`), the row is a `useDraggable` source. A
 * small grip handle appears between the checkbox and title; the rest of the
 * row stays click-friendly so inline title/minutes edit still works. Touch
 * devices hide the grip and rely on the three-dot menu's Move-to picker.
 *
 * Why a dedicated grip handle and not row-level drag listeners: the
 * row contains buttons (checkbox, title, chips, minutes, sun, menu)
 * whose clicks must not start drags. `@dnd-kit`'s PointerSensor has
 * a 5px activation distance, which mostly works, but attaching
 * listeners only to the grip eliminates the conflict entirely. The
 * pattern mirrors chunk-8's SubcategoryHeader drag handle.
 *
 * Validation is silent: empty title / out-of-range minutes show a
 * visible invalid border and an aria-invalid flag. Enter is a no-op
 * on invalid input, Escape reverts. No toasts on rejection.
 */

// The Checkbox's centred transparent ::before, minus its size — extends a
// small control's hit area without changing its visual box.
const HIT_AREA =
  "relative before:absolute before:left-1/2 before:top-1/2 before:-translate-x-1/2 before:-translate-y-1/2 before:content-['']"

const WHEN_TONE: Record<WhenTone, string> = {
  late: 'text-destructive',
  today: 'text-[var(--accent-ink)]',
  soon: 'text-ink-2',
  later: 'text-ink-2',
}

const MAX_MINUTES = 24 * 60

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
  onSetDue: (
    id: string,
    dueAt: string | null,
  ) => void | Promise<void>
  onSetPriority: (
    id: string,
    priority: 1 | 2 | 3 | null,
  ) => void | Promise<void>
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
  /**
   * The parent subcategory's jewel hue (a `var(--jewel-…)` string), used for
   * the completion celebration — the "+XP" floater color and the row-flush
   * tint. Defaults to the Work color for rows rendered outside a colored
   * section (e.g. SubcategoryView, which doesn't pass one).
   */
  hue?: string
  /**
   * Today-plan membership adornment. When `onToggleToday` is provided (dashboard
   * rows only), a sun toggle renders in the action cluster and reflects
   * `inToday`; toggling drives the one shared Today membership set. Screens
   * without a Today plan (Category/Subcategory views) omit it → no sun, no
   * change.
   */
  inToday?: boolean
  onToggleToday?: (id: string, force?: boolean) => void
  /**
   * The zone the when chip's day math runs in — the Settings time zone,
   * resolved by the owning screen. Defaults to the browser's zone.
   */
  timeZone?: string
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
  onSetDue,
  onSetPriority,
  selectable = false,
  selected = false,
  onToggleSelected,
  dragEnabled = true,
  hue,
  inToday = false,
  onToggleToday,
  timeZone,
}: TaskRowProps) {
  const isTouch = useIsTouchDevice()
  const canDrag = dragEnabled && !isTouch
  const completed = !!task.completedAt
  const [reminderOpen, setReminderOpen] = useState(false)
  // Priority picker open state lives here (two entry points: the chip
  // and TaskMenu → "Set priority…"), mirroring the reminder popover.
  const [priorityOpen, setPriorityOpen] = useState(false)
  const [dueOpen, setDueOpen] = useState(false)
  const notes = useTaskNotes(task.id)
  const openTaskNotes = useOpenTaskNotes()
  // The when chip (chunk 71): a due date always wins; none on completed rows.
  const tz = timeZone ?? browserTimezone()
  const whenKind: 'due' | 'reminder' | null = completed
    ? null
    : task.dueAt
      ? 'due'
      : task.remindAt
        ? 'reminder'
        : null
  const when =
    whenKind === 'due'
      ? dueLabel(task.dueAt!, tz)
      : whenKind === 'reminder'
        ? reminderLabel(task.remindAt!, tz)
        : null
  // Each picker's slot exists while its chip shows or, anchor-only, while
  // it is open.
  const dueSlot = whenKind === 'due' || dueOpen
  const reminderSlot = whenKind === 'reminder' || reminderOpen
  // Chips hide on completed rows (DESIGN_NOTES § Priority system). The
  // grid slot exists only while a chip shows or the picker is open —
  // unlike the left edge, chip presence may shift layout (matches the
  // prototype).
  const chipPriority = completed ? null : task.priority
  const prioritySlot = chipPriority !== null || priorityOpen

  // Completion celebration (chunk 27). The "+XP" floater color and the
  // row-flush tint both use the subcategory hue; default to Work when none.
  const flush = hue ?? 'var(--work)'
  const [cheer, setCheer] = useState<{ xp: number } | null>(null)
  const mounted = useRef(false)
  const wasDone = useRef(completed)
  // Keep the latest task readable inside the [completed]-keyed effect without
  // adding `task` to its deps — that would let an unrelated task edit within
  // the 950ms window cancel the cheer timer and freeze the row mid-flush. The
  // sync runs in its own effect (never during render) and, by declaration
  // order, before the transition effect — so the ref is fresh when read.
  const taskRef = useRef(task)
  useEffect(() => {
    taskRef.current = task
  })
  useEffect(() => {
    const prev = wasDone.current
    wasDone.current = completed
    // Don't fire on first render (a task that mounts already completed, or the
    // initial paint) — only on a genuine not-done → done transition.
    if (!mounted.current) {
      mounted.current = true
      return
    }
    if (completed && !prev) {
      setCheer({ xp: taskXP(taskRef.current) })
      const timer = setTimeout(() => setCheer(null), 950)
      return () => clearTimeout(timer)
    }
  }, [completed])

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
    prioritySlot ? 'auto' : null, // priority chip / picker anchor
    dueSlot ? 'auto' : null,      // due chip / picker anchor
    reminderSlot ? 'auto' : null, // reminder chip / picker anchor
    'auto',                     // minutes
    onToggleToday ? 'auto' : null, // Today sun toggle (dashboard rows only)
    'auto',                     // three-dot menu
  ]
    .filter(Boolean)
    .join(' ')

  const style = {
    transform: CSS.Translate.toString(transform),
    opacity: isDragging ? 0.5 : undefined,
    gridTemplateColumns,
    // Priority-1 rows carry a 3px destructive left edge; every row reserves
    // the 3px (transparent otherwise) so toggling priority/completion never
    // shifts the row's content sideways.
    borderLeft: `3px solid ${
      task.priority === 1 && !completed ? 'hsl(var(--destructive))' : 'transparent'
    }`,
    '--flush': `color-mix(in srgb, ${flush} 18%, transparent)`,
  } as React.CSSProperties

  const whenChip = when && (
    <button
      type="button"
      aria-label={
        whenKind === 'due'
          ? `Due ${when.long} — edit due date`
          : `Reminder ${when.long} — edit reminder`
      }
      title={whenKind === 'due' ? `Due ${when.long}` : `Reminder ${when.long}`}
      className={cn(
        HIT_AREA,
        'inline-flex min-h-6 items-center gap-1 whitespace-nowrap rounded-sm px-1.5 font-mono text-[11px] tabular-nums hover:bg-bg-alt focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        WHEN_TONE[when.tone],
        // >=44pt hit target on touch (UX-02); visual size unchanged.
        isTouch && 'before:size-11',
      )}
    >
      {whenKind === 'reminder' && <Bell className="size-3" aria-hidden />}
      {when.text}
    </button>
  )

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        'relative grid items-center gap-3 border-t border-line px-3 py-2 transition-[background-color,opacity] hover:bg-bg-alt/60',
        // Held at full opacity while the cheer plays so the flush + floater
        // are visible, then fades as the linger drops it into "completed".
        completed && !cheer && 'opacity-50',
        selected && 'bg-bg-alt/70',
        cheer && 'row-flush',
      )}
    >
      {cheer && (
        <span className="xp-floater" style={{ color: flush }}>
          +{cheer.xp}
        </span>
      )}
      {selectable && (
        <Checkbox
          checked={selected}
          aria-label={selected ? 'Deselect task' : 'Select task'}
          onCheckedChange={() => onToggleSelected?.(task.id)}
          // Extend the existing ::before hit area to >=44pt on touch (UX-02 /
          // §13 "all interactive elements"); visual box stays 16px.
          className={cn('rounded-sm', isTouch && 'before:size-11')}
        />
      )}
      <Checkbox
        checked={completed}
        aria-label={completed ? 'Mark task incomplete' : 'Mark task complete'}
        onCheckedChange={(next) => {
          if (typeof next === 'boolean') void onComplete(task.id, next)
        }}
        className={cn(isTouch && 'before:size-11', cheer && 'check-pop')}
      />
      {canDrag && (
        <button
          type="button"
          aria-label={`Drag to move "${task.title}"`}
          {...attributes}
          {...listeners}
          onClick={(e) => e.stopPropagation()}
          // 14px column and visual; the ::before widens the target to 24px.
          className={cn(
            HIT_AREA,
            'inline-flex h-6 w-3.5 cursor-grab items-center justify-center rounded-sm text-ink-3/70 before:size-6 hover:bg-bg-alt hover:text-ink active:cursor-grabbing focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          )}
        >
          <GripVertical className="size-3" aria-hidden />
        </button>
      )}
      <TitleField
        task={task}
        onCommit={(title) => onEditTitle(task.id, title)}
      />
      {prioritySlot && (
        <PriorityPicker
          open={priorityOpen}
          onOpenChange={setPriorityOpen}
          priority={task.priority}
          trigger={
            chipPriority !== null ? (
              <PriorityChip
                priority={chipPriority}
                // Radix's trigger toggle merges in via Slot; this stops
                // the click from reaching row-level handlers.
                onClick={(e) => e.stopPropagation()}
                className={cn(isTouch && 'before:size-11')}
              />
            ) : undefined
          }
          onPick={(p) => onSetPriority(task.id, p)}
        />
      )}
      {dueSlot && (
        <SetDuePopover
          open={dueOpen}
          onOpenChange={setDueOpen}
          dueAt={task.dueAt}
          trigger={whenKind === 'due' ? whenChip : undefined}
          onSave={(iso) => onSetDue(task.id, iso)}
          onClear={() => onSetDue(task.id, null)}
        />
      )}
      {reminderSlot && (
        <SetReminderPopover
          open={reminderOpen}
          onOpenChange={setReminderOpen}
          remindAt={task.remindAt}
          trigger={whenKind === 'reminder' ? whenChip : undefined}
          onSave={(iso) => onSetReminder(task.id, iso)}
          onClear={() => onSetReminder(task.id, null)}
        />
      )}
      <MinutesField
        task={task}
        onCommit={(minutes) => onEditMinutes(task.id, minutes)}
      />
      {onToggleToday && (
        <button
          type="button"
          aria-label={
            inToday
              ? `Remove "${task.title}" from Today`
              : `Add "${task.title}" to Today`
          }
          title={inToday ? 'Remove from Today' : 'Add to Today'}
          aria-pressed={inToday}
          onClick={() => onToggleToday(task.id)}
          className={cn(
            'inline-flex items-center justify-center rounded-sm hover:bg-bg-alt focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            isTouch ? 'h-11 w-11' : 'h-6 w-6',
            inToday
              ? 'text-[hsl(var(--accent))]'
              : 'text-ink-3 hover:text-ink',
          )}
        >
          <Sun className="size-3.5" aria-hidden />
        </button>
      )}
      <TaskMenu
        task={task}
        categories={categories}
        subcategories={subcategories}
        onMoveToSubcategoryId={(targetId) =>
          onMoveToSubcategory(task.id, targetId)
        }
        onOpenReminder={() => setReminderOpen(true)}
        onOpenPriority={() => setPriorityOpen(true)}
        onOpenDue={() => setDueOpen(true)}
        notes={notes}
        onOpenNotes={() => openTaskNotes(task.id)}
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
          'line-clamp-2 min-w-0 whitespace-normal break-words text-left text-[13px] leading-tight text-ink hover:text-ink-2',
          completed && 'line-through decoration-ink-3',
        )}
        title={task.title}
      >
        {/* The clamp is repeated on a span: a <button> lays its content out
            in an anonymous box, so engines can skip a clamp set on it. */}
        <span className="line-clamp-2">{task.title}</span>
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
        'min-w-0 rounded-sm bg-background px-2 py-1 text-base text-ink shadow-[inset_0_0_0_1px_hsl(var(--ring))] outline-none focus:shadow-[inset_0_0_0_1px_hsl(var(--ring))] sm:text-[13px]',
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
        className="min-h-6 rounded-sm px-1 font-mono text-[12px] tabular-nums text-ink-3 hover:bg-bg-alt hover:text-ink focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      >
        {fmtMin(task.estimateMinutes)}
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
        'w-16 rounded-sm bg-background px-2 py-1 text-right font-mono text-base text-ink shadow-[inset_0_0_0_1px_hsl(var(--ring))] outline-none sm:text-[12px]',
        invalid &&
          'shadow-[inset_0_0_0_1px_hsl(var(--destructive))] focus:shadow-[inset_0_0_0_1px_hsl(var(--destructive))]',
      )}
    />
  )
}
