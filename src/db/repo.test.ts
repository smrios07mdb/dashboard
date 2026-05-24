import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Hoisted mocks — these must exist before the repo module is evaluated
// so the imports of @/lib/supabase and @/lib/network see the mocked
// versions, not the real ones.
const { fromMock, removeChannelMock, channelMock, isOnlineMock } = vi.hoisted(
  () => ({
    fromMock: vi.fn(),
    removeChannelMock: vi.fn(),
    channelMock: vi.fn(() => ({ on: () => ({ on: () => ({}) }) })),
    isOnlineMock: vi.fn(() => true),
  }),
)

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: fromMock,
    channel: channelMock,
    removeChannel: removeChannelMock,
  },
}))

vi.mock('@/lib/network', () => ({
  isOnline: isOnlineMock,
}))

import { db } from './dexie'
import {
  categoryFromRow,
  categoryToRow,
  routineLogFromRow,
  routineLogToRow,
  settingsFromRow,
  settingsToRow,
  subcategoryFromRow,
  subcategoryToRow,
  taskFromRow,
  taskToRow,
} from './mappers'
import { repo } from './repo'
import { useSyncStore } from './syncStore'

// ---------- helpers ----------

type SupabaseResult<T> = { data: T | null; error: unknown }

const chainCalls: { method: string; args: unknown[] }[] = []

/**
 * Returns a chainable Supabase-like object where every method returns
 * the same chain, and `await` on it resolves to `result`. Records every
 * method call into `chainCalls` for assertions.
 */
function makeChain<T>(result: SupabaseResult<T>) {
  const chain = new Proxy(
    {},
    {
      get(_target, prop) {
        if (prop === 'then') {
          return (
            onfulfilled: (v: unknown) => unknown,
            onrejected?: (e: unknown) => unknown,
          ) => Promise.resolve(result).then(onfulfilled, onrejected)
        }
        if (prop === 'catch' || prop === 'finally') {
          return (cb: (v: unknown) => unknown) =>
            Promise.resolve(result)[prop as 'catch' | 'finally'](
              cb as never,
            )
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

async function clearDb() {
  await db.transaction(
    'rw',
    [
      db.categories,
      db.subcategories,
      db.tasks,
      db.routine_items,
      db.routine_logs,
      db.settings,
      db.push_subscriptions,
      db.outbox,
    ],
    async () => {
      await db.categories.clear()
      await db.subcategories.clear()
      await db.tasks.clear()
      await db.routine_items.clear()
      await db.routine_logs.clear()
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
// Mapper round-trips
// ============================================================

describe('mappers', () => {
  it('category round-trips through fromRow / toRow', () => {
    const row = {
      id: 'cat-1',
      user_id: 'u-1',
      name: 'Work' as const,
    }
    const cat = categoryFromRow(row)
    expect(cat).toEqual({ id: 'cat-1', userId: 'u-1', name: 'Work' })
    expect(categoryToRow(cat)).toEqual(row)
  })

  it('task fromRow translates snake_case to camelCase', () => {
    const row = {
      id: 't-1',
      user_id: 'u-1',
      subcategory_id: 's-1',
      title: 'Buy milk',
      notes: null,
      estimate_minutes: 15,
      due_at: null,
      remind_at: null,
      notified: false,
      priority: 1,
      completed_at: null,
      created_at: '2026-05-23T00:00:00.000Z',
      updated_at: '2026-05-23T00:00:00.000Z',
    }
    expect(taskFromRow(row)).toMatchObject({
      id: 't-1',
      userId: 'u-1',
      subcategoryId: 's-1',
      title: 'Buy milk',
      estimateMinutes: 15,
      priority: 1,
    })
  })

  it('task toRow omits undefined keys (partial update payload)', () => {
    expect(taskToRow({ id: 't-1', title: 'New title' })).toEqual({
      id: 't-1',
      title: 'New title',
    })
  })

  it('subcategory round-trips', () => {
    const row = {
      id: 's-1',
      user_id: 'u-1',
      category_id: 'c-1',
      name: 'Inbox',
      sort_order: 0,
      archived_at: null,
    }
    expect(subcategoryToRow(subcategoryFromRow(row))).toEqual(row)
  })

  it('settings round-trips', () => {
    const row = {
      user_id: 'u-1',
      ai_api_key: null,
      caldav_apple_id: null,
      caldav_calendar_url: null,
      caldav_status: 'unconfigured' as const,
      timezone: 'America/New_York',
      last_daily_reset: null,
    }
    expect(settingsToRow(settingsFromRow(row))).toEqual(row)
  })

  it('routine log round-trips', () => {
    const row = {
      id: 'rl-1',
      user_id: 'u-1',
      routine_item_id: 'ri-1',
      date_key: '2026-05-23',
      completed: true,
    }
    expect(routineLogToRow(routineLogFromRow(row))).toEqual(row)
  })
})

// ============================================================
// Repo: online success paths
// ============================================================

describe('repo (online)', () => {
  it('categories.list fetches from Supabase, mirrors to Dexie, returns mapped data', async () => {
    fromMock.mockReturnValue(
      makeChain({
        data: [
          { id: 'cat-1', user_id: 'u-1', name: 'Work' },
          { id: 'cat-2', user_id: 'u-1', name: 'Personal' },
        ],
        error: null,
      }),
    )

    const out = await repo.categories.list()

    expect(fromMock).toHaveBeenCalledWith('categories')
    expect(out).toEqual([
      { id: 'cat-1', userId: 'u-1', name: 'Work' },
      { id: 'cat-2', userId: 'u-1', name: 'Personal' },
    ])
    const cached = await db.categories.toArray()
    expect(cached).toHaveLength(2)
    expect(useSyncStore.getState().state).toBe('synced')
    expect(useSyncStore.getState().lastSyncAt).not.toBeNull()
  })

  it('subcategories.create writes to Supabase and to Dexie cache', async () => {
    const created = {
      id: 'sub-1',
      user_id: 'u-1',
      category_id: 'cat-1',
      name: 'Inbox',
      sort_order: 0,
      archived_at: null,
    }
    fromMock.mockReturnValue(makeChain({ data: created, error: null }))

    const out = await repo.subcategories.create({
      id: 'sub-1',
      userId: 'u-1',
      categoryId: 'cat-1',
      name: 'Inbox',
      sortOrder: 0,
    })

    expect(fromMock).toHaveBeenCalledWith('subcategories')
    expect(out.id).toBe('sub-1')
    expect(out.name).toBe('Inbox')
    const cached = await db.subcategories.get('sub-1')
    expect(cached?.name).toBe('Inbox')
    expect(await db.outbox.count()).toBe(0)
  })

  it('tasks.create writes to Supabase and cache; no outbox entry', async () => {
    const id = '11111111-1111-1111-1111-111111111111'
    const created = {
      id,
      user_id: 'u-1',
      subcategory_id: 'sub-1',
      title: 'Buy milk',
      notes: null,
      estimate_minutes: 15,
      due_at: null,
      remind_at: null,
      notified: false,
      priority: null,
      completed_at: null,
      created_at: '2026-05-23T00:00:00.000Z',
      updated_at: '2026-05-23T00:00:00.000Z',
    }
    fromMock.mockReturnValue(makeChain({ data: created, error: null }))

    const out = await repo.tasks.create({
      id,
      userId: 'u-1',
      subcategoryId: 'sub-1',
      title: 'Buy milk',
      notes: null,
      estimateMinutes: 15,
      dueAt: null,
      remindAt: null,
      priority: null,
      completedAt: null,
    })

    expect(out.id).toBe(id)
    expect(out.title).toBe('Buy milk')
    expect(await db.tasks.get(id)).toMatchObject({ title: 'Buy milk' })
    expect(await db.outbox.count()).toBe(0)
  })

  it('tasks.listBySubcategory hits the right table and filters cache by subcategoryId', async () => {
    fromMock.mockReturnValue(
      makeChain({
        data: [
          {
            id: 't-1',
            user_id: 'u-1',
            subcategory_id: 'sub-1',
            title: 'A',
            notes: null,
            estimate_minutes: 0,
            due_at: null,
            remind_at: null,
            notified: false,
            priority: null,
            completed_at: null,
            created_at: '2026-05-23T00:00:00.000Z',
            updated_at: '2026-05-23T00:00:00.000Z',
          },
        ],
        error: null,
      }),
    )

    const out = await repo.tasks.listBySubcategory('sub-1')

    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ id: 't-1', subcategoryId: 'sub-1' })
    const eqCall = chainCalls.find(
      (c) => c.method === 'eq' && c.args[0] === 'subcategory_id',
    )
    expect(eqCall?.args[1]).toBe('sub-1')
  })

  it('settings.get returns null when Supabase reports no row', async () => {
    fromMock.mockReturnValue(makeChain({ data: null, error: null }))
    const out = await repo.settings.get('u-1')
    expect(out).toBeNull()
  })
})

// ============================================================
// Repo: 4xx errors propagate
// ============================================================

describe('repo (4xx errors)', () => {
  it('throws when Supabase returns a 4xx-shaped error on read', async () => {
    fromMock.mockReturnValue(
      makeChain({
        data: null,
        error: { message: 'forbidden', status: 403, code: 'PGRST301' },
      }),
    )
    await expect(repo.categories.list()).rejects.toThrow(/forbidden/i)
  })

  it('throws when Supabase returns a 4xx-shaped error on create', async () => {
    fromMock.mockReturnValue(
      makeChain({
        data: null,
        error: { message: 'rls denied', status: 401 },
      }),
    )
    await expect(
      repo.tasks.create({
        userId: 'u-1',
        subcategoryId: 'sub-1',
        title: 'x',
        notes: null,
        estimateMinutes: 0,
        dueAt: null,
        remindAt: null,
        priority: null,
        completedAt: null,
      }),
    ).rejects.toThrow(/rls denied/i)
    expect(await db.outbox.count()).toBe(0)
  })
})

// ============================================================
// Repo: offline behaviour
// ============================================================

describe('repo (offline)', () => {
  beforeEach(() => {
    isOnlineMock.mockReturnValue(false)
  })

  it('categories.list returns cached rows and flips sync state to offline', async () => {
    await db.categories.bulkPut([
      { id: 'cat-1', userId: 'u-1', name: 'Work' },
      { id: 'cat-2', userId: 'u-1', name: 'Personal' },
    ])

    const out = await repo.categories.list()

    expect(out).toHaveLength(2)
    expect(fromMock).not.toHaveBeenCalled()
    expect(useSyncStore.getState().state).toBe('offline')
  })

  it('tasks.create applies to cache and enqueues an outbox row', async () => {
    const result = await repo.tasks.create({
      id: 't-offline',
      userId: 'u-1',
      subcategoryId: 'sub-1',
      title: 'Offline task',
      notes: null,
      estimateMinutes: 5,
      dueAt: null,
      remindAt: null,
      priority: null,
      completedAt: null,
    })

    expect(result.id).toBe('t-offline')
    expect(result.title).toBe('Offline task')
    const cached = await db.tasks.get('t-offline')
    expect(cached?.title).toBe('Offline task')
    const outboxRows = await db.outbox.toArray()
    expect(outboxRows).toHaveLength(1)
    expect(outboxRows[0]).toMatchObject({
      op: 'insert',
      table: 'tasks',
      attempts: 0,
      lastError: null,
    })
    expect(useSyncStore.getState().state).toBe('offline')
    expect(fromMock).not.toHaveBeenCalled()
  })

  it('tasks.delete removes from cache and enqueues a delete in the outbox', async () => {
    await db.tasks.put({
      id: 't-1',
      userId: 'u-1',
      subcategoryId: 'sub-1',
      title: 'doomed',
      notes: null,
      estimateMinutes: 0,
      dueAt: null,
      remindAt: null,
      notified: false,
      priority: null,
      completedAt: null,
      createdAt: '2026-05-23T00:00:00.000Z',
      updatedAt: '2026-05-23T00:00:00.000Z',
    })

    await repo.tasks.delete('t-1')

    expect(await db.tasks.get('t-1')).toBeUndefined()
    const outboxRows = await db.outbox.toArray()
    expect(outboxRows).toHaveLength(1)
    expect(outboxRows[0]).toMatchObject({ op: 'delete', table: 'tasks' })
  })

  it('offline write + offline read returns the row from the cache (Bug B regression)', async () => {
    // End-to-end offline contract per ARCHITECTURE §6: an offline
    // create lands in Dexie + outbox, and the next offline read
    // returns it from Dexie. This test guards the repo's half of
    // Bug B — the production defect itself lived at the Workbox SW
    // layer (`NetworkFirst` for Supabase was serving stale 200 GET
    // responses during reload-while-offline, so the repo's online
    // arm "succeeded" and clear-then-bulkPut the cache, evicting
    // the offline-written row). Fix is in `vite.config.ts`
    // (handler: 'NetworkOnly'); see docs/sync.md "The SW must be
    // transparent for Supabase". This test would have caught the
    // bug if the SW had been part of the test surface — keep it
    // here as a contract assertion so any future regression at the
    // repo layer surfaces in the unit run.
    const created = await repo.tasks.create({
      id: 't-bug-b',
      userId: 'u-1',
      subcategoryId: 'sub-1',
      title: 'Offline-written',
      notes: null,
      estimateMinutes: 15,
      dueAt: null,
      remindAt: null,
      priority: null,
      completedAt: null,
    })
    expect(created.id).toBe('t-bug-b')

    // Reload-while-offline simulation: another `list` call still
    // offline. Must return the offline-written row from Dexie.
    const list = await repo.tasks.list()
    const found = list.find((t) => t.id === 't-bug-b')
    expect(found).toBeDefined()
    expect(found?.title).toBe('Offline-written')

    // Outbox preserves the mutation for chunk 15's replay.
    const outboxRows = await db.outbox.toArray()
    expect(outboxRows).toHaveLength(1)
    expect(outboxRows[0]).toMatchObject({
      op: 'insert',
      table: 'tasks',
    })
  })

  it('falls through to the offline path when online Supabase call rejects with a network error', async () => {
    isOnlineMock.mockReturnValue(true)
    // Supabase returns a 0/undefined-status error → treated as network failure
    fromMock.mockReturnValue(
      makeChain({
        data: null,
        error: { message: 'fetch failed', status: 0 },
      }),
    )

    const out = await repo.tasks.create({
      id: 't-fallback',
      userId: 'u-1',
      subcategoryId: 'sub-1',
      title: 'Network died',
      notes: null,
      estimateMinutes: 0,
      dueAt: null,
      remindAt: null,
      priority: null,
      completedAt: null,
    })

    expect(out.id).toBe('t-fallback')
    expect(await db.tasks.get('t-fallback')).not.toBeUndefined()
    const outboxRows = await db.outbox.toArray()
    expect(outboxRows).toHaveLength(1)
    expect(outboxRows[0].op).toBe('insert')
    expect(useSyncStore.getState().state).toBe('offline')
  })
})
