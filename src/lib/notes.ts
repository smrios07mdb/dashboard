/*
 * Pure helpers for the Notebook (chunk 58): list text, ordering, search,
 * attachment resolution and the editor's save-state derivation. No React, no
 * repo — everything here is a function of its arguments.
 */
import { format } from 'date-fns'

import type { Category, Note, Subcategory, SyncState, Task } from '@/db/types'

/** `/notebook/:noteId` — the route whose phone layout hides the bottom nav. */
export function isNoteEditorPath(pathname: string): boolean {
  return /^\/notebook\/[^/]+\/?$/.test(pathname)
}

// ---------- list text ----------

/** Markdown source → the plain text a list row shows. */
export function stripNoteMarkdown(md: string): string {
  return md
    .replace(/^#+\s*/gm, '')
    .replace(/^-\s+/gm, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
}

function plainLines(body: string): string[] {
  return stripNoteMarkdown(body)
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
}

/** The row's headline: the title, else the body's first line, else "Untitled". */
export function noteFirstLine(note: Pick<Note, 'title' | 'body'>): string {
  return note.title || plainLines(note.body)[0] || 'Untitled'
}

/** Body lines joined with " · " — minus the first when it is the headline. */
export function noteExcerpt(note: Pick<Note, 'title' | 'body'>): string {
  const lines = plainLines(note.body)
  if (!note.title) lines.shift()
  return lines.join(' · ')
}

/** The body line holding the first match, trimmed to ~40 characters before it. */
export function noteMatchLine(
  note: Pick<Note, 'body'>,
  query: string,
): string | null {
  const q = query.toLowerCase()
  const hit = plainLines(note.body).find((l) => l.toLowerCase().includes(q))
  if (!hit) return null
  const start = Math.max(0, hit.toLowerCase().indexOf(q) - 40)
  return (start > 0 ? '…' : '') + hit.slice(start)
}

/** Case-insensitive match over title + body. An empty query matches all. */
export function noteMatches(
  note: Pick<Note, 'title' | 'body'>,
  query: string,
): boolean {
  if (!query) return true
  return `${note.title}\n${note.body}`
    .toLowerCase()
    .includes(query.toLowerCase())
}

/** `text` split around the first match of `query`, for a `<mark>`. */
export function splitOnMatch(
  text: string,
  query: string,
): { before: string; match: string; after: string } | null {
  if (!query) return null
  const i = text.toLowerCase().indexOf(query.toLowerCase())
  if (i < 0) return null
  return {
    before: text.slice(0, i),
    match: text.slice(i, i + query.length),
    after: text.slice(i + query.length),
  }
}

// ---------- time ----------

/** `now` / `42m` / `3h` / `Yesterday` / `Oct 3`. */
export function noteRel(iso: string, now: Date = new Date()): string {
  const minutes = (now.getTime() - new Date(iso).getTime()) / 60000
  if (minutes < 1) return 'now'
  if (minutes < 60) return `${Math.round(minutes)}m`
  if (minutes < 60 * 24) return `${Math.round(minutes / 60)}h`
  if (minutes < 60 * 48) return 'Yesterday'
  return noteDate(iso)
}

export function noteDate(iso: string): string {
  return format(new Date(iso), 'MMM d')
}

/** The footer's "updated" phrase: `just now` / `42m ago` / `Yesterday` / `Oct 3`. */
export function noteRelLong(iso: string, now: Date = new Date()): string {
  const rel = noteRel(iso, now)
  if (rel === 'now') return 'just now'
  return /^\d/.test(rel) ? `${rel} ago` : rel
}

// ---------- ordering & filtering ----------

export type NoteFilter = 'all' | 'freeform' | 'attached'

export function isAttached(note: Pick<Note, 'taskId' | 'subcategoryId'>) {
  return note.taskId !== null || note.subcategoryId !== null
}

/** Newest `updatedAt` first. */
export function byUpdatedDesc(a: Note, b: Note): number {
  return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
}

export function filterNotes(
  notes: Note[],
  filter: NoteFilter,
  query: string,
): Note[] {
  return notes
    .filter((n) =>
      filter === 'all'
        ? true
        : filter === 'freeform'
          ? !isAttached(n)
          : isAttached(n),
    )
    .filter((n) => noteMatches(n, query))
}

// ---------- attachment ----------

export type NoteAttachment =
  | {
      kind: 'task'
      name: string
      categoryName: string
      subcategory: Subcategory
      task: Task
    }
  | {
      kind: 'subcategory'
      name: string
      categoryName: string
      subcategory: Subcategory
    }
  /** Both links null, with the server's memo of what the note sat beside. */
  | { kind: 'detached'; name: string }

export type NoteContext = {
  categories: Category[]
  subcategories: Subcategory[]
  tasks: Task[]
}

/**
 * What a note is attached to, resolved against the loaded lists. `null` for a
 * freeform note with no memo, and for a link whose target is not loaded.
 * Archived subcategories resolve like any other.
 */
export function resolveAttachment(
  note: Pick<Note, 'taskId' | 'subcategoryId' | 'detachedLabel'>,
  ctx: NoteContext,
): NoteAttachment | null {
  const subOf = (id: string) => ctx.subcategories.find((s) => s.id === id)
  const catName = (sub: Subcategory) =>
    ctx.categories.find((c) => c.id === sub.categoryId)?.name ?? 'Work'
  if (note.taskId) {
    const task = ctx.tasks.find((t) => t.id === note.taskId)
    const subcategory = task && subOf(task.subcategoryId)
    if (!task || !subcategory) return null
    return {
      kind: 'task',
      name: task.title,
      categoryName: catName(subcategory),
      subcategory,
      task,
    }
  }
  if (note.subcategoryId) {
    const subcategory = subOf(note.subcategoryId)
    if (!subcategory) return null
    return {
      kind: 'subcategory',
      name: subcategory.name,
      categoryName: catName(subcategory),
      subcategory,
    }
  }
  if (note.detachedLabel) return { kind: 'detached', name: note.detachedLabel }
  return null
}

/** A note on a task that is completed — hidden from the list by default. */
export function isOnCompletedTask(
  note: Pick<Note, 'taskId'>,
  tasks: Task[],
): boolean {
  if (!note.taskId) return false
  return Boolean(tasks.find((t) => t.id === note.taskId)?.completedAt)
}

// ---------- save state ----------

export type NoteSaveState = {
  /** Which `SyncBadge` dot to borrow. */
  dot: 'synced' | 'syncing' | 'offline'
  label: string
}

/**
 * The editor's save-state line. `queued` is the outbox rows for this note;
 * `pending` is a local edit not yet handed to the repo (debounce running, or
 * a write in flight).
 */
export function noteSaveState(args: {
  sync: SyncState
  queued: number
  pending: boolean
}): NoteSaveState {
  if (args.sync === 'offline') {
    const n = args.queued + (args.pending ? 1 : 0)
    return {
      dot: 'offline',
      label:
        n === 0
          ? 'Offline · saved on this device'
          : `Offline · ${n} ${n === 1 ? 'change' : 'changes'} queued`,
    }
  }
  if (args.pending || args.queued > 0) return { dot: 'syncing', label: 'Syncing' }
  return { dot: 'synced', label: 'Saved' }
}
