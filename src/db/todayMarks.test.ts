import Dexie from 'dexie'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/*
 * Chunk 64 — the `today_marks` table through every data-layer touchpoint:
 * mappers, Dexie v7, the repo's online and offline paths, outbox replay (an
 * upsert on `id`), the realtime handler and the local-cache wipe.
 */

const { fromMock, channelMock, removeChannelMock, isOnlineMock, bindings } =
  vi.hoisted(() => {
    // table → the handler `startRealtime` bound for it.
    const bindings = new Map<string, (payload: unknown) => Promise<void>>()
    const channel = {
      on(
        _event: string,
        filter: { table: string },
        handler: (payload: unknown) => Promise<void>,
      ) {
        bindings.set(filter.table, handler)
        return channel
      },
      subscribe: () => channel,
    }
    return {
      fromMock: vi.fn(),
      channelMock: vi.fn(() => channel),
      removeChannelMock: vi.fn(),
      isOnlineMock: vi.fn(() => true),
      bindings,
    }
  })

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: fromMock,
    channel: channelMock,
    removeChannel: removeChannelMock,
  },
}))
vi.mock('@/lib/network', () => ({ isOnline: isOnlineMock }))

import { db } from './dexie'
import { wipeLocalCache } from './localCache'
import {
  todayMarkFromRow,
  todayMarkToRow,
  type TodayMarkRow,
} from './mappers'
import { drainOutbox } from './outbox'
import { startRealtime, stopRealtime } from './realtime'
import { repo, setOutboxUser } from './repo'
import { useSyncStore } from './syncStore'
import { TABLES } from './types'

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

function aRow(over: Partial<TodayMarkRow> = {}): TodayMarkRow {
  return {
    id: 't-1',
    user_id: 'u-1',
    day: '2026-10-13',
    kind: 'pin',
    updated_at: '2026-10-13T09:00:00+00:00',
    ...over,
  }
}

beforeEach(async () => {
  fromMock.mockReset()
  isOnlineMock.mockReset()
  isOnlineMock.mockReturnValue(true)
  chainCalls.length = 0
  useSyncStore.setState({ state: 'synced', lastSyncAt: null })
  await db.today_marks.clear()
  await db.outbox.clear()
})

describe('today mark mappers', () => {
  it('round-trips a row', () => {
    const row = aRow()
    const mark = todayMarkFromRow(row)
    expect(mark).toEqual({
      id: 't-1',
      userId: 'u-1',
      day: '2026-10-13',
      kind: 'pin',
      updatedAt: '2026-10-13T09:00:00+00:00',
    })
    expect(todayMarkToRow(mark)).toEqual(row)
    const removed = aRow({ kind: 'remove' })
    expect(todayMarkToRow(todayMarkFromRow(removed))).toEqual(removed)
  })

  it('toRow emits only the keys it was given', () => {
    expect(todayMarkToRow({ kind: 'remove' })).toEqual({ kind: 'remove' })
    expect(todayMarkToRow({})).toEqual({})
  })

  it('the table is registered as today_marks', () => {
    expect(TABLES.todayMarks).toBe('today_marks')
  })
})

describe('Dexie v7 (chunk 64)', () => {
  it('opens over a populated v6 DB with the existing stores intact', async () => {
    const NAME = 'dexie-v7-test'
    await Dexie.delete(NAME)
    const v6 = {
      tasks: '&id, subcategoryId, completedAt, dueAt, remindAt, priority, updatedAt',
      outbox: '++id, createdAt, table, attempts',
      notes: '&id, taskId, subcategoryId, pinned, updatedAt',
    }

    const oldDb = new Dexie(NAME)
    oldDb.version(6).stores(v6)
    await oldDb.open()
    await oldDb.table('tasks').add({ id: 't-keep', title: 'kept' })
    await oldDb.table('notes').add({ id: 'n-keep', taskId: 't-keep' })
    await oldDb.table('outbox').add({ op: 'insert', table: 'tasks', attempts: 0 })
    oldDb.close()

    const newDb = new Dexie(NAME)
    newDb.version(6).stores(v6)
    newDb.version(7).stores({ today_marks: '&id, day' })
    await newDb.open()

    expect(newDb.verno).toBe(7)
    expect(newDb.tables.map((t) => t.name).sort()).toEqual(
      ['notes', 'outbox', 'tasks', 'today_marks'].sort(),
    )
    expect(await newDb.table('tasks').get('t-keep')).toMatchObject({
      title: 'kept',
    })
    expect(await newDb.table('notes').get('n-keep')).toBeDefined()
    expect(await newDb.table('outbox').count()).toBe(1)
    // `id` is the primary key — a second put for the same task replaces.
    await newDb.table('today_marks').put({ id: 't-keep', day: 'd', kind: 'pin' })
    await newDb
      .table('today_marks')
      .put({ id: 't-keep', day: 'd', kind: 'remove' })
    expect(await newDb.table('today_marks').count()).toBe(1)

    newDb.close()
    await Dexie.delete(NAME)
  })

  it('the real DashboardCacheDB is at v7 with the today_marks store', () => {
    expect(db.verno).toBe(7)
    expect(db.today_marks.schema.primKey.name).toBe('id')
    expect(db.today_marks.schema.indexes.map((i) => i.name)).toEqual(['day'])
  })

  it('wipeLocalCache clears today_marks and leaves the outbox', async () => {
    await db.today_marks.put(todayMarkFromRow(aRow()))
    await db.outbox.add({
      op: 'insert',
      table: 'today_marks',
      payload: { id: 't-1' },
      createdAt: 'x',
      attempts: 0,
      lastError: null,
      lastAttemptAt: null,
    })
    await wipeLocalCache()
    expect(await db.today_marks.count()).toBe(0)
    expect(await db.outbox.count()).toBe(1)
  })
})

describe('repo.todayMarks — online', () => {
  it('list replaces the Dexie mirror with what the server returned', async () => {
    await db.today_marks.put(todayMarkFromRow(aRow({ id: 'gone-elsewhere' })))
    respond([aRow({ id: 't-1' }), aRow({ id: 't-2', kind: 'remove' })])

    const out = await repo.todayMarks.list()

    expect(fromMock).toHaveBeenCalledWith('today_marks')
    expect(out.map((m) => m.id).sort()).toEqual(['t-1', 't-2'])
    expect(
      (await db.today_marks.toArray()).map((m) => m.id).sort(),
    ).toEqual(['t-1', 't-2'])
  })

  it('set upserts on id, with the task id as the row id', async () => {
    respond(aRow({ updated_at: '2026-10-13T09:00:01+00:00' }))

    const out = await repo.todayMarks.set({
      taskId: 't-1',
      userId: 'u-1',
      day: '2026-10-13',
      kind: 'pin',
    })

    expect(fromMock).toHaveBeenCalledWith('today_marks')
    const upsert = call('upsert')
    expect(upsert?.args[1]).toEqual({ onConflict: 'id' })
    expect(upsert?.args[0]).toMatchObject({
      id: 't-1',
      user_id: 'u-1',
      day: '2026-10-13',
      kind: 'pin',
    })
    expect(call('insert')).toBeUndefined()
    // The server echo is what is returned and mirrored.
    expect(out).toMatchObject({
      id: 't-1',
      updatedAt: '2026-10-13T09:00:01+00:00',
    })
    expect(await db.today_marks.get('t-1')).toEqual(out)
    expect(await db.outbox.count()).toBe(0)
  })

  it('a second set for the same task flips the one mirrored row', async () => {
    respond(aRow())
    respond(aRow({ kind: 'remove' }))
    const input = { taskId: 't-1', userId: 'u-1', day: '2026-10-13' }
    await repo.todayMarks.set({ ...input, kind: 'pin' })
    await repo.todayMarks.set({ ...input, kind: 'remove' })
    expect(await db.today_marks.toArray()).toMatchObject([
      { id: 't-1', kind: 'remove' },
    ])
  })

  it('a 4xx on set throws and enqueues nothing', async () => {
    respond(null, { status: 403, message: 'rls' })
    await expect(
      repo.todayMarks.set({
        taskId: 't-1',
        userId: 'u-1',
        day: '2026-10-13',
        kind: 'pin',
      }),
    ).rejects.toMatchObject({ status: 403 })
    expect(await db.outbox.count()).toBe(0)
  })
})

describe('repo.todayMarks — offline', () => {
  beforeEach(() => {
    isOnlineMock.mockReturnValue(false)
    // Queued ops replay only for the user who queued them (chunk 84).
    setOutboxUser('u-1')
  })

  it('set applies to the cache and enqueues one insert outbox row', async () => {
    const out = await repo.todayMarks.set({
      taskId: 't-1',
      userId: 'u-1',
      day: '2026-10-13',
      kind: 'remove',
    })

    expect(fromMock).not.toHaveBeenCalled()
    expect(out).toMatchObject({ id: 't-1', kind: 'remove' })
    expect(await db.today_marks.get('t-1')).toMatchObject({ kind: 'remove' })
    const rows = await db.outbox.toArray()
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ op: 'insert', table: 'today_marks' })
    expect(rows[0].payload).toMatchObject({
      id: 't-1',
      userId: 'u-1',
      day: '2026-10-13',
      kind: 'remove',
    })
    expect(useSyncStore.getState().state).toBe('offline')
  })

  it('list falls back to the cache', async () => {
    await db.today_marks.put(todayMarkFromRow(aRow()))
    const out = await repo.todayMarks.list()
    expect(out.map((m) => m.id)).toEqual(['t-1'])
  })

  it('the outbox replay upserts on id, so a queued toggle cannot duplicate', async () => {
    const input = { taskId: 't-1', userId: 'u-1', day: '2026-10-13' }
    await repo.todayMarks.set({ ...input, kind: 'pin' })
    await repo.todayMarks.set({ ...input, kind: 'remove' })

    isOnlineMock.mockReturnValue(true)
    respond(aRow())
    respond(aRow({ kind: 'remove', updated_at: '2099-01-01T00:00:00+00:00' }))

    const res = await drainOutbox()

    expect(res).toMatchObject({ processed: 2, remaining: 0 })
    expect(fromMock.mock.calls.map((c) => c[0])).toEqual([
      'today_marks',
      'today_marks',
    ])
    const upserts = chainCalls.filter((c) => c.method === 'upsert')
    expect(upserts).toHaveLength(2)
    for (const u of upserts) expect(u.args[1]).toEqual({ onConflict: 'id' })
    expect(upserts[0].args[0]).toMatchObject({
      id: 't-1',
      user_id: 'u-1',
      kind: 'pin',
    })
    expect(upserts[0].args[0]).not.toHaveProperty('userId')
    expect(call('insert')).toBeUndefined()
    expect(await db.today_marks.get('t-1')).toMatchObject({
      kind: 'remove',
      updatedAt: '2099-01-01T00:00:00+00:00',
    })
    expect(await db.outbox.count()).toBe(0)
  })
})

describe('realtime — today_marks', () => {
  it('binds one today_marks handler that puts and deletes in Dexie', async () => {
    bindings.clear()
    startRealtime('u-1')
    const handler = bindings.get('today_marks')
    expect(handler).toBeDefined()
    // Ten user-scoped tables plus routing_proposals (chunk 89) on the one channel.
    expect(bindings.size).toBe(11)

    await handler!({ eventType: 'INSERT', new: aRow(), old: {} })
    expect(await db.today_marks.get('t-1')).toMatchObject({ kind: 'pin' })

    await handler!({
      eventType: 'UPDATE',
      new: aRow({ kind: 'remove' }),
      old: aRow(),
    })
    expect(await db.today_marks.get('t-1')).toMatchObject({ kind: 'remove' })

    // The task cascade arrives as a DELETE on the mark.
    await handler!({ eventType: 'DELETE', new: {}, old: aRow() })
    expect(await db.today_marks.get('t-1')).toBeUndefined()

    stopRealtime()
  })
})
