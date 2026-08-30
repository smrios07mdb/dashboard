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
