import { afterEach, describe, expect, it, vi } from 'vitest'

const {
  bulkUpsert,
  bulkDeleteAllForUser,
  existingIds,
  noteBodiesForTasks,
  outboxClear,
  wipeLocalCacheMock,
} = vi.hoisted(() => ({
    noteBodiesForTasks: vi.fn<
      (taskIds: string[]) => Promise<{ task_id: string; body: string }[]>
    >(() => Promise.resolve([])),
    bulkUpsert: vi.fn<(...args: unknown[]) => Promise<void>>(),
    bulkDeleteAllForUser: vi.fn<(...args: unknown[]) => Promise<void>>(),
    existingIds: vi.fn<(table: string, ids: string[]) => Promise<string[]>>(
      () => Promise.resolve([]),
    ),
    outboxClear: vi.fn(() => Promise.resolve()),
    wipeLocalCacheMock: vi.fn(() => Promise.resolve()),
  }))

vi.mock('@/db/repo', () => ({
  repo: {
    data: { bulkUpsert, bulkDeleteAllForUser, existingIds, noteBodiesForTasks },
  },
}))
vi.mock('@/db/dexie', () => ({ db: { outbox: { clear: outboxClear } } }))
vi.mock('@/db/localCache', () => ({ wipeLocalCache: wipeLocalCacheMock }))

import { buildExportPayload } from './export'
import {
  importData,
  ImportValidationError,
  previewCounts,
  validateImport,
} from './import'

/** One planner block, as it appears in an export file (chunk 50). */
const BLOCK = {
  id: 'b1',
  user_id: 'u1',
  task_id: 't1',
  start_at: '2026-09-01T13:00:00+00:00',
  end_at: '2026-09-01T14:00:00+00:00',
  calendar_uid: 'hupo-block-b1',
  created_at: '2026-08-01T00:00:00+00:00',
  updated_at: '2026-08-01T00:00:00+00:00',
}

/** The rows of the last bulkUpsert call for `table` (undefined if never called). */
function upsertedRows(table: string) {
  const call = bulkUpsert.mock.calls.filter((c) => c[0] === table).at(-1)
  return call?.[1] as Record<string, unknown>[] | undefined
}

function validPayload(over: Record<string, unknown> = {}) {
  return {
    version: 1,
    exported_at: 'x',
    user_id: 'u1',
    categories: [{ id: 'c1' }],
    subcategories: [{ id: 's1' }],
    tasks: [{ id: 't1' }],
    scheduled_blocks: [BLOCK],
    routine_items: [],
    routine_logs: [],
    settings: { user_id: 'u1' },
    ...over,
  }
}

afterEach(() => vi.clearAllMocks())

describe('validateImport', () => {
  it('accepts a well-formed version-1 file', () => {
    expect(() => validateImport(validPayload())).not.toThrow()
  })
  it('rejects an unsupported version', () => {
    expect(() => validateImport(validPayload({ version: 2 }))).toThrow(
      ImportValidationError,
    )
  })
  it('rejects a missing table key', () => {
    const p = validPayload()
    delete (p as Record<string, unknown>).tasks
    expect(() => validateImport(p)).toThrow(/tasks/)
  })
  it('rejects a non-array table', () => {
    expect(() => validateImport(validPayload({ tasks: {} }))).toThrow(
      ImportValidationError,
    )
  })
  it('rejects non-object input', () => {
    expect(() => validateImport('nope')).toThrow(ImportValidationError)
  })
  it('rejects a malformed table row (not an object with a string id) before any delete', () => {
    expect(() => validateImport(validPayload({ tasks: [{ title: 'no id' }] }))).toThrow(
      ImportValidationError,
    )
    expect(() => validateImport(validPayload({ subcategories: ['nope'] }))).toThrow(
      ImportValidationError,
    )
    expect(() =>
      validateImport(validPayload({ tasks: [{ id: '' }] })),
    ).toThrow(ImportValidationError)
  })
})

describe('settings credential safety (chunk-16 review fix)', () => {
  function settingsRowAfterImport(mode: 'merge' | 'replace') {
    return importData(
      validPayload({
        settings: {
          user_id: 'u1',
          timezone: 'America/Chicago',
          ai_api_key_encrypted: null,
          ai_status: 'ok',
          outlook_ics_url_encrypted: null,
          caldav_app_password_encrypted: null,
        },
      }),
      mode,
      'u1',
    ).then(() => {
      const call = bulkUpsert.mock.calls.find((c) => c[0] === 'settings')
      return (call?.[1] as Record<string, unknown>[])?.[0]
    })
  }

  it('omits every credential key from the settings upsert on Merge — live secrets survive', async () => {
    const row = await settingsRowAfterImport('merge')
    expect(row).toBeDefined()
    expect('caldav_app_password_encrypted' in (row as object)).toBe(false)
    expect('ai_api_key_encrypted' in (row as object)).toBe(false)
    expect('outlook_ics_url_encrypted' in (row as object)).toBe(false)
    expect((row as Record<string, unknown>).timezone).toBe('America/Chicago')
  })

  it('omits every credential key from the settings upsert on Replace too', async () => {
    const row = await settingsRowAfterImport('replace')
    expect(row).toBeDefined()
    expect('caldav_app_password_encrypted' in (row as object)).toBe(false)
    expect('ai_api_key_encrypted' in (row as object)).toBe(false)
    expect('outlook_ics_url_encrypted' in (row as object)).toBe(false)
  })
})

describe('server-held settings are never imported (chunk 56 D2)', () => {
  /** A pre-chunk-55 settings block: legacy plaintext column + stale statuses. */
  const PRE_55_SETTINGS = {
    user_id: 'u1',
    timezone: 'America/Chicago',
    planner_writeout: true,
    ai_api_key: null,
    ai_status: 'ok',
    caldav_status: 'ok',
    outlook_status: 'auth_failed',
  }

  async function settingsRowAfterImport(mode: 'merge' | 'replace') {
    await importData(validPayload({ settings: PRE_55_SETTINGS }), mode, 'u1')
    const row = upsertedRows('settings')?.[0]
    expect(row).toBeDefined()
    return row as Record<string, unknown>
  }

  it.each(['merge', 'replace'] as const)(
    '%s: a pre-55 file upserts settings without ai_api_key or ai_status',
    async (mode) => {
      const row = await settingsRowAfterImport(mode)
      expect('ai_api_key' in row).toBe(false)
      expect('ai_status' in row).toBe(false)
    },
  )

  it.each(['merge', 'replace'] as const)(
    '%s: caldav_status and outlook_status are stripped the same way',
    async (mode) => {
      const row = await settingsRowAfterImport(mode)
      expect('caldav_status' in row).toBe(false)
      expect('outlook_status' in row).toBe(false)
    },
  )

  it('non-credential settings still import', async () => {
    const row = await settingsRowAfterImport('merge')
    expect(row).toEqual({
      user_id: 'u1',
      timezone: 'America/Chicago',
      planner_writeout: true,
    })
  })

  it('does not mutate the parsed file', async () => {
    const settings = { ...PRE_55_SETTINGS }
    await importData(validPayload({ settings }), 'merge', 'u1')
    expect(settings).toEqual(PRE_55_SETTINGS)
  })
})

describe('previewCounts', () => {
  it('counts items per table', () => {
    expect(previewCounts(validateImport(validPayload()))).toMatchObject({
      categories: 1,
      subcategories: 1,
      tasks: 1,
      scheduled_blocks: 1,
      routine_items: 0,
      settings: 1,
    })
  })
})

describe('importData — validate before any delete (R4)', () => {
  it('a bad file throws and never deletes or upserts', async () => {
    await expect(
      importData(validPayload({ version: 99 }), 'replace', 'u1'),
    ).rejects.toThrow(ImportValidationError)
    expect(bulkDeleteAllForUser).not.toHaveBeenCalled()
    expect(bulkUpsert).not.toHaveBeenCalled()
    expect(outboxClear).not.toHaveBeenCalled()
  })
})

describe('replace mode', () => {
  it('tears down (never categories) then upserts parents→children, clears outbox, reloads cache', async () => {
    await importData(validPayload(), 'replace', 'u1')

    const deleted = bulkDeleteAllForUser.mock.calls.map((c) => c[0])
    expect(deleted).toEqual([
      'notes',
      'scheduled_blocks',
      'tasks',
      'routine_logs',
      'subcategories',
      'routine_items',
      'push_subscriptions',
    ])
    expect(deleted).not.toContain('categories')

    const upserted = bulkUpsert.mock.calls.map((c) => c[0])
    expect(upserted).toEqual([
      'subcategories',
      'tasks',
      'scheduled_blocks',
      'notes',
      'routine_items',
      'routine_logs',
      'settings',
    ])
    const settingsCall = bulkUpsert.mock.calls.find((c) => c[0] === 'settings')
    expect(settingsCall?.[2]).toBe('user_id')

    expect(outboxClear).toHaveBeenCalledTimes(1)
    expect(wipeLocalCacheMock).toHaveBeenCalledTimes(1)

    // every delete precedes every upsert
    const lastDelete = Math.max(...bulkDeleteAllForUser.mock.invocationCallOrder)
    const firstUpsert = Math.min(...bulkUpsert.mock.invocationCallOrder)
    expect(lastDelete).toBeLessThan(firstUpsert)
  })
})

describe('merge mode', () => {
  it('upserts (id-keyed) without deleting and without clearing the outbox', async () => {
    await importData(validPayload(), 'merge', 'u1')

    expect(bulkDeleteAllForUser).not.toHaveBeenCalled()
    expect(outboxClear).not.toHaveBeenCalled()

    const upserted = bulkUpsert.mock.calls.map((c) => c[0])
    expect(upserted).toEqual([
      'subcategories',
      'tasks',
      'scheduled_blocks',
      'notes',
      'routine_items',
      'routine_logs',
      'settings',
    ])
    const tasksCall = bulkUpsert.mock.calls.find((c) => c[0] === 'tasks')
    expect(tasksCall?.[2]).toBeUndefined() // default conflict key 'id'
  })
})

describe('scheduled_blocks (chunk 50)', () => {
  it('accepts a v1 file with no scheduled_blocks key and defaults it to [] (back-compat)', async () => {
    const p = validPayload()
    delete (p as Record<string, unknown>).scheduled_blocks
    const validated = validateImport(p)
    expect(validated.scheduled_blocks).toEqual([])
    expect(previewCounts(validated).scheduled_blocks).toBe(0)

    await importData(p, 'replace', 'u1')
    // Nothing to write (repo.bulkUpsert no-ops on an empty list) — but the
    // teardown still ran, so a stale live block cannot survive a Replace.
    expect(upsertedRows('scheduled_blocks')).toEqual([])
    expect(bulkDeleteAllForUser.mock.calls.map((c) => c[0])).toContain(
      'scheduled_blocks',
    )
  })

  it('does not mutate the caller\u2019s parsed object when defaulting', () => {
    const p = validPayload()
    delete (p as Record<string, unknown>).scheduled_blocks
    validateImport(p)
    expect('scheduled_blocks' in p).toBe(false)
  })

  it('rejects a non-array scheduled_blocks', () => {
    expect(() => validateImport(validPayload({ scheduled_blocks: {} }))).toThrow(
      ImportValidationError,
    )
  })

  it('rejects a malformed block row BEFORE any delete (R4)', async () => {
    expect(() =>
      validateImport(validPayload({ scheduled_blocks: [{ task_id: 't1' }] })),
    ).toThrow(/scheduled_blocks/)
    expect(() =>
      validateImport(validPayload({ scheduled_blocks: [{ ...BLOCK, id: 42 }] })),
    ).toThrow(ImportValidationError)

    await expect(
      importData(
        validPayload({ scheduled_blocks: [{ task_id: 't1' }] }),
        'replace',
        'u1',
      ),
    ).rejects.toThrow(ImportValidationError)
    expect(bulkDeleteAllForUser).not.toHaveBeenCalled()
    expect(bulkUpsert).not.toHaveBeenCalled()
  })

  it('replace: blocks are torn down first, re-inserted after tasks, uid nulled', async () => {
    await importData(validPayload(), 'replace', 'u1')

    const deleted = bulkDeleteAllForUser.mock.calls.map((c) => c[0])
    expect(deleted.indexOf('scheduled_blocks')).toBeLessThan(
      deleted.indexOf('tasks'),
    )
    const upserted = bulkUpsert.mock.calls.map((c) => c[0])
    expect(upserted.indexOf('scheduled_blocks')).toBeGreaterThan(
      upserted.indexOf('tasks'),
    )

    const rows = upsertedRows('scheduled_blocks')
    expect(rows).toHaveLength(1)
    // The uid is dropped on the way IN — the mirror's backfill re-creates the
    // event and stamps a fresh uid on the next load of that week (chunk 39).
    expect(rows?.[0].calendar_uid).toBeNull()
    expect(rows?.[0]).toMatchObject({
      id: 'b1',
      task_id: 't1',
      start_at: BLOCK.start_at,
      end_at: BLOCK.end_at,
    })
  })

  it('merge: upserts on task_id so a live block on the same task cannot collide', async () => {
    // Live DB holds block A for task t1; the file's block B targets t1 too.
    // unique (task_id) makes an id-keyed upsert fail partway — task_id wins.
    await importData(
      validPayload({
        scheduled_blocks: [
          {
            ...BLOCK,
            id: 'b-from-file',
            start_at: '2026-09-02T15:00:00+00:00',
            end_at: '2026-09-02T16:00:00+00:00',
          },
        ],
      }),
      'merge',
      'u1',
    )

    expect(bulkDeleteAllForUser).not.toHaveBeenCalled()
    const call = bulkUpsert.mock.calls.find((c) => c[0] === 'scheduled_blocks')
    expect(call?.[2]).toBe('task_id')
    const rows = call?.[1] as Record<string, unknown>[]
    expect(rows).toHaveLength(1) // one block per task survives
    expect(rows[0]).toMatchObject({
      task_id: 't1',
      start_at: '2026-09-02T15:00:00+00:00',
      end_at: '2026-09-02T16:00:00+00:00',
    })
    expect(rows[0].calendar_uid).toBeNull()
  })

  it('round-trips: export \u2192 replace-import writes the same block set modulo calendar_uid', async () => {
    const exported = buildExportPayload({
      userId: 'u1',
      exportedAt: '2026-08-31T00:00:00.000Z',
      tables: {
        categories: [{ id: 'c1' }],
        subcategories: [{ id: 's1' }],
        tasks: [{ id: 't1' }, { id: 't2' }],
        scheduled_blocks: [BLOCK, { ...BLOCK, id: 'b2', task_id: 't2' }],
        routine_items: [],
        routine_logs: [],
      },
      settings: null,
    })
    expect(exported.scheduled_blocks).toEqual([
      BLOCK,
      { ...BLOCK, id: 'b2', task_id: 't2' },
    ])

    await importData(JSON.parse(JSON.stringify(exported)), 'replace', 'u1')

    const rows = upsertedRows('scheduled_blocks') ?? []
    expect(rows).toEqual(
      exported.scheduled_blocks.map((b) => ({ ...b, calendar_uid: null })),
    )
  })
})

describe('notes (chunk 58)', () => {
  /** A note as it appears in an export file. */
  const NOTE = {
    id: 'n1',
    user_id: 'u1',
    title: 'Kickoff',
    body: 'Agenda',
    pinned: false,
    task_id: 't1',
    subcategory_id: null,
    detached_label: null,
    detached_at: null,
    created_at: '2026-10-01T00:00:00+00:00',
    updated_at: '2026-10-02T00:00:00+00:00',
  }

  it('exports notes after scheduled_blocks', () => {
    const exported = buildExportPayload({
      userId: 'u1',
      exportedAt: 'x',
      tables: { tasks: [{ id: 't1' }], notes: [NOTE] },
      settings: null,
    })
    expect(exported.notes).toEqual([NOTE])
    const keys = Object.keys(exported)
    expect(keys.indexOf('notes')).toBe(keys.indexOf('scheduled_blocks') + 1)
  })

  it('a file without a notes key still imports, as no notes', async () => {
    const p = validPayload()
    expect('notes' in p).toBe(false)
    const validated = validateImport(p)
    expect(validated.notes).toEqual([])
    expect(previewCounts(validated).notes).toBe(0)

    await importData(p, 'replace', 'u1')
    expect(upsertedRows('notes')).toEqual([])
    expect(existingIds).not.toHaveBeenCalled()
  })

  it('rejects malformed notes before anything is deleted', async () => {
    expect(() => validateImport(validPayload({ notes: {} }))).toThrow(/notes/)
    await expect(
      importData(validPayload({ notes: [{ title: 'no id' }] }), 'replace', 'u1'),
    ).rejects.toThrow(ImportValidationError)
    expect(bulkDeleteAllForUser).not.toHaveBeenCalled()
  })

  it('Replace deletes notes before tasks and subcategories, and inserts them after tasks', async () => {
    await importData(validPayload({ notes: [NOTE] }), 'replace', 'u1')

    const deleted = bulkDeleteAllForUser.mock.calls.map((c) => c[0])
    expect(deleted[0]).toBe('notes')
    expect(deleted.indexOf('notes')).toBeLessThan(deleted.indexOf('tasks'))
    expect(deleted.indexOf('notes')).toBeLessThan(
      deleted.indexOf('subcategories'),
    )

    const upserted = bulkUpsert.mock.calls.map((c) => c[0])
    expect(upserted.indexOf('notes')).toBeGreaterThan(upserted.indexOf('tasks'))
    expect(upsertedRows('notes')).toEqual([NOTE])
  })

  it('Merge upserts notes on id', async () => {
    await importData(validPayload({ notes: [NOTE] }), 'merge', 'u1')
    const call = bulkUpsert.mock.calls.find((c) => c[0] === 'notes')
    expect(call?.[1]).toEqual([NOTE])
    expect(call?.[2]).toBeUndefined() // default conflict key 'id'
    expect(bulkDeleteAllForUser).not.toHaveBeenCalled()
  })

  it.each(['replace', 'merge'] as const)(
    '%s: a link that is neither in the file nor live is written null; the memo is kept',
    async (mode) => {
      const notes = [
        NOTE, // t1 is in the file
        { ...NOTE, id: 'n2', task_id: 't-gone', detached_label: 'Old plan' },
        { ...NOTE, id: 'n3', task_id: null, subcategory_id: 's-gone' },
        { ...NOTE, id: 'n4', task_id: 't-live' },
        { ...NOTE, id: 'n5', task_id: null, subcategory_id: 's1' },
      ]
      existingIds.mockImplementation((table) =>
        Promise.resolve(table === 'tasks' ? ['t-live'] : []),
      )

      await importData(validPayload({ notes }), mode, 'u1')

      // Only ids the file does not carry are looked up.
      expect(existingIds).toHaveBeenCalledWith('tasks', ['t-gone', 't-live'])
      expect(existingIds).toHaveBeenCalledWith('subcategories', ['s-gone'])
      expect(upsertedRows('notes')).toEqual([
        NOTE,
        { ...NOTE, id: 'n2', task_id: null, detached_label: 'Old plan' },
        { ...NOTE, id: 'n3', task_id: null, subcategory_id: null },
        { ...NOTE, id: 'n4', task_id: 't-live' },
        { ...NOTE, id: 'n5', task_id: null, subcategory_id: 's1' },
      ])
    },
  )
})

describe('legacy tasks.notes → notes (chunk 59, D3)', () => {
  const T = (id: string, notes: unknown, n = 1) => ({
    id,
    user_id: 'u1',
    title: id,
    notes,
    created_at: `2026-0${n}-01T00:00:00+00:00`,
    updated_at: `2026-0${n}-02T00:00:00+00:00`,
  })
  /** A file written before chunk 58: tasks carry `notes`, there is no `notes` key. */
  const pre58 = () =>
    validPayload({
      tasks: [
        T('t1', 'Call the vendor\nask about lead time', 1),
        T('t2', '   \n  ', 2),
        T('t3', null, 3),
        T('t4', '  padded  ', 4),
      ],
    })

  it.each(['replace', 'merge'] as const)(
    '%s: a pre-58 file imports one note per non-blank task note',
    async (mode) => {
      await importData(pre58(), mode, 'u1')

      const notes = upsertedRows('notes')!
      expect(notes.map((n) => n.task_id)).toEqual(['t1', 't4'])
      expect(notes[0]).toMatchObject({
        user_id: 'u1',
        title: '',
        body: 'Call the vendor\nask about lead time',
        task_id: 't1',
        subcategory_id: null,
        pinned: false,
        detached_label: null,
        detached_at: null,
        created_at: '2026-01-01T00:00:00+00:00',
        updated_at: '2026-01-02T00:00:00+00:00',
      })
      expect(notes[0].id).toMatch(/^[0-9a-f-]{36}$/)
      expect(notes[0].id).not.toBe(notes[1].id)
      // Blank and null notes are skipped; the body is kept as written.
      expect(notes[1].body).toBe('  padded  ')
      // Synthesized notes go out with the file's own, after tasks.
      const order = bulkUpsert.mock.calls.map((c) => c[0])
      expect(order.indexOf('notes')).toBeGreaterThan(order.indexOf('tasks'))
      expect(order.filter((t) => t === 'notes')).toHaveLength(1)
    },
  )

  it.each(['replace', 'merge'] as const)(
    '%s: task rows are written without `notes`',
    async (mode) => {
      await importData(pre58(), mode, 'u1')
      const tasks = upsertedRows('tasks')!
      expect(tasks).toHaveLength(4)
      for (const row of tasks) expect(row).not.toHaveProperty('notes')
      expect(tasks[0]).toMatchObject({ id: 't1', title: 't1' })
    },
  )

  it('re-importing a chunk-59 export (column + copied note) creates no duplicate', async () => {
    const copied = {
      id: 'n-copied',
      user_id: 'u1',
      title: '',
      // Migration 17 dedupes on the trimmed body; so does the import.
      body: 'Call the vendor\nask about lead time  ',
      task_id: 't1',
      subcategory_id: null,
      pinned: false,
      detached_label: null,
      detached_at: null,
      created_at: '2026-01-01T00:00:00+00:00',
      updated_at: '2026-01-02T00:00:00+00:00',
    }
    await importData(
      validPayload({
        tasks: [T('t1', 'Call the vendor\nask about lead time')],
        notes: [copied],
      }),
      'merge',
      'u1',
    )
    expect(upsertedRows('notes')).toEqual([copied])
  })

  it('a live note with the same task and body is not duplicated', async () => {
    noteBodiesForTasks.mockResolvedValueOnce([
      { task_id: 't1', body: 'Call the vendor\nask about lead time' },
      // Same body on another task does not count.
      { task_id: 't-other', body: 'padded' },
    ])
    await importData(pre58(), 'merge', 'u1')

    expect(noteBodiesForTasks).toHaveBeenCalledWith(['t1', 't4'])
    expect(upsertedRows('notes')!.map((n) => n.task_id)).toEqual(['t4'])
  })

  it('a file with no legacy notes makes no live read', async () => {
    await importData(validPayload(), 'merge', 'u1')
    expect(noteBodiesForTasks).not.toHaveBeenCalled()
  })
})
