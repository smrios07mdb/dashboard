import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'

import { repo } from '@/db/repo'
import type { Note } from '@/db/types'
import { useUIStore } from '@/state/uiStore'

import {
  NotesContext,
  type NoteChange,
  type NotesContextValue,
} from './notesContext'

/*
 * NotesProvider (chunk 59, D5) — mounted once inside ProtectedLayout.
 *
 * Holds every note: read on mount and again whenever `dashboardRefreshKey`
 * moves, exactly like the screens' own loads. `useNoteWriter` reports each
 * write that succeeded, so a row's count changes at once — offline included —
 * without waiting for a realtime echo.
 *
 * It also owns the task notes sheet. The sheet's module is lazy, so the
 * editor, the attach picker and the Markdown renderer stay out of the eager
 * bundle; this file is the only part every screen pays for.
 */

const TaskNotesSheet = lazy(() => import('./TaskNotesSheet'))

type SheetState = {
  /** Remounts the sheet for each opening, so its view starts fresh. */
  key: number
  taskId: string
  noteId: string | null
  open: boolean
}

export default function NotesProvider({ children }: { children: ReactNode }) {
  const dashboardRefreshKey = useUIStore((s) => s.dashboardRefreshKey)
  const [notes, setNotes] = useState<Note[]>([])
  const [sheet, setSheet] = useState<SheetState | null>(null)

  /** The read in flight, if any; 0 when idle. */
  const loadRef = useRef(0)
  /**
   * Writes reported while a read is in flight. That read may have started
   * before the write landed, so these win over what it returns.
   */
  const duringLoadRef = useRef(new Map<string, Note | null>())

  useEffect(() => {
    const token = (loadRef.current = Date.now() + Math.random())
    duringLoadRef.current.clear()
    repo.notes
      .listAll()
      .then((fetched) => {
        if (loadRef.current !== token) return
        const local = duringLoadRef.current
        const merged = fetched.filter((n) => !local.has(n.id))
        for (const n of local.values()) if (n) merged.push(n)
        setNotes(merged)
      })
      .catch((e) => console.error('Notes load failed', e))
      .finally(() => {
        if (loadRef.current !== token) return
        loadRef.current = 0
        duringLoadRef.current.clear()
      })
    return () => {
      if (loadRef.current === token) loadRef.current = 0
    }
  }, [dashboardRefreshKey])

  const report = useCallback((change: NoteChange) => {
    if (change.kind === 'upsert') {
      const { note } = change
      if (loadRef.current) duringLoadRef.current.set(note.id, note)
      setNotes((prev) =>
        prev.some((n) => n.id === note.id)
          ? prev.map((n) => (n.id === note.id ? note : n))
          : [note, ...prev],
      )
    } else {
      if (loadRef.current) duringLoadRef.current.set(change.id, null)
      setNotes((prev) => prev.filter((n) => n.id !== change.id))
    }
  }, [])

  const openTaskNotes = useCallback((taskId: string, noteId?: string) => {
    setSheet((prev) => ({
      key: (prev?.key ?? 0) + 1,
      taskId,
      noteId: noteId ?? null,
      open: true,
    }))
  }, [])

  const closeSheet = useCallback(() => {
    setSheet((prev) => (prev ? { ...prev, open: false } : prev))
  }, [])

  const value: NotesContextValue = useMemo(
    () => ({ notes, report, openTaskNotes }),
    [notes, report, openTaskNotes],
  )

  return (
    <NotesContext.Provider value={value}>
      {children}
      {sheet && (
        <Suspense fallback={null}>
          <TaskNotesSheet
            key={sheet.key}
            taskId={sheet.taskId}
            noteId={sheet.noteId}
            open={sheet.open}
            onClose={closeSheet}
          />
        </Suspense>
      )}
    </NotesContext.Provider>
  )
}
