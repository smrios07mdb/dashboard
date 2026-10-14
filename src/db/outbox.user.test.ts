import { beforeEach, describe, expect, it, vi } from 'vitest'

/*
 * Chunk 84: the outbox is per user. Each queued op carries the user signed in
 * when it was queued; a drain replays only the current user's rows, leaves
 * another user's queued (dropped at 7 days), drops rows with no user, and
 * names the queuing user on every write that can insert.
 */

const { fromMock, isOnlineMock } = vi.hoisted(() => ({
  fromMock: vi.fn(),
  isOnlineMock: vi.fn(() => true),
}))

vi.mock('@/lib/supabase', () => ({ supabase: { from: fromMock } }))
vi.mock('@/lib/network', () => ({ isOnline: isOnlineMock }))

import { db } from './dexie'
import { discardAllFailed, drainOutbox, getSyncIssues, MAX_ATTEMPTS } from './outbox'
import { repo, setOutboxUser } from './repo'
import { useSyncStore } from './syncStore'
import type { OutboxRow } from './types'

const DAY = 86_400_000

const calls: { method: string; args: unknown[] }[] = []

/** A thenable query builder that records every chained call. */
function chain(data: unknown = null) {
  const c: object = new Proxy(
    {},
    {
      get(_t, prop) {
        if (prop === 'then') {
          return (ok: (v: unknown) => unknown) =>
            Promise.resolve({ data, error: null }).then(ok)
        }
        return (...args: unknown[]) => {
          calls.push({ method: String(prop), args })
          return c
        }
      },
    },
  )
  return c
}

function row(over: Partial<OutboxRow>): OutboxRow {
  return {
    op: 'delete',
    table: 'tasks',
    payload: { id: 't-a' },
    createdAt: new Date().toISOString(),
    attempts: 0,
    lastError: null,
    lastAttemptAt: null,
    ...over,
  }
}

async function add(r: OutboxRow): Promise<number> {
  return (await db.outbox.add(r)) as number
}

const ago = (ms: number) => new Date(Date.now() - ms).toISOString()

const taskPayload = {
  id: 't-new',
  subcategoryId: 's1',
  title: 'Queued',
  estimateMinutes: 0,
  dueAt: null,
  remindAt: null,
  notified: false,
  priority: null,
  completedAt: null,
  createdAt: '2026-10-14T00:00:00.000Z',
  updatedAt: '2026-10-14T00:00:00.000Z',
}

beforeEach(async () => {
  fromMock.mockReset()
  fromMock.mockImplementation(() => chain())
  isOnlineMock.mockReturnValue(true)
  calls.length = 0
  useSyncStore.setState({ state: 'synced', lastSyncAt: null })
  await db.outbox.clear()
  await db.tasks.clear()
})

describe('outbox — per user (chunk 84)', () => {
  it('(1) stamps the signed-in user at enqueue, and keeps it after the user changes', async () => {
    setOutboxUser('u-a')
    isOnlineMock.mockReturnValue(false)
    await repo.tasks.delete('t-a')
    setOutboxUser('u-b')

    const rows = await db.outbox.toArray()
    expect(rows).toHaveLength(1)
    expect(rows[0].uid).toBe('u-a')
  })

  it('(2) the same user replays their op', async () => {
    setOutboxUser('u-a')
    await add(row({ uid: 'u-a' }))

    const res = await drainOutbox()

    expect(fromMock).toHaveBeenCalledWith('tasks')
    expect(calls.map((c) => c.method)).toEqual(['delete', 'eq'])
    expect(res).toEqual({ processed: 1, failed: 0, remaining: 0 })
    expect(await db.outbox.count()).toBe(0)
  })

  it('(3) another user neither replays nor clears it, and it replays for its owner', async () => {
    setOutboxUser('u-b')
    const id = await add(row({ uid: 'u-a' }))

    const res = await drainOutbox()

    expect(fromMock).not.toHaveBeenCalled()
    expect(res).toEqual({ processed: 0, failed: 0, remaining: 0 })
    expect(useSyncStore.getState().state).toBe('synced')
    expect(await db.outbox.get(id)).toMatchObject({ uid: 'u-a', attempts: 0 })

    setOutboxUser('u-a')
    await drainOutbox()
    expect(fromMock).toHaveBeenCalledTimes(1)
    expect(await db.outbox.count()).toBe(0)
  })

  it('(4) another user\'s op is dropped once 7 days old, unreplayed', async () => {
    setOutboxUser('u-b')
    const old = await add(row({ uid: 'u-a', createdAt: ago(7 * DAY + 60_000) }))
    const young = await add(row({ uid: 'u-a', createdAt: ago(6 * DAY) }))

    await drainOutbox()

    expect(fromMock).not.toHaveBeenCalled()
    expect(await db.outbox.get(old)).toBeUndefined()
    expect(await db.outbox.get(young)).toBeDefined()
  })

  it('(5) a legacy row with no user is dropped, not replayed', async () => {
    setOutboxUser('u-a')
    await add(row({}))
    await add(row({ op: 'insert', payload: { ...taskPayload, userId: 'u-a' } }))

    const res = await drainOutbox()

    expect(fromMock).not.toHaveBeenCalled()
    expect(res.processed).toBe(0)
    expect(await db.outbox.count()).toBe(0)
  })

  it('(6) an insert sends user_id from the stamped user, not from the payload', async () => {
    setOutboxUser('u-a')
    // The payload names no user: only the stamp can supply it.
    await add(row({ op: 'insert', uid: 'u-a', payload: taskPayload }))

    await drainOutbox()

    const insert = calls.find((c) => c.method === 'insert')
    expect(insert?.args[0]).toMatchObject({ id: 't-new', user_id: 'u-a' })
  })

  // Not a regression guard from base: base already sent the payload's userId.
  it('(7) an insert payload carries user_id', async () => {
    setOutboxUser('u-a')
    await add(
      row({ op: 'insert', uid: 'u-a', payload: { ...taskPayload, userId: 'u-a' } }),
    )

    await drainOutbox()

    const insert = calls.find((c) => c.method === 'insert')
    expect(insert?.args[0]).toMatchObject({ user_id: 'u-a' })
  })

  it('(8) Sync issues show and discard only the current user\'s failed rows', async () => {
    setOutboxUser('u-b')
    const theirs = await add(row({ uid: 'u-a', attempts: MAX_ATTEMPTS }))
    const mine = await add(row({ uid: 'u-b', attempts: MAX_ATTEMPTS }))

    expect((await getSyncIssues()).map((r) => r.id)).toEqual([mine])

    await discardAllFailed()
    expect(await db.outbox.get(mine)).toBeUndefined()
    expect(await db.outbox.get(theirs)).toBeDefined()
  })

  it('(9) with no user signed in, nothing is replayed or dropped', async () => {
    setOutboxUser(undefined)
    await add(row({ uid: 'u-a' }))
    await add(row({}))

    await drainOutbox()

    expect(fromMock).not.toHaveBeenCalled()
    expect(await db.outbox.count()).toBe(2)
  })
})
