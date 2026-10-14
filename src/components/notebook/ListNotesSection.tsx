import { useNavigate } from 'react-router-dom'

import { Note as NoteGlyph, Plus } from '@/components/icons'
import { Button } from '@/components/ui/button'
import type { Task } from '@/db/types'
import { noteFirstLine, noteRel } from '@/lib/notes'
import { useIsTouchDevice } from '@/lib/useIsTouchDevice'
import { cn } from '@/lib/utils'

import { useListNotes, useOpenTaskNotes } from './notesContext'

/*
 * The subcategory drill-down's Notes section (chunk 59, D6; handoff §4).
 *
 * Lists the notes attached to the list itself *and* to any of its tasks,
 * newest first, each row labelled with where it sits. A task's note opens the
 * task notes sheet at that note; a list's note goes to the Notebook.
 * `New note here` hands the Notebook an `attach` param — it opens an unsaved
 * draft already attached to this list, so nothing is written until it is
 * non-empty.
 */

type ListNotesSectionProps = {
  subcategoryId: string
  /** Every task on the list, completed ones included. */
  tasks: Task[]
}

export default function ListNotesSection({
  subcategoryId,
  tasks,
}: ListNotesSectionProps) {
  const navigate = useNavigate()
  const touch = useIsTouchDevice()
  const openTaskNotes = useOpenTaskNotes()
  const notes = useListNotes(
    subcategoryId,
    tasks.map((t) => t.id),
  )

  return (
    <section aria-label="Notes" className="mt-7">
      <div className="mb-2.5 flex items-center gap-2.5">
        <span className="label">Notes · {notes.length}</span>
        <Button
          type="button"
          variant="outline"
          size={touch ? 'default' : 'sm'}
          onClick={() =>
            navigate(`/notebook?attach=subcategory:${subcategoryId}`)
          }
          className="ml-auto"
        >
          <Plus aria-hidden />
          New note here
        </Button>
      </div>
      <div className="overflow-hidden rounded-md border border-line bg-surface">
        {notes.length === 0 && (
          <div className="px-4 py-6 text-center text-[13px] text-ink-3">
            No notes on this list yet.
          </div>
        )}
        {notes.map((n) => {
          const task = n.taskId ? tasks.find((t) => t.id === n.taskId) : null
          return (
            <button
              key={n.id}
              type="button"
              data-testid="list-note-row"
              onClick={(e) => {
                if (!task) {
                  navigate(`/notebook/${n.id}`)
                  return
                }
                // The sheet is not opened from a Radix trigger, so hand it this
                // row to return focus to (chunk 81). A row that unmounted while
                // the sheet was open (its note deleted) leaves Radix's default.
                const row = e.currentTarget
                openTaskNotes(task.id, n.id, (ev) => {
                  if (!row.isConnected) return
                  ev.preventDefault()
                  row.focus()
                })
              }}
              className={cn(
                'grid min-h-11 w-full grid-cols-[1fr_auto] gap-x-3 gap-y-0.5 border-b border-line px-3.5 text-left transition-colors last:border-b-0 hover:bg-bg-alt focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
                touch ? 'py-[13px]' : 'py-2.5',
              )}
            >
              <span
                className={cn(
                  'truncate text-[13.5px] font-semibold',
                  n.title ? 'text-ink' : 'italic text-ink-2',
                )}
              >
                {noteFirstLine(n)}
              </span>
              <span className="num text-[11px] text-ink-3">
                {noteRel(n.updatedAt)}
              </span>
              <span className="col-span-full flex min-w-0 items-center gap-1.5 text-[12px] text-ink-3">
                {task ? (
                  <>
                    <NoteGlyph size={12} aria-hidden className="shrink-0" />
                    <span className="truncate">{task.title}</span>
                  </>
                ) : (
                  'On this list'
                )}
              </span>
            </button>
          )
        })}
      </div>
    </section>
  )
}
