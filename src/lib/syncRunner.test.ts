import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { drainMock, countMock, authMock, unsubscribeMock } = vi.hoisted(() => ({
  drainMock: vi.fn(() =>
    Promise.resolve({ processed: 0, failed: 0, remaining: 0 }),
  ),
  countMock: vi.fn(() => Promise.resolve(0)),
  authMock: vi.fn(),
  unsubscribeMock: vi.fn(),
}))

vi.mock('@/db/outbox', () => ({ drainOutbox: drainMock }))
vi.mock('@/db/dexie', () => ({ db: { outbox: { count: countMock } } }))
vi.mock('@/lib/supabase', () => ({
  supabase: { auth: { onAuthStateChange: authMock } },
}))

import { startSyncRunner } from './syncRunner'

// The runner imports the replay engine on demand (chunk 84).
const settled = () => vi.dynamicImportSettled()

let authCb: ((event: string, session: unknown) => void) | undefined

beforeEach(() => {
  drainMock.mockClear()
  countMock.mockClear()
  countMock.mockResolvedValue(0)
  authMock.mockClear()
  unsubscribeMock.mockClear()
  authCb = undefined
  authMock.mockImplementation(
    (cb: (event: string, session: unknown) => void) => {
      authCb = cb
      return { data: { subscription: { unsubscribe: unsubscribeMock } } }
    },
  )
})

afterEach(() => {
  vi.useRealTimers()
})

describe('startSyncRunner', () => {
  it('drains once on start (app-load trigger)', async () => {
    const runner = startSyncRunner()
    await settled()
    expect(drainMock).toHaveBeenCalledTimes(1)
    runner.stop()
  })

  it('drains on the window online event', async () => {
    const runner = startSyncRunner()
    await settled()
    drainMock.mockClear()
    window.dispatchEvent(new Event('online'))
    await settled()
    expect(drainMock).toHaveBeenCalledTimes(1)
    runner.stop()
  })

  it('drains on a successful auth refresh, but ignores sign-out', async () => {
    const runner = startSyncRunner()
    await settled()
    drainMock.mockClear()
    authCb?.('TOKEN_REFRESHED', null)
    await settled()
    expect(drainMock).toHaveBeenCalledTimes(1)
    authCb?.('SIGNED_OUT', null)
    await settled()
    expect(drainMock).toHaveBeenCalledTimes(1) // unchanged
    runner.stop()
  })

  it('the 60s safety net drains only when the outbox is non-empty', async () => {
    vi.useFakeTimers()
    const runner = startSyncRunner({ intervalMs: 1000 })
    await settled()
    drainMock.mockClear()

    countMock.mockResolvedValue(0)
    await vi.advanceTimersByTimeAsync(1000)
    expect(drainMock).not.toHaveBeenCalled()

    countMock.mockResolvedValue(2)
    await vi.advanceTimersByTimeAsync(1000)
    await settled()
    expect(drainMock).toHaveBeenCalledTimes(1)

    runner.stop()
  })

  it('stop() clears the interval, removes the online listener, and unsubscribes auth', async () => {
    vi.useFakeTimers()
    const runner = startSyncRunner({ intervalMs: 1000 })
    runner.stop()
    expect(unsubscribeMock).toHaveBeenCalledTimes(1)

    await settled()
    drainMock.mockClear()
    countMock.mockResolvedValue(5)
    await vi.advanceTimersByTimeAsync(3000)
    window.dispatchEvent(new Event('online'))
    authCb?.('TOKEN_REFRESHED', null)
    await settled()

    expect(drainMock).not.toHaveBeenCalled()
  })
})
