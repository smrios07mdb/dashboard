import { useState } from 'react'
import {
  Bell,
  CalendarClock,
  ListFilter,
  MoreHorizontal,
  Trash2,
} from 'lucide-react'

import BlockTimeSheet from '@/components/BlockTimeSheet'
import DeleteConfirm from '@/components/DeleteConfirm'
import { Note as NoteGlyph } from '@/components/icons'
import MoveToPicker from '@/components/MoveToPicker'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import type { Category, Note, Subcategory, Task } from '@/db/types'
import { noteRel } from '@/lib/notes'
import { cn } from '@/lib/utils'
import { useIsTouchDevice } from '@/lib/useIsTouchDevice'

/*
 * Three-dot menu attached to each TaskRow.
 *
 * Items per chunk 9: Move to (cascading MoveToPicker), Set reminder…
 * (delegates to the parent — the reminder popover is anchored on
 * TaskRow's bell icon, so its open state lives there), Notes / Add a
 * note (chunk 59 — opens the task notes sheet NotesProvider owns; it
 * replaced the old notes dialog), Delete (DeleteConfirm).
 *
 * "Move to" uses MoveToPicker as a DropdownMenuSub branch — picking a
 * target closes the dropdown via Radix's default item-select behavior
 * and fires onMoveToSubcategoryId.
 *
 * "Delete" wraps the menu item in DeleteConfirm (chunk-7's wrapper).
 * The item's onSelect calls preventDefault so the dropdown doesn't
 * race the AlertDialog for focus on click.
 */

export type TaskMenuProps = {
  task: Task
  categories: Category[]
  subcategories: Subcategory[]
  onMoveToSubcategoryId: (targetSubId: string) => void | Promise<void>
  /** Opens the reminder popover that lives in TaskRow (two entry points). */
  onOpenReminder: () => void
  /** Opens the priority picker that lives in TaskRow (chip + this item). */
  onOpenPriority: () => void
  /** The task's notes, newest first — picks the item's label and right side. */
  notes: Note[]
  onOpenNotes: () => void
  onDelete: () => void | Promise<void>
}

export default function TaskMenu({
  task,
  categories,
  subcategories,
  onMoveToSubcategoryId,
  onOpenReminder,
  onOpenPriority,
  notes,
  onOpenNotes,
  onDelete,
}: TaskMenuProps) {
  const isTouch = useIsTouchDevice()
  const [blockTimeOpen, setBlockTimeOpen] = useState(false)

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label={`Actions for "${task.title}"`}
            className={cn(
              'inline-flex items-center justify-center rounded-sm text-muted-foreground hover:bg-secondary hover:text-secondary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              isTouch ? 'h-11 w-11' : 'h-6 w-6',
            )}
          >
            <MoreHorizontal className="size-3.5" aria-hidden />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <MoveToPicker
            categories={categories}
            subcategories={subcategories}
            currentSubcategoryId={task.subcategoryId}
            onSelect={(id) => void onMoveToSubcategoryId(id)}
          />
          <DropdownMenuItem onSelect={() => onOpenPriority()}>
            <ListFilter className="size-3.5" aria-hidden />
            Set priority…
            {task.priority !== null && (
              <span className="ml-auto pl-4 font-mono text-[10px] tracking-[0.1em] text-ink-3">
                P{task.priority}
              </span>
            )}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => onOpenReminder()}>
            <Bell className="size-3.5" aria-hidden />
            {task.remindAt ? 'Edit reminder' : 'Set reminder…'}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setBlockTimeOpen(true)}>
            <CalendarClock className="size-3.5" aria-hidden />
            Block time
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => onOpenNotes()}>
            <NoteGlyph size={14} aria-hidden />
            {notes.length > 0 ? 'Notes' : 'Add a note'}
            {notes.length > 0 && (
              <span className="num ml-auto pl-4 text-[11px] text-ink-3">
                {notes.length > 1 ? notes.length : noteRel(notes[0].updatedAt)}
              </span>
            )}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DeleteConfirm
            trigger={
              <DropdownMenuItem
                onSelect={(e) => {
                  // Keep the menu's onSelect from auto-closing the
                  // dropdown before AlertDialog adopts focus.
                  e.preventDefault()
                }}
                className="text-destructive focus:text-destructive"
              >
                <Trash2 className="size-3.5" aria-hidden />
                Delete
              </DropdownMenuItem>
            }
            title="Delete this task?"
            description="This cannot be undone."
            onConfirm={onDelete}
          />
        </DropdownMenuContent>
      </DropdownMenu>

      <BlockTimeSheet
        task={task}
        open={blockTimeOpen}
        onOpenChange={setBlockTimeOpen}
      />
    </>
  )
}
