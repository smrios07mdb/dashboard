import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Chunk 90: the Sort General button's lazy module. Boundaries mocked: the
// session (JWT), `fetch` (the proxy), the pending re-read and the toasts.
const { getSessionMock, pendingMock, toastMock } = vi.hoisted(() => {
  vi.stubEnv('VITE_CALDAV_PROXY_URL', 'https://proxy.test/')
  const toastMock = Object.assign(vi.fn(), { error: vi.fn() })
  return { getSessionMock: vi.fn(), pendingMock: vi.fn(), toastMock }
})

vi.mock('@/lib/supabase', () => ({
  supabase: { auth: { getSession: getSessionMock } },
}))
vi.mock('@/db/repo', () => ({ repo: { routing: { pending: pendingMock } } }))
vi.mock('sonner', () => ({ toast: toastMock }))

import { runSort } from './sortGeneral'

const fetchMock = vi.fn()
const reply = (status: number, body: unknown) =>
  Promise.resolve({ status, json: () => Promise.resolve(body) })
const OK = {
  ok: true,
  run_id: 'r1',
  proposed: 2,
  kept: 1,
  skipped: 0,
  remaining: 0,
  usage: { input_tokens: 10, output_tokens: 5 },
}

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock)
  fetchMock.mockReset()
  toastMock.mockReset()
  toastMock.error.mockReset()
  pendingMock.mockReset().mockResolvedValue([{ id: 'p1' }])
  getSessionMock.mockResolvedValue({
    data: { session: { access_token: 'jwt-1' } },
    error: null,
  })
})
afterEach(() => vi.unstubAllGlobals())

describe('runSort (chunk 90 D6)', () => {
  it('POSTs /api/ai/sort with the JWT and returns the fresh pending rows', async () => {
    fetchMock.mockReturnValue(reply(200, { ...OK, remaining: 7 }))
    const out = await runSort(vi.fn())
    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe('https://proxy.test/api/ai/sort')
    expect(init.method).toBe('POST')
    expect(init.headers.Authorization).toBe('Bearer jwt-1')
    expect(out?.rows).toEqual([{ id: 'p1' }])
    expect(toastMock).not.toHaveBeenCalled()
    expect(toastMock.error).not.toHaveBeenCalled()
    // done() runs when the sheet closes: the remaining toast.
    out!.done()
    expect(toastMock).toHaveBeenCalledWith('7 more in General — tap Sort General again')
    out!.done() // once-only
    expect(toastMock).toHaveBeenCalledTimes(1)
  })

  it('remaining 0 → done() toasts nothing', async () => {
    fetchMock.mockReturnValue(reply(200, OK))
    const out = await runSort(vi.fn())
    out!.done()
    expect(toastMock).not.toHaveBeenCalled()
  })

  it('a 200 that is not ok:true → malformed', async () => {
    fetchMock.mockReturnValue(reply(200, { ok: false }))
    expect(await runSort(vi.fn())).toBeNull()
    expect(toastMock.error).toHaveBeenCalledWith('AI response was malformed. Try again.', undefined)
  })

  it('proposed + kept = 0 → toast "Nothing to sort", no sheet', async () => {
    fetchMock.mockReturnValue(reply(200, { ...OK, proposed: 0, kept: 0 }))
    expect(await runSort(vi.fn())).toBeNull()
    expect(toastMock).toHaveBeenCalledWith('Nothing to sort')
    expect(pendingMock).not.toHaveBeenCalled()
  })

  it.each([
    [412, { ok: false, error: 'missing_key' }, 'Add your Anthropic key in Settings.', true],
    [422, { ok: false, error: 'bad_key' }, 'Anthropic rejected the key. Replace it in Settings.', true],
    [502, { ok: false, error: 'upstream' }, "Couldn't reach the AI. Try again.", false],
    [502, { ok: false, error: 'malformed' }, 'AI response was malformed. Try again.', false],
    [502, { ok: false, error: 'truncated' }, "Claude's answer was cut off. Try again.", false],
    [401, { ok: false, error: 'unauthorized' }, 'Your session expired — sign in again.', false],
  ])('%i %j → its triage toast', async (status, body, copy, settingsLink) => {
    fetchMock.mockReturnValue(reply(status, body))
    const goSettings = vi.fn()
    expect(await runSort(goSettings)).toBeNull()
    const [msg, opts] = toastMock.error.mock.calls[0]!
    expect(msg).toBe(copy)
    if (settingsLink) {
      expect(opts.action.label).toBe('Settings')
      opts.action.onClick()
      expect(goSettings).toHaveBeenCalledWith('/settings')
    } else {
      expect(opts?.action).toBeUndefined()
    }
  })

  it('a fetch reject → network toast', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'))
    expect(await runSort(vi.fn())).toBeNull()
    expect(toastMock.error).toHaveBeenCalledWith("Couldn't reach the AI. Try again.", undefined)
  })
})
