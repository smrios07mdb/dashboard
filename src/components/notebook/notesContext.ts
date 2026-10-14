import { createContext, useContext, useMemo } from 'react'

import type { Note } from '@/db/types'
import { notesForList, notesForTask } from '@/lib/notes'

/*
 * The notes every screen can see (chunk 59, D5). `NotesProvider` holds the
 * list and owns the task sheet; this module is the context and the hooks that
 * read it, kept apart from the provider so the component file exports only a
 * component.
 *
 * The default value is an empty, inert notebook: a row rendered outside the
 * provider (a unit test, a storybook-style page) simply shows no notes.
 */

export type NoteChange =
  | { kind: 'upsert'; note: Note }
  | { kind: 'delete'; id: string }

export type NotesContextValue = {
  notes: Note[]
  /** A write that already succeeded — applied here without a refetch. */
  report: (change: NoteChange) => void
  /** Open the task's notes sheet, optionally straight at one note. */
  openTaskNotes: (taskId: string, noteId?: string) => void
}

const INERT: NotesContextValue = {
  notes: [],
  report: () => undefined,
  openTaskNotes: () => undefined,
}

export const NotesContext = createContext<NotesContextValue>(INERT)

export function useNotes(): NotesContextValue {
  return useContext(NotesContext)
}

/** That task's notes, newest first. */
export function useTaskNotes(taskId: string | null): Note[] {
  const { notes } = useContext(NotesContext)
  return useMemo(() => notesForTask(notes, taskId), [notes, taskId])
}

/** Notes on the list and on those tasks, newest first. */
export function useListNotes(
  subcategoryId: string,
  taskIds: readonly string[],
): Note[] {
  const { notes } = useContext(NotesContext)
  return notesForList(notes, subcategoryId, taskIds)
}

export function useOpenTaskNotes(): NotesContextValue['openTaskNotes'] {
  return useContext(NotesContext).openTaskNotes
}
