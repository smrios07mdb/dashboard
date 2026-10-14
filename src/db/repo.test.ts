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
  scheduledBlockFromRow,
  scheduledBlockToRow,
  settingsFromRow,
  settingsToRow,
  toCachedSettings,
  subcategoryFromRow,
  subcategoryToRow,
  taskFromRow,
  taskToRow,
  type TaskRow,
} from './mappers'
import { repo } from './repo'
import type { ScheduledBlock, Task } from './types'
import { useSyncStore } from './syncStore'
import {
  deleteTasksWithUndo,
  flushPendingDeletes,
  isPendingDelete,
} from '@/lib/taskUndo'

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
      db.scheduled_blocks,
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
      await db.scheduled_blocks.clear()
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
      ai_status: 'unconfigured' as const,
      caldav_apple_id: null,
      caldav_calendar_url: null,
      caldav_read_calendars: null,
      caldav_status: 'unconfigured' as const,
      outlook_status: 'unconfigured' as const,
      outlook_feed_name: null,
      outlook_fetched_at: null,
      planner_writeout: false,
      timezone: 'America/New_York',
      last_daily_reset: null,
    }
    expect(settingsToRow(settingsFromRow(row))).toEqual(row)
  })

  it('settings: caldav_read_calendars round-trips as the READ set (chunk 51)', () => {
    const set = [
      { url: 'https://caldav.icloud.com/1/calendars/home/', name: 'Home', enabled: true },
      { url: 'https://caldav.icloud.com/1/calendars/work/', name: 'Work', enabled: false },
    ]
    const row = {
      user_id: 'u-1',
      ai_status: 'unconfigured' as const,
      caldav_apple_id: 'me@icloud.com',
      caldav_calendar_url: 'https://caldav.icloud.com/1/calendars/home/',
      caldav_read_calendars: set,
      caldav_status: 'ok' as const,
      outlook_status: 'unconfigured' as const,
      outlook_feed_name: null,
      outlook_fetched_at: null,
      planner_writeout: true,
      timezone: 'America/New_York',
      last_daily_reset: null,
    }
    expect(settingsFromRow(row).caldavReadCalendars).toEqual(set)
    expect(settingsToRow(settingsFromRow(row))).toEqual(row)
    expect(settingsToRow({ caldavReadCalendars: null })).toEqual({ caldav_read_calendars: null })
    // Undefined (not in the patch) is not written at all.
    expect(settingsToRow({ plannerWriteout: true })).not.toHaveProperty('caldav_read_calendars')
  })

  it('settings: a read-set entry keeps a valid #rrggbb color and drops a bad one (chunk 51b)', () => {
    const row = {
      user_id: 'u-1',
      ai_status: 'unconfigured' as const,
      caldav_apple_id: 'me@icloud.com',
      caldav_calendar_url: 'https://caldav.icloud.com/1/calendars/home/',
      caldav_read_calendars: [
        { url: 'https://caldav.icloud.com/1/calendars/home/', name: 'Home', enabled: true, color: '#FF2968' },
        { url: 'https://caldav.icloud.com/1/calendars/work/', name: 'Work', enabled: true, color: 'red' },
      ],
      caldav_status: 'ok' as const,
      outlook_status: 'unconfigured' as const,
      outlook_feed_name: null,
      outlook_fetched_at: null,
      planner_writeout: true,
      timezone: 'America/New_York',
      last_daily_reset: null,
    }
    expect(settingsFromRow(row).caldavReadCalendars).toEqual([
      { url: 'https://caldav.icloud.com/1/calendars/home/', name: 'Home', enabled: true, color: '#ff2968' },
      { url: 'https://caldav.icloud.com/1/calendars/work/', name: 'Work', enabled: true },
    ])
  })

  it('settings: invalid or missing caldav_read_calendars jsonb reads as null; malformed entries drop', () => {
    const base = {
      user_id: 'u-1',
      ai_status: 'unconfigured' as const,
      caldav_apple_id: null,
      caldav_calendar_url: null,
      caldav_status: 'ok' as const,
      outlook_status: 'unconfigured' as const,
      outlook_feed_name: null,
      outlook_fetched_at: null,
      timezone: 'America/New_York',
      last_daily_reset: null,
    }
    // Pre-migration-13 cached row: the key is absent.
    expect(settingsFromRow(base).caldavReadCalendars).toBeNull()
    expect(settingsFromRow({ ...base, caldav_read_calendars: 'nope' }).caldavReadCalendars).toBeNull()
    expect(
      settingsFromRow({ ...base, caldav_read_calendars: { url: 'x' } }).caldavReadCalendars,
    ).toBeNull()
    expect(
      settingsFromRow({
        ...base,
        caldav_read_calendars: [
          { url: 'https://cal/a/', name: 'A', enabled: true },
          { url: 'https://cal/a/', name: 'dup', enabled: false },
          { url: '', name: 'no url', enabled: true },
          { url: 'https://cal/b/', name: 'B', enabled: 'yes' },
          { url: 'https://cal/c/', enabled: false },
          null,
        ],
      }).caldavReadCalendars,
    ).toEqual([
      { url: 'https://cal/a/', name: 'A', enabled: true },
      { url: 'https://cal/c/', name: '', enabled: false },
    ])
    // An empty array is an initialized, empty set — not null.
    expect(settingsFromRow({ ...base, caldav_read_calendars: [] }).caldavReadCalendars).toEqual([])
  })

  it('settings: planner_writeout defaults to false on rows that predate migration 12', () => {
    const row = {
      user_id: 'u-1',
      ai_status: 'unconfigured' as const,
      caldav_apple_id: null,
      caldav_calendar_url: null,
      caldav_status: 'ok' as const,
      outlook_status: 'unconfigured' as const,
      outlook_feed_name: null,
      outlook_fetched_at: null,
      timezone: 'America/New_York',
      last_daily_reset: null,
    }
    expect(settingsFromRow(row).plannerWriteout).toBe(false)
    expect(settingsToRow({ plannerWriteout: true })).toEqual({ planner_writeout: true })
  })

  it('scheduled block round-trips calendar_uid and carries no done (chunk 39)', () => {
    const row = {
      id: 'sb-1',
      user_id: 'u-1',
      task_id: 't-1',
      start_at: '2026-05-06T13:15:00.000Z',
      end_at: '2026-05-06T14:00:00.000Z',
      calendar_uid: 'hupo-block-abc',
      created_at: '2026-05-06T00:00:00.000Z',
      updated_at: '2026-05-06T00:00:00.000Z',
    }
    const mapped = scheduledBlockFromRow(row)
    expect(mapped.calendarUid).toBe('hupo-block-abc')
    expect(mapped).not.toHaveProperty('done')
    expect(scheduledBlockToRow(mapped)).toEqual(row)
    // A cached row from before migration 12 maps to null, not undefined.
    const { calendar_uid: _dropped, ...legacy } = row
    void _dropped
    expect(scheduledBlockFromRow(legacy as typeof row).calendarUid).toBeNull()
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
// PRIV-02: online-only fields must never persist in the Dexie cache at rest —
// only travel in the live return value. Since chunk 55 the Anthropic key is
// proxy-owned: it must not surface in the Settings shape AT ALL (live or
// cached), even though `select('*')` still returns its ciphertext column.
// ============================================================

describe('settings cache omits secrets at rest (PRIV-02)', () => {
  const rowWithSecrets = {
    user_id: 'u-1',
    ai_api_key_encrypted: '\\xC1PHERTEXT',
    ai_status: 'ok' as const,
    caldav_apple_id: 'me@icloud.com',
    caldav_calendar_url: 'https://cal.example',
    caldav_status: 'ok' as const,
    outlook_status: 'ok' as const,
    outlook_feed_name: 'Meetings — S. Ríos',
    outlook_fetched_at: '2026-07-30T09:14:00.000Z',
    timezone: 'America/New_York',
    last_daily_reset: null,
  }
  const hasKeyMaterial = (v: unknown) =>
    Object.keys(v as object).some((k) => /key/i.test(k)) ||
    JSON.stringify(v).includes('C1PHERTEXT')

  it('toCachedSettings drops caldavAppleId, keeps aiStatus and the rest', () => {
    const cached = toCachedSettings(settingsFromRow(rowWithSecrets))
    expect('caldavAppleId' in cached).toBe(false)
    expect(hasKeyMaterial(cached)).toBe(false)
    expect(cached.aiStatus).toBe('ok')
    expect(cached.userId).toBe('u-1')
    expect(cached.caldavCalendarUrl).toBe('https://cal.example')
    expect(cached.caldavStatus).toBe('ok')
    expect(cached.timezone).toBe('America/New_York')
  })

  it('settingsFromRow defaults aiStatus for a row cached before migration 14', () => {
    const legacy = { ...rowWithSecrets, ai_status: undefined }
    expect(settingsFromRow(legacy).aiStatus).toBe('unconfigured')
  })

  it('settings.get never surfaces the AI key; the Apple ID is live-only', async () => {
    fromMock.mockReturnValue(makeChain({ data: rowWithSecrets, error: null }))
    const out = await repo.settings.get('u-1')
    expect(hasKeyMaterial(out)).toBe(false)
    expect(out?.aiStatus).toBe('ok')
    // Live return still carries the Apple ID — online callers need it.
    expect(out?.caldavAppleId).toBe('me@icloud.com')
    // The Dexie mirror must NOT.
    const cached = await db.settings.get('u-1')
    expect(cached).toBeTruthy()
    expect(hasKeyMaterial(cached)).toBe(false)
    expect(cached && 'caldavAppleId' in cached).toBe(false)
    expect(cached?.aiStatus).toBe('ok')
    expect(cached?.timezone).toBe('America/New_York')
  })

  it('settings.update caches a record without secrets (applyServerEcho path)', async () => {
    fromMock.mockReturnValue(makeChain({ data: rowWithSecrets, error: null }))
    const out = await repo.settings.update('u-1', {
      timezone: 'America/New_York',
    })
    expect(hasKeyMaterial(out)).toBe(false)
    expect(out.caldavAppleId).toBe('me@icloud.com')
    const cached = await db.settings.get('u-1')
    expect(hasKeyMaterial(cached)).toBe(false)
    expect(cached && 'caldavAppleId' in cached).toBe(false)
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

// ============================================================
// Repo: bulk operations (chunk 8)
// ============================================================

function aTaskRow(overrides: Partial<TaskRow> = {}): TaskRow {
  return {
    id: 't-x',
    user_id: 'u-1',
    subcategory_id: 'sub-1',
    title: 'Task',
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

describe('repo bulk ops (online)', () => {
  it('tasks.bulkUpdate groups identical patches into one query', async () => {
    fromMock.mockReturnValue(
      makeChain({
        data: [
          aTaskRow({ id: 't-1', subcategory_id: 'sub-2' }),
          aTaskRow({ id: 't-2', subcategory_id: 'sub-2' }),
        ],
        error: null,
      }),
    )

    await repo.tasks.bulkUpdate([
      { id: 't-1', patch: { subcategoryId: 'sub-2' } },
      { id: 't-2', patch: { subcategoryId: 'sub-2' } },
    ])

    expect(fromMock).toHaveBeenCalledTimes(1)
    const inCall = chainCalls.find((c) => c.method === 'in')
    expect(inCall?.args[0]).toBe('id')
    expect(inCall?.args[1]).toEqual(['t-1', 't-2'])
    expect(await db.tasks.get('t-1')).toMatchObject({ subcategoryId: 'sub-2' })
    expect(await db.tasks.get('t-2')).toMatchObject({ subcategoryId: 'sub-2' })
    expect(await db.outbox.count()).toBe(0)
  })

  it('tasks.bulkDelete issues a single .in() query and clears the cache', async () => {
    await db.tasks.bulkPut([
      taskFromRow(aTaskRow({ id: 't-a' })),
      taskFromRow(aTaskRow({ id: 't-b' })),
    ])
    fromMock.mockReturnValue(makeChain({ data: null, error: null }))

    await repo.tasks.bulkDelete(['t-a', 't-b'])

    expect(fromMock).toHaveBeenCalledTimes(1)
    const inCall = chainCalls.find((c) => c.method === 'in')
    expect(inCall?.args[0]).toBe('id')
    expect(inCall?.args[1]).toEqual(['t-a', 't-b'])
    expect(await db.tasks.get('t-a')).toBeUndefined()
    expect(await db.tasks.get('t-b')).toBeUndefined()
    expect(await db.outbox.count()).toBe(0)
  })

  it('tasks.bulkUpdate is a no-op when called with no updates', async () => {
    const out = await repo.tasks.bulkUpdate([])
    expect(out).toEqual([])
    expect(fromMock).not.toHaveBeenCalled()
  })

  it('tasks.bulkDelete is a no-op when called with no ids', async () => {
    await repo.tasks.bulkDelete([])
    expect(fromMock).not.toHaveBeenCalled()
  })
})

describe('repo bulk ops (offline)', () => {
  beforeEach(() => {
    isOnlineMock.mockReturnValue(false)
  })

  it('tasks.bulkUpdate applies to cache and enqueues one outbox row per update', async () => {
    await db.tasks.bulkPut([
      taskFromRow(aTaskRow({ id: 't-1' })),
      taskFromRow(aTaskRow({ id: 't-2' })),
    ])

    await repo.tasks.bulkUpdate([
      { id: 't-1', patch: { subcategoryId: 'sub-2' } },
      { id: 't-2', patch: { subcategoryId: 'sub-2' } },
    ])

    expect(await db.tasks.get('t-1')).toMatchObject({ subcategoryId: 'sub-2' })
    expect(await db.tasks.get('t-2')).toMatchObject({ subcategoryId: 'sub-2' })
    expect(await db.outbox.count()).toBe(2)
    const rows = await db.outbox.toArray()
    expect(rows.every((r) => r.op === 'update' && r.table === 'tasks')).toBe(true)
    expect(useSyncStore.getState().state).toBe('offline')
  })

  it('tasks.bulkDelete removes rows from cache and enqueues one outbox row per id', async () => {
    await db.tasks.bulkPut([
      taskFromRow(aTaskRow({ id: 't-a' })),
      taskFromRow(aTaskRow({ id: 't-b' })),
    ])

    await repo.tasks.bulkDelete(['t-a', 't-b'])

    expect(await db.tasks.get('t-a')).toBeUndefined()
    expect(await db.tasks.get('t-b')).toBeUndefined()
    expect(await db.outbox.count()).toBe(2)
    const rows = await db.outbox.toArray()
    expect(rows.every((r) => r.op === 'delete' && r.table === 'tasks')).toBe(true)
  })
})

// ============================================================
// Repo: routineLogs.deleteAllForUser (Revisions 2026-05-27)
// ============================================================

describe('repo.routineLogs.deleteAllForUser', () => {
  it('online: deletes via Supabase, clears Dexie mirror, returns count', async () => {
    await db.routine_logs.bulkPut([
      {
        id: 'rl-1',
        userId: 'u-1',
        routineItemId: 'ri-1',
        dateKey: '2026-05-25',
        completed: true,
      },
      {
        id: 'rl-2',
        userId: 'u-1',
        routineItemId: 'ri-1',
        dateKey: '2026-05-26',
        completed: false,
      },
    ])
    fromMock.mockReturnValue(
      makeChain({
        data: [{ id: 'rl-1' }, { id: 'rl-2' }],
        error: null,
      }),
    )

    const count = await repo.routineLogs.deleteAllForUser('u-1')

    expect(count).toBe(2)
    expect(fromMock).toHaveBeenCalledWith('routine_logs')
    expect(chainCalls.some((c) => c.method === 'delete')).toBe(true)
    const eqCall = chainCalls.find(
      (c) => c.method === 'eq' && c.args[0] === 'user_id',
    )
    expect(eqCall?.args[1]).toBe('u-1')
    expect(await db.routine_logs.count()).toBe(0)
    expect(await db.outbox.count()).toBe(0)
    expect(useSyncStore.getState().state).toBe('synced')
  })

  it('offline: throws and does not touch Dexie or the outbox', async () => {
    isOnlineMock.mockReturnValue(false)
    await db.routine_logs.bulkPut([
      {
        id: 'rl-1',
        userId: 'u-1',
        routineItemId: 'ri-1',
        dateKey: '2026-05-25',
        completed: true,
      },
    ])

    await expect(repo.routineLogs.deleteAllForUser('u-1')).rejects.toThrow(
      /Reset requires an online connection/,
    )
    expect(fromMock).not.toHaveBeenCalled()
    expect(await db.routine_logs.count()).toBe(1)
    expect(await db.outbox.count()).toBe(0)
  })
})

// ============================================================
// Chunk 37 — scheduled_blocks repo
// ============================================================

describe('repo.scheduledBlocks (chunk 37)', () => {
  const blockRow = {
    id: 'sb-1',
    user_id: 'u-1',
    task_id: 't-1',
    start_at: '2026-05-06T13:15:00.000Z',
    end_at: '2026-05-06T14:00:00.000Z',
    calendar_uid: null,
    created_at: '2026-05-06T00:00:00.000Z',
    updated_at: '2026-05-06T00:00:00.000Z',
  }

  it('online create returns the server echo and mirrors it into Dexie', async () => {
    fromMock.mockReturnValue(
      makeChain({ data: { ...blockRow, updated_at: '2099-01-01T00:00:00.000Z' }, error: null }),
    )
    const out = await repo.scheduledBlocks.create({
      id: 'sb-1',
      userId: 'u-1',
      taskId: 't-1',
      startAt: blockRow.start_at,
      endAt: blockRow.end_at,
    })
    expect(fromMock).toHaveBeenCalledWith('scheduled_blocks')
    expect(out).toMatchObject({ id: 'sb-1', taskId: 't-1', calendarUid: null })
    expect(out.updatedAt).toBe('2099-01-01T00:00:00.000Z')
    expect(await db.scheduled_blocks.get('sb-1')).toMatchObject({
      updatedAt: '2099-01-01T00:00:00.000Z',
    })
    expect(await db.outbox.count()).toBe(0)
  })

  it('listByRange filters the Dexie mirror by overlap and queries start_at/end_at', async () => {
    fromMock.mockReturnValue(makeChain({ data: [blockRow], error: null }))
    const rows = await repo.scheduledBlocks.listByRange(
      '2026-05-04T00:00:00.000Z',
      '2026-05-11T00:00:00.000Z',
    )
    expect(rows).toHaveLength(1)
    expect(chainCalls.find((c) => c.method === 'lt')?.args).toEqual([
      'start_at',
      '2026-05-11T00:00:00.000Z',
    ])
    expect(chainCalls.find((c) => c.method === 'gt')?.args).toEqual([
      'end_at',
      '2026-05-04T00:00:00.000Z',
    ])
    expect(await db.scheduled_blocks.count()).toBe(1)
  })

  describe('offline', () => {
    beforeEach(() => {
      isOnlineMock.mockReturnValue(false)
    })

    it('create → Dexie row + insert outbox row on scheduled_blocks', async () => {
      const out = await repo.scheduledBlocks.create({
        id: 'sb-off',
        userId: 'u-1',
        taskId: 't-1',
        startAt: blockRow.start_at,
        endAt: blockRow.end_at,
      })
      expect(out.calendarUid).toBeNull()
      expect(await db.scheduled_blocks.get('sb-off')).toMatchObject({ taskId: 't-1' })
      const rows = await db.outbox.toArray()
      expect(rows).toHaveLength(1)
      expect(rows[0]).toMatchObject({ op: 'insert', table: 'scheduled_blocks' })
      expect(useSyncStore.getState().state).toBe('offline')
      expect(fromMock).not.toHaveBeenCalled()
    })

    it('update → Dexie row patched (updatedAt stamped) + update outbox row; no `done` on the row', async () => {
      await db.scheduled_blocks.put({
        id: 'sb-1',
        userId: 'u-1',
        taskId: 't-1',
        startAt: blockRow.start_at,
        endAt: blockRow.end_at,
        calendarUid: null,
        createdAt: blockRow.created_at,
        updatedAt: blockRow.updated_at,
      })
      const endAt = '2026-05-06T15:00:00.000Z'
      const out = await repo.scheduledBlocks.update('sb-1', { endAt })
      expect(out.endAt).toBe(endAt)
      expect(out).not.toHaveProperty('done')
      expect(out.updatedAt).not.toBe(blockRow.updated_at)
      expect((await db.scheduled_blocks.get('sb-1'))?.endAt).toBe(endAt)
      const rows = await db.outbox.toArray()
      expect(rows[0]).toMatchObject({ op: 'update', table: 'scheduled_blocks' })
      const payload = rows[0].payload as Record<string, unknown>
      expect(payload.endAt).toBe(endAt)
      // Chunk 39 dropped the `done` mirror column: an outbox replay of this
      // payload carries no `done` (the column no longer exists server-side).
      expect(scheduledBlockToRow(payload as Partial<ScheduledBlock>)).not.toHaveProperty('done')
    })

    it('update with calendarUid stamps calendar_uid (chunk 39 mirror handle)', async () => {
      await db.scheduled_blocks.put({
        id: 'sb-1',
        userId: 'u-1',
        taskId: 't-1',
        startAt: blockRow.start_at,
        endAt: blockRow.end_at,
        calendarUid: null,
        createdAt: blockRow.created_at,
        updatedAt: blockRow.updated_at,
      })
      const out = await repo.scheduledBlocks.update('sb-1', { calendarUid: 'hupo-block-1' })
      expect(out.calendarUid).toBe('hupo-block-1')
      expect((await db.scheduled_blocks.get('sb-1'))?.calendarUid).toBe('hupo-block-1')
      const rows = await db.outbox.toArray()
      const payload = rows[0].payload as Record<string, unknown>
      expect(scheduledBlockToRow(payload as Partial<ScheduledBlock>)).toMatchObject({
        calendar_uid: 'hupo-block-1',
      })
    })

    it('delete → Dexie row removed + delete outbox row keyed by id', async () => {
      await db.scheduled_blocks.put({
        id: 'sb-1',
        userId: 'u-1',
        taskId: 't-1',
        startAt: blockRow.start_at,
        endAt: blockRow.end_at,
        calendarUid: null,
        createdAt: blockRow.created_at,
        updatedAt: blockRow.updated_at,
      })
      await repo.scheduledBlocks.delete('sb-1')
      expect(await db.scheduled_blocks.get('sb-1')).toBeUndefined()
      const rows = await db.outbox.toArray()
      expect(rows[0]).toMatchObject({
        op: 'delete',
        table: 'scheduled_blocks',
        payload: { id: 'sb-1' },
      })
    })
  })

  it('a 4xx on create (e.g. unique(task_id) violation) throws and enqueues nothing', async () => {
    fromMock.mockReturnValue(
      makeChain({
        data: null,
        error: { message: 'duplicate key value violates unique constraint', status: 409 },
      }),
    )
    await expect(
      repo.scheduledBlocks.create({
        userId: 'u-1',
        taskId: 't-1',
        startAt: blockRow.start_at,
        endAt: blockRow.end_at,
      }),
    ).rejects.toThrow(/duplicate key/)
    expect(await db.outbox.count()).toBe(0)
  })
})

// Chunk 72: a task inside its undo window is hidden from every list read while
// the Dexie cache keeps the row.
describe('repo — pending deletes (chunk 72)', () => {
  function mk(id: string): Task {
    return {
      id,
      userId: 'u-1',
      subcategoryId: 'sub-1',
      title: id,
      estimateMinutes: 0,
      dueAt: null,
      remindAt: null,
      notified: false,
      priority: null,
      completedAt: null,
      createdAt: '2026-05-23T00:00:00.000Z',
      updatedAt: '2026-05-23T00:00:00.000Z',
    }
  }

  it('tasks.list omits a pending id on the fallback path and on the online path', async () => {
    const keep = mk('t-keep')
    const gone = mk('t-gone')
    await db.tasks.bulkPut([keep, gone])
    deleteTasksWithUndo({ tasks: [gone] })
    try {
      isOnlineMock.mockReturnValue(false)
      expect((await repo.tasks.list()).map((t) => t.id)).toEqual(['t-keep'])
      expect(await db.tasks.get('t-gone')).toBeDefined()

      isOnlineMock.mockReturnValue(true)
      fromMock.mockReturnValue(
        makeChain({ data: [taskToRow(keep), taskToRow(gone)], error: null }),
      )
      expect((await repo.tasks.list()).map((t) => t.id)).toEqual(['t-keep'])
      expect(await db.tasks.get('t-gone')).toBeDefined()
    } finally {
      // Close the window now so its 6 s timer cannot outlive the test.
      fromMock.mockReturnValue(makeChain({ data: null, error: null }))
      flushPendingDeletes()
      await vi.waitFor(() => expect(isPendingDelete('t-gone')).toBe(false))
    }
  })
})

// ============================================================
// Repo: data.archivedCounts / data.purgeArchived (chunk 86, D5)
// ============================================================

describe('repo.data archived purge (chunk 86)', () => {
  // Per-table result queues, consumed in call order; every `from` is logged
  // into `chainCalls` so a segment can be read back per table.
  function serve(queues: Record<string, SupabaseResult<unknown>[]>) {
    fromMock.mockImplementation((table: string) => {
      chainCalls.push({ method: 'from', args: [table] })
      const next = queues[table]?.shift()
      if (!next) throw new Error(`unexpected from(${table})`)
      return makeChain(next)
    })
  }
  /** One entry per `from` call: the table and the methods chained on it. */
  function segments() {
    const out: { table: string; calls: { method: string; args: unknown[] }[] }[] = []
    for (const c of chainCalls) {
      if (c.method === 'from') out.push({ table: c.args[0] as string, calls: [] })
      else out[out.length - 1]?.calls.push(c)
    }
    return out
  }
  const isDelete = (s: { calls: { method: string }[] }) =>
    s.calls.some((c) => c.method === 'delete')

  // ri-1, ri-2 archived; s-empty and s-empty2 deletable; s-task holds a
  // task, s-note a note.
  const reads = () => ({
    routine_items: [
      { data: [{ id: 'ri-1' }, { id: 'ri-2' }], error: null },
    ] as SupabaseResult<unknown>[],
    subcategories: [
      {
        data: [
          { id: 's-empty' },
          { id: 's-task' },
          { id: 's-note' },
          { id: 's-empty2' },
        ],
        error: null,
      },
    ] as SupabaseResult<unknown>[],
    tasks: [
      { data: [{ subcategory_id: 's-task' }, { subcategory_id: 's-task' }], error: null },
    ] as SupabaseResult<unknown>[],
    notes: [{ data: [{ subcategory_id: 's-note' }], error: null }] as SupabaseResult<unknown>[],
  })

  it('archivedCounts returns routine items, deletable lists and kept lists', async () => {
    serve(reads())
    expect(await repo.data.archivedCounts()).toEqual({
      routineItems: 2,
      lists: 2,
      listsKept: 2,
    })
    expect(segments().some(isDelete)).toBe(false)
  })

  it('purgeArchived deletes archived routine items and only the empty archived lists', async () => {
    const q = reads()
    q.routine_items.push({ data: [{ id: 'ri-1' }, { id: 'ri-2' }], error: null })
    q.subcategories.push({ data: [{ id: 's-empty' }, { id: 's-empty2' }], error: null })
    serve(q)
    await db.routine_items.bulkPut([
      { id: 'ri-1', userId: 'u-1', routine: 'morning', label: 'a', sortOrder: 0, archivedAt: '2026-01-01T00:00:00.000Z', createdAt: '2026-01-01T00:00:00.000Z' },
      { id: 'ri-2', userId: 'u-1', routine: 'morning', label: 'b', sortOrder: 1, archivedAt: '2026-01-01T00:00:00.000Z', createdAt: '2026-01-01T00:00:00.000Z' },
      { id: 'ri-live', userId: 'u-1', routine: 'morning', label: 'c', sortOrder: 2, archivedAt: null, createdAt: '2026-01-01T00:00:00.000Z' },
    ])
    await db.routine_logs.bulkPut([
      { id: 'rl-1', userId: 'u-1', routineItemId: 'ri-1', dateKey: '2026-05-25', completed: true },
      { id: 'rl-live', userId: 'u-1', routineItemId: 'ri-live', dateKey: '2026-05-25', completed: true },
    ])
    await db.subcategories.bulkPut(
      ['s-empty', 's-task', 's-note', 's-empty2'].map((id, i) => ({
        id,
        userId: 'u-1',
        categoryId: 'c-1',
        name: id,
        sortOrder: i,
        archivedAt: '2026-01-01T00:00:00.000Z',
      })),
    )

    expect(await repo.data.purgeArchived()).toEqual({ routineItems: 2, lists: 2 })

    const deletes = segments().filter(isDelete)
    expect(deletes.map((d) => d.table)).toEqual(['routine_items', 'subcategories'])
    const inIds = (d: (typeof deletes)[number]) =>
      d.calls.find((c) => c.method === 'in' && c.args[0] === 'id')?.args[1]
    expect(inIds(deletes[0])).toEqual(['ri-1', 'ri-2'])
    expect(inIds(deletes[1])).toEqual(['s-empty', 's-empty2'])
    // Never a delete naming a list that holds a task or a note.
    for (const d of deletes) {
      expect(inIds(d)).not.toContain('s-task')
      expect(inIds(d)).not.toContain('s-note')
    }

    expect((await db.routine_items.toArray()).map((r) => r.id)).toEqual(['ri-live'])
    expect((await db.routine_logs.toArray()).map((r) => r.id)).toEqual(['rl-live'])
    expect((await db.subcategories.toArray()).map((r) => r.id).sort()).toEqual([
      's-note',
      's-task',
    ])
    expect(await db.outbox.count()).toBe(0)
  })

  it('throws offline without calling Supabase', async () => {
    isOnlineMock.mockReturnValue(false)
    await expect(repo.data.purgeArchived()).rejects.toThrow('offline')
    await expect(repo.data.archivedCounts()).rejects.toThrow('offline')
    expect(fromMock).not.toHaveBeenCalled()
  })
})
