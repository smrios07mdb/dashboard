import Dexie from 'dexie'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/*
 * Chunk 58 — the `notes` table through every data-layer touchpoint: mappers,
 * Dexie v6, the repo's online and offline paths, outbox replay, the realtime
 * handler and the local-cache wipe.
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
import { noteFromRow, noteToRow, type NoteRow } from './mappers'
import { countOutboxFor, drainOutbox } from './outbox'
import { startRealtime, stopRealtime } from './realtime'
import { repo } from './repo'
import { useSyncStore } from './syncStore'
import { TABLES, type Note } from './types'

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

function aRow(over: Partial<NoteRow> = {}): NoteRow {
  return {
    id: 'n-1',
    user_id: 'u-1',
    title: 'Kickoff',
    body: '# Agenda\n- one',
    pinned: false,
    task_id: null,
    subcategory_id: null,
    detached_label: null,
    detached_at: null,
    created_at: '2026-10-01T00:00:00.000Z',
    updated_at: '2026-10-02T00:00:00.000Z',
    ...over,
  }
}

beforeEach(async () => {
  fromMock.mockReset()
  isOnlineMock.mockReset()
  isOnlineMock.mockReturnValue(true)
  chainCalls.length = 0
  useSyncStore.setState({ state: 'synced', lastSyncAt: null })
  await db.notes.clear()
  await db.tasks.clear()
  await db.outbox.clear()
})

describe('note mappers', () => {
  it('round-trips a row, nulls preserved', () => {
    const row = aRow()
    const note = noteFromRow(row)
    expect(note).toEqual({
      id: 'n-1',
      userId: 'u-1',
      title: 'Kickoff',
      body: '# Agenda\n- one',
      pinned: false,
      taskId: null,
      subcategoryId: null,
      detachedLabel: null,
      detachedAt: null,
      createdAt: '2026-10-01T00:00:00.000Z',
      updatedAt: '2026-10-02T00:00:00.000Z',
    })
    expect(noteToRow(note)).toEqual(row)
  })

  it('round-trips an attached and a detached row', () => {
    const attached = aRow({ task_id: 't-1', pinned: true, title: '' })
    expect(noteToRow(noteFromRow(attached))).toEqual(attached)
    const detached = aRow({
      detached_label: 'Q3 planning',
      detached_at: '2026-10-09T00:00:00.000Z',
    })
    expect(noteToRow(noteFromRow(detached))).toEqual(detached)
  })

  it('toRow emits only the keys it was given — an explicit null is a key', () => {
    expect(noteToRow({ title: 'x' })).toEqual({ title: 'x' })
    expect(noteToRow({ taskId: null, detachedLabel: null })).toEqual({
      task_id: null,
      detached_label: null,
    })
  })
})

describe('Dexie v6 (chunk 58)', () => {
  it('opens over a populated v5 DB with the existing stores intact', async () => {
    const NAME = 'dexie-v6-test'
    await Dexie.delete(NAME)
    const v5 = {
      tasks: '&id, subcategoryId, completedAt, dueAt, remindAt, priority, updatedAt',
      outbox: '++id, createdAt, table, attempts',
      scheduled_blocks: '&id, taskId, startAt, endAt',
    }

    const oldDb = new Dexie(NAME)
    oldDb.version(5).stores(v5)
    await oldDb.open()
    await oldDb.table('tasks').add({ id: 't-keep', title: 'kept' })
    await oldDb
      .table('scheduled_blocks')
      .add({ id: 'b-keep', taskId: 't-keep', startAt: 'x', endAt: 'y' })
    await oldDb.table('outbox').add({ op: 'insert', table: 'tasks', attempts: 0 })
    oldDb.close()

    const newDb = new Dexie(NAME)
    newDb.version(5).stores(v5)
    newDb.version(6).stores({
      notes: '&id, taskId, subcategoryId, pinned, updatedAt',
    })
    await newDb.open()

    expect(newDb.verno).toBe(6)
    expect(newDb.tables.map((t) => t.name).sort()).toEqual(
      ['notes', 'outbox', 'scheduled_blocks', 'tasks'].sort(),
    )
    expect(await newDb.table('tasks').get('t-keep')).toMatchObject({
      title: 'kept',
    })
    expect(await newDb.table('scheduled_blocks').get('b-keep')).toBeDefined()
    expect(await newDb.table('outbox').count()).toBe(1)
    // taskId is a plain (non-unique) index — a task may hold many notes.
    await newDb.table('notes').bulkAdd([
      { id: 'a', taskId: 't-keep', subcategoryId: null, pinned: false },
      { id: 'b', taskId: 't-keep', subcategoryId: null, pinned: true },
    ])
    expect(
      await newDb.table('notes').where('taskId').equals('t-keep').count(),
    ).toBe(2)

    newDb.close()
    await Dexie.delete(NAME)
  })

  it('the real DashboardCacheDB carries the notes store with the D4 indexes', () => {
    expect(db.verno).toBe(6)
    expect(db.notes.schema.primKey.name).toBe('id')
    expect(db.notes.schema.indexes.map((i) => i.name).sort()).toEqual(
      ['pinned', 'subcategoryId', 'taskId', 'updatedAt'].sort(),
    )
  })

  it('wipeLocalCache clears notes and leaves the outbox', async () => {
    await db.notes.put(noteFromRow(aRow()))
    await db.outbox.add({
      op: 'insert',
      table: 'notes',
      payload: { id: 'n-1' },
      createdAt: 'x',
      attempts: 0,
      lastError: null,
      lastAttemptAt: null,
    })
    await wipeLocalCache()
    expect(await db.notes.count()).toBe(0)
    expect(await db.outbox.count()).toBe(1)
  })
})

describe('repo.notes — online', () => {
  it('listAll replaces the Dexie mirror with what the server returned', async () => {
    await db.notes.put(noteFromRow(aRow({ id: 'n-stale' })))
    respond([aRow(), aRow({ id: 'n-2', title: '' })])

    const out = await repo.notes.listAll()

    expect(fromMock).toHaveBeenCalledWith('notes')
    expect(out.map((n) => n.id)).toEqual(['n-1', 'n-2'])
    expect((await db.notes.toArray()).map((n) => n.id).sort()).toEqual([
      'n-1',
      'n-2',
    ])
  })

  it('create uses a client id, returns the server echo and mirrors it', async () => {
    respond(aRow({ updated_at: '2099-01-01T00:00:00.000Z' }))

    const out = await repo.notes.create({
      userId: 'u-1',
      id: 'n-1',
      title: 'Kickoff',
      body: '# Agenda\n- one',
    })

    expect(call('insert')?.args[0]).toMatchObject({
      id: 'n-1',
      user_id: 'u-1',
      title: 'Kickoff',
      pinned: false,
      task_id: null,
      subcategory_id: null,
    })
    expect(out.updatedAt).toBe('2099-01-01T00:00:00.000Z')
    expect((await db.notes.get('n-1'))?.updatedAt).toBe(
      '2099-01-01T00:00:00.000Z',
    )
    expect(await db.outbox.count()).toBe(0)

    respond(aRow({ id: 'generated' }))
    await repo.notes.create({ userId: 'u-1', body: 'x' })
    const generated = chainCalls.filter((c) => c.method === 'insert').at(-1)
    expect((generated?.args[0] as { id: string }).id).toMatch(/^[0-9a-f-]{36}$/)
  })

  it('update sends only the changed columns, keyed by id', async () => {
    await db.notes.put(noteFromRow(aRow({ task_id: 't-1' })))
    respond(aRow({ pinned: true, task_id: null, subcategory_id: 's-1' }))

    const out = await repo.notes.update('n-1', {
      pinned: true,
      taskId: null,
      subcategoryId: 's-1',
      detachedLabel: null,
      detachedAt: null,
    })

    const sent = call('update')?.args[0] as Record<string, unknown>
    expect(Object.keys(sent).sort()).toEqual(
      [
        'detached_at',
        'detached_label',
        'pinned',
        'subcategory_id',
        'task_id',
        'updated_at',
      ].sort(),
    )
    expect(call('eq')?.args).toEqual(['id', 'n-1'])
    expect(out).toMatchObject({ pinned: true, subcategoryId: 's-1' })
    expect(await db.notes.get('n-1')).toMatchObject({ subcategoryId: 's-1' })
    expect(await db.outbox.count()).toBe(0)
  })

  it('delete removes the row from Supabase and from the cache', async () => {
    await db.notes.put(noteFromRow(aRow()))
    respond(null)

    await repo.notes.delete('n-1')

    expect(call('delete')).toBeDefined()
    expect(call('eq')?.args).toEqual(['id', 'n-1'])
    expect(await db.notes.get('n-1')).toBeUndefined()
    expect(await db.outbox.count()).toBe(0)
  })

  it('a 4xx on create throws and enqueues nothing', async () => {
    respond(null, { message: 'violates row-level security', status: 403 })
    await expect(
      repo.notes.create({ userId: 'u-1', id: 'n-1', taskId: 'not-mine' }),
    ).rejects.toThrow(/row-level security/)
    expect(await db.outbox.count()).toBe(0)
  })
})

describe('repo.notes — offline', () => {
  beforeEach(() => isOnlineMock.mockReturnValue(false))

  it('each op applies to the cache and enqueues exactly one outbox row', async () => {
    const created = await repo.notes.create({
      userId: 'u-1',
      id: 'n-1',
      title: 'Offline',
    })
    expect(fromMock).not.toHaveBeenCalled()
    expect(await db.notes.get('n-1')).toMatchObject({ title: 'Offline' })
    expect(await db.outbox.count()).toBe(1)

    await repo.notes.update('n-1', { body: 'typed on the train' })
    expect(await db.notes.get('n-1')).toMatchObject({
      title: 'Offline',
      body: 'typed on the train',
    })
    expect(await db.outbox.count()).toBe(2)
    expect(await countOutboxFor(TABLES.notes, 'n-1')).toBe(2)
    expect(await countOutboxFor(TABLES.notes, 'someone-else')).toBe(0)

    await repo.notes.delete('n-1')
    expect(await db.notes.get('n-1')).toBeUndefined()

    const rows = await db.outbox.orderBy('id').toArray()
    expect(rows.map((r) => [r.op, r.table])).toEqual([
      ['insert', 'notes'],
      ['update', 'notes'],
      ['delete', 'notes'],
    ])
    expect(rows[0].payload).toMatchObject({ id: created.id, title: 'Offline' })
    expect(useSyncStore.getState().state).toBe('offline')
  })

  it('listAll falls back to the cache, newest first', async () => {
    await db.notes.bulkPut([
      noteFromRow(aRow({ id: 'old', updated_at: '2026-10-01T00:00:00.000Z' })),
      noteFromRow(aRow({ id: 'new', updated_at: '2026-10-05T00:00:00.000Z' })),
    ])
    const out = await repo.notes.listAll()
    expect(out.map((n) => n.id)).toEqual(['new', 'old'])
  })

  it('the outbox replay writes the queued note ops to `notes`', async () => {
    await repo.notes.create({ userId: 'u-1', id: 'n-1', title: 'Offline' })
    await repo.notes.update('n-1', { body: 'later' })
    await repo.notes.create({ userId: 'u-1', id: 'n-2', title: 'Gone' })
    await repo.notes.delete('n-2')

    isOnlineMock.mockReturnValue(true)
    respond(aRow({ title: 'Offline', body: '' }))
    respond(
      aRow({
        title: 'Offline',
        body: 'later',
        updated_at: '2099-01-01T00:00:00.000Z',
      }),
    )
    respond(aRow({ id: 'n-2', title: 'Gone' }))
    respond(null)

    const res = await drainOutbox()

    expect(res).toMatchObject({ processed: 4, remaining: 0 })
    expect(fromMock.mock.calls.map((c) => c[0])).toEqual([
      'notes',
      'notes',
      'notes',
      'notes',
    ])
    const insert = call('insert')?.args[0] as Record<string, unknown>
    expect(insert).toMatchObject({ id: 'n-1', user_id: 'u-1', title: 'Offline' })
    expect(insert).not.toHaveProperty('userId')
    expect(await db.notes.get('n-1')).toMatchObject({
      body: 'later',
      updatedAt: '2099-01-01T00:00:00.000Z',
    })
    expect(await db.notes.get('n-2')).toBeUndefined()
    expect(await db.outbox.count()).toBe(0)
  })
})

describe('realtime — notes', () => {
  it('binds one notes handler that puts and deletes in Dexie', async () => {
    bindings.clear()
    startRealtime('u-1')
    const handler = bindings.get('notes')
    expect(handler).toBeDefined()
    // Nine user-scoped tables on the one channel.
    expect(bindings.size).toBe(9)

    await handler!({ eventType: 'INSERT', new: aRow(), old: {} })
    expect(await db.notes.get('n-1')).toMatchObject({ title: 'Kickoff' })

    await handler!({
      eventType: 'UPDATE',
      new: aRow({
        task_id: null,
        detached_label: 'Smoke task',
        detached_at: '2026-10-09T00:00:00.000Z',
      }),
      old: aRow({ task_id: 't-1' }),
    })
    expect(await db.notes.get('n-1')).toMatchObject<Partial<Note>>({
      taskId: null,
      detachedLabel: 'Smoke task',
    })

    await handler!({ eventType: 'DELETE', new: {}, old: aRow() })
    expect(await db.notes.get('n-1')).toBeUndefined()

    stopRealtime()
  })
})
