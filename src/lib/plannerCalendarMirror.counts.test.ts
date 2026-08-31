import { describe, expect, it, vi, beforeEach } from 'vitest'

vi.mock('@/lib/supabase', () => ({
  supabase: { auth: { getSession: async () => ({ data: { session: { access_token: 'T' } }, error: null }) } },
}))

import { createCalendarMirror, type MirrorBlock } from './plannerCalendarMirror'
import { createEvent, updateEvent, deleteEvent } from './calendarApi'

type Entry = { method: string; url: string; status: number }
let log: Entry[] = []

beforeEach(() => {
  log = []
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    const method = (init?.method ?? 'GET').toUpperCase()
    log.push({ method, url: String(url).replace('https://dashboard-caldav-proxy.vercel.app', ''), status: 200 })
    if (method !== 'GET') await new Promise((r) => setTimeout(r, 25))
    return { ok: true, status: 200, json: async () => ({ ok: true, uid: 'hupo-block-new' }) } as unknown as Response
  })
})

const ev = (method: string) => log.filter((e) => e.method === method && e.url.startsWith('/api/calendar/events'))
const deps = () => ({
  enabled: () => true,
  createEvent, updateEvent, deleteEvent,
  stampUid: async () => undefined,
  onWriteFailed: () => undefined,
  warn: () => undefined,
})
const B = (o: Partial<MirrorBlock> = {}): MirrorBlock => ({
  id: 'b1', startAt: '2026-09-01T16:00:00.000Z', endAt: '2026-09-01T17:00:00.000Z',
  calendarUid: 'hupo-block-AAA', ...o,
})
const OLD = { uid: 'hupo-block-AAA', start: '2026-09-01T14:00:00.000Z', end: '2026-09-01T15:00:00.000Z' }
const T = (s: string) => Date.parse(s)

describe('0831k — app-issued mutation counts at d075268', () => {
  it('S1  move: PATCH before the post-move refetch, and calls after it', async () => {
    const m = createCalendarMirror(deps())
    const moved = B()
    const pending = new Set(['b1'])
    const snapAt = T('2026-08-31T20:00:00Z')
    // frames 1+2: optimistic patch, then patchBlocks(saved) — both while the caller owns the write
    const savedRow = B({ startAt: '2026-09-01T16:00:00+00:00', endAt: '2026-09-01T17:00:00+00:00' })
    await m.reconcile({ key: 'wk:1', blocks: [moved], plannerEvents: [OLD], plannerEventsAt: snapAt, pending, titleOf: () => 'Smoke-Blk' })
    await m.reconcile({ key: 'wk:1', blocks: [savedRow], plannerEvents: [OLD], plannerEventsAt: snapAt, pending, titleOf: () => 'Smoke-Blk' })
    const before = ev('PATCH').length
    await m.afterUpdate(moved, 'Smoke-Blk')          // the mutation's own mirror write
    pending.clear()
    const atRefetch = ev('PATCH').length
    // post-move blocks refetch: same stale snapshot, mirror's record is newer
    await m.reconcile({ key: 'wk:2', blocks: [moved], plannerEvents: [OLD], plannerEventsAt: snapAt, pending, titleOf: () => 'Smoke-Blk' })
    const after = log.filter((e) => e.url.startsWith('/api/calendar/events')).length - atRefetch
    console.log(`S1 pre-write reconciles=${before}  PATCH before refetch=${atRefetch}  any /events after refetch=${after}`)
    console.log(JSON.stringify(log, null, 0))
    expect(atRefetch).toBe(1)
    expect(after).toBe(0)
  })

  it('S2  unschedule: delete-by-uid', async () => {
    const m = createCalendarMirror(deps())
    const inFlight = m.afterDelete('hupo-block-AAA')   // NOT awaited — live, the sweep fires while this runs
    await m.reconcile({ key: 'wk:3', blocks: [], plannerEvents: [OLD], plannerEventsAt: T('2026-08-31T20:00:00Z'), titleOf: () => 'Smoke-Blk' })
    await inFlight
    const d = ev('DELETE')
    console.log(`S2 DELETE count=${d.length}`)
    console.log(JSON.stringify(d, null, 0))
    expect(d.length).toBe(1)
  })

  it('S3  D15: orphan in the snapshot across two deferred passes', async () => {
    const m = createCalendarMirror(deps())
    const orphan = { uid: 'hupo-block-ORPHAN', start: '2026-09-02T14:00:00.000Z', end: '2026-09-02T15:00:00.000Z' }
    const pending = new Set(['b1'])
    const args = { key: 'wk:4', blocks: [B()], plannerEvents: [OLD, orphan], plannerEventsAt: T('2026-08-31T20:00:00Z'), pending, titleOf: () => 'Smoke-Blk' }
    await m.reconcile({ ...args })
    await m.reconcile({ ...args })
    const d = ev('DELETE').filter((e) => e.url.includes('ORPHAN'))
    const p = ev('PATCH')
    console.log(`S3 orphan DELETE=${d.length}  PATCH=${p.length}`)
    console.log(JSON.stringify(ev('DELETE'), null, 0))
    expect(d.length).toBe(1)
  })
})
