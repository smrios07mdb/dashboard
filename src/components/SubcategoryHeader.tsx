import { useEffect, useRef, useState } from 'react'
import { useDroppable } from '@dnd-kit/core'
import {
  ArrowDown,
  ArrowUp,
  GitMerge,
  GripVertical,
  MoreHorizontal,
  Pencil,
  Trash2,
} from 'lucide-react'

import DeleteSubcategoryDialog from '@/components/DeleteSubcategoryDialog'
import MergeSubcategoryDialog from '@/components/MergeSubcategoryDialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import type { Subcategory } from '@/db/types'
import { cn } from '@/lib/utils'

/*
 * One subcategory header — chunk 8 extracted this out of
 * SubcategorySection so the chunk-8 affordances (inline rename, drag
 * handle, three-dot menu) live in one place.
 *
 * Inline rename uses the chunk-7 draft-or-null pattern: `null` means
 * "not editing", and the input renders from the draft string while
 * present. No useEffect synchronizes the draft from the prop, so a
 * realtime echo during edit can't clobber in-flight input.
 *
 * Three-dot menu items:
 *   Rename         — flips into edit mode (same path as clicking name)
 *   Delete         — opens DeleteSubcategoryDialog (no-tasks vs has-tasks
 *                    branch decided by the dialog itself)
 *   Merge into…    — opens MergeSubcategoryDialog
 *   Move up/down   — touch-only fallback for reorder (drag is desktop-only)
 *
 * Drag handle: desktop only. The drag listeners (`@dnd-kit` `attributes`
 * + `listeners`) come from CategoryColumn's sortable wrapper. On touch
 * devices, the handle is hidden and the menu shows Move up/down instead.
 */

function formatMinutes(mins: number): string {
  if (!mins) return '0m'
  if (mins < 60) return `${mins}m`
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return m ? `${h}h ${m}m` : `${h}h`
}

export type SubcategoryHeaderProps = {
  subcategory: Subcategory
  incompleteCount: number
  incompleteMinutes: number
  /** Total tasks attached to this subcategory (live + completed). */
  taskCount: number
  /** Other non-archived subs in the same category — exclude self. */
  otherSubsInCategory: Subcategory[]
  canMoveUp: boolean
  canMoveDown: boolean
  isTouch: boolean
  /** Drag handle bindings from useSortable; undefined on touch. */
  dragHandleProps?: {
    attributes: Record<string, unknown>
    listeners: Record<string, unknown>
  }
  onDrillDown: (id: string) => void
  onRename: (name: string) => void | Promise<void>
  onDeleteSubcategory: (
    id: string,
    options: { moveToId?: string; cascadeDelete?: boolean },
  ) => void | Promise<void>
  onMergeSubcategory: (
    sourceId: string,
    targetId: string,
  ) => void | Promise<void>
  onMoveUp: () => void
  onMoveDown: () => void
}

export default function SubcategoryHeader({
  subcategory,
  incompleteCount,
  incompleteMinutes,
  taskCount,
  otherSubsInCategory,
  canMoveUp,
  canMoveDown,
  isTouch,
  dragHandleProps,
  onDrillDown,
  onRename,
  onDeleteSubcategory,
  onMergeSubcategory,
  onMoveUp,
  onMoveDown,
}: SubcategoryHeaderProps) {
  const [draft, setDraft] = useState<string | null>(null)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [mergeOpen, setMergeOpen] = useState(false)
  const inputRef = useRef<HTMLInputElement | null>(null)

  const editing = draft !== null
  const trimmed = (draft ?? '').trim()
  const invalid = editing && trimmed.length === 0

  // Chunk 9: subcategory header is a drop target for task drags within
  // the same DndContext (Dashboard category column or CategoryView).
  // Drop data carries the target subcategoryId so the DndContext's
  // onDragEnd handler can fan it into repo.tasks.update.
  const { isOver, setNodeRef: setDropRef } = useDroppable({
    id: `subdrop:${subcategory.id}`,
    data: { type: 'subcategory', subcategoryId: subcategory.id },
  })

  useEffect(() => {
    if (editing) inputRef.current?.select()
  }, [editing])

  function startEditing() {
    setDraft(subcategory.name)
  }

  function commit() {
    if (!editing) return
    if (trimmed.length === 0) {
      setDraft(null)
      return
    }
    if (trimmed === subcategory.name) {
      setDraft(null)
      return
    }
    void onRename(trimmed)
    setDraft(null)
  }

  return (
    <header
      ref={setDropRef}
      role="button"
      tabIndex={editing ? -1 : 0}
      onDoubleClick={() => !editing && onDrillDown(subcategory.id)}
      onKeyDown={(e) => {
        if (editing) return
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onDrillDown(subcategory.id)
        }
      }}
      className={cn(
        'grid cursor-pointer items-center gap-2 px-3 py-3 transition-colors [grid-template-columns:auto_1fr_auto_auto_auto_auto]',
        isOver
          ? 'bg-[hsl(var(--ring)/0.15)] ring-1 ring-inset ring-[hsl(var(--ring))]'
          : 'hover:bg-secondary/40',
      )}
    >
      {/* Drag handle — desktop only */}
      {!isTouch ? (
        <button
          type="button"
          aria-label={`Drag to reorder ${subcategory.name}`}
          {...(dragHandleProps?.attributes ?? {})}
          {...(dragHandleProps?.listeners ?? {})}
          onClick={(e) => e.stopPropagation()}
          className="inline-flex h-6 w-5 cursor-grab items-center justify-center rounded-sm text-muted-foreground hover:bg-secondary hover:text-foreground active:cursor-grabbing focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <GripVertical className="size-3.5" aria-hidden />
        </button>
      ) : (
        <span aria-hidden className="inline-block h-6 w-5" />
      )}

      {/* Name or inline-edit input */}
      {editing ? (
        <input
          ref={inputRef}
          autoFocus
          type="text"
          value={draft ?? ''}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onClick={(e) => e.stopPropagation()}
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
          aria-label="Subcategory name"
          className={cn(
            'min-w-0 rounded-sm bg-background px-2 py-1 text-[14px] font-medium text-foreground shadow-[inset_0_0_0_1px_hsl(var(--ring))] outline-none',
            invalid &&
              'shadow-[inset_0_0_0_1px_hsl(var(--destructive))]',
          )}
        />
      ) : (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            startEditing()
          }}
          className="min-w-0 truncate text-left text-[14px] font-medium text-foreground hover:text-accent-foreground"
          title={subcategory.name}
        >
          {subcategory.name}
        </button>
      )}

      <span className="font-mono text-[12px] text-muted-foreground tabular-nums">
        {incompleteCount}
      </span>
      <span className="font-mono text-[12px] text-muted-foreground tabular-nums">
        {formatMinutes(incompleteMinutes)}
      </span>

      <button
        type="button"
        aria-label={`Open ${subcategory.name}`}
        onClick={(e) => {
          e.stopPropagation()
          onDrillDown(subcategory.id)
        }}
        className="inline-flex h-6 w-6 items-center justify-center rounded-sm text-[16px] leading-none text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span aria-hidden>›</span>
      </button>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label={`Actions for ${subcategory.name}`}
            onClick={(e) => e.stopPropagation()}
            className="inline-flex h-6 w-6 items-center justify-center rounded-sm text-muted-foreground hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <MoreHorizontal className="size-3.5" aria-hidden />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
          <DropdownMenuItem onSelect={() => startEditing()}>
            <Pencil className="size-3.5" aria-hidden />
            Rename
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={otherSubsInCategory.length === 0}
            onSelect={() => setMergeOpen(true)}
          >
            <GitMerge className="size-3.5" aria-hidden />
            Merge into…
          </DropdownMenuItem>
          {isTouch && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem disabled={!canMoveUp} onSelect={onMoveUp}>
                <ArrowUp className="size-3.5" aria-hidden />
                Move up
              </DropdownMenuItem>
              <DropdownMenuItem disabled={!canMoveDown} onSelect={onMoveDown}>
                <ArrowDown className="size-3.5" aria-hidden />
                Move down
              </DropdownMenuItem>
            </>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onSelect={() => setDeleteOpen(true)}
            className="text-destructive focus:text-destructive"
          >
            <Trash2 className="size-3.5" aria-hidden />
            Delete subcategory
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <DeleteSubcategoryDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        subcategory={subcategory}
        taskCount={taskCount}
        otherSubsInCategory={otherSubsInCategory}
        onConfirm={(options) =>
          onDeleteSubcategory(subcategory.id, options)
        }
      />
      <MergeSubcategoryDialog
        open={mergeOpen}
        onOpenChange={setMergeOpen}
        subcategory={subcategory}
        taskCount={taskCount}
        otherSubsInCategory={otherSubsInCategory}
        onConfirm={(targetId) =>
          onMergeSubcategory(subcategory.id, targetId)
        }
      />
    </header>
  )
}
