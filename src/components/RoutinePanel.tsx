import { useMemo, useRef, useState, type FormEvent } from 'react'
import {
  DndContext,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import {
  ArrowDown,
  ArrowUp,
  GripVertical,
  MoonStar,
  Plus,
  Sun,
  X,
} from 'lucide-react'

import DeleteConfirm from '@/components/DeleteConfirm'
import RoutineDotGrid from '@/components/RoutineDotGrid'
import StreakBadge from '@/components/StreakBadge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import type { RoutineItem, RoutineLog } from '@/db/types'
import { calcStreak } from '@/lib/streak'
import { useIsTouchDevice } from '@/lib/useIsTouchDevice'
import { cn } from '@/lib/utils'
import { MoreHorizontal } from 'lucide-react'

/**
 * One routine panel (Morning or Night).
 *
 * Two modes governed by the local `editing` state:
 *   - Check-off (default): list of today's non-archived items as
 *     accessible checkboxes. Click toggles via `onToggle`.
 *   - Edit: rename inline (chunk-7 draft-or-null pattern), grip handle
 *     to reorder on desktop, Move up / Move down menu items on touch
 *     (per pre-flight #2; matches the chunk-8 SubcategoryHeader
 *     affordance switch). Direct `X` delete per pre-flight #3 — no
 *     three-dot menu equivalent.
 *
 * Drag is per-panel: each panel mounts its own `DndContext` so the
 * morning and night sorts can't bleed across (they're separate
 * `routine` values, not a continuum). Within the panel, items are
 * wrapped in a single vertical-strategy `SortableContext`.
 *
 * The streak text comes from `calcStreak` with explicit
 * `todayKey` + `timezone` args so the component never reaches into
 * `clock` itself (pre-flight #6). The 14-day grid is the same story.
 */

export type RoutinePanelProps = {
  routine: 'morning' | 'night'
  items: RoutineItem[]
  logs: RoutineLog[]
  todayKey: string
  timezone: string
  onToggle: (itemId: string, completed: boolean) => void | Promise<void>
  onCreate: (label: string) => Promise<boolean>
  onRename: (id: string, label: string) => void | Promise<void>
  onArchive: (id: string) => void | Promise<void>
  onReorder: (orderedIds: string[]) => void | Promise<void>
  onMove: (id: string, direction: 'up' | 'down') => void
}

export default function RoutinePanel({
  routine,
  items,
  logs,
  todayKey,
  timezone,
  onToggle,
  onCreate,
  onRename,
  onArchive,
  onReorder,
  onMove,
}: RoutinePanelProps) {
  const isTouch = useIsTouchDevice()
  const [editing, setEditing] = useState(false)

  const live = useMemo(
    () =>
      items
        .filter((i) => i.routine === routine && !i.archivedAt)
        .sort((a, b) => a.sortOrder - b.sortOrder),
    [items, routine],
  )

  const streak = useMemo(
    () => calcStreak(routine, items, logs, todayKey, timezone),
    [routine, items, logs, todayKey, timezone],
  )

  const completedToday = useMemo(() => {
    const set = new Set<string>()
    for (const log of logs) {
      if (log.dateKey === todayKey && log.completed) set.add(log.routineItemId)
    }
    return set
  }, [logs, todayKey])

  const allDoneToday = live.length > 0 && live.every((i) => completedToday.has(i.id))

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 5 } }),
  )

  const itemIds = live.map((i) => i.id)

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const oldIndex = itemIds.indexOf(String(active.id))
    const newIndex = itemIds.indexOf(String(over.id))
    if (oldIndex === -1 || newIndex === -1) return
    const next = [...itemIds]
    const [moved] = next.splice(oldIndex, 1)
    next.splice(newIndex, 0, moved)
    void onReorder(next)
  }

  const Icon = routine === 'morning' ? Sun : MoonStar
  const accentRing =
    routine === 'morning'
      ? 'bg-[hsl(40_70%_60%/0.15)] text-[hsl(40_70%_72%)]'
      : 'bg-[hsl(260_75%_75%/0.15)] text-[hsl(260_70%_82%)]'

  return (
    <section className="rounded-md border border-border bg-card p-5">
      <header className="mb-5 flex flex-wrap items-center gap-3">
        <span
          aria-hidden
          className={cn(
            'inline-flex h-8 w-8 items-center justify-center rounded-full',
            accentRing,
          )}
        >
          <Icon className="size-4" />
        </span>
        <h2
          className="m-0 text-[20px] font-medium text-foreground"
          style={{ letterSpacing: '-0.01em' }}
        >
          {routine === 'morning' ? 'Morning' : 'Night'}
        </h2>
        <StreakBadge streak={streak} tone={routine} />
        <span className="ml-auto" />
        <Button
          size="sm"
          variant={editing ? 'default' : 'ghost'}
          onClick={() => setEditing((e) => !e)}
          aria-pressed={editing}
        >
          {editing ? 'Done' : 'Edit list'}
        </Button>
      </header>

      <div>
        {editing ? (
          <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
            <SortableContext
              items={itemIds}
              strategy={verticalListSortingStrategy}
            >
              {live.map((item, idx) => (
                <SortableEditRow
                  key={item.id}
                  item={item}
                  isTouch={isTouch}
                  canMoveUp={idx > 0}
                  canMoveDown={idx < live.length - 1}
                  onRename={onRename}
                  onArchive={onArchive}
                  onMove={onMove}
                />
              ))}
            </SortableContext>
          </DndContext>
        ) : (
          live.map((item) => (
            <CheckRow
              key={item.id}
              item={item}
              checked={completedToday.has(item.id)}
              onToggle={(next) => void onToggle(item.id, next)}
            />
          ))
        )}
        {live.length === 0 && (
          <div className="py-6 text-center text-[13px] italic text-muted-foreground">
            No items yet. {editing ? '' : 'Click "Edit list" to add some.'}
          </div>
        )}
        {editing && <AddItemRow routine={routine} onCreate={onCreate} />}
        {!editing && allDoneToday && (
          <div
            className={cn(
              'mt-4 flex items-center gap-2 rounded-md px-3 py-2 text-[13px]',
              routine === 'morning'
                ? 'bg-[hsl(40_70%_60%/0.13)] text-[hsl(40_70%_82%)]'
                : 'bg-[hsl(260_75%_75%/0.13)] text-[hsl(260_70%_88%)]',
            )}
          >
            All done for today.
          </div>
        )}
      </div>

      <div className="mt-6 border-t border-border pt-4">
        <div className="label mb-3">Last 14 days</div>
        <RoutineDotGrid
          routine={routine}
          items={items}
          logs={logs}
          todayKey={todayKey}
          timezone={timezone}
        />
      </div>
    </section>
  )
}

// ---------- check-off row ----------

function CheckRow({
  item,
  checked,
  onToggle,
}: {
  item: RoutineItem
  checked: boolean
  onToggle: (next: boolean) => void
}) {
  return (
    <label
      className={cn(
        'flex cursor-pointer items-center gap-3 border-t border-border px-1 py-2.5 first:border-t-0 transition-colors hover:bg-secondary/40',
      )}
    >
      <Checkbox
        checked={checked}
        aria-label={checked ? `Uncheck ${item.label}` : `Check ${item.label}`}
        onCheckedChange={(next) => {
          if (typeof next === 'boolean') onToggle(next)
        }}
      />
      <span
        className={cn(
          'flex-1 text-[14px]',
          checked
            ? 'text-muted-foreground line-through decoration-muted-foreground'
            : 'text-foreground',
        )}
      >
        {item.label}
      </span>
    </label>
  )
}

// ---------- edit-mode row + sortable wrapper ----------

type EditRowProps = {
  item: RoutineItem
  isTouch: boolean
  canMoveUp: boolean
  canMoveDown: boolean
  dragHandleProps?: {
    attributes: Record<string, unknown>
    listeners: Record<string, unknown>
  }
  onRename: (id: string, label: string) => void | Promise<void>
  onArchive: (id: string) => void | Promise<void>
  onMove: (id: string, direction: 'up' | 'down') => void
}

function EditRow({
  item,
  isTouch,
  canMoveUp,
  canMoveDown,
  dragHandleProps,
  onRename,
  onArchive,
  onMove,
}: EditRowProps) {
  // chunk-7 draft-or-null inline-edit pattern
  const [draft, setDraft] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const editing = draft !== null
  const trimmed = (draft ?? '').trim()
  const invalid = editing && trimmed.length === 0

  function commit() {
    if (!editing) return
    if (trimmed.length === 0 || trimmed === item.label) {
      setDraft(null)
      return
    }
    void onRename(item.id, trimmed)
    setDraft(null)
  }

  return (
    <div className="grid items-center gap-2 border-t border-border px-1 py-2 first:border-t-0 [grid-template-columns:auto_1fr_auto_auto]">
      {!isTouch ? (
        <button
          type="button"
          aria-label={`Drag to reorder ${item.label}`}
          {...(dragHandleProps?.attributes ?? {})}
          {...(dragHandleProps?.listeners ?? {})}
          className="inline-flex h-7 w-5 cursor-grab items-center justify-center rounded-sm text-muted-foreground hover:bg-secondary hover:text-foreground active:cursor-grabbing focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <GripVertical className="size-3.5" aria-hidden />
        </button>
      ) : (
        <span aria-hidden className="inline-block h-7 w-5" />
      )}

      {editing ? (
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
          aria-label="Routine item label"
          className={cn(
            'min-w-0 rounded-sm bg-background px-2 py-1 text-[14px] text-foreground shadow-[inset_0_0_0_1px_hsl(var(--ring))] outline-none',
            invalid &&
              'shadow-[inset_0_0_0_1px_hsl(var(--destructive))]',
          )}
        />
      ) : (
        <button
          type="button"
          onClick={() => setDraft(item.label)}
          className="min-w-0 truncate text-left text-[14px] text-foreground hover:text-accent-foreground"
          title={item.label}
        >
          {item.label}
        </button>
      )}

      {isTouch ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label={`Actions for ${item.label}`}
              className="inline-flex h-6 w-6 items-center justify-center rounded-sm text-muted-foreground hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <MoreHorizontal className="size-3.5" aria-hidden />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              disabled={!canMoveUp}
              onSelect={() => onMove(item.id, 'up')}
            >
              <ArrowUp className="size-3.5" aria-hidden />
              Move up
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={!canMoveDown}
              onSelect={() => onMove(item.id, 'down')}
            >
              <ArrowDown className="size-3.5" aria-hidden />
              Move down
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : (
        <span aria-hidden className="inline-block h-6 w-6" />
      )}

      <DeleteConfirm
        trigger={
          <button
            type="button"
            aria-label={`Remove ${item.label}`}
            className="inline-flex h-6 w-6 items-center justify-center rounded-sm text-muted-foreground hover:bg-secondary hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <X className="size-3.5" aria-hidden />
          </button>
        }
        title={`Remove "${item.label}"?`}
        description="This is reversible — items are archived rather than hard-deleted. Past streak history is preserved."
        confirmLabel="Remove"
        onConfirm={() => onArchive(item.id)}
      />
    </div>
  )
}

function SortableEditRow(props: Omit<EditRowProps, 'dragHandleProps'>) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: props.item.id })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : undefined,
  }

  return (
    <div ref={setNodeRef} style={style}>
      <EditRow
        {...props}
        dragHandleProps={{
          attributes: attributes as unknown as Record<string, unknown>,
          listeners: (listeners ?? {}) as unknown as Record<string, unknown>,
        }}
      />
    </div>
  )
}

// ---------- add-item form ----------

function AddItemRow({
  routine,
  onCreate,
}: {
  routine: 'morning' | 'night'
  onCreate: (label: string) => Promise<boolean>
}) {
  const [draft, setDraft] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const inputRef = useRef<HTMLInputElement | null>(null)

  const trimmed = draft.trim()
  const invalid = trimmed.length === 0
  const disabled = submitting || invalid

  async function submit() {
    if (disabled) return
    setSubmitting(true)
    try {
      const ok = await onCreate(trimmed)
      if (ok) {
        setDraft('')
        queueMicrotask(() => inputRef.current?.focus())
      }
    } finally {
      setSubmitting(false)
    }
  }

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    void submit()
  }

  return (
    <form
      onSubmit={onSubmit}
      className="mt-3 grid items-center gap-2 [grid-template-columns:1fr_auto]"
    >
      <Input
        ref={inputRef}
        type="text"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        placeholder={`Add a ${routine} item…`}
        aria-label={`New ${routine} item`}
        aria-invalid={invalid && draft.length > 0 ? true : undefined}
        className={cn(
          'h-9 bg-background text-[14px]',
          invalid &&
            draft.length > 0 &&
            'border-destructive focus-visible:ring-destructive',
        )}
      />
      <Button
        type="submit"
        size="sm"
        disabled={disabled}
        className="h-9 px-3"
      >
        <Plus className="size-3.5" aria-hidden />
        {submitting ? 'Adding…' : 'Add'}
      </Button>
    </form>
  )
}
