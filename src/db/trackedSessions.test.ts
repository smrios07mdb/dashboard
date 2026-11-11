import Dexie from 'dexie'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/*
 * Chunk 98 — the `tracked_sessions` table through every data-layer
 * touchpoint: mappers, Dexie v8, the repo's online and offline paths, outbox
 * replay (an upsert on `id`) and the local-cache wipe. There is no realtime
 * handler, on purpose.
 */

const { fromMock, isOnlineMock } = vi.hoisted(() => ({
  fromMock: vi.fn(),
  isOnlineMock: vi.fn(() => true),
}))

vi.mock('@/lib/supabase', () => ({ supabase: { from: fromMock } }))
vi.mock('@/lib/network', () => ({ isOnline: isOnlineMock }))

import { db } from './dexie'
import { wipeLocalCache } from './localCache'
import {
  trackedSessionFromRow,
  trackedSessionToRow,
  type TrackedSessionRow,
} from './mappers'
import { drainOutbox } from './outbox'
import { isClientError, repo, setOutboxUser } from './repo'
import { useSyncStore } from './syncStore'
import { TABLES, type TrackedSession } from './types'

type SupabaseResult = { data: unknown; error: unknown }

const chainCalls: { method: string; args: unknown[] }[] = []

/** Chainable Supabase stand-in (the repo.test.ts shape). */
function makeChain(result: SupabaseResult) {
  const chain: unknown = new Proxy(
    {},
    {
      get(_t, prop) {
        if (prop === 'then') {
          return (
            onfulfilled: (v: unknown) => unknown,
            onrejected?: (e: unknown) => unknown,
          ) => Promise.resolve(result).then(onfulfilled, onrejected)
        }
        if (typeof prop !== 'string') return undefined
        return (...args: unknown[]) => {
          chainCalls.push({ method: prop, args })
          return chain
        }
      },
    },
  )
  return chain
}

const respond = (data: unknown, error: unknown = null) =>
  fromMock.mockReturnValueOnce(makeChain({ data, error }))

const call = (method: string) => chainCalls.find((c) => c.method === method)

const ID = 'b57c0a63-a227-83f2-9f8a-49a164405cab'

function aRow(over: Partial<TrackedSessionRow> = {}): TrackedSessionRow {
  return {
    id: ID,
    user_id: 'u-1',
    kind: 'focus',
    started_at: '2026-11-11T14:00:00+00:00',
    ended_at: '2026-11-11T14:25:00+00:00',
    planned_seconds: 1500,
    active_seconds: 1500,
    outcome: 'completed',
    task_id: 't-1',
    task_title: 'Write the report',
    created_at: '2026-11-11T14:25:01+00:00',
    ...over,
  }
}

/** What the menu bar web view hands to `save`. */
function anInput(
  over: Partial<Omit<TrackedSession, 'createdAt'>> = {},
): Omit<TrackedSession, 'createdAt'> {
  return {
    id: ID,
    userId: 'u-1',
    kind: 'focus',
    startedAt: '2026-11-11T14:00:00.000Z',
    endedAt: '2026-11-11T14:25:00.000Z',
    plannedSeconds: 1500,
    activeSeconds: 1500,
    outcome: 'completed',
    taskId: 't-1',
    taskTitle: 'Write the report',
    ...over,
  }
}

beforeEach(async () => {
  fromMock.mockReset()
  isOnlineMock.mockReset()
  isOnlineMock.mockReturnValue(true)
  chainCalls.length = 0
  useSyncStore.setState({ state: 'synced', lastSyncAt: null })
  await db.tracked_sessions.clear()
  await db.outbox.clear()
})

describe('tracked session mappers', () => {
  it('round-trips a focus row and a breathing row', () => {
    const row = aRow()
    const session = trackedSessionFromRow(row)
    expect(session).toEqual({
      id: ID,
      userId: 'u-1',
      kind: 'focus',
      startedAt: '2026-11-11T14:00:00+00:00',
      endedAt: '2026-11-11T14:25:00+00:00',
      plannedSeconds: 1500,
      activeSeconds: 1500,
      outcome: 'completed',
      taskId: 't-1',
      taskTitle: 'Write the report',
      createdAt: '2026-11-11T14:25:01+00:00',
    })
    expect(trackedSessionToRow(session)).toEqual(row)

    const breathing = aRow({
      kind: 'meditation',
      outcome: 'ended',
      task_id: null,
      task_title: null,
    })
    expect(trackedSessionToRow(trackedSessionFromRow(breathing))).toEqual(
      breathing,
    )
  })

  it('toRow emits only the keys it was given, and keeps a null task', () => {
    expect(trackedSessionToRow({ outcome: 'skipped' })).toEqual({
      outcome: 'skipped',
    })
    expect(trackedSessionToRow({ taskId: null, taskTitle: null })).toEqual({
      task_id: null,
      task_title: null,
    })
    expect(trackedSessionToRow({})).toEqual({})
  })

  it('the table is registered as tracked_sessions', () => {
    expect(TABLES.trackedSessions).toBe('tracked_sessions')
  })
})

describe('Dexie v8 (chunk 98)', () => {
  it('opens over a populated v7 DB with the data kept', async () => {
    const NAME = 'dexie-v8-test'
    await Dexie.delete(NAME)
    const v7 = {
      tasks: '&id, subcategoryId, completedAt, dueAt, remindAt, priority, updatedAt',
      outbox: '++id, createdAt, table, attempts',
      notes: '&id, taskId, subcategoryId, pinned, updatedAt',
      today_marks: '&id, day',
    }

    const oldDb = new Dexie(NAME)
    oldDb.version(7).stores(v7)
    await oldDb.open()
    await oldDb.table('tasks').add({ id: 't-keep', title: 'kept' })
    await oldDb.table('notes').add({ id: 'n-keep', taskId: 't-keep' })
    await oldDb.table('today_marks').add({ id: 't-keep', day: 'd', kind: 'pin' })
    await oldDb.table('outbox').add({ op: 'insert', table: 'tasks', attempts: 0 })
    oldDb.close()

    const newDb = new Dexie(NAME)
    newDb.version(7).stores(v7)
    newDb.version(8).stores({ tracked_sessions: '&id, startedAt, kind' })
    await newDb.open()

    expect(newDb.verno).toBe(8)
    expect(newDb.tables.map((t) => t.name).sort()).toEqual(
      ['notes', 'outbox', 'tasks', 'today_marks', 'tracked_sessions'].sort(),
    )
    expect(await newDb.table('tasks').get('t-keep')).toMatchObject({
      title: 'kept',
    })
    expect(await newDb.table('notes').get('n-keep')).toBeDefined()
    expect(await newDb.table('today_marks').get('t-keep')).toMatchObject({
      kind: 'pin',
    })
    expect(await newDb.table('outbox').count()).toBe(1)
    // `id` is the primary key — the same session put twice is one row.
    await newDb.table('tracked_sessions').put({ id: ID, kind: 'focus' })
    await newDb.table('tracked_sessions').put({ id: ID, kind: 'focus' })
    expect(await newDb.table('tracked_sessions').count()).toBe(1)

    newDb.close()
    await Dexie.delete(NAME)
  })

  it('the real DashboardCacheDB is at v8 with the tracked_sessions store', () => {
    expect(db.verno).toBe(8)
    expect(db.tracked_sessions.schema.primKey.name).toBe('id')
    expect(db.tracked_sessions.schema.indexes.map((i) => i.name)).toEqual([
      'startedAt',
      'kind',
    ])
  })

  it('wipeLocalCache clears tracked_sessions and leaves the outbox', async () => {
    await db.tracked_sessions.put(trackedSessionFromRow(aRow()))
    await db.outbox.add({
      op: 'insert',
      table: 'tracked_sessions',
      payload: { id: ID },
      createdAt: 'x',
      attempts: 0,
      lastError: null,
      lastAttemptAt: null,
    })
    await wipeLocalCache()
    expect(await db.tracked_sessions.count()).toBe(0)
    expect(await db.outbox.count()).toBe(1)
  })
})

describe('repo.trackedSessions — online', () => {
  it('save upserts on id and mirrors the server row', async () => {
    respond(aRow())
    const out = await repo.trackedSessions.save(anInput())

    expect(fromMock).toHaveBeenCalledWith('tracked_sessions')
    const upsert = call('upsert')
    expect(upsert?.args[1]).toEqual({ onConflict: 'id' })
    expect(upsert?.args[0]).toEqual({
      id: ID,
      user_id: 'u-1',
      kind: 'focus',
      started_at: '2026-11-11T14:00:00.000Z',
      ended_at: '2026-11-11T14:25:00.000Z',
      planned_seconds: 1500,
      active_seconds: 1500,
      outcome: 'completed',
      task_id: 't-1',
      task_title: 'Write the report',
    })
    // `created_at` is the server's to stamp.
    expect(upsert?.args[0]).not.toHaveProperty('created_at')
    expect(call('insert')).toBeUndefined()
    expect(out.createdAt).toBe('2026-11-11T14:25:01+00:00')
    expect(await db.tracked_sessions.get(ID)).toMatchObject({
      createdAt: '2026-11-11T14:25:01+00:00',
    })
    expect(await db.outbox.count()).toBe(0)
  })

  it('the same session saved twice is one mirrored row', async () => {
    respond(aRow())
    respond(aRow())
    await repo.trackedSessions.save(anInput())
    await repo.trackedSessions.save(anInput())
    expect(await db.tracked_sessions.count()).toBe(1)
  })

  it('a 4xx on save throws a client error and enqueues nothing', async () => {
    respond(null, { status: 400, message: 'check violation' })
    const failed = await repo.trackedSessions.save(anInput()).then(
      () => null,
      (e: unknown) => e,
    )
    expect(failed).toMatchObject({ status: 400 })
    expect(isClientError(failed)).toBe(true)
    expect(isClientError(new TypeError('Failed to fetch'))).toBe(false)
    expect(await db.outbox.count()).toBe(0)
    expect(await db.tracked_sessions.count()).toBe(0)
  })

  it('a network failure on save queues the row instead of throwing', async () => {
    fromMock.mockImplementationOnce(() => {
      throw new TypeError('Failed to fetch')
    })
    const out = await repo.trackedSessions.save(anInput())
    expect(out.id).toBe(ID)
    const rows = await db.outbox.toArray()
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ op: 'insert', table: 'tracked_sessions' })
  })

  it('listInRange asks for [from, to) and adds to the mirror without clearing it', async () => {
    await db.tracked_sessions.put(
      trackedSessionFromRow(
        aRow({ id: 'older', started_at: '2026-01-01T10:00:00+00:00' }),
      ),
    )
    respond([aRow()])
    const out = await repo.trackedSessions.listInRange(
      '2026-11-01T00:00:00.000Z',
      '2026-11-12T00:00:00.000Z',
    )
    expect(out.map((s) => s.id)).toEqual([ID])
    expect(call('gte')?.args).toEqual(['started_at', '2026-11-01T00:00:00.000Z'])
    expect(call('lt')?.args).toEqual(['started_at', '2026-11-12T00:00:00.000Z'])
    expect(await db.tracked_sessions.count()).toBe(2)
  })

  it('listAll replaces the mirror; delete removes the row', async () => {
    await db.tracked_sessions.put(
      trackedSessionFromRow(aRow({ id: 'gone-on-the-server' })),
    )
    respond([aRow()])
    expect((await repo.trackedSessions.listAll()).map((s) => s.id)).toEqual([ID])
    expect(await db.tracked_sessions.count()).toBe(1)

    respond(null)
    await repo.trackedSessions.delete(ID)
    expect(call('delete')).toBeDefined()
    expect(chainCalls.filter((c) => c.method === 'eq').at(-1)?.args).toEqual([
      'id',
      ID,
    ])
    expect(await db.tracked_sessions.count()).toBe(0)
    expect(await db.outbox.count()).toBe(0)
  })
})

describe('repo.trackedSessions — offline', () => {
  beforeEach(() => {
    isOnlineMock.mockReturnValue(false)
    // Queued ops replay only for the user who queued them (chunk 84).
    setOutboxUser('u-1')
  })

  it('save applies to the cache and enqueues one insert outbox row', async () => {
    const out = await repo.trackedSessions.save(anInput())

    expect(fromMock).not.toHaveBeenCalled()
    expect(out).toMatchObject({ id: ID, outcome: 'completed' })
    expect(await db.tracked_sessions.get(ID)).toMatchObject({
      activeSeconds: 1500,
    })
    const rows = await db.outbox.toArray()
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ op: 'insert', table: 'tracked_sessions' })
    expect(rows[0].payload).toMatchObject({
      id: ID,
      userId: 'u-1',
      kind: 'focus',
      taskId: 't-1',
    })
    expect(useSyncStore.getState().state).toBe('offline')
  })

  it('the outbox replay upserts on id, so a session queued twice cannot duplicate', async () => {
    await repo.trackedSessions.save(anInput())
    await repo.trackedSessions.save(anInput())
    expect(await db.outbox.count()).toBe(2)

    isOnlineMock.mockReturnValue(true)
    respond(aRow())
    respond(aRow())

    const res = await drainOutbox()

    expect(res).toMatchObject({ processed: 2, remaining: 0 })
    expect(fromMock.mock.calls.map((c) => c[0])).toEqual([
      'tracked_sessions',
      'tracked_sessions',
    ])
    const upserts = chainCalls.filter((c) => c.method === 'upsert')
    expect(upserts).toHaveLength(2)
    for (const u of upserts) expect(u.args[1]).toEqual({ onConflict: 'id' })
    expect(upserts[0].args[0]).toMatchObject({
      id: ID,
      user_id: 'u-1',
      active_seconds: 1500,
      task_title: 'Write the report',
    })
    expect(upserts[0].args[0]).not.toHaveProperty('userId')
    expect(call('insert')).toBeUndefined()
    expect(await db.tracked_sessions.count()).toBe(1)
    expect(await db.tracked_sessions.get(ID)).toMatchObject({
      createdAt: '2026-11-11T14:25:01+00:00',
    })
    expect(await db.outbox.count()).toBe(0)
  })

  it('listInRange falls back to the mirror, filtered by startedAt whatever its spelling', async () => {
    // A server row (`+00:00`) and an optimistic one (`Z`).
    await db.tracked_sessions.bulkPut([
      trackedSessionFromRow(
        aRow({ id: 'before', started_at: '2026-10-31T23:59:59.999+00:00' }),
      ),
      trackedSessionFromRow(
        aRow({ id: 'first', started_at: '2026-11-01T00:00:00+00:00' }),
      ),
      { ...anInput({ id: 'mid' }), createdAt: 'x' },
      trackedSessionFromRow(
        aRow({ id: 'at-the-end', started_at: '2026-11-12T00:00:00+00:00' }),
      ),
    ])
    const out = await repo.trackedSessions.listInRange(
      '2026-11-01T00:00:00.000Z',
      '2026-11-12T00:00:00.000Z',
    )
    expect(out.map((s) => s.id)).toEqual(['first', 'mid'])
    expect(fromMock).not.toHaveBeenCalled()
  })

  it('delete applies to the cache and enqueues a delete', async () => {
    await db.tracked_sessions.put(trackedSessionFromRow(aRow()))
    await repo.trackedSessions.delete(ID)
    expect(await db.tracked_sessions.count()).toBe(0)
    const rows = await db.outbox.toArray()
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      op: 'delete',
      table: 'tracked_sessions',
      payload: { id: ID },
    })
  })
})
