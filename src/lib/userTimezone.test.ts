import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getSession, settingsGet } = vi.hoisted(() => ({
  getSession: vi.fn(),
  settingsGet: vi.fn(),
}))

vi.mock('@/lib/supabase', () => ({
  supabase: { auth: { getSession } },
}))

vi.mock('@/db/repo', () => ({
  repo: { settings: { get: settingsGet } },
}))

import { browserTimezone, loadUserTimezone } from './userTimezone'

const SESSION = { data: { session: { user: { id: 'u1' } } }, error: null }

describe('loadUserTimezone (chunk 61)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("(a) returns the settings row's timezone", async () => {
    getSession.mockResolvedValue(SESSION)
    settingsGet.mockResolvedValue({ userId: 'u1', timezone: 'Asia/Tokyo' })

    await expect(loadUserTimezone()).resolves.toBe('Asia/Tokyo')
    expect(settingsGet).toHaveBeenCalledWith('u1')
  })

  it('(b) falls back to the browser zone with no session', async () => {
    getSession.mockResolvedValue({ data: { session: null }, error: null })

    await expect(loadUserTimezone()).resolves.toBe(browserTimezone())
    expect(settingsGet).not.toHaveBeenCalled()
  })

  it('(c) falls back to the browser zone when timezone is blank', async () => {
    getSession.mockResolvedValue(SESSION)
    settingsGet.mockResolvedValue({ userId: 'u1', timezone: '' })

    await expect(loadUserTimezone()).resolves.toBe(browserTimezone())
  })

  it('(d) falls back to the browser zone when settings.get throws', async () => {
    getSession.mockResolvedValue(SESSION)
    settingsGet.mockRejectedValue(new Error('boom'))

    await expect(loadUserTimezone()).resolves.toBe(browserTimezone())
  })
})
