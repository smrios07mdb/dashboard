/*
 * Undo for task delete and task complete (chunk 72).
 *
 * Delete is deferred, not soft: `deleteTasksWithUndo` marks the ids pending
 * and the real `repo.tasks.bulkDelete` runs UNDO_MS later from this module's
 * own timer — never from the toast's lifecycle, so closing the toast neither
 * commits early nor cancels. Until the commit nothing is written anywhere, so
 * Undo restores the task with its planner block, calendar event, Today mark
 * and note links untouched.
 *
 * Pending ids are filtered out of every `repo.tasks` list read
 * (`withoutPendingDeletes`) and mirrored to localStorage, so a page that dies
 * inside the window still commits: `flushPendingDeletes` on `pagehide` (and,
 * awaited, before sign-out), and `resumePendingDeletes` for whatever is left
 * on the next start.
 *
 * Any sign-out (chunk 82) parks the ids still waiting (`parkPendingDeletes`
 * on `SIGNED_OUT`): their timers stop, so nothing commits with no session, and
 * they stay pending and stored until `resumePendingDeletes` commits them at
 * the next signed-in start.
 *
 * Each entry carries its task's `userId` (chunk 83). RLS turns another user's
 * delete into a silent no-op, so `resumePendingDeletes(userId)` commits only
 * that user's entries; the rest stay parked for their owner and are dropped
 * once 7 days old. Pre-83 entries carry no user and are dropped unread at
 * load (chunk 84): their owner is unknown. `flushPendingDeletes`
 * commits only ids this session has scheduled, never another user's.
 *
 * Complete is written at once by the screen; `offerCompleteUndo` only offers
 * to put the prior `completedAt` back. A move (chunk 88) works the same way:
 * `offerMoveUndo` offers to put the prior `subcategoryId` back.
 */
import { toast } from 'sonner'

import { repo } from '@/db/repo'
import type { Category, Subcategory, Task } from '@/db/types'
import { useUIStore } from '@/state/uiStore'

export const UNDO_MS = 6000

const STORAGE_KEY = 'hup:pendingTaskDeletes'
const SAVE_ERROR = 'Could not save — retry'

const PARK_MS = 7 * 86_400_000

type Entry = { at: number; uid: string }

type Batch = {
  ids: string[]
  timer: ReturnType<typeof setTimeout>
  toastId?: string | number
}

/** Every id inside its window, including ones whose commit is in flight. */
const pending = new Map<string, Entry>()
/** Batches whose timer has not fired — the only ones Undo can still cancel. */
const waiting = new Set<Batch>()
/** Ids some waiting batch owns. Leftovers seeded from storage own none. */
const scheduled = new Set<string>()
/** Ids whose `bulkDelete` has been issued and has not settled. */
const committing = new Set<string>()

function readStored(): ({ id: string } & Entry)[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (e): e is { id: string } & Entry =>
        typeof e?.id === 'string' && typeof e?.at === 'number',
    )
  } catch {
    return []
  }
}

function persist() {
  try {
    if (pending.size === 0) {
      localStorage.removeItem(STORAGE_KEY)
      return
    }
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify(Array.from(pending, ([id, e]) => ({ id, ...e }))),
    )
  } catch {
    // Storage unavailable (private mode, quota): the in-memory map still
    // drives this session; only the killed-app recovery is lost.
  }
}

// Seed at module load so list reads filter leftovers before anything else runs.
// Entries without a user (pre-83) are left out, so the next write drops them.
for (const { id, at, uid } of readStored()) if (uid) pending.set(id, { at, uid })

function drop(ids: string[]) {
  for (const id of ids) {
    pending.delete(id)
    scheduled.delete(id)
    committing.delete(id)
  }
  persist()
}

function refresh() {
  useUIStore.getState().forceDashboardRefresh()
}

async function commit(ids: string[]): Promise<void> {
  if (ids.length === 0) return
  for (const id of ids) committing.add(id)
  try {
    // `repo` handles offline itself (outbox); only a client error throws.
    await repo.tasks.bulkDelete(ids)
    drop(ids)
  } catch (e) {
    console.error('Deferred task delete failed', e)
    drop(ids)
    toast.error(SAVE_ERROR)
    refresh()
  }
}

function plural(n: number, verb: string): string {
  return n === 1 ? `Task ${verb}` : `${n} tasks ${verb}`
}

/** Hide `tasks` now; hard-delete them after UNDO_MS unless undone. */
export function deleteTasksWithUndo(opts: {
  /** The full rows, kept for restore. */
  tasks: Task[]
  /** Re-insert into the calling screen's state. */
  onRestore?: (tasks: Task[]) => void
}): void {
  // An id already pending is ignored, so a double delete commits once.
  const seen = new Set<string>()
  const tasks = opts.tasks.filter((t) => {
    if (pending.has(t.id) || seen.has(t.id)) return false
    seen.add(t.id)
    return true
  })
  if (tasks.length === 0) return

  const at = Date.now()
  const ids = tasks.map((t) => t.id)
  for (const t of tasks) {
    pending.set(t.id, { at, uid: t.userId })
    scheduled.add(t.id)
  }
  persist()

  const batch: Batch = {
    ids,
    timer: setTimeout(() => {
      waiting.delete(batch)
      // The window is over: take the toast down with it so no dead Undo lingers
      // (sonner pauses its own countdown on hover and on window blur).
      if (batch.toastId !== undefined) toast.dismiss(batch.toastId)
      void commit(ids)
    }, UNDO_MS),
  }
  waiting.add(batch)

  batch.toastId = toast(plural(ids.length, 'deleted'), {
    duration: UNDO_MS,
    action: {
      label: 'Undo',
      onClick: () => {
        if (!waiting.has(batch)) return
        clearTimeout(batch.timer)
        waiting.delete(batch)
        drop(ids)
        opts.onRestore?.(tasks)
        refresh()
      },
    },
  })
}

/** Toast "Task completed" / "N tasks completed" with Undo after a successful complete. */
export function offerCompleteUndo(opts: {
  /** The rows as they were before the complete. */
  before: Task[]
  onRestored?: (tasks: Task[]) => void
}): void {
  const { before, onRestored } = opts
  if (before.length === 0) return
  let used = false
  toast(plural(before.length, 'completed'), {
    duration: UNDO_MS,
    action: {
      label: 'Undo',
      onClick: () => {
        if (used) return
        used = true
        void (async () => {
          try {
            // One open task → the plain un-complete. Anything else restores
            // each task's own prior stamp: null for the ones that were open,
            // the old value for the ones that were already complete.
            const restored =
              before.length === 1 && before[0].completedAt === null
                ? [await repo.tasks.markComplete(before[0].id, false)]
                : await repo.tasks.bulkUpdate(
                    before.map((t) => ({
                      id: t.id,
                      patch: { completedAt: t.completedAt },
                    })),
                  )
            onRestored?.(restored)
            refresh()
          } catch (e) {
            console.error('Undo complete failed', e)
            toast.error(SAVE_ERROR)
          }
        })()
      },
    },
  })
}

/**
 * Where a move went, for its toast (chunk 88): `Category › List` when it
 * crosses categories, else just `List`.
 */
export function moveLabel(
  fromSubId: string,
  toSubId: string,
  subcategories: Subcategory[],
  categories: Category[],
): string {
  const to = subcategories.find((s) => s.id === toSubId)
  if (!to) return 'list'
  const from = subcategories.find((s) => s.id === fromSubId)
  if (from && from.categoryId === to.categoryId) return to.name
  const cat = categories.find((c) => c.id === to.categoryId)
  return cat ? `${cat.name} › ${to.name}` : to.name
}

/** Toast "Moved to …" with Undo after a successful move (chunk 88). */
export function offerMoveUndo(opts: {
  /** The task as it was before the move. */
  before: Task
  toLabel: string
  onRestored?: (task: Task) => void
}): void {
  const { before, toLabel, onRestored } = opts
  let used = false
  toast(`Moved to ${toLabel}`, {
    duration: UNDO_MS,
    action: {
      label: 'Undo',
      onClick: () => {
        if (used) return
        used = true
        void (async () => {
          try {
            // An archived previous list is still written back; the task then
            // surfaces in the Recovered card.
            const restored = await repo.tasks.update(before.id, {
              subcategoryId: before.subcategoryId,
            })
            onRestored?.(restored)
            refresh()
          } catch (e) {
            console.error('Undo move failed', e)
            toast.error(SAVE_ERROR)
          }
        })()
      },
    },
  })
}

export function isPendingDelete(id: string): boolean {
  return pending.has(id)
}

export function withoutPendingDeletes<T extends { id: string }>(rows: T[]): T[] {
  if (pending.size === 0) return rows
  return rows.filter((r) => !pending.has(r.id))
}

/** Cancel every waiting batch's timer and take its Undo toast down. */
function stopWaiting() {
  for (const batch of waiting) {
    clearTimeout(batch.timer)
    if (batch.toastId !== undefined) toast.dismiss(batch.toastId)
  }
  waiting.clear()
}

/**
 * Commit everything this session scheduled, now. Fire-and-forget on
 * `pagehide`: the ids stay pending and in storage until the write resolves, so
 * a request the unload cuts short
 * is picked up by `resumePendingDeletes` on the next start. Awaited on
 * sign-out (`signOutUser`, chunk 81), so the delete runs while RLS still
 * matches the rows.
 */
export function flushPendingDeletes(): Promise<void> {
  stopWaiting()
  // Only ids this session scheduled: another user's parked entries are not.
  return commit([...scheduled].filter((id) => !committing.has(id)))
}

/**
 * Stop every waiting batch without committing (chunk 82, on `SIGNED_OUT`).
 * The ids stay pending (hidden from list reads) and in storage, and leave
 * `scheduled`, so the next `resumePendingDeletes` commits them — at once,
 * since they are overdue. Ids whose commit is in flight are left alone.
 * Returns the number of ids parked.
 */
export function parkPendingDeletes(): number {
  stopWaiting()
  let parked = 0
  for (const id of pending.keys()) {
    if (committing.has(id)) continue
    scheduled.delete(id)
    parked++
  }
  // Rewrite storage from this tab's map, so a drop in another tab cannot
  // have erased these ids.
  persist()
  return parked
}

/**
 * Commit `userId`'s leftovers from storage (startup). No toast; Undo is not
 * offered. Another user's entries stay parked, or are dropped at 7 days.
 */
export function resumePendingDeletes(userId: string): void {
  const now = Date.now()
  const overdue: string[] = []
  for (const [id, { at, uid }] of pending) {
    // Skip ids this session already owns — they still have a live Undo.
    if (scheduled.has(id) || committing.has(id)) continue
    if (uid !== userId) {
      if (now - at > PARK_MS) pending.delete(id)
      continue
    }
    scheduled.add(id)
    const wait = Math.min(UNDO_MS, at + UNDO_MS - now)
    if (wait <= 0) {
      overdue.push(id)
      continue
    }
    const batch: Batch = {
      ids: [id],
      timer: setTimeout(() => {
        waiting.delete(batch)
        void commit([id])
      }, wait),
    }
    waiting.add(batch)
  }
  persist()
  void commit(overdue)
}
