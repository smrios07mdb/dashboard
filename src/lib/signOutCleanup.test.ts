import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { Category, Settings, Task } from '@/db/types'

/*
 * Sign-out local-data hygiene (chunk 18 — AUTH-01 / PRIV-01).
 *
 * The cache wipe must run on SIGNED_OUT (token expiry / multi-tab too, not just
 * the account-menu button), must clear the calendar "verified" flag, and must
 * PRESERVE the outbox (un-synced offline edits) while warning about it.
 */

const {
  onAuthStateChangeMock,
  unsubscribeMock,
  warningMock,
  signOutMock,
  flushPendingDeletesMock,
  parkPendingDeletesMock,
} = vi.hoisted(() => ({
  onAuthStateChangeMock: vi.fn(),
  unsubscribeMock: vi.fn(),
  warningMock: vi.fn(),
  signOutMock: vi.fn(),
  flushPendingDeletesMock: vi.fn(),
  parkPendingDeletesMock: vi.fn(() => 0),
}))

vi.mock('@/lib/supabase', () => ({
  supabase: {
    auth: { onAuthStateChange: onAuthStateChangeMock, signOut: signOutMock },
  },
}))
vi.mock('sonner', () => ({ toast: { warning: warningMock } }))
vi.mock('@/lib/taskUndo', () => ({
  flushPendingDeletes: flushPendingDeletesMock,
  parkPendingDeletes: parkPendingDeletesMock,
}))

import { db } from '@/db/dexie'
import { outboxUser } from '@/db/repo'
import {
  clearLocalDataOnSignOut,
  installSignOutCleanup,
  SIGN_OUT_FLUSH_CAP_MS,
  signOutUser,
} from './signOutCleanup'

const VERIFIED_AT_KEY = 'caldav:lastVerifiedAt'

function task(): Task {
  return {
    id: 't1',
    userId: 'u1',
    subcategoryId: 'sub1',
    title: 'Secret task',
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
    aiStatus: 'unconfigured',
    caldavAppleId: null,
    caldavCalendarUrl: null,
    caldavReadCalendars: null,
    caldavStatus: 'unconfigured',
    outlookStatus: 'unconfigured',
    outlookFeedName: null,
    outlookFetchedAt: null,
    plannerWriteout: false,
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
  parkPendingDeletesMock.mockClear()
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

  // Chunk 82: park before the wipe so the timer cannot commit with no session.
  it('parks pending deletes on SIGNED_OUT, before the outbox count', async () => {
    const countSpy = vi.spyOn(db.outbox, 'count')
    installSignOutCleanup()
    const handler = onAuthStateChangeMock.mock.calls[0][0] as (
      event: string,
      session: unknown,
    ) => void

    handler('SIGNED_OUT', null)
    expect(parkPendingDeletesMock).toHaveBeenCalledTimes(1)
    await vi.waitFor(() => expect(countSpy).toHaveBeenCalled())
    expect(parkPendingDeletesMock.mock.invocationCallOrder[0]).toBeLessThan(
      countSpy.mock.invocationCallOrder[0],
    )
    countSpy.mockRestore()
  })

  // Not a regression guard from base: base never calls parkPendingDeletes.
  it('does not park on SIGNED_IN or TOKEN_REFRESHED', () => {
    installSignOutCleanup()
    const handler = onAuthStateChangeMock.mock.calls[0][0] as (
      event: string,
      session: unknown,
    ) => void

    handler('SIGNED_IN', { user: { id: 'u1' } })
    handler('TOKEN_REFRESHED', { user: { id: 'u1' } })
    expect(parkPendingDeletesMock).not.toHaveBeenCalled()
  })

  it('records the signed-in user for queued writes, and clears it on SIGNED_OUT (chunk 84)', () => {
    installSignOutCleanup()
    const handler = onAuthStateChangeMock.mock.calls[0][0] as (
      event: string,
      session: unknown,
    ) => void

    handler('INITIAL_SESSION', { user: { id: 'u-a' } })
    expect(outboxUser()).toBe('u-a')
    handler('SIGNED_IN', { user: { id: 'u-b' } })
    expect(outboxUser()).toBe('u-b')
    handler('SIGNED_OUT', null)
    expect(outboxUser()).toBeUndefined()
  })

  it('returns an unsubscribe that tears down the listener', () => {
    const stop = installSignOutCleanup()
    stop()
    expect(unsubscribeMock).toHaveBeenCalledTimes(1)
  })
})

// Chunk 81: the two sign-out buttons commit pending task deletes first, so a
// delete inside its undo window is not lost to RLS once the session is gone.
describe('signOutUser', () => {
  beforeEach(() => {
    signOutMock.mockReset().mockResolvedValue({ error: null })
    flushPendingDeletesMock.mockReset()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('signs out once, only after the flush resolves', async () => {
    let resolve!: () => void
    flushPendingDeletesMock.mockReturnValue(
      new Promise<void>((r) => (resolve = r)),
    )
    const done = signOutUser()
    await Promise.resolve()
    await Promise.resolve()
    expect(flushPendingDeletesMock).toHaveBeenCalledTimes(1)
    expect(signOutMock).not.toHaveBeenCalled()

    resolve()
    await done
    expect(signOutMock).toHaveBeenCalledTimes(1)
  })

  it('signs out at exactly SIGN_OUT_FLUSH_CAP_MS when the flush hangs', async () => {
    vi.useFakeTimers()
    expect(SIGN_OUT_FLUSH_CAP_MS).toBe(4000)
    flushPendingDeletesMock.mockReturnValue(new Promise<void>(() => {}))
    const done = signOutUser()

    await vi.advanceTimersByTimeAsync(SIGN_OUT_FLUSH_CAP_MS - 1)
    expect(signOutMock).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(signOutMock).toHaveBeenCalledTimes(1)
    await done
  })

  it('still signs out when the flush rejects', async () => {
    flushPendingDeletesMock.mockRejectedValue(new Error('boom'))
    await expect(signOutUser()).resolves.toEqual({ error: null })
    expect(signOutMock).toHaveBeenCalledTimes(1)
  })

  it('returns the { error } from auth.signOut unchanged', async () => {
    flushPendingDeletesMock.mockResolvedValue(undefined)
    const error = new Error('network')
    signOutMock.mockResolvedValue({ error })
    const result = await signOutUser()
    expect(result.error).toBe(error)
  })
})
