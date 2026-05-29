import { beforeEach, describe, expect, it, vi } from 'vitest'

const { refreshSessionMock } = vi.hoisted(() => ({
  refreshSessionMock: vi.fn(),
}))

vi.mock('@/lib/supabase', () => ({
  supabase: { auth: { refreshSession: refreshSessionMock } },
}))

import { CalendarError } from './calendarApi'
import { recoverSignedOut, withSessionRetry } from './session'

const okSession = { data: { session: { access_token: 't' } }, error: null }
const noSession = { data: { session: null }, error: { message: 'invalid refresh token' } }

describe('recoverSignedOut', () => {
  beforeEach(() => refreshSessionMock.mockReset())

  it('returns "recovered" when refresh yields a session', async () => {
    refreshSessionMock.mockResolvedValue(okSession)
    expect(await recoverSignedOut()).toBe('recovered')
  })

  it('returns "signed-out" when refresh errors / yields no session', async () => {
    refreshSessionMock.mockResolvedValue(noSession)
    expect(await recoverSignedOut()).toBe('signed-out')
  })

  it('returns "signed-out" on a malformed refresh result (defensive catch)', async () => {
    // supabase-js reports a failed refresh by RESOLVING `{ error }` (the test
    // above), not by throwing — so attemptRefresh's try/catch is defensive. A
    // resolved-but-null result makes the destructuring throw *inside* the try,
    // exercising that catch branch without a throwing mock (a mock whose impl
    // throws/rejects trips Vitest's settled-results tracking here).
    refreshSessionMock.mockResolvedValue(null)
    expect(await recoverSignedOut()).toBe('signed-out')
  })

  it('de-dupes concurrent calls into a single refresh', async () => {
    let resolve!: (v: unknown) => void
    refreshSessionMock.mockReturnValue(
      new Promise((r) => {
        resolve = r
      }),
    )
    const a = recoverSignedOut()
    const b = recoverSignedOut()
    expect(refreshSessionMock).toHaveBeenCalledTimes(1)
    resolve(okSession)
    expect(await a).toBe('recovered')
    expect(await b).toBe('recovered')
  })
})

describe('withSessionRetry', () => {
  beforeEach(() => refreshSessionMock.mockReset())

  it('returns the result without refreshing on success', async () => {
    const action = vi.fn().mockResolvedValue('ok')
    expect(await withSessionRetry(action)).toBe('ok')
    expect(action).toHaveBeenCalledTimes(1)
    expect(refreshSessionMock).not.toHaveBeenCalled()
  })

  it('rethrows a non-signed_out error without refreshing', async () => {
    const action = vi.fn().mockRejectedValue(new CalendarError('auth_failed'))
    await expect(withSessionRetry(action)).rejects.toBeInstanceOf(CalendarError)
    expect(refreshSessionMock).not.toHaveBeenCalled()
    expect(action).toHaveBeenCalledTimes(1)
  })

  it('refreshes once and retries the action when signed_out then recovered', async () => {
    refreshSessionMock.mockResolvedValue(okSession)
    const action = vi
      .fn()
      .mockRejectedValueOnce(new CalendarError('signed_out'))
      .mockResolvedValueOnce('ok')
    expect(await withSessionRetry(action)).toBe('ok')
    expect(refreshSessionMock).toHaveBeenCalledTimes(1)
    expect(action).toHaveBeenCalledTimes(2)
  })

  it('throws without retrying when the refresh fails (signed-out → guard)', async () => {
    refreshSessionMock.mockResolvedValue(noSession)
    const action = vi.fn().mockRejectedValue(new CalendarError('signed_out'))
    await expect(withSessionRetry(action)).rejects.toBeInstanceOf(CalendarError)
    expect(refreshSessionMock).toHaveBeenCalledTimes(1)
    expect(action).toHaveBeenCalledTimes(1) // no retry
  })

  it('does not refresh a second time if the single retry also signs out', async () => {
    refreshSessionMock.mockResolvedValue(okSession)
    const action = vi.fn().mockRejectedValue(new CalendarError('signed_out'))
    await expect(withSessionRetry(action)).rejects.toBeInstanceOf(CalendarError)
    expect(refreshSessionMock).toHaveBeenCalledTimes(1) // recovered once only
    expect(action).toHaveBeenCalledTimes(2) // initial + exactly one retry
  })
})
