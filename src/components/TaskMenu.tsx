import { useState } from 'react'
import { Bell, FileText, MoreHorizontal, Trash2 } from 'lucide-react'

import DeleteConfirm from '@/components/DeleteConfirm'
import EditNotesDialog from '@/components/EditNotesDialog'
import MoveToPicker from '@/components/MoveToPicker'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import type { Category, Subcategory, Task } from '@/db/types'

/*
 * Three-dot menu attached to each TaskRow.
 *
 * Items per chunk 9: Move to (cascading MoveToPicker), Set reminder…
 * (delegates to the parent — the reminder popover is anchored on
 * TaskRow's bell icon, so its open state lives there), Edit notes
 * (EditNotesDialog mounted right here), Delete (DeleteConfirm).
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
  onEditNotes: (notes: string | null) => void | Promise<void>
  onDelete: () => void | Promise<void>
}

export default function TaskMenu({
  task,
  categories,
  subcategories,
  onMoveToSubcategoryId,
  onOpenReminder,
  onEditNotes,
  onDelete,
}: TaskMenuProps) {
  const [notesOpen, setNotesOpen] = useState(false)

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label={`Actions for "${task.title}"`}
            className="inline-flex h-6 w-6 items-center justify-center rounded-sm text-muted-foreground hover:bg-secondary hover:text-secondary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
          <DropdownMenuItem onSelect={() => onOpenReminder()}>
            <Bell className="size-3.5" aria-hidden />
            {task.remindAt ? 'Edit reminder' : 'Set reminder…'}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setNotesOpen(true)}>
            <FileText className="size-3.5" aria-hidden />
            Edit notes
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

      <EditNotesDialog
        open={notesOpen}
        onOpenChange={setNotesOpen}
        taskTitle={task.title}
        notes={task.notes}
        onSave={onEditNotes}
      />
    </>
  )
}
