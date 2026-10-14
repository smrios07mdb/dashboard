import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { Subcategory, Task } from '@/db/types'

/*
 * deleteList (chunk 87, D2/D3): the task step for each choice, then the
 * archive, and never the archive when the task step fails.
 */

const calls: string[] = []
const repoMock = vi.hoisted(() => ({
  tasks: { bulkUpdate: vi.fn(), bulkDelete: vi.fn() },
  subcategories: { archive: vi.fn() },
}))
vi.mock('@/db/repo', () => ({ repo: repoMock }))

import { deleteList } from './deleteList'

const SUB: Subcategory = {
  id: 's1',
  userId: 'u1',
  categoryId: 'c-work',
  name: 'Inbox',
  sortOrder: 0,
  archivedAt: null,
}
const ARCHIVED: Subcategory = { ...SUB, archivedAt: '2026-10-14T12:00:00.000Z' }

const task = (
  id: string,
  subcategoryId: string,
  completedAt: string | null = null,
): Task => ({
  id,
  userId: 'u1',
  subcategoryId,
  title: id,
  estimateMinutes: 30,
  dueAt: null,
  remindAt: null,
  notified: false,
  priority: null,
  completedAt,
  createdAt: '2026-09-01T12:00:00.000Z',
  updatedAt: '2026-09-01T12:00:00.000Z',
})

const OLD_DONE = '2026-06-01T12:00:00.000Z'
const TASKS = [
  task('open-a', 's1'),
  task('open-b', 's1'),
  task('done-c', 's1', OLD_DONE),
  task('elsewhere', 's2'),
]

type Update = { id: string; patch: Partial<Task> }

beforeEach(() => {
  calls.length = 0
  repoMock.tasks.bulkUpdate.mockReset().mockImplementation(async (u: Update[]) => {
    await Promise.resolve()
    calls.push('bulkUpdate')
    return u.map(({ id, patch }) => ({ ...TASKS.find((t) => t.id === id)!, ...patch }))
  })
  repoMock.tasks.bulkDelete.mockReset().mockImplementation(async () => {
    await Promise.resolve()
    calls.push('bulkDelete')
  })
  repoMock.subcategories.archive.mockReset().mockImplementation(async () => {
    calls.push('archive')
    return ARCHIVED
  })
})

describe('deleteList', () => {
  it('move: open and completed rows go to the target, then the archive', async () => {
    const res = await deleteList('s1', { kind: 'move', toId: 's9' }, TASKS)
    expect(repoMock.tasks.bulkUpdate).toHaveBeenCalledWith([
      { id: 'open-a', patch: { subcategoryId: 's9' } },
      { id: 'open-b', patch: { subcategoryId: 's9' } },
      { id: 'done-c', patch: { subcategoryId: 's9' } },
    ])
    expect(repoMock.tasks.bulkDelete).not.toHaveBeenCalled()
    expect(repoMock.subcategories.archive).toHaveBeenCalledWith('s1')
    expect(calls).toEqual(['bulkUpdate', 'archive'])
    expect(res.archived).toBe(ARCHIVED)
    expect(res.updated.map((t) => [t.id, t.subcategoryId])).toEqual([
      ['open-a', 's9'],
      ['open-b', 's9'],
      ['done-c', 's9'],
    ])
    expect(res.deletedIds).toEqual([])
  })

  it('complete: only open rows get one completedAt, then the archive', async () => {
    const res = await deleteList('s1', { kind: 'complete' }, TASKS)
    expect(repoMock.tasks.bulkUpdate).toHaveBeenCalledTimes(1)
    const updates = repoMock.tasks.bulkUpdate.mock.calls[0][0] as Update[]
    expect(updates.map((u) => u.id)).toEqual(['open-a', 'open-b'])
    const stamps = new Set(updates.map((u) => u.patch.completedAt))
    expect(stamps.size).toBe(1)
    const [stamp] = stamps
    expect(typeof stamp).toBe('string')
    expect(Number.isNaN(Date.parse(stamp as string))).toBe(false)
    expect(updates.every((u) => Object.keys(u.patch).length === 1)).toBe(true)
    expect(calls).toEqual(['bulkUpdate', 'archive'])
    expect(res.updated.map((t) => t.id)).toEqual(['open-a', 'open-b'])
    expect(res.deletedIds).toEqual([])
  })

  it('delete: every row is deleted, then the archive', async () => {
    const res = await deleteList('s1', { kind: 'delete' }, TASKS)
    expect(repoMock.tasks.bulkDelete).toHaveBeenCalledWith([
      'open-a',
      'open-b',
      'done-c',
    ])
    expect(repoMock.tasks.bulkUpdate).not.toHaveBeenCalled()
    expect(calls).toEqual(['bulkDelete', 'archive'])
    expect(res.deletedIds).toEqual(['open-a', 'open-b', 'done-c'])
    expect(res.updated).toEqual([])
  })

  it('none: archives only', async () => {
    const res = await deleteList('s1', { kind: 'none' }, TASKS)
    expect(repoMock.tasks.bulkUpdate).not.toHaveBeenCalled()
    expect(repoMock.tasks.bulkDelete).not.toHaveBeenCalled()
    expect(calls).toEqual(['archive'])
    expect(res).toEqual({ archived: ARCHIVED, updated: [], deletedIds: [] })
  })

  it('skips the task call when there are no rows', async () => {
    await deleteList('s1', { kind: 'complete' }, [task('done-only', 's1', OLD_DONE)])
    await deleteList('s1', { kind: 'delete' }, [])
    expect(repoMock.tasks.bulkUpdate).not.toHaveBeenCalled()
    expect(repoMock.tasks.bulkDelete).not.toHaveBeenCalled()
    expect(calls).toEqual(['archive', 'archive'])
  })

  it('a failing task step archives nothing and propagates', async () => {
    const boom = new Error('offline write failed')
    repoMock.tasks.bulkUpdate.mockRejectedValueOnce(boom)
    await expect(
      deleteList('s1', { kind: 'complete' }, TASKS),
    ).rejects.toBe(boom)
    repoMock.tasks.bulkDelete.mockRejectedValueOnce(boom)
    await expect(deleteList('s1', { kind: 'delete' }, TASKS)).rejects.toBe(boom)
    expect(repoMock.subcategories.archive).not.toHaveBeenCalled()
  })

  it('archives only after the task step resolves', async () => {
    let release!: () => void
    repoMock.tasks.bulkDelete.mockImplementationOnce(
      () =>
        new Promise<void>((r) => {
          release = () => {
            calls.push('bulkDelete')
            r()
          }
        }),
    )
    const pending = deleteList('s1', { kind: 'delete' }, TASKS)
    await new Promise((r) => setTimeout(r, 0))
    expect(repoMock.subcategories.archive).not.toHaveBeenCalled()
    release()
    await pending
    expect(calls).toEqual(['bulkDelete', 'archive'])
  })
})
