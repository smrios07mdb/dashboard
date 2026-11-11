import { beforeEach, describe, expect, it, vi } from 'vitest'

// Hoisted mocks so sample-data's transitive @/lib/supabase + @/lib/network
// imports see the mocked versions (mirrors repo.test.ts).
const { fromMock, isOnlineMock } = vi.hoisted(() => ({
  fromMock: vi.fn(),
  isOnlineMock: vi.fn(() => true),
}))

vi.mock('@/lib/supabase', () => ({ supabase: { from: fromMock } }))
vi.mock('@/lib/network', () => ({ isOnline: isOnlineMock }))
vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
  },
}))

import { db } from '@/db/dexie'
import type { OutboxRow } from '@/db/types'

import { wipeMyData } from './sample-data'

type SupabaseResult<T> = { data: T | null; error: unknown }

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
        return () => chain
      },
    },
  )
  return chain as unknown as PromiseLike<SupabaseResult<T>>
}

const SETTINGS_ROW = {
  user_id: 'u1',
  ai_status: 'unconfigured' as const,
  caldav_apple_id: null,
  caldav_calendar_url: null,
  caldav_status: 'unconfigured' as const,
  timezone: 'America/New_York',
  last_daily_reset: null,
}

const staleOutboxRow: Omit<OutboxRow, 'id'> = {
  op: 'insert',
  table: 'tasks',
  payload: { id: 'stale-before-wipe' },
  createdAt: '2026-05-20T00:00:00.000Z',
  attempts: 0,
  lastError: null,
  lastAttemptAt: null,
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
  await clearDb()
})

describe('wipeMyData — clears the outbox (chunk-15 resolution 10b)', () => {
  it('online wipe empties the outbox (stale rows gone, teardown enqueues none)', async () => {
    // Every read returns empty; settings.update returns a valid row.
    fromMock.mockImplementation((table: string) =>
      makeChain<unknown>(
        table === 'settings'
          ? { data: SETTINGS_ROW, error: null }
          : { data: [], error: null },
      ),
    )
    await db.outbox.add(staleOutboxRow as OutboxRow)
    expect(await db.outbox.count()).toBe(1)

    await wipeMyData('u1')

    expect(await db.outbox.count()).toBe(0)
  })

  it('offline wipe drops stale rows FIRST but preserves the wipe’s own enqueued teardown', async () => {
    isOnlineMock.mockReturnValue(false)

    // A task in the cache so the offline teardown has something to delete.
    await db.tasks.put({
      id: 't-cache',
      userId: 'u1',
      subcategoryId: 's1',
      title: 'cached',
      estimateMinutes: 0,
      dueAt: null,
      remindAt: null,
      notified: false,
      priority: null,
      completedAt: null,
      createdAt: '2026-05-23T00:00:00.000Z',
      updatedAt: '2026-05-23T00:00:00.000Z',
    })
    await db.outbox.add(staleOutboxRow as OutboxRow)

    await wipeMyData('u1')

    const rows = await db.outbox.toArray()
    // The pre-existing stale row must be gone (cleared first)...
    expect(
      rows.find((r) => (r.payload as { id?: string }).id === 'stale-before-wipe'),
    ).toBeUndefined()
    // ...but the wipe's own offline teardown must survive so it still syncs.
    expect(rows.some((r) => r.op === 'delete' && r.table === 'tasks')).toBe(true)
  })
})

describe('wipeMyData — tracked sessions (chunk 98, D13)', () => {
  const session = (id: string) => ({
    id,
    userId: 'u1',
    kind: 'focus' as const,
    startedAt: '2026-11-11T14:00:00.000Z',
    endedAt: '2026-11-11T14:25:00.000Z',
    plannedSeconds: 1500,
    activeSeconds: 1500,
    outcome: 'completed' as const,
    taskId: null,
    taskTitle: null,
    createdAt: '2026-11-11T14:25:01.000Z',
  })

  beforeEach(async () => {
    await db.tracked_sessions.clear()
  })

  it('online: every session is deleted, after notes and before tasks', async () => {
    const order: string[] = []
    fromMock.mockImplementation((table: string) => {
      order.push(table)
      if (table === 'settings') {
        return makeChain<unknown>({ data: SETTINGS_ROW, error: null })
      }
      if (table === 'tracked_sessions') {
        // The first call is the list; the next two are the deletes.
        const listed = order.filter((t) => t === 'tracked_sessions').length === 1
        return makeChain<unknown>({
          data: listed
            ? [
                { id: 's-1', user_id: 'u1', kind: 'focus' },
                { id: 's-2', user_id: 'u1', kind: 'meditation' },
              ]
            : null,
          error: null,
        })
      }
      return makeChain<unknown>({ data: [], error: null })
    })

    await wipeMyData('u1')

    expect(order.filter((t) => t === 'tracked_sessions')).toHaveLength(3)
    expect(order.indexOf('notes')).toBeLessThan(order.indexOf('tracked_sessions'))
    expect(order.lastIndexOf('tracked_sessions')).toBeLessThan(
      order.indexOf('tasks'),
    )
    expect(await db.tracked_sessions.count()).toBe(0)
    expect(await db.outbox.count()).toBe(0)
  })

  it('offline: cached sessions go and their deletes are queued', async () => {
    isOnlineMock.mockReturnValue(false)
    await db.tracked_sessions.bulkPut([session('s-1'), session('s-2')])

    await wipeMyData('u1')

    expect(await db.tracked_sessions.count()).toBe(0)
    const rows = await db.outbox.toArray()
    expect(
      rows
        .filter((r) => r.op === 'delete' && r.table === 'tracked_sessions')
        .map((r) => (r.payload as { id: string }).id)
        .sort(),
    ).toEqual(['s-1', 's-2'])
  })
})
