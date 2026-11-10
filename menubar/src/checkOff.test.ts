import { describe, expect, it, vi } from 'vitest'

import type { Task } from '@/db/types'

import { createCheckOff } from './checkOff'

const OPEN: Task = {
  id: 't1',
  userId: 'u1',
  subcategoryId: 's1',
  title: 'First aid kit',
  estimateMinutes: 30,
  dueAt: null,
  remindAt: null,
  notified: false,
  priority: null,
  completedAt: null,
  createdAt: '2026-11-01T12:00:00.000Z',
  updatedAt: '2026-11-01T12:00:00.000Z',
}
const DONE: Task = { ...OPEN, completedAt: '2026-11-10T16:00:00.000Z' }

function setup(write = vi.fn().mockResolvedValue(undefined)) {
  const refresh = vi.fn().mockResolvedValue(undefined)
  const onCompleted = vi.fn()
  const c = createCheckOff({ write, refresh, onCompleted })
  return { c, write, refresh, onCompleted }
}

describe('createCheckOff', () => {
  it('checking off writes completed, refreshes, keeps the row and offers Undo with the prior task', async () => {
    const { c, write, refresh, onCompleted } = setup()
    await c.toggle(OPEN)
    expect(write).toHaveBeenCalledWith('t1', true)
    expect(refresh).toHaveBeenCalledTimes(1)
    expect(onCompleted).toHaveBeenCalledWith(OPEN)
    expect(c.getState().kept.has('t1')).toBe(true)
    expect(c.getState().optimistic.size).toBe(0)
  })

  it('unchecking writes open and offers no Undo', async () => {
    const { c, write, onCompleted } = setup()
    await c.toggle(DONE)
    expect(write).toHaveBeenCalledWith('t1', false)
    expect(onCompleted).not.toHaveBeenCalled()
  })

  it('shows the new state while the write is in flight and ignores a second click', async () => {
    let resolve!: () => void
    const write = vi.fn(() => new Promise<void>((r) => (resolve = r)))
    const { c } = setup(write)
    const p = c.toggle(OPEN)
    expect(c.getState().optimistic.get('t1')).toBe(true)
    await c.toggle(OPEN)
    expect(write).toHaveBeenCalledTimes(1)
    resolve()
    await p
    expect(c.getState().optimistic.size).toBe(0)
  })

  it('a failed write drops the optimistic state, reports it and offers no Undo', async () => {
    const write = vi.fn().mockRejectedValue(new Error('boom'))
    const { c, refresh, onCompleted } = setup(write)
    vi.spyOn(console, 'error').mockImplementation(() => {})
    await c.toggle(OPEN)
    expect(c.getState().failed).toBe(true)
    expect(c.getState().optimistic.size).toBe(0)
    expect(onCompleted).not.toHaveBeenCalled()
    expect(refresh).not.toHaveBeenCalled()
  })

  it('the next successful write clears the failure', async () => {
    const write = vi
      .fn()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValue(undefined)
    const { c } = setup(write)
    vi.spyOn(console, 'error').mockImplementation(() => {})
    await c.toggle(OPEN)
    await c.toggle(OPEN)
    expect(c.getState().failed).toBe(false)
  })

  it('notifies subscribers', async () => {
    const { c } = setup()
    const fn = vi.fn()
    c.subscribe(fn)
    await c.toggle(OPEN)
    expect(fn).toHaveBeenCalled()
  })
})
