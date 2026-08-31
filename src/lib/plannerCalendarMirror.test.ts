import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  createCalendarMirror,
  type MirrorBlock,
  type MirrorDeps,
} from './plannerCalendarMirror'

/*
 * The Apple Calendar mirror (chunk 39): a pure module driven by injected
 * calendar + repo functions, so every rule of D8/D9 can be pinned without a
 * screen render — create-then-stamp, update when a uid exists, delete,
 * the skip gate, and the per-week reconcile passes.
 */

const block = (over: Partial<MirrorBlock> = {}): MirrorBlock => ({
  id: 'b-1',
  startAt: '2026-05-06T13:00:00.000Z',
  endAt: '2026-05-06T14:00:00.000Z',
  calendarUid: null,
  ...over,
})

function makeDeps(over: Partial<MirrorDeps> = {}) {
  return {
    enabled: vi.fn<MirrorDeps['enabled']>(() => true),
    createEvent: vi.fn<MirrorDeps['createEvent']>(async () => ({ uid: 'hupo-block-new' })),
    updateEvent: vi.fn<MirrorDeps['updateEvent']>(async () => undefined),
    deleteEvent: vi.fn<MirrorDeps['deleteEvent']>(async () => ({ missing: false })),
    stampUid: vi.fn<MirrorDeps['stampUid']>(async () => undefined),
    onWriteFailed: vi.fn<MirrorDeps['onWriteFailed']>(),
    warn: vi.fn<NonNullable<MirrorDeps['warn']>>(),
    ...over,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('afterCreate', () => {
  it('creates a planner-tagged event and stamps the uid on the block', async () => {
    const deps = makeDeps()
    await createCalendarMirror(deps).afterCreate(block(), 'Draft brief')
    expect(deps.createEvent).toHaveBeenCalledWith({
      title: 'Draft brief',
      start: '2026-05-06T13:00:00.000Z',
      end: '2026-05-06T14:00:00.000Z',
      source: 'planner',
    })
    expect(deps.stampUid).toHaveBeenCalledWith('b-1', 'hupo-block-new')
    expect(deps.onWriteFailed).not.toHaveBeenCalled()
  })

  it('on a calendar failure: toasts once, never stamps, never throws', async () => {
    const deps = makeDeps({
      createEvent: vi.fn(async () => {
        throw new Error('502')
      }),
    })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await expect(
      createCalendarMirror(deps).afterCreate(block(), 'x'),
    ).resolves.toBeUndefined()
    expect(deps.stampUid).not.toHaveBeenCalled()
    expect(deps.onWriteFailed).toHaveBeenCalledTimes(1)
    warn.mockRestore()
  })

  it('a failed stamp (Supabase) also counts as one failure', async () => {
    const deps = makeDeps({
      stampUid: vi.fn(async () => {
        throw new Error('rls')
      }),
    })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await createCalendarMirror(deps).afterCreate(block(), 'x')
    expect(deps.onWriteFailed).toHaveBeenCalledTimes(1)
    warn.mockRestore()
  })
})

describe('afterUpdate', () => {
  it('rebuilds the event when the block has a uid', async () => {
    const deps = makeDeps()
    await createCalendarMirror(deps).afterUpdate(
      block({ calendarUid: 'hupo-block-1', endAt: '2026-05-06T15:00:00.000Z' }),
      'Draft brief',
    )
    expect(deps.updateEvent).toHaveBeenCalledWith({
      uid: 'hupo-block-1',
      title: 'Draft brief',
      start: '2026-05-06T13:00:00.000Z',
      end: '2026-05-06T15:00:00.000Z',
    })
    expect(deps.createEvent).not.toHaveBeenCalled()
  })

  it('creates instead when the block has no uid yet (carryMove on an offline placement)', async () => {
    const deps = makeDeps()
    await createCalendarMirror(deps).afterUpdate(block(), 'Draft brief')
    expect(deps.updateEvent).not.toHaveBeenCalled()
    expect(deps.createEvent).toHaveBeenCalledTimes(1)
    expect(deps.stampUid).toHaveBeenCalledWith('b-1', 'hupo-block-new')
  })
})

describe('afterDelete', () => {
  it('deletes the event when a uid is present and treats missing as done', async () => {
    const deps = makeDeps({ deleteEvent: vi.fn(async () => ({ missing: true })) })
    await createCalendarMirror(deps).afterDelete('hupo-block-1')
    expect(deps.deleteEvent).toHaveBeenCalledWith('hupo-block-1')
    expect(deps.onWriteFailed).not.toHaveBeenCalled()
  })

  it('does nothing without a uid', async () => {
    const deps = makeDeps()
    await createCalendarMirror(deps).afterDelete(null)
    expect(deps.deleteEvent).not.toHaveBeenCalled()
  })
})

describe('skip gate', () => {
  it('makes no calendar call and no toast when disabled (toggle off / not ok / offline)', async () => {
    const deps = makeDeps({ enabled: vi.fn(() => false) })
    const m = createCalendarMirror(deps)
    await m.afterCreate(block(), 'x')
    await m.afterUpdate(block({ calendarUid: 'u' }), 'x')
    await m.afterDelete('u')
    await m.reconcile({
      key: 'k',
      blocks: [block()],
      plannerEvents: [{ uid: 'orphan', start: 'a', end: 'b' }],
      titleOf: () => 'x',
    })
    expect(deps.createEvent).not.toHaveBeenCalled()
    expect(deps.updateEvent).not.toHaveBeenCalled()
    expect(deps.deleteEvent).not.toHaveBeenCalled()
    expect(deps.stampUid).not.toHaveBeenCalled()
    expect(deps.onWriteFailed).not.toHaveBeenCalled()
  })

  it('re-checks enabled per call (online-ness can change between calls)', async () => {
    const enabled = vi.fn().mockReturnValueOnce(false).mockReturnValueOnce(true)
    const deps = makeDeps({ enabled })
    const m = createCalendarMirror(deps)
    await m.afterCreate(block(), 'x')
    await m.afterCreate(block({ id: 'b-2' }), 'x')
    expect(deps.createEvent).toHaveBeenCalledTimes(1)
  })
})

describe('reconcile', () => {
  const titles: Record<string, string> = { 'b-1': 'One', 'b-2': 'Two', 'b-3': 'Three' }
  const titleOf = (id: string) => titles[id]

  it('deletes orphans, backfills null uids, and updates time drift — in that order', async () => {
    const calls: string[] = []
    const deps = makeDeps({
      deleteEvent: vi.fn(async (uid: string) => {
        calls.push(`delete:${uid}`)
        return { missing: false }
      }),
      createEvent: vi.fn(async () => {
        calls.push('create')
        return { uid: 'hupo-block-new' }
      }),
      updateEvent: vi.fn(async (a: { uid: string }) => {
        calls.push(`update:${a.uid}`)
      }),
    })
    await createCalendarMirror(deps).reconcile({
      key: '2026-05-04:0',
      blocks: [
        block({ id: 'b-1', calendarUid: 'hupo-block-1' }), // in sync
        block({ id: 'b-2', calendarUid: null }), // backfill
        block({
          id: 'b-3',
          calendarUid: 'hupo-block-3',
          startAt: '2026-05-07T09:00:00.000Z',
          endAt: '2026-05-07T10:00:00.000Z',
        }), // drift
      ],
      plannerEvents: [
        { uid: 'hupo-block-1', start: '2026-05-06T13:00:00.000Z', end: '2026-05-06T14:00:00.000Z' },
        { uid: 'hupo-block-3', start: '2026-05-07T09:00:00.000Z', end: '2026-05-07T09:30:00.000Z' },
        { uid: 'hupo-block-gone', start: '2026-05-08T09:00:00.000Z', end: '2026-05-08T09:30:00.000Z' },
      ],
      titleOf,
    })
    expect(calls).toEqual(['delete:hupo-block-gone', 'create', 'update:hupo-block-3'])
    expect(deps.stampUid).toHaveBeenCalledWith('b-2', 'hupo-block-new')
    expect(deps.updateEvent).toHaveBeenCalledWith({
      uid: 'hupo-block-3',
      title: 'Three',
      start: '2026-05-07T09:00:00.000Z',
      end: '2026-05-07T10:00:00.000Z',
    })
    expect(deps.onWriteFailed).not.toHaveBeenCalled()
  })

  it('ignores sub-minute drift', async () => {
    const deps = makeDeps()
    await createCalendarMirror(deps).reconcile({
      key: 'k',
      blocks: [block({ id: 'b-1', calendarUid: 'hupo-block-1' })],
      plannerEvents: [
        { uid: 'hupo-block-1', start: '2026-05-06T13:00:30.000Z', end: '2026-05-06T14:00:00.000Z' },
      ],
      titleOf,
    })
    expect(deps.updateEvent).not.toHaveBeenCalled()
  })

  it('runs once per key — a repeat with the same key is a no-op, a new key runs', async () => {
    const deps = makeDeps()
    const m = createCalendarMirror(deps)
    const input = {
      blocks: [block({ id: 'b-2' })],
      plannerEvents: [],
      titleOf,
    }
    await m.reconcile({ key: '2026-05-04:0', ...input })
    await m.reconcile({ key: '2026-05-04:0', ...input })
    expect(deps.createEvent).toHaveBeenCalledTimes(1)
    await m.reconcile({ key: '2026-05-04:1', ...input })
    expect(deps.createEvent).toHaveBeenCalledTimes(2)
  })

  it('re-reconciles the same key when the blocks content changed (chunk 43, F2)', async () => {
    const deps = makeDeps()
    const m = createCalendarMirror(deps)
    const ev = {
      uid: 'hupo-block-1',
      start: '2026-05-06T13:00:00.000Z',
      end: '2026-05-06T14:00:00.000Z',
    }
    const inSync = block({ id: 'b-1', calendarUid: 'hupo-block-1' })
    await m.reconcile({
      key: '2026-05-04:0',
      blocks: [inSync],
      plannerEvents: [ev],
      titleOf,
    })
    expect(deps.updateEvent).not.toHaveBeenCalled()

    // The block drifts (another device, an outbox drain) — same key, and no
    // busyRefreshKey bump: the content signature must re-open the key.
    const driftedBlock = block({
      id: 'b-1',
      calendarUid: 'hupo-block-1',
      startAt: '2026-05-06T13:30:00.000Z',
      endAt: '2026-05-06T14:30:00.000Z',
    })
    await m.reconcile({
      key: '2026-05-04:0',
      blocks: [driftedBlock],
      plannerEvents: [ev],
      titleOf,
    })
    expect(deps.updateEvent).toHaveBeenCalledWith({
      uid: 'hupo-block-1',
      title: 'One',
      start: '2026-05-06T13:30:00.000Z',
      end: '2026-05-06T14:30:00.000Z',
    })

    // Unchanged content again — still deduped.
    await m.reconcile({
      key: '2026-05-04:0',
      blocks: [driftedBlock],
      plannerEvents: [ev],
      titleOf,
    })
    expect(deps.updateEvent).toHaveBeenCalledTimes(1)
  })

  it('background failures warn and continue — no toast, later passes still run', async () => {
    const deps = makeDeps({
      deleteEvent: vi.fn(async () => {
        throw new Error('502')
      }),
    })
    await createCalendarMirror(deps).reconcile({
      key: 'k',
      blocks: [block({ id: 'b-2' })],
      plannerEvents: [{ uid: 'hupo-block-gone', start: 'a', end: 'b' }],
      titleOf,
    })
    expect(deps.warn).toHaveBeenCalledTimes(1)
    expect(deps.onWriteFailed).not.toHaveBeenCalled()
    expect(deps.createEvent).toHaveBeenCalledTimes(1)
  })

  it('skips a backfill whose task title is unknown and a block with a create in flight', async () => {
    let resolveCreate: (v: { uid: string }) => void = () => {}
    const deps = makeDeps({
      createEvent: vi.fn(
        () =>
          new Promise<{ uid: string }>((r) => {
            resolveCreate = r
          }),
      ),
    })
    const m = createCalendarMirror(deps)
    const pending = m.afterCreate(block({ id: 'b-1' }), 'One')
    await m.reconcile({
      key: 'k',
      blocks: [block({ id: 'b-1' }), block({ id: 'b-unknown' })],
      plannerEvents: [],
      titleOf,
    })
    // Only the foreground create — reconcile neither doubled b-1 nor
    // created for the title-less block.
    expect(deps.createEvent).toHaveBeenCalledTimes(1)
    resolveCreate({ uid: 'hupo-block-1' })
    await pending
    expect(deps.stampUid).toHaveBeenCalledWith('b-1', 'hupo-block-1')
  })
})

/*
 * Chunk 46, F1/D1–D4: the session record of the mirror's own writes. The
 * `/busy` snapshot that feeds `plannerEvents` is refetched on
 * `[weekKey, weekStartDate, busyRefreshKey, busyTick]` only — nothing about
 * blocks, nothing about mirror writes — so an event the mirror just created
 * is absent from it and the drift loop had nothing to compare against. The
 * record fills exactly those uids; `plannerEvents` still wins where both
 * know one, so Calendar.app edits keep flowing one way.
 */
describe('reconcile: the mirror’s own writes (chunk 46)', () => {
  const titles: Record<string, string> = { 'b-1': 'One' }
  const titleOf = (id: string) => titles[id]

  it('a just-mirrored block whose times are unchanged is not rewritten', async () => {
    const deps = makeDeps()
    const m = createCalendarMirror(deps)
    await m.afterCreate(block({ id: 'b-1' }), 'One')
    await m.reconcile({
      key: 'k',
      blocks: [block({ id: 'b-1', calendarUid: 'hupo-block-new' })],
      plannerEvents: [],
      titleOf,
    })
    expect(deps.updateEvent).not.toHaveBeenCalled()
  })

  it('drift on a just-mirrored block is repaired against an empty plannerEvents', async () => {
    const deps = makeDeps()
    const m = createCalendarMirror(deps)
    await m.afterCreate(block({ id: 'b-1' }), 'One')
    await m.reconcile({
      key: 'k',
      blocks: [
        block({
          id: 'b-1',
          calendarUid: 'hupo-block-new',
          startAt: '2026-05-06T15:00:00.000Z',
          endAt: '2026-05-06T16:00:00.000Z',
        }),
      ],
      plannerEvents: [],
      titleOf,
    })
    expect(deps.updateEvent).toHaveBeenCalledTimes(1)
    expect(deps.updateEvent).toHaveBeenCalledWith({
      uid: 'hupo-block-new',
      title: 'One',
      start: '2026-05-06T15:00:00.000Z',
      end: '2026-05-06T16:00:00.000Z',
    })
  })

  it('a repair refreshes the record, so the same drift is never PATCHed twice', async () => {
    const deps = makeDeps()
    const m = createCalendarMirror(deps)
    await m.afterCreate(block({ id: 'b-1' }), 'One')
    const moved = block({
      id: 'b-1',
      calendarUid: 'hupo-block-new',
      startAt: '2026-05-06T15:00:00.000Z',
      endAt: '2026-05-06T16:00:00.000Z',
    })
    await m.reconcile({ key: 'k1', blocks: [moved], plannerEvents: [], titleOf })
    await m.reconcile({ key: 'k2', blocks: [moved], plannerEvents: [], titleOf })
    expect(deps.updateEvent).toHaveBeenCalledTimes(1)
  })

  it('plannerEvents wins where both know the uid (D3 — Calendar.app edits still repaired)', async () => {
    const deps = makeDeps()
    const m = createCalendarMirror(deps)
    // The mirror wrote 13:00–14:00 and recorded it; the calendar reports the
    // event moved to 18:00 (edited in Calendar.app). The block is unchanged,
    // so `written` alone would see no drift — `plannerEvents` must decide.
    await m.afterCreate(block({ id: 'b-1' }), 'One')
    await m.reconcile({
      key: 'k',
      blocks: [block({ id: 'b-1', calendarUid: 'hupo-block-new' })],
      plannerEvents: [
        {
          uid: 'hupo-block-new',
          start: '2026-05-06T18:00:00.000Z',
          end: '2026-05-06T19:00:00.000Z',
        },
      ],
      titleOf,
    })
    expect(deps.updateEvent).toHaveBeenCalledWith({
      uid: 'hupo-block-new',
      title: 'One',
      start: '2026-05-06T13:00:00.000Z',
      end: '2026-05-06T14:00:00.000Z',
    })
  })

  it('afterDelete drops the uid from the record', async () => {
    const deps = makeDeps()
    const m = createCalendarMirror(deps)
    await m.afterCreate(block({ id: 'b-1' }), 'One')
    await m.afterDelete('hupo-block-new')
    // A block still claiming the uid with drifted times: with the record
    // gone and `plannerEvents` empty there is nothing to compare against.
    await m.reconcile({
      key: 'k',
      blocks: [
        block({
          id: 'b-1',
          calendarUid: 'hupo-block-new',
          startAt: '2026-05-06T15:00:00.000Z',
          endAt: '2026-05-06T16:00:00.000Z',
        }),
      ],
      plannerEvents: [],
      titleOf,
    })
    expect(deps.updateEvent).not.toHaveBeenCalled()
  })
})

/*
 * Chunk 46, F2/D6: the unschedule double-delete. Chunk 43's content
 * signature makes the post-unschedule `blocks: []` a distinct snapshot, so
 * the reconcile runs and its orphan sweep hit a `plannerEvents` snapshot
 * that still listed the just-deleted event — two identical deletes per
 * unschedule, observed live on 2026-08-31.
 */
describe('reconcile: orphan sweep vs. the mirror’s own deletes (chunk 46)', () => {
  const titleOf = () => 'One'

  it('does not re-delete a uid afterDelete already removed', async () => {
    const deps = makeDeps()
    const m = createCalendarMirror(deps)
    await m.afterDelete('hupo-block-1')
    expect(deps.deleteEvent).toHaveBeenCalledTimes(1)
    await m.reconcile({
      key: 'k',
      blocks: [],
      plannerEvents: [
        { uid: 'hupo-block-1', start: 'a', end: 'b' },
      ],
      titleOf,
    })
    expect(deps.deleteEvent).toHaveBeenCalledTimes(1)
  })

  it('still sweeps an orphan the mirror never deleted', async () => {
    const deps = makeDeps()
    const m = createCalendarMirror(deps)
    await m.afterDelete('hupo-block-1')
    await m.reconcile({
      key: 'k',
      blocks: [],
      plannerEvents: [
        { uid: 'hupo-block-1', start: 'a', end: 'b' },
        { uid: 'hupo-block-other', start: 'a', end: 'b' },
      ],
      titleOf,
    })
    expect(deps.deleteEvent).toHaveBeenCalledTimes(2)
    expect(deps.deleteEvent).toHaveBeenLastCalledWith('hupo-block-other')
  })
})

/*
 * Chunk 47, D8/D9. Two things chunk 46 left open, both reproduced against its
 * committed module:
 *
 *  - D8: the delete guard was populated *after* the network await, so it was
 *    still empty when the concurrent sweep read it. Live on 2026-08-31 the
 *    sweep's delete started at +184 ms while the mirror's own was still in
 *    flight until ~+594 ms — the sequential case the chunk-46 tests cover is
 *    the one the implementation already handled.
 *  - D9: `plannerEvents` winning unconditionally made a single drag-move fire
 *    two identical PATCHes, because the post-move reconcile compared the moved
 *    block against a snapshot that predates the mirror's own write. The newer
 *    observation wins instead; D3's purpose is untouched.
 */
describe('afterDelete: the guard fires while the delete is in flight (chunk 47)', () => {
  const titleOf = () => 'One'

  it('the concurrent sweep does not re-delete a uid whose delete is still pending', async () => {
    const resolvers: Array<() => void> = []
    const deleteEvent = vi.fn<MirrorDeps['deleteEvent']>(
      () =>
        new Promise((res) => {
          resolvers.push(() => res({ missing: false }))
        }),
    )
    const deps = makeDeps({ deleteEvent })
    const m = createCalendarMirror(deps)

    // Deliberately NOT awaited: this is the window the live run measured.
    const pendingDelete = m.afterDelete('hupo-block-1')
    await Promise.resolve()
    expect(deleteEvent).toHaveBeenCalledTimes(1)

    const pendingReconcile = m.reconcile({
      key: 'k',
      blocks: [],
      plannerEvents: [{ uid: 'hupo-block-1', start: 'a', end: 'b' }],
      titleOf,
    })
    await Promise.resolve()
    expect(deleteEvent).toHaveBeenCalledTimes(1)

    for (const resolve of resolvers) resolve()
    await Promise.all([pendingDelete, pendingReconcile])
    expect(deleteEvent).toHaveBeenCalledTimes(1)
  })

  it('a failed delete leaves the uid sweepable, and still toasts once', async () => {
    const deleteEvent = vi.fn<MirrorDeps['deleteEvent']>(async () => {
      throw new Error('502')
    })
    const deps = makeDeps({ deleteEvent })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const m = createCalendarMirror(deps)

    await m.afterDelete('hupo-block-1')
    expect(deps.onWriteFailed).toHaveBeenCalledTimes(1)

    deleteEvent.mockResolvedValue({ missing: false })
    await m.reconcile({
      key: 'k',
      blocks: [],
      plannerEvents: [{ uid: 'hupo-block-1', start: 'a', end: 'b' }],
      titleOf,
    })
    expect(deleteEvent).toHaveBeenCalledTimes(2)
    expect(deleteEvent).toHaveBeenLastCalledWith('hupo-block-1')
    expect(deps.onWriteFailed).toHaveBeenCalledTimes(1)
    warn.mockRestore()
  })
})

describe('reconcile: the newer observation wins (chunk 47, D9)', () => {
  const titleOf = () => 'One'

  const moved = block({
    id: 'b-1',
    calendarUid: 'hupo-block-1',
    startAt: '2026-05-06T15:00:00.000Z',
    endAt: '2026-05-06T16:00:00.000Z',
  })

  it('a drag-move fires exactly one updateEvent when the snapshot predates the write', async () => {
    const deps = makeDeps()
    const m = createCalendarMirror(deps)
    const fetchedAt = Date.now() - 5_000

    await m.afterUpdate(moved, 'One')
    expect(deps.updateEvent).toHaveBeenCalledTimes(1)

    // The blocks refetch that follows the move is a new content signature, so
    // the reconcile runs — against the pre-move `/busy` snapshot.
    await m.reconcile({
      key: 'k',
      blocks: [moved],
      plannerEvents: [
        {
          uid: 'hupo-block-1',
          start: '2026-05-06T13:00:00.000Z',
          end: '2026-05-06T14:00:00.000Z',
        },
      ],
      plannerEventsAt: fetchedAt,
      titleOf,
    })
    expect(deps.updateEvent).toHaveBeenCalledTimes(1)
  })

  it('a snapshot fetched after the write still wins — Calendar.app edits repaired', async () => {
    const deps = makeDeps()
    const m = createCalendarMirror(deps)

    // The mirror wrote 13:00–14:00; a later `/busy` reports 18:00 (the event
    // was edited in Calendar.app). That is drift and must be rewritten to the
    // DB time, one-way, exactly as D3 required.
    await m.afterCreate(block({ id: 'b-1' }), 'One')
    await m.reconcile({
      key: 'k',
      blocks: [block({ id: 'b-1', calendarUid: 'hupo-block-new' })],
      plannerEvents: [
        {
          uid: 'hupo-block-new',
          start: '2026-05-06T18:00:00.000Z',
          end: '2026-05-06T19:00:00.000Z',
        },
      ],
      plannerEventsAt: Date.now() + 60_000,
      titleOf,
    })
    expect(deps.updateEvent).toHaveBeenCalledTimes(1)
    expect(deps.updateEvent).toHaveBeenCalledWith({
      uid: 'hupo-block-new',
      title: 'One',
      start: '2026-05-06T13:00:00.000Z',
      end: '2026-05-06T14:00:00.000Z',
    })
  })
})
