import Dexie from 'dexie'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/*
 * Chunk 99 — the `block_groups` table through every data-layer touchpoint:
 * mappers, Dexie v9, the repo's online and offline paths, outbox replay, the
 * realtime handler and the local-cache wipe (the `today_marks` shape).
 */

const { fromMock, channelMock, removeChannelMock, isOnlineMock, bindings } =
  vi.hoisted(() => {
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
  blockGroupFromRow,
  blockGroupToRow,
  type BlockGroupRow,
} from './mappers'
import { drainOutbox } from './outbox'
import { startRealtime, stopRealtime } from './realtime'
import { repo, setOutboxUser } from './repo'
import { useSyncStore } from './syncStore'
import { TABLES } from './types'

type SupabaseResult = { data: unknown; error: unknown }

const chainCalls: { method: string; args: unknown[] }[] = []

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

const ID = 'g-1'

function aRow(over: Partial<BlockGroupRow> = {}): BlockGroupRow {
  return {
    id: ID,
    user_id: 'u-1',
    name: 'Social',
    domains: ['x.com', 'reddit.com'],
    enabled: true,
    block_in_focus: true,
    block_on_schedule: false,
    schedule_days: [1, 2, 3, 4, 5],
    schedule_from: '09:00:00',
    schedule_to: '17:30:00',
    daily_limit_on: false,
    daily_limit_minutes: 30,
    sort_order: 0,
    created_at: '2026-11-11T14:00:00+00:00',
    updated_at: '2026-11-11T14:00:00+00:00',
    ...over,
  }
}

beforeEach(async () => {
  fromMock.mockReset()
  isOnlineMock.mockReset()
  isOnlineMock.mockReturnValue(true)
  chainCalls.length = 0
  useSyncStore.setState({ state: 'synced', lastSyncAt: null })
  await db.block_groups.clear()
  await db.outbox.clear()
})

describe('block group mappers', () => {
  it('round-trips a row, trimming HH:MM:SS to HH:MM', () => {
    const g = blockGroupFromRow(aRow())
    expect(g).toEqual({
      id: ID,
      userId: 'u-1',
      name: 'Social',
      domains: ['x.com', 'reddit.com'],
      enabled: true,
      blockInFocus: true,
      blockOnSchedule: false,
      scheduleDays: [1, 2, 3, 4, 5],
      scheduleFrom: '09:00',
      scheduleTo: '17:30',
      dailyLimitOn: false,
      dailyLimitMinutes: 30,
      sortOrder: 0,
      createdAt: '2026-11-11T14:00:00+00:00',
      updatedAt: '2026-11-11T14:00:00+00:00',
    })
    expect(blockGroupToRow(g)).toEqual(
      aRow({ schedule_from: '09:00', schedule_to: '17:30' }),
    )
    expect(blockGroupFromRow(blockGroupToRow(g) as BlockGroupRow)).toEqual(g)
  })

  it('round-trips the daily allowance (chunk 100)', () => {
    const row = aRow({ daily_limit_on: true, daily_limit_minutes: 45 })
    const g = blockGroupFromRow(row)
    expect(g).toMatchObject({ dailyLimitOn: true, dailyLimitMinutes: 45 })
    expect(blockGroupToRow(g)).toMatchObject({
      daily_limit_on: true,
      daily_limit_minutes: 45,
    })
    expect(blockGroupFromRow(blockGroupToRow(g) as BlockGroupRow)).toEqual(g)
    expect(
      blockGroupToRow({ dailyLimitOn: false, dailyLimitMinutes: 1440 }),
    ).toEqual({ daily_limit_on: false, daily_limit_minutes: 1440 })
  })

  it('a row read before migration 24 has no allowance', () => {
    const old = aRow()
    delete old.daily_limit_on
    delete old.daily_limit_minutes
    expect(blockGroupFromRow(old)).toMatchObject({
      dailyLimitOn: false,
      dailyLimitMinutes: 30,
    })
  })

  it('toRow emits only the keys it was given', () => {
    expect(blockGroupToRow({ enabled: false })).toEqual({ enabled: false })
    expect(blockGroupToRow({})).toEqual({})
  })

  it('the table is registered as block_groups', () => {
    expect(TABLES.blockGroups).toBe('block_groups')
  })
})

describe('Dexie v9 (chunk 99)', () => {
  it('opens over a populated v8 DB with the data kept', async () => {
    const NAME = 'dexie-v9-test'
    await Dexie.delete(NAME)
    const v8 = {
      tasks: '&id, subcategoryId, completedAt, dueAt, remindAt, priority, updatedAt',
      outbox: '++id, createdAt, table, attempts',
      notes: '&id, taskId, subcategoryId, pinned, updatedAt',
      today_marks: '&id, day',
      tracked_sessions: '&id, startedAt, kind',
    }
    const oldDb = new Dexie(NAME)
    oldDb.version(8).stores(v8)
    await oldDb.open()
    await oldDb.table('tasks').add({ id: 't-keep', title: 'kept' })
    await oldDb.table('tracked_sessions').add({ id: 's-keep', kind: 'focus' })
    await oldDb.table('outbox').add({ op: 'insert', table: 'tasks', attempts: 0 })
    oldDb.close()

    const newDb = new Dexie(NAME)
    newDb.version(8).stores(v8)
    newDb.version(9).stores({ block_groups: '&id, sortOrder' })
    await newDb.open()

    expect(newDb.verno).toBe(9)
    expect(newDb.tables.map((t) => t.name).sort()).toEqual(
      [
        'block_groups',
        'notes',
        'outbox',
        'tasks',
        'today_marks',
        'tracked_sessions',
      ].sort(),
    )
    expect(await newDb.table('tasks').get('t-keep')).toMatchObject({ title: 'kept' })
    expect(await newDb.table('tracked_sessions').get('s-keep')).toBeDefined()
    expect(await newDb.table('outbox').count()).toBe(1)
    newDb.close()
    await Dexie.delete(NAME)
  })

  it('the real DashboardCacheDB is at v9 with the block_groups store', () => {
    expect(db.verno).toBe(9)
    expect(db.block_groups.schema.primKey.name).toBe('id')
    expect(db.block_groups.schema.indexes.map((i) => i.name)).toEqual(['sortOrder'])
  })

  it('wipeLocalCache clears block_groups and leaves the outbox', async () => {
    await db.block_groups.put(blockGroupFromRow(aRow()))
    await db.outbox.add({
      op: 'insert',
      table: 'block_groups',
      payload: { id: ID },
      createdAt: 'x',
      attempts: 0,
      lastError: null,
      lastAttemptAt: null,
    })
    await wipeLocalCache()
    expect(await db.block_groups.count()).toBe(0)
    expect(await db.outbox.count()).toBe(1)
  })
})

describe('repo.blockGroups — online', () => {
  it('create inserts and mirrors the server row', async () => {
    respond(aRow({ name: 'New group', domains: [] }))
    const out = await repo.blockGroups.create({
      userId: 'u-1',
      name: 'New group',
      domains: [],
      blockInFocus: true,
      id: ID,
    })
    expect(fromMock).toHaveBeenCalledWith('block_groups')
    expect(call('insert')?.args[0]).toMatchObject({
      id: ID,
      user_id: 'u-1',
      name: 'New group',
      domains: [],
      enabled: true,
      block_in_focus: true,
      block_on_schedule: false,
      schedule_days: [1, 2, 3, 4, 5],
      schedule_from: '09:00',
      schedule_to: '17:00',
    })
    expect(out.scheduleTo).toBe('17:30')
    expect(await db.block_groups.get(ID)).toMatchObject({ name: 'New group' })
    expect(await db.outbox.count()).toBe(0)
  })

  it('update sends only the change (and updated_at)', async () => {
    await db.block_groups.put(blockGroupFromRow(aRow()))
    respond(aRow({ enabled: false }))
    const out = await repo.blockGroups.update(ID, { enabled: false })
    const payload = call('update')?.args[0] as Record<string, unknown>
    expect(Object.keys(payload).sort()).toEqual(['enabled', 'updated_at'])
    expect(payload.enabled).toBe(false)
    expect(call('eq')?.args).toEqual(['id', ID])
    expect(out.enabled).toBe(false)
    expect(await db.block_groups.get(ID)).toMatchObject({ enabled: false })
  })

  it('create sends no allowance by default; update sends the two fields (chunk 100)', async () => {
    respond(aRow())
    await repo.blockGroups.create({ userId: 'u-1', id: ID })
    expect(call('insert')?.args[0]).toMatchObject({
      daily_limit_on: false,
      daily_limit_minutes: 30,
    })
    chainCalls.length = 0
    respond(aRow({ daily_limit_on: true, daily_limit_minutes: 45 }))
    const out = await repo.blockGroups.update(ID, {
      dailyLimitOn: true,
      dailyLimitMinutes: 45,
    })
    const payload = call('update')?.args[0] as Record<string, unknown>
    expect(Object.keys(payload).sort()).toEqual([
      'daily_limit_minutes',
      'daily_limit_on',
      'updated_at',
    ])
    expect(payload).toMatchObject({ daily_limit_on: true, daily_limit_minutes: 45 })
    expect(out).toMatchObject({ dailyLimitOn: true, dailyLimitMinutes: 45 })
    expect(await db.block_groups.get(ID)).toMatchObject({
      dailyLimitOn: true,
      dailyLimitMinutes: 45,
    })
  })

  it('delete removes the row', async () => {
    await db.block_groups.put(blockGroupFromRow(aRow()))
    respond(null)
    await repo.blockGroups.delete(ID)
    expect(call('delete')).toBeDefined()
    expect(await db.block_groups.count()).toBe(0)
    expect(await db.outbox.count()).toBe(0)
  })

  it('list orders by sort_order then created_at and replaces the mirror', async () => {
    await db.block_groups.put(blockGroupFromRow(aRow({ id: 'gone' })))
    respond([
      aRow({ id: 'b', sort_order: 1, created_at: '2026-11-01T00:00:00Z' }),
      aRow({ id: 'c', sort_order: 0, created_at: '2026-11-02T00:00:00Z' }),
      aRow({ id: 'a', sort_order: 0, created_at: '2026-11-01T00:00:00Z' }),
    ])
    const out = await repo.blockGroups.list()
    expect(out.map((g) => g.id)).toEqual(['a', 'c', 'b'])
    const orders = chainCalls.filter((c) => c.method === 'order').map((c) => c.args[0])
    expect(orders).toEqual(['sort_order', 'created_at'])
    expect((await db.block_groups.toArray()).map((g) => g.id).sort()).toEqual([
      'a',
      'b',
      'c',
    ])
  })
})

describe('repo.blockGroups — offline', () => {
  beforeEach(() => {
    isOnlineMock.mockReturnValue(false)
    setOutboxUser('u-1')
  })

  it('create, update and delete go to the cache and the outbox', async () => {
    const created = await repo.blockGroups.create({ userId: 'u-1', id: ID })
    expect(fromMock).not.toHaveBeenCalled()
    expect(created).toMatchObject({ name: 'New group', blockInFocus: true })
    await repo.blockGroups.update(ID, { domains: ['x.com'] })
    expect(await db.block_groups.get(ID)).toMatchObject({ domains: ['x.com'] })
    await repo.blockGroups.delete(ID)
    expect(await db.block_groups.count()).toBe(0)
    const rows = await db.outbox.toArray()
    expect(rows.map((r) => [r.op, r.table])).toEqual([
      ['insert', 'block_groups'],
      ['update', 'block_groups'],
      ['delete', 'block_groups'],
    ])
    expect(useSyncStore.getState().state).toBe('offline')
  })

  it('the replay sends snake_case rows', async () => {
    await repo.blockGroups.create({ userId: 'u-1', id: ID, domains: ['x.com'] })
    isOnlineMock.mockReturnValue(true)
    respond(aRow({ domains: ['x.com'] }))
    const res = await drainOutbox()
    expect(res).toMatchObject({ processed: 1, remaining: 0 })
    expect(fromMock).toHaveBeenCalledWith('block_groups')
    const ins = chainCalls.find((c) => c.method === 'insert' || c.method === 'upsert')
    expect(ins?.args[0]).toMatchObject({
      id: ID,
      user_id: 'u-1',
      domains: ['x.com'],
      block_in_focus: true,
    })
    expect(ins?.args[0]).not.toHaveProperty('userId')
    expect(await db.block_groups.get(ID)).toMatchObject({ scheduleTo: '17:30' })
  })

  it('an allowance update goes through the outbox (chunk 100)', async () => {
    await db.block_groups.put(blockGroupFromRow(aRow()))
    const out = await repo.blockGroups.update(ID, {
      dailyLimitOn: true,
      dailyLimitMinutes: 20,
    })
    expect(fromMock).not.toHaveBeenCalled()
    expect(out).toMatchObject({ dailyLimitOn: true, dailyLimitMinutes: 20 })
    expect(await db.block_groups.get(ID)).toMatchObject({
      dailyLimitOn: true,
      dailyLimitMinutes: 20,
    })
    isOnlineMock.mockReturnValue(true)
    respond(aRow({ daily_limit_on: true, daily_limit_minutes: 20 }))
    const res = await drainOutbox()
    expect(res).toMatchObject({ processed: 1, remaining: 0 })
    const sent = call('update')?.args[0] as Record<string, unknown>
    expect(sent).toMatchObject({ daily_limit_on: true, daily_limit_minutes: 20 })
    expect(sent).not.toHaveProperty('dailyLimitOn')
    expect(await db.block_groups.get(ID)).toMatchObject({
      dailyLimitOn: true,
      dailyLimitMinutes: 20,
    })
  })

  it('list falls back to the mirror, in order', async () => {
    await db.block_groups.bulkPut([
      blockGroupFromRow(aRow({ id: 'z', sort_order: 2 })),
      blockGroupFromRow(aRow({ id: 'y', sort_order: 1 })),
    ])
    expect((await repo.blockGroups.list()).map((g) => g.id)).toEqual(['y', 'z'])
    expect(fromMock).not.toHaveBeenCalled()
  })
})

describe('realtime — block_groups', () => {
  it('binds one block_groups handler that puts and deletes in Dexie', async () => {
    bindings.clear()
    startRealtime('u-1')
    const handler = bindings.get('block_groups')
    expect(handler).toBeDefined()
    await handler!({ eventType: 'INSERT', new: aRow(), old: {} })
    expect(await db.block_groups.get(ID)).toMatchObject({ scheduleFrom: '09:00' })
    await handler!({ eventType: 'UPDATE', new: aRow({ name: 'News' }), old: aRow() })
    expect(await db.block_groups.get(ID)).toMatchObject({ name: 'News' })
    await handler!({ eventType: 'DELETE', new: {}, old: aRow() })
    expect(await db.block_groups.get(ID)).toBeUndefined()
    stopRealtime()
  })
})
