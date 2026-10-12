/* Shared fixtures for the Notebook tests (chunk 58). Not imported by app code. */
import type { Category, Note, Subcategory, Task } from '@/db/types'
import type { NoteContext } from '@/lib/notes'

export const CATEGORIES: Category[] = [
  { id: 'c-work', userId: 'u1', name: 'Work' },
  { id: 'c-personal', userId: 'u1', name: 'Personal' },
]

export const SUBCATEGORIES: Subcategory[] = [
  { id: 's-atlas', userId: 'u1', categoryId: 'c-work', name: 'Atlas launch', sortOrder: 0, archivedAt: null },
  { id: 's-archived', userId: 'u1', categoryId: 'c-work', name: 'Old initiative', sortOrder: 1, archivedAt: '2026-09-01T00:00:00.000Z' },
  { id: 's-home', userId: 'u1', categoryId: 'c-personal', name: 'Home', sortOrder: 0, archivedAt: null },
]

export function mkTask(over: Partial<Task> & { id: string }): Task {
  return {
    userId: 'u1',
    subcategoryId: 's-atlas',
    title: over.id,
    notes: null,
    estimateMinutes: 30,
    dueAt: null,
    remindAt: null,
    notified: false,
    priority: null,
    completedAt: null,
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
    ...over,
  }
}

export const TASKS: Task[] = [
  mkTask({ id: 't-open', title: 'Ship the pricing page' }),
  mkTask({
    id: 't-done',
    title: 'Draft the announcement',
    completedAt: '2026-10-01T00:00:00.000Z',
    createdAt: '2026-08-01T00:00:00.000Z',
  }),
  mkTask({ id: 't-archived', title: 'Legacy cleanup', subcategoryId: 's-archived' }),
]

export function mkNote(over: Partial<Note> & { id: string }): Note {
  return {
    userId: 'u1',
    title: over.id,
    body: '',
    pinned: false,
    taskId: null,
    subcategoryId: null,
    detachedLabel: null,
    detachedAt: null,
    createdAt: '2026-09-20T12:00:00.000Z',
    updatedAt: '2026-10-01T12:00:00.000Z',
    ...over,
  }
}

/** One of every kind the list distinguishes. Newest-updated: n-done. */
export const NOTES: Note[] = [
  mkNote({ id: 'n-pin-old', title: 'Pinned old', pinned: true, updatedAt: '2026-10-01T12:00:00.000Z' }),
  mkNote({ id: 'n-pin-new', title: 'Pinned new', body: 'Meditations, book 4', pinned: true, updatedAt: '2026-10-05T12:00:00.000Z' }),
  mkNote({ id: 'n-untitled', title: '', body: '# First line here\nsecond line\n- third', updatedAt: '2026-10-06T12:00:00.000Z' }),
  mkNote({ id: 'n-list', title: 'On list', body: 'Remember the zebra crossing by the office', subcategoryId: 's-atlas', updatedAt: '2026-10-03T12:00:00.000Z' }),
  mkNote({ id: 'n-task', title: 'On open task', body: 'Open questions', taskId: 't-open', updatedAt: '2026-10-07T12:00:00.000Z' }),
  mkNote({ id: 'n-done', title: 'On done task', body: 'What went well', taskId: 't-done', updatedAt: '2026-10-08T12:00:00.000Z' }),
  mkNote({ id: 'n-detached', title: 'Was attached', body: 'Kept after the delete', detachedLabel: 'Q3 planning', detachedAt: '2026-10-09T12:00:00.000Z', updatedAt: '2026-10-02T12:00:00.000Z' }),
]

export const CTX: NoteContext = {
  categories: CATEGORIES,
  subcategories: SUBCATEGORIES,
  tasks: TASKS,
}
