import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'

import { BookOpen, ChevronLeft, Plus } from '@/components/icons'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/ui/icon-button'
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet'
import { repo } from '@/db/repo'
import type { Note } from '@/db/types'
import { catColor } from '@/lib/cat'
import {
  noteExcerpt,
  noteFirstLine,
  noteRel,
  resolveAttachment,
  type NoteContext,
} from '@/lib/notes'
import { useIsTouchDevice } from '@/lib/useIsTouchDevice'
import { cn } from '@/lib/utils'
import { useUIStore } from '@/state/uiStore'

import AttachPicker, { type AttachTarget } from './AttachPicker'
import NoteEditor from './NoteEditor'
import { useNotes, useTaskNotes } from './notesContext'
import { newDraftNote, useNoteWriter } from './useNoteWriter'

/*
 * A task's notes, beside the task (chunk 59, D6; handoff §4).
 *
 * The app Sheet — right at 480px on pointer, bottom at 88vh on touch — titled
 * with the category dot and the task title. What it opens on:
 *
 *   0 notes  → an unsaved draft attached to the task, in the editor
 *   1 note   → that note's editor
 *   2+ notes → a list, newest first; a row opens its editor, and the title
 *              gains a back chevron
 *
 * Notes on a completed task always show here — only the Notebook list hides
 * them. Writing goes through `useNoteWriter`, so the draft rules are the
 * Notebook's: nothing is written until the draft is non-empty.
 *
 * This module is the lazy half of `NotesProvider`: it is what pulls in the
 * editor, the attach picker and the Markdown renderer.
 */

type TaskNotesSheetProps = {
  /**
   * From `NotesProvider`, already resolved. Not `useSession()` here: that hook
   * has no user on its first render, which is the render that decides whether
   * to open a draft.
   */
  userId: string
  taskId: string
  /** Open straight at this note. */
  noteId: string | null
  open: boolean
  onClose: () => void
}

const EMPTY_CTX: NoteContext = { categories: [], subcategories: [], tasks: [] }

export default function TaskNotesSheet({
  userId,
  taskId,
  noteId,
  open,
  onClose,
}: TaskNotesSheetProps) {
  const navigate = useNavigate()
  const touch = useIsTouchDevice()
  const dashboardRefreshKey = useUIStore((s) => s.dashboardRefreshKey)
  const { notes } = useNotes()
  const taskNotes = useTaskNotes(taskId)

  // What the sheet opens on, decided once per opening (the provider remounts
  // this component each time).
  const [initial] = useState(() => {
    if (noteId) return { viewId: noteId, draft: null }
    if (taskNotes.length === 0) {
      const draft = newDraftNote(userId, { taskId })
      return { viewId: draft.id, draft }
    }
    return { viewId: null, draft: null }
  })
  const { draft, openDraft, save, attach, detach, remove } = useNoteWriter({
    initialDraft: initial.draft,
  })
  /** The note being edited; `null` shows the list (or the only note). */
  const [viewId, setViewId] = useState<string | null>(initial.viewId)
  const [pickerOpen, setPickerOpen] = useState(false)

  const [ctx, setCtx] = useState<NoteContext>(EMPTY_CTX)
  useEffect(() => {
    let cancelled = false
    Promise.all([
      repo.categories.list(),
      repo.subcategories.list(),
      repo.tasks.list(),
    ])
      .then(([categories, subcategories, tasks]) => {
        if (!cancelled) setCtx({ categories, subcategories, tasks })
      })
      .catch((e) => console.error('Task notes load failed', e))
    return () => {
      cancelled = true
    }
  }, [dashboardRefreshKey])

  const task = useMemo(
    () => ctx.tasks.find((t) => t.id === taskId) ?? null,
    [ctx.tasks, taskId],
  )
  const categoryName = useMemo(() => {
    const sub = task && ctx.subcategories.find((s) => s.id === task.subcategoryId)
    return sub ? ctx.categories.find((c) => c.id === sub.categoryId)?.name : undefined
  }, [ctx, task])

  // The note on screen: the one picked, while it is still on this task (or is
  // the open draft); otherwise the task's only note. With two or more and
  // nothing picked, the list.
  const picked = viewId
    ? (taskNotes.find((n) => n.id === viewId) ??
      (draft && draft.id === viewId ? draft : null))
    : null
  const shown = picked ?? (taskNotes.length === 1 ? taskNotes[0] : null)
  const shownIsDraft = shown !== null && shown === draft
  const others = shown ? taskNotes.filter((n) => n.id !== shown.id).length : 0

  function newNote() {
    setViewId(openDraft(userId, { taskId }).id)
  }

  function openInNotebook(id: string) {
    onClose()
    navigate(`/notebook/${id}`)
  }

  /**
   * `note` is about to leave this task (moved, unlinked or deleted). Whether
   * it is the task's last is read here, from the notes as they stand BEFORE
   * the write; the returned function then goes back to the list, or closes
   * the sheet when that was the last one.
   */
  function leaving(note: Note) {
    const wasLast = taskNotes.every((n) => n.id === note.id)
    return () => {
      setViewId(null)
      if (wasLast) onClose()
    }
  }

  // Belt and braces for the same rule (chunk 59a, F2): an open sheet with no
  // note on screen and none on the task has nothing to show — the last note
  // went, here or on another device — so it closes rather than sit on an
  // empty list. A 0-note opening never lands here: it starts on a draft.
  const nothingLeft = open && !shown && taskNotes.length === 0
  useEffect(() => {
    if (nothingLeft) onClose()
  }, [nothingLeft, onClose])

  function detachNote(note: Note) {
    const left = leaving(note)
    void detach(note.id).then(
      () => {
        toast.success(
          `Detached from ${task?.title ?? 'the task'}. It is now a freeform note.`,
        )
        left()
      },
      () => undefined,
    )
  }

  function pick(note: Note, target: AttachTarget | null) {
    setPickerOpen(false)
    if (!target) {
      detachNote(note)
      return
    }
    // Picking the task it is already on changes nothing.
    if (target.kind === 'task' && target.id === taskId) return
    const left = leaving(note)
    void attach(note.id, target).then(
      () => {
        toast.success('Note moved.')
        left()
      },
      () => undefined,
    )
  }

  async function removeNote(note: Note) {
    const left = leaving(note)
    if (await remove(note)) left()
  }

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent
        side={touch ? 'bottom' : 'right'}
        data-side={touch ? 'bottom' : 'right'}
        aria-describedby={undefined}
        // A blank draft's editor has already put the caret in its body; leave
        // it there instead of letting the sheet focus its first control.
        onOpenAutoFocus={(e) => {
          if (shownIsDraft) e.preventDefault()
        }}
        className={cn(
          'flex flex-col gap-0 bg-surface p-0',
          touch
            ? 'h-[88vh] rounded-t-xl'
            : 'w-full max-w-[480px] sm:max-w-[480px]',
        )}
      >
        <SheetTitle className="flex min-h-[52px] min-w-0 items-center gap-2 border-b border-line py-2 pl-4 pr-12 text-[14px] font-semibold">
          {shown && others > 0 && (
            <IconButton
              label="All notes on this task"
              size={touch ? 40 : 28}
              tone="ink"
              onClick={() => setViewId(null)}
              className="-ml-2"
            >
              <ChevronLeft size={18} />
            </IconButton>
          )}
          <span
            aria-hidden
            className="size-2 shrink-0 rounded-full"
            style={{
              background: categoryName ? catColor(categoryName) : 'var(--ink-4)',
            }}
          />
          <span className="min-w-0 truncate">{task?.title ?? 'Notes'}</span>
          {!shown && taskNotes.length > 1 && (
            <span className="num shrink-0 text-[11px] font-normal text-ink-3">
              {taskNotes.length} notes
            </span>
          )}
        </SheetTitle>

        {shown ? (
          <div className="relative min-h-0 flex-1">
            <div className="absolute inset-0">
              <NoteEditor
                key={shown.id}
                note={shown}
                persisted={!shownIsDraft}
                attachment={resolveAttachment(shown, ctx)}
                touch={touch}
                onSave={(changes) => save(shown.id, changes)}
                onTogglePin={() =>
                  void save(shown.id, { pinned: !shown.pinned }).catch(
                    () => undefined,
                  )
                }
                onAttach={() => setPickerOpen(true)}
                onDetach={() => detachNote(shown)}
                onDelete={() => removeNote(shown)}
                menu={{
                  onOpenInNotebook: shownIsDraft
                    ? undefined
                    : () => openInNotebook(shown.id),
                  onNewNote: newNote,
                }}
              />
            </div>
          </div>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4">
            {taskNotes.length > 0 && (
              <div className="overflow-hidden rounded-md border border-line">
                {taskNotes.map((n) => (
                  <button
                    key={n.id}
                    type="button"
                    data-testid="task-note-row"
                    onClick={() => setViewId(n.id)}
                    className="grid min-h-11 w-full grid-cols-[1fr_auto] gap-x-3 gap-y-0.5 border-b border-line px-3.5 py-3 text-left transition-colors last:border-b-0 hover:bg-bg-alt focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
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
                    <span className="col-span-full line-clamp-2 text-[12.5px] text-ink-2">
                      {noteExcerpt(n)}
                    </span>
                  </button>
                ))}
              </div>
            )}
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                size={touch ? 'default' : 'sm'}
                onClick={newNote}
              >
                <Plus aria-hidden />
                New note
              </Button>
              {taskNotes.length > 0 && (
                <Button
                  type="button"
                  variant="ghost"
                  size={touch ? 'default' : 'sm'}
                  onClick={() => openInNotebook(taskNotes[0].id)}
                >
                  <BookOpen aria-hidden />
                  Open in Notebook
                </Button>
              )}
            </div>
          </div>
        )}

        {shown && (
          <AttachPicker
            open={pickerOpen}
            onOpenChange={setPickerOpen}
            note={shown}
            notes={notes}
            ctx={ctx}
            onPick={(target) => pick(shown, target)}
          />
        )}
      </SheetContent>
    </Sheet>
  )
}
