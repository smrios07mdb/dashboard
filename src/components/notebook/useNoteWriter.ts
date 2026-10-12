import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'

import { repo } from '@/db/repo'
import type { Note } from '@/db/types'
import { isBlankNote } from '@/lib/notes'

import type { AttachTarget } from './AttachPicker'
import { useNotes } from './notesContext'

/*
 * The one write path for notes (chunk 59, D4) — lifted out of the Notebook
 * screen so the task sheet writes by exactly the same rules:
 *
 *   - a new note is an unsaved draft until its title or body is
 *     non-whitespace; nothing is written before that, and walking away from an
 *     empty draft simply drops it;
 *   - emptying a note that already exists does not delete it;
 *   - writes run one at a time, so an update never overtakes its insert;
 *   - a failed write toasts `Could not save — retry` and rejects.
 *
 * Every write that succeeds is reported to `NotesProvider`, so counts on task
 * rows move without a refetch. The optional handlers let a screen that keeps
 * its own list (the Notebook) apply the same change to it.
 */

const SAVE_ERROR = 'Could not save — retry'

export type NoteChanges = Partial<
  Pick<
    Note,
    | 'title'
    | 'body'
    | 'pinned'
    | 'taskId'
    | 'subcategoryId'
    | 'detachedLabel'
    | 'detachedAt'
  >
>

type NoteLinks = { taskId?: string | null; subcategoryId?: string | null }

/** A blank note that exists only on screen, optionally pre-attached. */
export function newDraftNote(userId: string, links: NoteLinks = {}): Note {
  const now = new Date().toISOString()
  return {
    id: crypto.randomUUID(),
    userId,
    title: '',
    body: '',
    pinned: false,
    taskId: links.taskId ?? null,
    subcategoryId: links.subcategoryId ?? null,
    detachedLabel: null,
    detachedAt: null,
    createdAt: now,
    updatedAt: now,
  }
}

type NoteWriterOptions = {
  /** A draft to open with (the task sheet's "Add a note"). */
  initialDraft?: Note | null
  onCreated?: (note: Note) => void
  onUpdated?: (note: Note) => void
  onDeleted?: (id: string) => void
}

export function useNoteWriter(options: NoteWriterOptions = {}) {
  const { report } = useNotes()
  const initialDraft = options.initialDraft ?? null
  /** The open draft, as rendered. */
  const [draft, setDraft] = useState<Note | null>(initialDraft)

  /**
   * Unsaved drafts as the save path sees them, by id. State lags a render, and
   * a draft's last keystrokes are flushed as its editor unmounts — by which
   * time New note may already have opened the next one.
   */
  const draftsRef = useRef(
    new Map<string, Note>(initialDraft ? [[initialDraft.id, initialDraft]] : []),
  )
  /**
   * Notes created here that a refetch has not returned yet. A read that began
   * before the insert landed must not drop the note the user is typing in.
   */
  const createdRef = useRef(new Set<string>())
  /** Writes run one at a time, so an update never overtakes its insert. */
  const chainRef = useRef<Promise<unknown>>(Promise.resolve())

  const handlersRef = useRef(options)
  useEffect(() => {
    handlersRef.current = options
  })

  /** Apply one change to one note: the draft, a first insert, or an update. */
  const write = useCallback(
    async (id: string, changes: NoteChanges): Promise<void> => {
      const drafts = draftsRef.current
      const d = drafts.get(id)
      const show = (next: Note | null) =>
        setDraft((cur) => (cur && cur.id === id ? next : cur))
      if (d) {
        const merged: Note = { ...d, ...changes }
        if (isBlankNote(merged)) {
          drafts.set(id, merged)
          show(merged)
          return
        }
        drafts.delete(id)
        try {
          const created = await repo.notes.create({
            userId: merged.userId,
            id: merged.id,
            title: merged.title,
            body: merged.body,
            pinned: merged.pinned,
            taskId: merged.taskId,
            subcategoryId: merged.subcategoryId,
          })
          createdRef.current.add(created.id)
          report({ kind: 'upsert', note: created })
          handlersRef.current.onCreated?.(created)
          show(null)
        } catch (e) {
          drafts.set(id, merged)
          show(merged)
          throw e
        }
        return
      }
      const updated = await repo.notes.update(id, changes)
      report({ kind: 'upsert', note: updated })
      handlersRef.current.onUpdated?.(updated)
    },
    [report],
  )

  const save = useCallback(
    (id: string, changes: NoteChanges): Promise<void> => {
      const run = chainRef.current.then(() => write(id, changes))
      chainRef.current = run.catch(() => undefined)
      return run.catch((e) => {
        console.error('Note save failed', e)
        toast.error(SAVE_ERROR)
        throw e
      })
    },
    [write],
  )

  /** Open a fresh unsaved draft and return it. */
  const openDraft = useCallback((userId: string, links?: NoteLinks): Note => {
    const fresh = newDraftNote(userId, links)
    draftsRef.current.set(fresh.id, fresh)
    setDraft(fresh)
    return fresh
  }, [])

  /** Attach to a task or a list: exactly one link, and the detach memo cleared. */
  const attach = useCallback(
    (id: string, target: AttachTarget): Promise<void> =>
      save(id, {
        taskId: target.kind === 'task' ? target.id : null,
        subcategoryId: target.kind === 'subcategory' ? target.id : null,
        detachedLabel: null,
        detachedAt: null,
      }),
    [save],
  )

  const detach = useCallback(
    (id: string): Promise<void> =>
      save(id, { taskId: null, subcategoryId: null }),
    [save],
  )

  /**
   * Delete a note — or drop it, when it is still an unsaved draft. Resolves
   * `true` once the note is gone, `false` when the delete failed (toasted).
   */
  const remove = useCallback(
    async (note: Note): Promise<boolean> => {
      if (draftsRef.current.has(note.id)) {
        draftsRef.current.delete(note.id)
        setDraft((cur) => (cur && cur.id === note.id ? null : cur))
        return true
      }
      try {
        // Behind any write still queued for this note.
        await chainRef.current
        await repo.notes.delete(note.id)
        createdRef.current.delete(note.id)
        report({ kind: 'delete', id: note.id })
        handlersRef.current.onDeleted?.(note.id)
        toast.success('Note deleted.')
        return true
      } catch (e) {
        console.error('Note delete failed', e)
        toast.error(SAVE_ERROR)
        return false
      }
    },
    [report],
  )

  /**
   * Fold a fresh read into a list this writer has been adding to: notes
   * created here that the read has not returned yet are kept.
   */
  const keepCreated = useCallback((fetched: Note[]) => {
    for (const n of fetched) createdRef.current.delete(n.id)
    return (prev: Note[]): Note[] => [
      ...prev.filter((n) => createdRef.current.has(n.id)),
      ...fetched,
    ]
  }, [])

  return { draft, openDraft, save, attach, detach, remove, keepCreated }
}
