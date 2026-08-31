import { afterEach, describe, expect, it, vi } from 'vitest'

const { bulkUpsert, bulkDeleteAllForUser, outboxClear, wipeLocalCacheMock } =
  vi.hoisted(() => ({
    bulkUpsert: vi.fn<(...args: unknown[]) => Promise<void>>(),
    bulkDeleteAllForUser: vi.fn<(...args: unknown[]) => Promise<void>>(),
    outboxClear: vi.fn(() => Promise.resolve()),
    wipeLocalCacheMock: vi.fn(() => Promise.resolve()),
  }))

vi.mock('@/db/repo', () => ({
  repo: { data: { bulkUpsert, bulkDeleteAllForUser } },
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
          ai_api_key: null,
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
    expect('ai_api_key' in (row as object)).toBe(false)
    expect((row as Record<string, unknown>).timezone).toBe('America/Chicago')
  })

  it('omits every credential key from the settings upsert on Replace too', async () => {
    const row = await settingsRowAfterImport('replace')
    expect(row).toBeDefined()
    expect('caldav_app_password_encrypted' in (row as object)).toBe(false)
    expect('ai_api_key' in (row as object)).toBe(false)
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
