import Dexie from 'dexie'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Hoisted mocks — must exist before the outbox module (and its transitive
// `@/lib/supabase` / `@/lib/network` imports) are evaluated. Mirrors the
// pattern established in repo.test.ts.
const { fromMock, isOnlineMock } = vi.hoisted(() => ({
  fromMock: vi.fn(),
  isOnlineMock: vi.fn(() => true),
}))

vi.mock('@/lib/supabase', () => ({
  supabase: { from: fromMock },
}))

vi.mock('@/lib/network', () => ({
  isOnline: isOnlineMock,
}))

import { db, upgradeToV3 } from './dexie'
import { taskFromRow, type TaskRow } from './mappers'
import {
  discardAllFailed,
  discardOutboxRow,
  drainOutbox,
  getSyncIssues,
  retryAllFailed,
  retryOutboxRow,
} from './outbox'
import { repo } from './repo'
import { useSyncStore } from './syncStore'
import type { OutboxRow } from './types'

// ---------- supabase chain mock (copied shape from repo.test.ts) ----------

type SupabaseResult<T> = { data: T | null; error: unknown }

const chainCalls: { method: string; args: unknown[] }[] = []

function makeChain<T>(result: SupabaseResult<T>) {
  const chain = new Proxy(
    {},
    {
      get(_t, prop) {
        if (prop === 'then') {
          return (
            onfulfilled: (v: unknown) => unknown,
            onrejected?: (e: unknown) => unknown,
          ) => Promise.resolve(result).then(onfulfilled, onrejected)
        }
        if (prop === 'catch' || prop === 'finally') {
          return (cb: (v: unknown) => unknown) =>
            Promise.resolve(result)[prop as 'catch' | 'finally'](cb as never)
        }
        if (typeof prop !== 'string') return undefined
        return (...args: unknown[]) => {
          chainCalls.push({ method: prop, args })
          return chain
        }
      },
    },
  )
  return chain as unknown as PromiseLike<SupabaseResult<T>>
}

/** Queue one chain result per expected `supabase.from()` call, in order. */
function queueResults(...results: SupabaseResult<unknown>[]) {
  for (const r of results) fromMock.mockReturnValueOnce(makeChain(r))
}

function aTaskRow(overrides: Partial<TaskRow> = {}): TaskRow {
  return {
    id: 't-x',
    user_id: 'u-1',
    subcategory_id: 'sub-1',
    title: 'Task',
    notes: null,
    estimate_minutes: 0,
    due_at: null,
    remind_at: null,
    notified: false,
    priority: null,
    completed_at: null,
    created_at: '2026-05-23T00:00:00.000Z',
    updated_at: '2026-05-23T00:00:00.000Z',
    ...overrides,
  }
}

/** Insert an outbox row directly, returning its generated id. */
async function enqueue(row: Omit<OutboxRow, 'id'>): Promise<number> {
  return (await db.outbox.add(row as OutboxRow)) as number
}

async function clearDb() {
  await db.transaction(
    'rw',
    [db.tasks, db.subcategories, db.settings, db.push_subscriptions, db.outbox],
    async () => {
      await db.tasks.clear()
      await db.subcategories.clear()
      await db.settings.clear()
      await db.push_subscriptions.clear()
      await db.outbox.clear()
    },
  )
}

beforeEach(async () => {
  fromMock.mockReset()
  isOnlineMock.mockReset()
  isOnlineMock.mockReturnValue(true)
  chainCalls.length = 0
  useSyncStore.setState({ state: 'synced', lastSyncAt: null })
  await clearDb()
})

afterEach(() => {
  vi.useRealTimers()
})

// ============================================================
// Group A — enqueue contract, empty drain, Dexie v3 migration
// ============================================================

describe('chunk-5 enqueue contract', () => {
  it('an offline create enqueues an outbox row carrying lastAttemptAt: null', async () => {
    isOnlineMock.mockReturnValue(false)

    await repo.tasks.create({
      id: 't1',
      userId: 'u1',
      subcategoryId: 's1',
      title: 'x',
      notes: null,
      estimateMinutes: 0,
      dueAt: null,
      remindAt: null,
      priority: null,
      completedAt: null,
    })

    const rows = await db.outbox.toArray()
    expect(rows).toHaveLength(1)
    expect(rows[0].lastAttemptAt).toBeNull()
  })
})

describe('drainOutbox — empty outbox', () => {
  it('sets synced + lastSyncAt and returns zeros', async () => {
    const result = await drainOutbox()
    expect(result).toEqual({ processed: 0, failed: 0, remaining: 0 })
    expect(useSyncStore.getState().state).toBe('synced')
    expect(useSyncStore.getState().lastSyncAt).not.toBeNull()
  })
})

describe('Dexie v3 migration', () => {
  it('backfills lastAttemptAt=null and preserves queued rows + payloads', async () => {
    const NAME = 'outbox-migration-test'
    await Dexie.delete(NAME)

    // Populate a DB at the pre-chunk-15 (v2) schema: outbox rows have no
    // lastAttemptAt field at all.
    const oldDb = new Dexie(NAME)
    oldDb.version(2).stores({ outbox: '++id, createdAt, table, attempts' })
    await oldDb.open()
    await oldDb.table('outbox').add({
      op: 'insert',
      table: 'tasks',
      payload: { id: 'queued-before-upgrade' },
      createdAt: '2026-01-01T00:00:00.000Z',
      attempts: 2,
      lastError: 'boom',
    })
    oldDb.close()

    // Re-open with the v3 upgrade applied.
    const newDb = new Dexie(NAME)
    newDb.version(2).stores({ outbox: '++id, createdAt, table, attempts' })
    newDb
      .version(3)
      .stores({ outbox: '++id, createdAt, table, attempts' })
      .upgrade(upgradeToV3)
    await newDb.open()

    const rows = await newDb.table('outbox').toArray()
    expect(rows).toHaveLength(1)
    expect(rows[0].lastAttemptAt).toBeNull()
    // Pre-existing fields survive untouched.
    expect(rows[0].attempts).toBe(2)
    expect(rows[0].lastError).toBe('boom')
    expect(rows[0].payload).toEqual({ id: 'queued-before-upgrade' })

    newDb.close()
    await Dexie.delete(NAME)
  })
})

// ============================================================
// Group B — FIFO replay + per-op cache reconciliation
// ============================================================

function aTask(overrides: Record<string, unknown> = {}) {
  return {
    id: 't-1',
    userId: 'u-1',
    subcategoryId: 'sub-1',
    title: 'Task',
    notes: null,
    estimateMinutes: 0,
    dueAt: null,
    remindAt: null,
    notified: false,
    priority: null,
    completedAt: null,
    createdAt: '2026-05-23T00:00:00.000Z',
    updatedAt: '2026-05-23T00:00:00.000Z',
    ...overrides,
  }
}

const fromTables = () => fromMock.mock.calls.map((c) => c[0])

describe('drainOutbox — FIFO replay', () => {
  it('replays the 3 airplane-mode mutations in createdAt order, empties the outbox, → synced', async () => {
    // Enqueued out of insertion order to prove createdAt (not ++id) drives FIFO.
    await enqueue({
      op: 'update',
      table: 'tasks',
      payload: aTask({ id: 't-1', title: 'edited' }),
      createdAt: '2026-05-23T00:00:03.000Z',
      attempts: 0,
      lastError: null,
      lastAttemptAt: null,
    })
    await enqueue({
      op: 'insert',
      table: 'subcategories',
      payload: {
        id: 'sub-1',
        userId: 'u-1',
        categoryId: 'c-1',
        name: 'Inbox',
        sortOrder: 0,
        archivedAt: null,
      },
      createdAt: '2026-05-23T00:00:01.000Z',
      attempts: 0,
      lastError: null,
      lastAttemptAt: null,
    })
    await enqueue({
      op: 'insert',
      table: 'tasks',
      payload: aTask({ id: 't-1' }),
      createdAt: '2026-05-23T00:00:02.000Z',
      attempts: 0,
      lastError: null,
      lastAttemptAt: null,
    })

    queueResults(
      {
        data: {
          id: 'sub-1',
          user_id: 'u-1',
          category_id: 'c-1',
          name: 'Inbox',
          sort_order: 0,
          archived_at: null,
        },
        error: null,
      },
      { data: aTaskRow({ id: 't-1' }), error: null },
      { data: aTaskRow({ id: 't-1', title: 'edited' }), error: null },
    )

    const result = await drainOutbox()

    // Table order proves createdAt ordering: sub (c1) → task insert (c2) → task update (c3).
    expect(fromTables()).toEqual(['subcategories', 'tasks', 'tasks'])
    expect(result).toEqual({ processed: 3, failed: 0, remaining: 0 })
    expect(await db.outbox.count()).toBe(0)
    expect(useSyncStore.getState().state).toBe('synced')
  })
})

describe('drainOutbox — success reconciliation by op', () => {
  it('insert: writes the canonical server row (server-stamped fields) into the cache', async () => {
    await enqueue({
      op: 'insert',
      table: 'tasks',
      payload: aTask({ id: 't-1', title: 'optimistic' }),
      createdAt: '2026-05-23T00:00:01.000Z',
      attempts: 0,
      lastError: null,
      lastAttemptAt: null,
    })
    queueResults({
      data: aTaskRow({
        id: 't-1',
        title: 'optimistic',
        updated_at: '2099-01-01T00:00:00.000Z',
      }),
      error: null,
    })

    await drainOutbox()

    const cached = await db.tasks.get('t-1')
    expect(cached?.updatedAt).toBe('2099-01-01T00:00:00.000Z')
  })

  it('update: keys the Supabase call on id and reconciles the cache', async () => {
    await enqueue({
      op: 'update',
      table: 'tasks',
      payload: aTask({ id: 't-7', title: 'renamed' }),
      createdAt: '2026-05-23T00:00:01.000Z',
      attempts: 0,
      lastError: null,
      lastAttemptAt: null,
    })
    queueResults({
      data: aTaskRow({ id: 't-7', title: 'renamed' }),
      error: null,
    })

    await drainOutbox()

    const eqCall = chainCalls.find((c) => c.method === 'eq')
    expect(eqCall?.args).toEqual(['id', 't-7'])
    expect((await db.tasks.get('t-7'))?.title).toBe('renamed')
  })

  it('delete: removes the cache row by id and never refetches (no select)', async () => {
    await db.tasks.put(
      taskFromRow(aTaskRow({ id: 't-doomed', title: 'doomed' })),
    )
    await enqueue({
      op: 'delete',
      table: 'tasks',
      payload: { id: 't-doomed' },
      createdAt: '2026-05-23T00:00:01.000Z',
      attempts: 0,
      lastError: null,
      lastAttemptAt: null,
    })
    queueResults({ data: null, error: null })

    await drainOutbox()

    expect(await db.tasks.get('t-doomed')).toBeUndefined()
    expect(chainCalls.some((c) => c.method === 'delete')).toBe(true)
    expect(chainCalls.some((c) => c.method === 'select')).toBe(false)
    const eqCall = chainCalls.find((c) => c.method === 'eq')
    expect(eqCall?.args).toEqual(['id', 't-doomed'])
  })
})

describe('drainOutbox — irregular keys (settings / push / routine_logs)', () => {
  it('settings update replays keyed by user_id', async () => {
    await enqueue({
      op: 'update',
      table: 'settings',
      payload: {
        userId: 'u-9',
        aiApiKey: null,
        caldavAppleId: null,
        caldavCalendarUrl: null,
        caldavStatus: 'unconfigured',
        timezone: 'America/Chicago',
        lastDailyReset: null,
      },
      createdAt: '2026-05-23T00:00:01.000Z',
      attempts: 0,
      lastError: null,
      lastAttemptAt: null,
    })
    queueResults({
      data: {
        user_id: 'u-9',
        ai_api_key: null,
        caldav_apple_id: null,
        caldav_calendar_url: null,
        caldav_status: 'unconfigured',
        timezone: 'America/Chicago',
        last_daily_reset: null,
      },
      error: null,
    })

    await drainOutbox()

    const eqCall = chainCalls.find((c) => c.method === 'eq')
    expect(eqCall?.args).toEqual(['user_id', 'u-9'])
    expect((await db.settings.get('u-9'))?.timezone).toBe('America/Chicago')
  })

  it('push_subscriptions delete replays keyed by endpoint and removes the cache row by endpoint', async () => {
    await db.push_subscriptions.put({
      id: 'ps-1',
      userId: 'u-1',
      endpoint: 'https://push.example/abc',
      p256dh: 'k',
      auth: 'a',
      createdAt: '2026-05-23T00:00:00.000Z',
    })
    await enqueue({
      op: 'delete',
      table: 'push_subscriptions',
      payload: { endpoint: 'https://push.example/abc' },
      createdAt: '2026-05-23T00:00:01.000Z',
      attempts: 0,
      lastError: null,
      lastAttemptAt: null,
    })
    queueResults({ data: null, error: null })

    await drainOutbox()

    const eqCall = chainCalls.find((c) => c.method === 'eq')
    expect(eqCall?.args).toEqual(['endpoint', 'https://push.example/abc'])
    expect(await db.push_subscriptions.count()).toBe(0)
  })

  it('routine_logs replays via upsert with the unique onConflict target', async () => {
    await enqueue({
      op: 'insert',
      table: 'routine_logs',
      payload: {
        id: 'rl-1',
        userId: 'u-1',
        routineItemId: 'ri-1',
        dateKey: '2026-05-25',
        completed: true,
      },
      createdAt: '2026-05-23T00:00:01.000Z',
      attempts: 0,
      lastError: null,
      lastAttemptAt: null,
    })
    queueResults({
      data: {
        id: 'rl-1',
        user_id: 'u-1',
        routine_item_id: 'ri-1',
        date_key: '2026-05-25',
        completed: true,
      },
      error: null,
    })

    await drainOutbox()

    const upsertCall = chainCalls.find((c) => c.method === 'upsert')
    expect(upsertCall).toBeDefined()
    expect(upsertCall?.args[1]).toMatchObject({
      onConflict: 'user_id,routine_item_id,date_key',
    })
    expect(await db.routine_logs.get('rl-1')).toBeDefined()
  })
})

// ============================================================
// Group C — failure handling, backoff, failed bucket
// ============================================================

// Fake only `Date` so backoff math is deterministic while fake-indexeddb's
// internal timers/microtasks keep running (faking them would deadlock Dexie).
function fakeClock(iso: string) {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(iso))
}

describe('drainOutbox — transient failures', () => {
  it('a 5xx failure increments attempts and leaves the row; later rows still process', async () => {
    await enqueue({
      op: 'insert',
      table: 'tasks',
      payload: aTask({ id: 't-fail' }),
      createdAt: '2026-05-23T00:00:01.000Z',
      attempts: 0,
      lastError: null,
      lastAttemptAt: null,
    })
    await enqueue({
      op: 'insert',
      table: 'tasks',
      payload: aTask({ id: 't-ok' }),
      createdAt: '2026-05-23T00:00:02.000Z',
      attempts: 0,
      lastError: null,
      lastAttemptAt: null,
    })
    queueResults(
      { data: null, error: { message: 'server boom', status: 503 } },
      { data: aTaskRow({ id: 't-ok' }), error: null },
    )

    const result = await drainOutbox()

    expect(result).toEqual({ processed: 1, failed: 0, remaining: 1 })
    const remaining = await db.outbox.toArray()
    expect(remaining).toHaveLength(1)
    expect(remaining[0].attempts).toBe(1)
    expect(remaining[0].lastError).toMatch(/boom/)
    expect(remaining[0].lastAttemptAt).not.toBeNull()
    expect(await db.tasks.get('t-ok')).toBeDefined()
    expect(useSyncStore.getState().state).toBe('syncing')
  })
})

describe('drainOutbox — exponential backoff', () => {
  it('skips a row inside its backoff window, then attempts it once elapsed', async () => {
    const base = '2026-05-23T12:00:00.000Z'
    fakeClock(base)

    await enqueue({
      op: 'insert',
      table: 'tasks',
      payload: aTask({ id: 't-bo' }),
      createdAt: '2026-05-23T00:00:01.000Z',
      attempts: 1, // backoff window = min(2^1, 300) = 2s
      lastError: 'boom',
      lastAttemptAt: base,
    })

    const r1 = await drainOutbox()
    expect(fromMock).not.toHaveBeenCalled() // still inside the 2s window
    expect(r1).toEqual({ processed: 0, failed: 0, remaining: 1 })

    // Advance 3s — past the 2s backoff window.
    vi.setSystemTime(new Date(new Date(base).getTime() + 3000))
    queueResults({ data: aTaskRow({ id: 't-bo' }), error: null })

    const r2 = await drainOutbox()
    expect(fromMock).toHaveBeenCalledTimes(1)
    expect(r2.processed).toBe(1)
    expect(await db.outbox.count()).toBe(0)
  })
})

describe('drainOutbox — failed bucket', () => {
  it('moves a row to the failed bucket after MAX_ATTEMPTS and sets sync_issues', async () => {
    await enqueue({
      op: 'insert',
      table: 'tasks',
      payload: aTask({ id: 't-x' }),
      createdAt: '2026-05-23T00:00:01.000Z',
      attempts: 4, // one more failure tips it into the failed bucket
      lastError: 'boom',
      lastAttemptAt: '2026-05-23T00:00:00.000Z', // far in the past → not in backoff
    })
    queueResults({ data: null, error: { message: 'still failing', status: 500 } })

    const result = await drainOutbox()

    expect(result).toEqual({ processed: 0, failed: 1, remaining: 1 })
    expect((await db.outbox.toArray())[0].attempts).toBe(5)
    expect(useSyncStore.getState().state).toBe('sync_issues')

    // A subsequent drain skips the failed row entirely — no Supabase call.
    fromMock.mockReset()
    const result2 = await drainOutbox()
    expect(fromMock).not.toHaveBeenCalled()
    expect(result2).toEqual({ processed: 0, failed: 1, remaining: 1 })
    expect(useSyncStore.getState().state).toBe('sync_issues')
  })
})

describe('drainOutbox — 4xx gets backoff too (resolution 6)', () => {
  it('a 4xx increments + backs off (not hammered on the next immediate drain)', async () => {
    const base = '2026-05-23T12:00:00.000Z'
    fakeClock(base)

    await enqueue({
      op: 'update',
      table: 'tasks',
      payload: aTask({ id: 't-4' }),
      createdAt: '2026-05-23T00:00:01.000Z',
      attempts: 0,
      lastError: null,
      lastAttemptAt: null,
    })
    queueResults({ data: null, error: { message: 'not found', status: 404 } })

    await drainOutbox()
    expect(fromMock).toHaveBeenCalledTimes(1)
    const row = (await db.outbox.toArray())[0]
    expect(row.attempts).toBe(1) // NOT jumped straight to the failed bucket
    expect(row.lastAttemptAt).toBe(base)
    expect(useSyncStore.getState().state).toBe('syncing')

    // Immediate re-drain: row is in its 2s backoff window → not retried.
    const r2 = await drainOutbox()
    expect(fromMock).toHaveBeenCalledTimes(1) // unchanged — no hammering
    expect(r2.remaining).toBe(1)
  })

  it('a permanently-failing 4xx reaches attempts=5 → sync_issues over spaced retries', async () => {
    let t = new Date('2026-05-23T12:00:00.000Z').getTime()
    fakeClock(new Date(t).toISOString())

    await enqueue({
      op: 'update',
      table: 'tasks',
      payload: aTask({ id: 't-perm' }),
      createdAt: '2026-05-23T00:00:01.000Z',
      attempts: 0,
      lastError: null,
      lastAttemptAt: null,
    })

    for (let i = 0; i < 5; i++) {
      queueResults({ data: null, error: { message: 'gone', status: 404 } })
      await drainOutbox()
      t += 301_000 // jump past the backoff cap (300s) before the next attempt
      vi.setSystemTime(new Date(t))
    }

    expect((await db.outbox.toArray())[0].attempts).toBe(5)
    expect(useSyncStore.getState().state).toBe('sync_issues')
  })
})

// ============================================================
// Group D — offline guard, in-flight idempotency, retry/discard
// ============================================================

describe('drainOutbox — offline guard', () => {
  it('does not attempt any rows while offline; sets offline; preserves attempts', async () => {
    isOnlineMock.mockReturnValue(false)
    await enqueue({
      op: 'insert',
      table: 'tasks',
      payload: aTask({ id: 't-1' }),
      createdAt: '2026-05-23T00:00:01.000Z',
      attempts: 0,
      lastError: null,
      lastAttemptAt: null,
    })

    const result = await drainOutbox()

    expect(fromMock).not.toHaveBeenCalled()
    expect(result).toEqual({ processed: 0, failed: 0, remaining: 1 })
    expect((await db.outbox.toArray())[0].attempts).toBe(0) // attempts NOT burned
    expect(useSyncStore.getState().state).toBe('offline')
  })
})

describe('drainOutbox — exactly-once via shared in-flight promise', () => {
  it('concurrent calls share one promise (one Supabase call); a later call starts fresh', async () => {
    await enqueue({
      op: 'insert',
      table: 'tasks',
      payload: aTask({ id: 't-1' }),
      createdAt: '2026-05-23T00:00:01.000Z',
      attempts: 0,
      lastError: null,
      lastAttemptAt: null,
    })
    queueResults({ data: aTaskRow({ id: 't-1' }), error: null })

    const p1 = drainOutbox()
    const p2 = drainOutbox()
    expect(p1).toBe(p2) // shared in-flight promise

    await Promise.all([p1, p2])
    expect(fromMock).toHaveBeenCalledTimes(1) // applied exactly once
    expect(await db.outbox.count()).toBe(0)

    // Once settled, a fresh call is a new drain (in-flight was reset).
    const p3 = drainOutbox()
    expect(p3).not.toBe(p1)
    await p3
  })
})

describe('outbox — Sync issues management', () => {
  it('getSyncIssues returns only failed-bucket rows', async () => {
    await enqueue({
      op: 'insert',
      table: 'tasks',
      payload: aTask({ id: 't-failed' }),
      createdAt: '2026-05-23T00:00:01.000Z',
      attempts: 5,
      lastError: 'gone',
      lastAttemptAt: '2026-05-23T00:00:00.000Z',
    })
    await enqueue({
      op: 'insert',
      table: 'tasks',
      payload: aTask({ id: 't-healthy' }),
      createdAt: '2026-05-23T00:00:02.000Z',
      attempts: 1,
      lastError: 'transient',
      lastAttemptAt: '2026-05-23T00:00:00.000Z',
    })

    const issues = await getSyncIssues()
    expect(issues).toHaveLength(1)
    expect((issues[0].payload as { id: string }).id).toBe('t-failed')
  })

  it('discardOutboxRow removes the row without touching Supabase and recomputes state', async () => {
    const id = await enqueue({
      op: 'insert',
      table: 'tasks',
      payload: aTask({ id: 't-failed' }),
      createdAt: '2026-05-23T00:00:01.000Z',
      attempts: 5,
      lastError: 'gone',
      lastAttemptAt: '2026-05-23T00:00:00.000Z',
    })
    useSyncStore.setState({ state: 'sync_issues' })

    await discardOutboxRow(id)

    expect(fromMock).not.toHaveBeenCalled()
    expect(await db.outbox.count()).toBe(0)
    expect(useSyncStore.getState().state).toBe('synced')
  })

  it('discardAllFailed clears the failed bucket but keeps healthy rows', async () => {
    await enqueue({
      op: 'insert',
      table: 'tasks',
      payload: aTask({ id: 't-failed' }),
      createdAt: '2026-05-23T00:00:01.000Z',
      attempts: 5,
      lastError: 'gone',
      lastAttemptAt: '2026-05-23T00:00:00.000Z',
    })
    await enqueue({
      op: 'insert',
      table: 'tasks',
      payload: aTask({ id: 't-healthy' }),
      createdAt: '2026-05-23T00:00:02.000Z',
      attempts: 0,
      lastError: null,
      lastAttemptAt: null,
    })
    useSyncStore.setState({ state: 'sync_issues' })

    await discardAllFailed()

    expect(fromMock).not.toHaveBeenCalled()
    const rows = await db.outbox.toArray()
    expect(rows).toHaveLength(1)
    expect((rows[0].payload as { id: string }).id).toBe('t-healthy')
    expect(useSyncStore.getState().state).toBe('syncing')
  })

  it('retryOutboxRow resets attempts/lastError/lastAttemptAt and re-runs the drain', async () => {
    const id = await enqueue({
      op: 'insert',
      table: 'tasks',
      payload: aTask({ id: 't-retry' }),
      createdAt: '2026-05-23T00:00:01.000Z',
      attempts: 5, // would be skipped by a normal drain
      lastError: 'gone',
      lastAttemptAt: '2026-05-23T00:00:00.000Z',
    })
    queueResults({ data: aTaskRow({ id: 't-retry' }), error: null })

    const result = await retryOutboxRow(id)

    expect(fromMock).toHaveBeenCalledTimes(1) // reset enabled the attempt
    expect(result.processed).toBe(1)
    expect(await db.outbox.count()).toBe(0)
    expect(useSyncStore.getState().state).toBe('synced')
  })

  it('retryAllFailed resets every failed row and re-drains them', async () => {
    await enqueue({
      op: 'insert',
      table: 'tasks',
      payload: aTask({ id: 't-a' }),
      createdAt: '2026-05-23T00:00:01.000Z',
      attempts: 5,
      lastError: 'gone',
      lastAttemptAt: '2026-05-23T00:00:00.000Z',
    })
    await enqueue({
      op: 'insert',
      table: 'tasks',
      payload: aTask({ id: 't-b' }),
      createdAt: '2026-05-23T00:00:02.000Z',
      attempts: 5,
      lastError: 'gone',
      lastAttemptAt: '2026-05-23T00:00:00.000Z',
    })
    queueResults(
      { data: aTaskRow({ id: 't-a' }), error: null },
      { data: aTaskRow({ id: 't-b' }), error: null },
    )

    const result = await retryAllFailed()

    expect(result.processed).toBe(2)
    expect(await db.outbox.count()).toBe(0)
    expect(useSyncStore.getState().state).toBe('synced')
  })
})
