import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/*
 * Chunk 72: the undo window. The module keeps its pending set at module level
 * and seeds it from localStorage on load, so every test imports a fresh copy
 * (`vi.resetModules` + dynamic import). `repo`, `sonner` and the UI store are
 * mocked; timers are fake.
 */

const { bulkDelete, markComplete, bulkUpdate, toast, forceDashboardRefresh } =
  vi.hoisted(() => {
    const toast = Object.assign(
      vi.fn<(...args: unknown[]) => string>(() => 'toast-id'),
      { error: vi.fn(), dismiss: vi.fn() },
    )
    return {
      bulkDelete: vi.fn(),
      markComplete: vi.fn(),
      bulkUpdate: vi.fn(),
      toast,
      forceDashboardRefresh: vi.fn(),
    }
  })

vi.mock('@/db/repo', () => ({
  repo: { tasks: { bulkDelete, markComplete, bulkUpdate } },
}))
vi.mock('sonner', () => ({ toast }))
vi.mock('@/state/uiStore', () => ({
  useUIStore: { getState: () => ({ forceDashboardRefresh }) },
}))

import type { Task } from '@/db/types'

const KEY = 'hup:pendingTaskDeletes'
const NOW = new Date('2026-10-13T16:00:00.000Z')

function mkTask(id: string, completedAt: string | null = null): Task {
  return {
    id,
    userId: 'u1',
    subcategoryId: 's1',
    title: id,
    estimateMinutes: 30,
    dueAt: null,
    remindAt: null,
    notified: false,
    priority: null,
    completedAt,
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
  }
}

async function load() {
  vi.resetModules()
  return import('./taskUndo')
}

type ToastOpts = {
  duration: number
  action: { label: string; onClick: () => void }
  onDismiss?: () => void
  onAutoClose?: () => void
}
const toastOpts = (call = 0) => toast.mock.calls[call][1] as ToastOpts
const stored = () => localStorage.getItem(KEY)
const UNDO_PAST = 7000

beforeEach(() => {
  localStorage.clear()
  vi.useFakeTimers()
  vi.setSystemTime(NOW)
  bulkDelete.mockReset().mockResolvedValue(undefined)
  markComplete.mockReset()
  bulkUpdate.mockReset()
  toast.mockClear()
  toast.error.mockClear()
  toast.dismiss.mockClear()
  forceDashboardRefresh.mockClear()
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('taskUndo — deferred delete (chunk 72)', () => {
  it('(1) hides at once and hard-deletes at exactly 6 s', async () => {
    const m = await load()
    expect(m.UNDO_MS).toBe(6000)
    m.deleteTasksWithUndo({ tasks: [mkTask('a')] })

    expect(m.isPendingDelete('a')).toBe(true)
    expect(JSON.parse(stored()!)).toEqual([{ id: 'a', at: NOW.getTime(), uid: 'u1' }])
    expect(toast).toHaveBeenCalledTimes(1)
    expect(toast.mock.calls[0][0]).toBe('Task deleted')
    expect(toastOpts().duration).toBe(6000)
    expect(toastOpts().action.label).toBe('Undo')

    await vi.advanceTimersByTimeAsync(5999)
    expect(bulkDelete).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(1)
    expect(bulkDelete).toHaveBeenCalledTimes(1)
    expect(bulkDelete).toHaveBeenCalledWith(['a'])
    expect(m.isPendingDelete('a')).toBe(false)
    expect(stored()).toBeNull()
    expect(toast.error).not.toHaveBeenCalled()
  })

  it('(2) Undo at 3 s restores and never deletes', async () => {
    const m = await load()
    const onRestore = vi.fn()
    const task = mkTask('a')
    m.deleteTasksWithUndo({ tasks: [task], onRestore })

    await vi.advanceTimersByTimeAsync(3000)
    toastOpts().action.onClick()

    expect(onRestore).toHaveBeenCalledTimes(1)
    expect(onRestore).toHaveBeenCalledWith([task])
    expect(forceDashboardRefresh).toHaveBeenCalledTimes(1)
    expect(m.isPendingDelete('a')).toBe(false)
    expect(stored()).toBeNull()

    await vi.advanceTimersByTimeAsync(7000)
    expect(bulkDelete).not.toHaveBeenCalled()
  })

  it('(3) the same id deleted twice inside the window commits once', async () => {
    const m = await load()
    m.deleteTasksWithUndo({ tasks: [mkTask('a')] })
    await vi.advanceTimersByTimeAsync(1000)
    m.deleteTasksWithUndo({ tasks: [mkTask('a')] })

    await vi.advanceTimersByTimeAsync(10000)
    expect(bulkDelete).toHaveBeenCalledTimes(1)
    expect(bulkDelete).toHaveBeenCalledWith(['a'])
    expect(toast).toHaveBeenCalledTimes(1)
  })

  it('(4) two tasks in one call: one delete, one "2 tasks deleted" toast', async () => {
    const m = await load()
    m.deleteTasksWithUndo({ tasks: [mkTask('a'), mkTask('b')] })

    expect(toast).toHaveBeenCalledTimes(1)
    expect(toast.mock.calls[0][0]).toBe('2 tasks deleted')

    await vi.advanceTimersByTimeAsync(6000)
    expect(bulkDelete).toHaveBeenCalledTimes(1)
    expect(bulkDelete).toHaveBeenCalledWith(['a', 'b'])
  })

  it('(5) a client error clears pending, toasts and refreshes', async () => {
    bulkDelete.mockRejectedValue(Object.assign(new Error('nope'), { status: 400 }))
    const m = await load()
    m.deleteTasksWithUndo({ tasks: [mkTask('a')] })

    await vi.advanceTimersByTimeAsync(6000)
    expect(bulkDelete).toHaveBeenCalledTimes(1)
    expect(m.isPendingDelete('a')).toBe(false)
    expect(stored()).toBeNull()
    expect(toast.error).toHaveBeenCalledTimes(1)
    expect(forceDashboardRefresh).toHaveBeenCalledTimes(1)
  })

  it('(6) closing the toast neither commits nor cancels', async () => {
    const m = await load()
    m.deleteTasksWithUndo({ tasks: [mkTask('a')] })

    // The commit is on the module's own timer: the toast carries no close
    // hooks, and firing sonner's anyway changes nothing.
    await vi.advanceTimersByTimeAsync(2000)
    const opts = toastOpts()
    opts.onDismiss?.()
    opts.onAutoClose?.()
    expect(opts.onDismiss).toBeUndefined()
    expect(opts.onAutoClose).toBeUndefined()
    expect(bulkDelete).not.toHaveBeenCalled()
    expect(m.isPendingDelete('a')).toBe(true)

    await vi.advanceTimersByTimeAsync(3999)
    expect(bulkDelete).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(bulkDelete).toHaveBeenCalledTimes(1)
    expect(bulkDelete).toHaveBeenCalledWith(['a'])
  })

  it('(7) flushPendingDeletes commits now; storage clears when it resolves', async () => {
    let resolve!: () => void
    bulkDelete.mockReturnValue(new Promise<void>((r) => (resolve = r)))
    const m = await load()
    m.deleteTasksWithUndo({ tasks: [mkTask('a')] })

    await vi.advanceTimersByTimeAsync(2000)
    m.flushPendingDeletes()
    expect(bulkDelete).toHaveBeenCalledTimes(1)
    expect(bulkDelete).toHaveBeenCalledWith(['a'])
    // In flight: still pending, still stored, and a second flush is a no-op.
    expect(m.isPendingDelete('a')).toBe(true)
    expect(stored()).not.toBeNull()
    m.flushPendingDeletes()
    expect(bulkDelete).toHaveBeenCalledTimes(1)

    resolve()
    await vi.advanceTimersByTimeAsync(0)
    expect(m.isPendingDelete('a')).toBe(false)
    expect(stored()).toBeNull()

    await vi.advanceTimersByTimeAsync(10000)
    expect(bulkDelete).toHaveBeenCalledTimes(1)
  })

  // Chunk 81: sign-out awaits the flush, so it must settle with the delete.
  it('(12) flushPendingDeletes resolves only after the delete settles', async () => {
    let resolve!: () => void
    bulkDelete.mockReturnValue(new Promise<void>((r) => (resolve = r)))
    const m = await load()
    m.deleteTasksWithUndo({ tasks: [mkTask('a')] })

    const flushed = m.flushPendingDeletes()
    expect(flushed).toBeInstanceOf(Promise)
    let settled = false
    void flushed.then(() => (settled = true))
    await vi.advanceTimersByTimeAsync(0)
    expect(settled).toBe(false)
    expect(stored()).not.toBeNull()

    resolve()
    await vi.advanceTimersByTimeAsync(0)
    expect(settled).toBe(true)
    expect(stored()).toBeNull()
  })

  it('(8) leftovers in storage are pending at load and committed on resume', async () => {
    const now = NOW.getTime()
    localStorage.setItem(
      KEY,
      JSON.stringify([
        { id: 'a', at: now - 10_000, uid: 'u1' },
        { id: 'b', at: now - 2_000, uid: 'u1' },
      ]),
    )
    const m = await load()
    expect(m.isPendingDelete('a')).toBe(true)
    expect(m.isPendingDelete('b')).toBe(true)
    expect(bulkDelete).not.toHaveBeenCalled()

    m.resumePendingDeletes('u1')
    expect(bulkDelete).toHaveBeenCalledTimes(1)
    expect(bulkDelete).toHaveBeenLastCalledWith(['a'])

    await vi.advanceTimersByTimeAsync(3999)
    expect(bulkDelete).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(bulkDelete).toHaveBeenCalledTimes(2)
    expect(bulkDelete).toHaveBeenLastCalledWith(['b'])

    // No Undo for leftovers, and a second resume schedules nothing new.
    expect(toast).not.toHaveBeenCalled()
    m.resumePendingDeletes('u1')
    await vi.advanceTimersByTimeAsync(10000)
    expect(bulkDelete).toHaveBeenCalledTimes(2)
    expect(stored()).toBeNull()
  })

  it('(9) withoutPendingDeletes drops exactly the pending ids', async () => {
    const m = await load()
    const rows = [mkTask('a'), mkTask('b'), mkTask('c')]
    expect(m.withoutPendingDeletes(rows)).toEqual(rows)

    m.deleteTasksWithUndo({ tasks: [rows[1]] })
    expect(m.withoutPendingDeletes(rows).map((t) => t.id)).toEqual(['a', 'c'])
  })
})

// Chunk 82: any SIGNED_OUT parks the window instead of letting the timer
// commit with no session; the next signed-in start commits the parked ids.
describe('taskUndo — park on sign-out (chunk 82)', () => {
  it('(13) parkPendingDeletes cancels the window without committing', async () => {
    const m = await load()
    m.deleteTasksWithUndo({ tasks: [mkTask('a')] })
    await vi.advanceTimersByTimeAsync(2000)

    expect(m.parkPendingDeletes()).toBe(1)
    await vi.advanceTimersByTimeAsync(10000)

    expect(bulkDelete).not.toHaveBeenCalled()
    expect(m.isPendingDelete('a')).toBe(true)
    expect(JSON.parse(stored()!)).toEqual([{ id: 'a', at: NOW.getTime(), uid: 'u1' }])
  })

  it('(14) parked ids commit on the next resume', async () => {
    const m = await load()
    m.deleteTasksWithUndo({ tasks: [mkTask('a')] })
    m.parkPendingDeletes()
    await vi.advanceTimersByTimeAsync(UNDO_PAST)

    m.resumePendingDeletes('u1')
    expect(bulkDelete).toHaveBeenCalledTimes(1)
    expect(bulkDelete).toHaveBeenCalledWith(['a'])
    await vi.advanceTimersByTimeAsync(0)
    expect(stored()).toBeNull()
  })

  it('(15) park leaves an in-flight commit alone', async () => {
    let resolve!: () => void
    bulkDelete.mockReturnValue(new Promise<void>((r) => (resolve = r)))
    const m = await load()
    m.deleteTasksWithUndo({ tasks: [mkTask('a')] })

    void m.flushPendingDeletes()
    expect(m.parkPendingDeletes()).toBe(0)
    m.resumePendingDeletes('u1')
    await vi.advanceTimersByTimeAsync(10000)
    expect(bulkDelete).toHaveBeenCalledTimes(1)

    resolve()
    await vi.advanceTimersByTimeAsync(0)
    expect(stored()).toBeNull()
  })

  it('(16) park takes the Undo toast down', async () => {
    const m = await load()
    m.deleteTasksWithUndo({ tasks: [mkTask('a')] })
    m.parkPendingDeletes()
    expect(toast.dismiss).toHaveBeenCalledWith('toast-id')
  })
})

describe('taskUndo — complete (chunk 72)', () => {
  it('(10) one open task: Undo un-completes it and hands back the row', async () => {
    const reopened = mkTask('a')
    markComplete.mockResolvedValue(reopened)
    const m = await load()
    const onRestored = vi.fn()
    m.offerCompleteUndo({ before: [mkTask('a')], onRestored })

    expect(toast).toHaveBeenCalledTimes(1)
    expect(toast.mock.calls[0][0]).toBe('Task completed')
    expect(toastOpts().duration).toBe(6000)
    expect(toastOpts().action.label).toBe('Undo')
    expect(markComplete).not.toHaveBeenCalled()

    toastOpts().action.onClick()
    await vi.advanceTimersByTimeAsync(0)
    expect(markComplete).toHaveBeenCalledTimes(1)
    expect(markComplete).toHaveBeenCalledWith('a', false)
    expect(bulkUpdate).not.toHaveBeenCalled()
    expect(onRestored).toHaveBeenCalledWith([reopened])
  })

  it('(11) two tasks, one already complete: Undo restores each prior stamp', async () => {
    const X = '2026-10-01T09:00:00.000Z'
    const before = [mkTask('a'), mkTask('b', X)]
    bulkUpdate.mockResolvedValue(before)
    const m = await load()
    const onRestored = vi.fn()
    m.offerCompleteUndo({ before, onRestored })

    expect(toast.mock.calls[0][0]).toBe('2 tasks completed')

    toastOpts().action.onClick()
    await vi.advanceTimersByTimeAsync(0)
    expect(markComplete).not.toHaveBeenCalled()
    expect(bulkUpdate).toHaveBeenCalledTimes(1)
    expect(bulkUpdate).toHaveBeenCalledWith([
      { id: 'a', patch: { completedAt: null } },
      { id: 'b', patch: { completedAt: X } },
    ])
    expect(onRestored).toHaveBeenCalledWith(before)
  })

  it('a failed Undo write toasts the save error and restores nothing', async () => {
    markComplete.mockRejectedValue(new Error('nope'))
    const m = await load()
    const onRestored = vi.fn()
    m.offerCompleteUndo({ before: [mkTask('a')], onRestored })

    toastOpts().action.onClick()
    await vi.advanceTimersByTimeAsync(0)
    expect(toast.error).toHaveBeenCalledTimes(1)
    expect(onRestored).not.toHaveBeenCalled()
  })
})

// Chunk 83: a parked delete belongs to the user who made it. Another user's
// sign-in neither commits it (RLS would match nothing and the delete would be
// lost) nor clears it; it is dropped once it is 7 days old.
describe('taskUndo — parked deletes are per user (chunk 83)', () => {
  const DAY = 86_400_000

  // Not a regression guard from base: base commits for whoever signs in.
  it('(17) the same user commits a parked delete at the next sign-in', async () => {
    const m = await load()
    m.deleteTasksWithUndo({ tasks: [mkTask('a')] })
    m.parkPendingDeletes()
    await vi.advanceTimersByTimeAsync(UNDO_PAST)

    m.resumePendingDeletes('u1')
    expect(bulkDelete).toHaveBeenCalledTimes(1)
    expect(bulkDelete).toHaveBeenCalledWith(['a'])
    await vi.advanceTimersByTimeAsync(0)
    expect(stored()).toBeNull()
  })

  it('(18) another user neither commits nor clears it', async () => {
    const m = await load()
    m.deleteTasksWithUndo({ tasks: [mkTask('a')] })
    m.parkPendingDeletes()
    await vi.advanceTimersByTimeAsync(UNDO_PAST)

    m.resumePendingDeletes('u2')
    await vi.advanceTimersByTimeAsync(10000)
    expect(bulkDelete).not.toHaveBeenCalled()
    expect(m.isPendingDelete('a')).toBe(true)
    expect(JSON.parse(stored()!).map((e: { id: string }) => e.id)).toEqual(['a'])

    // Their own delete still commits, and the parked entry survives it.
    m.deleteTasksWithUndo({ tasks: [{ ...mkTask('b'), userId: 'u2' }] })
    await vi.advanceTimersByTimeAsync(UNDO_PAST)
    expect(bulkDelete).toHaveBeenCalledTimes(1)
    expect(bulkDelete).toHaveBeenCalledWith(['b'])
    expect(JSON.parse(stored()!).map((e: { id: string }) => e.id)).toEqual(['a'])

    // A page hide under the other user does not commit it either.
    await m.flushPendingDeletes()
    expect(bulkDelete).toHaveBeenCalledTimes(1)

    // Back as the owner: it commits.
    m.resumePendingDeletes('u1')
    expect(bulkDelete).toHaveBeenCalledTimes(2)
    expect(bulkDelete).toHaveBeenLastCalledWith(['a'])
  })

  it('(19) another user\'s entries are dropped after 7 days', async () => {
    const now = NOW.getTime()
    localStorage.setItem(
      KEY,
      JSON.stringify([
        { id: 'old', at: now - 7 * DAY - 1, uid: 'u1' },
        { id: 'young', at: now - 6 * DAY, uid: 'u1' },
      ]),
    )
    const m = await load()
    m.resumePendingDeletes('u2')
    await vi.advanceTimersByTimeAsync(10000)

    expect(bulkDelete).not.toHaveBeenCalled()
    expect(m.isPendingDelete('old')).toBe(false)
    expect(m.isPendingDelete('young')).toBe(true)
    expect(JSON.parse(stored()!)).toEqual([
      { id: 'young', at: now - 6 * DAY, uid: 'u1' },
    ])
  })
  it('(20) pre-83 entries with no user are dropped at load, never committed (chunk 84)', async () => {
    const now = NOW.getTime()
    localStorage.setItem(
      KEY,
      JSON.stringify([
        { id: 'legacy', at: now - 10_000 },
        { id: 'mine', at: now - 10_000, uid: 'u1' },
      ]),
    )
    const m = await load()
    expect(m.isPendingDelete('legacy')).toBe(false)

    m.resumePendingDeletes('u1')
    await vi.advanceTimersByTimeAsync(10000)
    expect(bulkDelete).toHaveBeenCalledTimes(1)
    expect(bulkDelete).toHaveBeenCalledWith(['mine'])
    expect(stored()).toBeNull()
  })
})

