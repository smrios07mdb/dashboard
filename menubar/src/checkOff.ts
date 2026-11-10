/*
 * Check off from the popover (chunk 92).
 *
 * The write is the app's own: `repo.tasks.markComplete`, which goes through
 * the existing outbox when offline. Undo is the Dashboard's own
 * `offerCompleteUndo` (lib/taskUndo), handed the task as it was before the
 * write; unchecking offers none — the Dashboard rule.
 *
 * While a write is in flight the row shows its new state (`optimistic`).
 * A task completed here stays in the list, struck, for as long as the
 * popover runs (`kept`) — the Dashboard keeps a session completion until its
 * next load the same way. No DOM, no React: the popover subscribes.
 */
import type { Task } from '@/db/types'

export type CheckOffState = {
  /** id → the done state shown while its write is in flight. */
  optimistic: ReadonlyMap<string, boolean>
  /** The last write failed. */
  failed: boolean
  /** Completed in this popover session — kept in Today until restart. */
  kept: ReadonlySet<string>
}

export type CheckOff = {
  getState: () => CheckOffState
  subscribe: (fn: () => void) => () => void
  toggle: (task: Task) => Promise<void>
  dispose: () => void
}

export function createCheckOff(deps: {
  write: (id: string, completed: boolean) => Promise<unknown>
  /** Reload the list after a write; resolves when the new list is shown. */
  refresh: () => Promise<void>
  /** A check-off landed; `before` is the task as it was (for Undo). */
  onCompleted: (before: Task) => void
}): CheckOff {
  let state: CheckOffState = {
    optimistic: new Map(),
    failed: false,
    kept: new Set(),
  }
  const listeners = new Set<() => void>()
  let disposed = false

  function set(patch: Partial<CheckOffState>) {
    if (disposed) return
    state = { ...state, ...patch }
    listeners.forEach((fn) => fn())
  }

  function withOptimistic(id: string, done: boolean | null) {
    const next = new Map(state.optimistic)
    if (done === null) next.delete(id)
    else next.set(id, done)
    return next
  }

  return {
    getState: () => state,
    subscribe(fn) {
      listeners.add(fn)
      return () => {
        listeners.delete(fn)
      }
    },
    async toggle(task) {
      const { id } = task
      if (state.optimistic.has(id)) return
      const completed = !task.completedAt
      set({ optimistic: withOptimistic(id, completed), failed: false })
      try {
        await deps.write(id, completed)
      } catch (e) {
        console.error('menubar: check off failed', e)
        set({ optimistic: withOptimistic(id, null), failed: true })
        return
      }
      if (completed) {
        const kept = new Set(state.kept)
        kept.add(id)
        set({ kept })
        deps.onCompleted(task)
      }
      try {
        await deps.refresh()
      } finally {
        set({ optimistic: withOptimistic(id, null) })
      }
    },
    dispose() {
      disposed = true
      listeners.clear()
    },
  }
}
