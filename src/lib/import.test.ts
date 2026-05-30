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

import {
  importData,
  ImportValidationError,
  previewCounts,
  validateImport,
} from './import'

function validPayload(over: Record<string, unknown> = {}) {
  return {
    version: 1,
    exported_at: 'x',
    user_id: 'u1',
    categories: [{ id: 'c1' }],
    subcategories: [{ id: 's1' }],
    tasks: [{ id: 't1' }],
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
  it('strips caldav_app_password_encrypted from the settings upsert — never nulls the live password', async () => {
    await importData(
      validPayload({
        settings: {
          user_id: 'u1',
          timezone: 'America/Chicago',
          caldav_app_password_encrypted: null,
        },
      }),
      'merge',
      'u1',
    )
    const settingsCall = bulkUpsert.mock.calls.find((c) => c[0] === 'settings')
    const row = (settingsCall?.[1] as Record<string, unknown>[])?.[0]
    expect(row).toBeDefined()
    expect('caldav_app_password_encrypted' in (row as object)).toBe(false)
    expect((row as Record<string, unknown>).timezone).toBe('America/Chicago')
  })
})

describe('previewCounts', () => {
  it('counts items per table', () => {
    expect(previewCounts(validPayload())).toMatchObject({
      categories: 1,
      subcategories: 1,
      tasks: 1,
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
      'routine_items',
      'routine_logs',
      'settings',
    ])
    const tasksCall = bulkUpsert.mock.calls.find((c) => c[0] === 'tasks')
    expect(tasksCall?.[2]).toBeUndefined() // default conflict key 'id'
  })
})
