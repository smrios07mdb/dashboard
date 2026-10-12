import { beforeEach, describe, expect, it, vi } from 'vitest'

/*
 * Chunk 58 — sample data seeds four notes, and "Wipe my data" deletes notes
 * before tasks so migration 16's detach-memo trigger has nothing to stamp.
 */

const { calls, repoMock } = vi.hoisted(() => {
  const calls: string[] = []
  let seq = 0
  const id = (p: string) => `${p}-${(seq += 1)}`
  const tasks: { id: string; completedAt: string | null }[] = []
  const notes: Record<string, unknown>[] = []
  const repoMock = {
    categories: {
      list: async () => [
        { id: 'c-work', userId: 'u1', name: 'Work' },
        { id: 'c-personal', userId: 'u1', name: 'Personal' },
      ],
    },
    subcategories: {
      list: async () => [] as { id: string; archivedAt: string | null }[],
      create: async (input: { name: string }) => ({
        id: id('sub'),
        name: input.name,
      }),
      archive: async () => undefined,
    },
    tasks: {
      list: async () => tasks,
      create: async (input: { completedAt: string | null }) => {
        const t = { id: id('task'), completedAt: input.completedAt }
        tasks.push(t)
        return t
      },
      delete: async (taskId: string) => {
        calls.push(`tasks.delete:${taskId}`)
      },
    },
    notes: {
      listAll: async () => notes,
      create: async (input: Record<string, unknown>) => {
        const n = { id: id('note'), ...input }
        notes.push(n)
        return n
      },
      delete: async (noteId: string) => {
        calls.push(`notes.delete:${noteId}`)
      },
    },
    routineItems: {
      list: async () => [],
      create: async () => ({ id: id('item'), createdAt: 'x' }),
      archive: async () => undefined,
    },
    routineLogs: { toggle: async () => undefined },
    pushSubscriptions: {
      listMine: async () => [],
      removeByEndpoint: async () => undefined,
    },
    settings: { update: async () => undefined },
    _tasks: tasks,
    _notes: notes,
  }
  return { calls, repoMock }
})

vi.mock('@/db/repo', () => ({ repo: repoMock }))
vi.mock('@/db/dexie', () => ({
  db: { outbox: { clear: () => Promise.resolve() } },
}))
vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}))

import { loadSampleData, wipeMyData } from './sample-data'

beforeEach(() => {
  calls.length = 0
  repoMock._tasks.length = 0
  repoMock._notes.length = 0
})

describe('sample data — notes (chunk 58)', () => {
  it('seeds a pinned freeform note, one on a list, one on an open task, one on a completed task', async () => {
    await loadSampleData('u1')

    const notes = repoMock._notes
    expect(notes).toHaveLength(4)
    const doneIds = new Set(
      repoMock._tasks.filter((t) => t.completedAt).map((t) => t.id),
    )
    const openIds = new Set(
      repoMock._tasks.filter((t) => !t.completedAt).map((t) => t.id),
    )

    const freeform = notes.filter((n) => !n.taskId && !n.subcategoryId)
    expect(freeform).toHaveLength(1)
    expect(freeform[0].pinned).toBe(true)
    expect(notes.filter((n) => n.subcategoryId)).toHaveLength(1)
    expect(notes.filter((n) => openIds.has(n.taskId as string))).toHaveLength(1)
    expect(notes.filter((n) => doneIds.has(n.taskId as string))).toHaveLength(1)
    // Never both links on one note.
    expect(notes.some((n) => n.taskId && n.subcategoryId)).toBe(false)
    // The optional title is exercised: one seeded note has none.
    expect(notes.some((n) => n.title === '')).toBe(true)
  })

  it('wipe deletes every note before the first task', async () => {
    await loadSampleData('u1')
    calls.length = 0

    await wipeMyData('u1')

    const noteDeletes = calls.filter((c) => c.startsWith('notes.delete'))
    expect(noteDeletes).toHaveLength(4)
    const lastNote = calls.lastIndexOf(noteDeletes.at(-1)!)
    const firstTask = calls.findIndex((c) => c.startsWith('tasks.delete'))
    expect(firstTask).toBeGreaterThan(-1)
    expect(lastNote).toBeLessThan(firstTask)
  })
})
