import { useRef, useState } from 'react'
import {
  Bell,
  CalendarCheck,
  CalendarClock,
  ListFilter,
  MoreHorizontal,
  Trash2,
} from 'lucide-react'

import BlockTimeSheet from '@/components/BlockTimeSheet'
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
 * (delegates to the parent — the reminder popover's open state lives in
 * TaskRow, anchored on the row's reminder chip or, when the row shows
 * none, an invisible anchor; chunk 71), Notes / Add a
 * note (chunk 59 — opens the task notes sheet NotesProvider owns; it
 * replaced the old notes dialog), Delete.
 *
 * "Move to" uses MoveToPicker as a DropdownMenuSub branch — picking a
 * target closes the dropdown via Radix's default item-select behavior
 * and fires onMoveToSubcategoryId.
 *
 * "Delete" is a plain item with no confirm (chunk 72): the parent hides
 * the task and lib/taskUndo hard-deletes it 6 s later unless Undo is
 * pressed in the toast.
 */

export type TaskMenuProps = {
  task: Task
  categories: Category[]
  subcategories: Subcategory[]
  onMoveToSubcategoryId: (targetSubId: string) => void | Promise<void>
  /** Opens the reminder popover that lives in TaskRow (reminder chip + this item). */
  onOpenReminder: () => void
  /** Opens the priority picker that lives in TaskRow (chip + this item). */
  onOpenPriority: () => void
  /** Opens the due-date picker that lives in TaskRow (due chip + this item). */
  onOpenDue: () => void
  /** The task's notes, newest first — picks the item's label and right side. */
  notes: Note[]
  onOpenNotes: () => void
  onDelete: () => void | Promise<void>
  /** Where focus goes when the Block time sheet closes (chunk 77c). */
  onSheetClose?: (e: Event) => void
  /** TaskRow's roving-tabindex props for the ⋯ trigger (chunk 77). */
  triggerProps?: {
    'data-row-nav'?: string
    tabIndex?: number
    onFocus?: React.FocusEventHandler<HTMLButtonElement>
  }
}

export default function TaskMenu({
  task,
  categories,
  subcategories,
  onMoveToSubcategoryId,
  onOpenReminder,
  onOpenPriority,
  onOpenDue,
  notes,
  onOpenNotes,
  onDelete,
  onSheetClose,
  triggerProps,
}: TaskMenuProps) {
  const isTouch = useIsTouchDevice()
  const [blockTimeOpen, setBlockTimeOpen] = useState(false)
  // Set by the three picker items (chunk 77a) and the two sheet items (77c):
  // the menu then keeps focus off ⋯ as it closes, so the picker or sheet it
  // hands off to keeps it. A sheet item stores its opener instead of `true`:
  // the sheet opens only once the menu has closed, since the menu's focus
  // trap stays active through its exit animation and would pull focus back
  // out of a sheet mounting inside that window.
  const handingOff = useRef<boolean | (() => void)>(false)
  // Radix focuses a menu item on pointer move and the menu on pointer leave.
  // The closing menu still gets both while the picker sits over it (chunk
  // 77b), so a hand-off item skips them; hover is untouched otherwise.
  const keepFocus = (e: React.PointerEvent) => {
    if (handingOff.current) e.preventDefault()
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            {...triggerProps}
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
        <DropdownMenuContent
          align="end"
          onCloseAutoFocus={(e) => {
            const open = handingOff.current
            if (open) {
              e.preventDefault()
              handingOff.current = false
              if (open !== true) open()
            }
          }}
        >
          <MoveToPicker
            categories={categories}
            subcategories={subcategories}
            currentSubcategoryId={task.subcategoryId}
            onSelect={(id) => void onMoveToSubcategoryId(id)}
          />
          <DropdownMenuItem
            onPointerMove={keepFocus}
            onPointerLeave={keepFocus}
            onSelect={() => {
              handingOff.current = true
              onOpenPriority()
            }}
          >
            <ListFilter className="size-3.5" aria-hidden />
            Set priority…
            {task.priority !== null && (
              <span className="ml-auto pl-4 font-mono text-[11px] tracking-[0.1em] text-ink-3">
                P{task.priority}
              </span>
            )}
          </DropdownMenuItem>
          <DropdownMenuItem
            onPointerMove={keepFocus}
            onPointerLeave={keepFocus}
            onSelect={() => {
              handingOff.current = true
              onOpenDue()
            }}
          >
            <CalendarCheck className="size-3.5" aria-hidden />
            {task.dueAt ? 'Edit due date' : 'Set due date…'}
          </DropdownMenuItem>
          <DropdownMenuItem
            onPointerMove={keepFocus}
            onPointerLeave={keepFocus}
            onSelect={() => {
              handingOff.current = true
              onOpenReminder()
            }}
          >
            <Bell className="size-3.5" aria-hidden />
            {task.remindAt ? 'Edit reminder' : 'Set reminder…'}
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={() => {
              handingOff.current = () => setBlockTimeOpen(true)
            }}
          >
            <CalendarClock className="size-3.5" aria-hidden />
            Block time
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={() => {
              handingOff.current = onOpenNotes
            }}
          >
            <NoteGlyph size={14} aria-hidden />
            {notes.length > 0 ? 'Notes' : 'Add a note'}
            {notes.length > 0 && (
              <span className="num ml-auto pl-4 text-[11px] text-ink-3">
                {notes.length > 1 ? notes.length : noteRel(notes[0].updatedAt)}
              </span>
            )}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onSelect={() => void onDelete()}
            className="text-destructive focus:text-destructive"
          >
            <Trash2 className="size-3.5" aria-hidden />
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <BlockTimeSheet
        task={task}
        open={blockTimeOpen}
        onOpenChange={setBlockTimeOpen}
        onCloseAutoFocus={onSheetClose}
      />
    </>
  )
}
