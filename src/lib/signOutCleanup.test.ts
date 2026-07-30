import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { Category, Settings, Task } from '@/db/types'

/*
 * Sign-out local-data hygiene (chunk 18 — AUTH-01 / PRIV-01).
 *
 * The cache wipe must run on SIGNED_OUT (token expiry / multi-tab too, not just
 * the account-menu button), must clear the calendar "verified" flag, and must
 * PRESERVE the outbox (un-synced offline edits) while warning about it.
 */

const { onAuthStateChangeMock, unsubscribeMock, warningMock } = vi.hoisted(
  () => ({
    onAuthStateChangeMock: vi.fn(),
    unsubscribeMock: vi.fn(),
    warningMock: vi.fn(),
  }),
)

vi.mock('@/lib/supabase', () => ({
  supabase: { auth: { onAuthStateChange: onAuthStateChangeMock } },
}))
vi.mock('sonner', () => ({ toast: { warning: warningMock } }))

import { db } from '@/db/dexie'
import { clearLocalDataOnSignOut, installSignOutCleanup } from './signOutCleanup'

const VERIFIED_AT_KEY = 'caldav:lastVerifiedAt'

function task(): Task {
  return {
    id: 't1',
    userId: 'u1',
    subcategoryId: 'sub1',
    title: 'Secret task',
    notes: 'private notes',
    estimateMinutes: 25,
    dueAt: null,
    remindAt: null,
    notified: false,
    priority: null,
    completedAt: null,
    createdAt: '2026-05-31T00:00:00.000Z',
    updatedAt: '2026-05-31T00:00:00.000Z',
  }
}

function settings(): Settings {
  return {
    userId: 'u1',
    aiApiKey: null,
    caldavAppleId: null,
    caldavCalendarUrl: null,
    caldavStatus: 'unconfigured',
    outlookStatus: 'unconfigured',
    outlookFeedName: null,
    outlookFetchedAt: null,
    timezone: 'America/New_York',
    lastDailyReset: null,
  }
}

const category: Category = { id: 'c1', userId: 'u1', name: 'Work' }

async function seedCache(): Promise<void> {
  await db.tasks.put(task())
  await db.settings.put(settings())
  await db.categories.put(category)
}

async function enqueueWrite(): Promise<void> {
  await db.outbox.add({
    op: 'update',
    table: 'tasks',
    payload: { id: 't1' },
    createdAt: '2026-05-31T00:00:00.000Z',
    attempts: 0,
    lastError: null,
    lastAttemptAt: null,
  })
}

beforeEach(async () => {
  await db.transaction(
    'rw',
    [db.tasks, db.settings, db.categories, db.outbox],
    async () => {
      await db.tasks.clear()
      await db.settings.clear()
      await db.categories.clear()
      await db.outbox.clear()
    },
  )
  onAuthStateChangeMock.mockReset()
  unsubscribeMock.mockReset()
  warningMock.mockReset()
  onAuthStateChangeMock.mockReturnValue({
    data: { subscription: { unsubscribe: unsubscribeMock } },
  })
  localStorage.setItem(VERIFIED_AT_KEY, '1717000000000')
})

afterEach(() => {
  localStorage.clear()
})

describe('clearLocalDataOnSignOut', () => {
  it('wipes every cache mirror and clears the calendar verified flag', async () => {
    await seedCache()
    const result = await clearLocalDataOnSignOut()

    expect(await db.tasks.count()).toBe(0)
    expect(await db.settings.count()).toBe(0)
    expect(await db.categories.count()).toBe(0)
    expect(localStorage.getItem(VERIFIED_AT_KEY)).toBeNull()
    expect(result.pendingPreserved).toBe(0)
  })

  it('preserves a non-empty outbox and reports the pending count', async () => {
    await seedCache()
    await enqueueWrite()

    const onPendingPreserved = vi.fn()
    const result = await clearLocalDataOnSignOut({ onPendingPreserved })

    // Mirror tables wiped...
    expect(await db.tasks.count()).toBe(0)
    // ...but the queued write is NOT dropped.
    expect(await db.outbox.count()).toBe(1)
    expect(result.pendingPreserved).toBe(1)
    expect(onPendingPreserved).toHaveBeenCalledWith(1)
  })

  it('does not call the warning callback when the outbox is empty', async () => {
    await seedCache()
    const onPendingPreserved = vi.fn()
    await clearLocalDataOnSignOut({ onPendingPreserved })
    expect(onPendingPreserved).not.toHaveBeenCalled()
  })
})

describe('installSignOutCleanup', () => {
  it('wipes the cache on a SIGNED_OUT event', async () => {
    installSignOutCleanup()
    expect(onAuthStateChangeMock).toHaveBeenCalledTimes(1)
    const handler = onAuthStateChangeMock.mock.calls[0][0] as (
      event: string,
      session: unknown,
    ) => void

    await seedCache()
    handler('SIGNED_OUT', null)

    await vi.waitFor(async () => {
      expect(await db.tasks.count()).toBe(0)
    })
    expect(localStorage.getItem(VERIFIED_AT_KEY)).toBeNull()
  })

  it('does NOT wipe on a non-sign-out event', async () => {
    installSignOutCleanup()
    const handler = onAuthStateChangeMock.mock.calls[0][0] as (
      event: string,
      session: unknown,
    ) => void

    await seedCache()
    handler('SIGNED_IN', { user: { id: 'u1' } })
    await Promise.resolve()

    expect(await db.tasks.count()).toBe(1)
  })

  it('returns an unsubscribe that tears down the listener', () => {
    const stop = installSignOutCleanup()
    stop()
    expect(unsubscribeMock).toHaveBeenCalledTimes(1)
  })
})
