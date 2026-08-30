import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// The module reads VITE_CALDAV_PROXY_URL at load time, so the stub has to be
// in place before the import is evaluated — hence inside vi.hoisted (mirrors
// the vi.hoisted + vi.mock shape in src/lib/ai.test.ts).
const { getSessionMock, fetchMock } = vi.hoisted(() => {
  vi.stubEnv('VITE_CALDAV_PROXY_URL', 'https://proxy.test')
  return { getSessionMock: vi.fn(), fetchMock: vi.fn() }
})

vi.mock('@/lib/supabase', () => ({
  supabase: { auth: { getSession: getSessionMock } },
}))

vi.stubGlobal('fetch', fetchMock)

import {
  CalendarError,
  createEvent,
  deleteEvent,
  disconnectOutlookFeed,
  getBusy,
  saveOutlookFeed,
  updateEvent,
} from './calendarApi'

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

beforeEach(() => {
  getSessionMock.mockResolvedValue({
    data: { session: { access_token: 'jwt-token' } },
    error: null,
  })
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('saveOutlookFeed', () => {
  it('POSTs the ICS URL and returns feedName + eventCount', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(200, { ok: true, feedName: 'Meetings — S. Ríos', eventCount: 14 }),
    )
    const result = await saveOutlookFeed({
      icsUrl: 'https://outlook.office365.com/owa/calendar/abc/calendar.ics',
    })
    expect(result).toEqual({ feedName: 'Meetings — S. Ríos', eventCount: 14 })

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://proxy.test/api/calendar/outlook')
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body as string)).toEqual({
      icsUrl: 'https://outlook.office365.com/owa/calendar/abc/calendar.ics',
    })
    expect(
      (init.headers as Record<string, string>).Authorization,
    ).toBe('Bearer jwt-token')
  })

  it.each([
    ['invalid_url', "That doesn't look like a valid https ICS link."],
    ['unreachable', "The feed didn't respond — check the link."],
    ['invalid_feed', "That URL isn't an iCalendar feed."],
  ])('maps a 422 %s to its user-readable message', async (code, message) => {
    fetchMock.mockResolvedValue(jsonResponse(422, { ok: false, error: code }))
    const err = await saveOutlookFeed({ icsUrl: 'https://example.com' }).catch(
      (e: unknown) => e,
    )
    expect(err).toBeInstanceOf(CalendarError)
    expect((err as CalendarError).kind).toBe('bad_feed')
    expect((err as CalendarError).message).toBe(message)
  })

  it('falls back to the generic bad_feed message on an unknown 422 code', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(422, { ok: false, error: 'something_new' }),
    )
    const err = await saveOutlookFeed({ icsUrl: 'https://example.com' }).catch(
      (e: unknown) => e,
    )
    expect(err).toBeInstanceOf(CalendarError)
    expect((err as CalendarError).kind).toBe('bad_feed')
    expect((err as CalendarError).message).toBe(
      "That feed couldn't be verified — check the link and retry.",
    )
  })
})

describe('disconnectOutlookFeed', () => {
  it('POSTs { icsUrl: null } to the outlook endpoint', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { ok: true }))
    await disconnectOutlookFeed()

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://proxy.test/api/calendar/outlook')
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body as string)).toEqual({ icsUrl: null })
  })
})

describe('getBusy (chunk-35 merged shape)', () => {
  it('returns the busy array with per-source health attached as .sources', async () => {
    const sources = {
      icloud: { configured: true, ok: true },
      outlook: {
        configured: true,
        status: 'stale' as const,
        fetchedAt: '2026-07-30T09:14:00.000Z',
        feedName: 'Meetings — S. Ríos',
      },
    }
    fetchMock.mockResolvedValue(
      jsonResponse(200, {
        ok: true,
        busy: [
          { start: 'a', end: 'b', source: 'icloud' },
          { start: 'c', end: 'd', source: 'outlook', title: 'Standup' },
        ],
        sources,
      }),
    )
    const result = await getBusy({ from: 'x', to: 'y' })
    expect(result).toHaveLength(2)
    expect(result[1]).toEqual({
      start: 'c',
      end: 'd',
      source: 'outlook',
      title: 'Standup',
    })
    expect(result.sources).toEqual(sources)
  })

  it('leaves .sources undefined when the proxy omits it (older callsites stay valid)', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(200, { ok: true, busy: [{ start: 'a', end: 'b' }] }),
    )
    const result = await getBusy({ from: 'x', to: 'y' })
    expect(result).toHaveLength(1)
    expect(result.sources).toBeUndefined()
  })
})

describe('planner mirror endpoints (chunk 39)', () => {
  it('createEvent forwards source: planner in the POST body', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { ok: true, uid: 'hupo-block-1' }))
    const out = await createEvent({
      title: 'Draft brief',
      start: 'a',
      end: 'b',
      source: 'planner',
    })
    expect(out).toEqual({ uid: 'hupo-block-1' })
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://proxy.test/api/calendar/events')
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body as string)).toEqual({
      title: 'Draft brief',
      start: 'a',
      end: 'b',
      source: 'planner',
    })
  })

  it('updateEvent PATCHes the rebuilt event and resolves on ok', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { ok: true }))
    await expect(
      updateEvent({ uid: 'hupo-block-1', title: 'T', start: 'a', end: 'b' }),
    ).resolves.toBeUndefined()
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://proxy.test/api/calendar/events')
    expect(init.method).toBe('PATCH')
    expect(JSON.parse(init.body as string)).toEqual({
      uid: 'hupo-block-1',
      title: 'T',
      start: 'a',
      end: 'b',
    })
    expect((init.headers as Record<string, string>).Authorization).toBe(
      'Bearer jwt-token',
    )
  })

  it('deleteEvent DELETEs by uid query and reports missing', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { ok: true }))
    await expect(deleteEvent('hupo-block-1')).resolves.toEqual({ missing: false })
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://proxy.test/api/calendar/events?uid=hupo-block-1')
    expect(init.method).toBe('DELETE')

    fetchMock.mockResolvedValueOnce(jsonResponse(200, { ok: true, missing: true }))
    await expect(deleteEvent('hupo-block-1')).resolves.toEqual({ missing: true })
  })

  it('a pre-chunk-39 proxy answering 405 surfaces as a network CalendarError', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(405, { ok: false, error: 'method_not_allowed' }),
    )
    await expect(deleteEvent('hupo-block-1')).rejects.toMatchObject({
      kind: 'network',
    })
  })

  it('getBusy parses plannerEvents (well-formed entries only) and leaves busy alone', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(200, {
        ok: true,
        busy: [{ start: 'a', end: 'b', source: 'icloud' }],
        plannerEvents: [
          { uid: 'hupo-block-1', start: 'c', end: 'd' },
          { uid: 42, start: 'e', end: 'f' },
          'junk',
        ],
      }),
    )
    const result = await getBusy({ from: 'x', to: 'y' })
    expect(result).toHaveLength(1)
    expect(result.plannerEvents).toEqual([{ uid: 'hupo-block-1', start: 'c', end: 'd' }])
  })

  it('getBusy leaves plannerEvents undefined when the proxy omits it (old proxy)', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(200, { ok: true, busy: [{ start: 'a', end: 'b' }] }),
    )
    const result = await getBusy({ from: 'x', to: 'y' })
    expect(result.plannerEvents).toBeUndefined()
  })
})
