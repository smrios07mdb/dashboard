import { afterEach, describe, expect, it, vi } from 'vitest'

const { fromMock } = vi.hoisted(() => ({ fromMock: vi.fn() }))
vi.mock('@/lib/supabase', () => ({ supabase: { from: fromMock } }))

import {
  buildExportPayload,
  EXPORT_VERSION,
  exportAllData,
  redactSettings,
} from './export'

/** One planner block row, verbatim as Supabase returns it (chunk 50). */
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

afterEach(() => vi.clearAllMocks())

describe('redactSettings', () => {
  it('nulls every device-local credential but preserves config fields', () => {
    const out = redactSettings({
      user_id: 'u1',
      timezone: 'America/New_York',
      caldav_apple_id: 'me@icloud.com',
      ai_api_key: 'sk-ant-LIVE',
      caldav_app_password_encrypted: 'SUPER-SECRET',
    })
    expect(out?.caldav_app_password_encrypted).toBeNull()
    expect(out?.ai_api_key).toBeNull() // credential — must not leave the device
    expect(out?.timezone).toBe('America/New_York')
    expect(out?.caldav_apple_id).toBe('me@icloud.com') // config, not a secret
  })

  it('handles a null settings row', () => {
    expect(redactSettings(null)).toBeNull()
  })
})

describe('buildExportPayload', () => {
  it('assembles a version-1 payload with the password redacted', () => {
    const payload = buildExportPayload({
      userId: 'u1',
      exportedAt: '2026-05-29T00:00:00.000Z',
      tables: {
        categories: [{ id: 'c1' }],
        subcategories: [],
        tasks: [{ id: 't1' }, { id: 't2' }],
        scheduled_blocks: [BLOCK],
        routine_items: [],
        routine_logs: [],
      },
      settings: {
        user_id: 'u1',
        ai_api_key: 'sk-ant-LIVE',
        caldav_app_password_encrypted: 'SECRET',
      },
    })

    expect(payload.version).toBe(EXPORT_VERSION)
    expect(payload.version).toBe(1)
    expect(payload.user_id).toBe('u1')
    expect(payload.exported_at).toBe('2026-05-29T00:00:00.000Z')
    expect(payload.tasks).toHaveLength(2)
    // Blocks travel verbatim — `calendar_uid` is NOT redacted (it is dropped on
    // the way IN instead; see import.ts). The export stays a faithful dump.
    expect(payload.scheduled_blocks).toEqual([BLOCK])
    expect(payload.settings?.caldav_app_password_encrypted).toBeNull()
    expect(payload.settings?.ai_api_key).toBeNull()
  })
})

describe('exportAllData — scheduled_blocks (chunk 50)', () => {
  it('fetches scheduled_blocks and carries the rows, uid intact', async () => {
    const rowsByTable: Record<string, Record<string, unknown>[]> = {
      categories: [{ id: 'c1' }],
      subcategories: [],
      tasks: [{ id: 't1' }],
      scheduled_blocks: [BLOCK],
      routine_items: [],
      routine_logs: [],
      settings: [{ user_id: 'u1', ai_api_key: 'sk-ant-LIVE' }],
    }
    fromMock.mockImplementation((table: string) => {
      const rows = rowsByTable[table] ?? []
      return {
        select: () => ({
          eq: () => ({
            data: rows,
            error: null,
            maybeSingle: () => ({ data: rows[0] ?? null, error: null }),
          }),
        }),
      }
    })

    const payload = await exportAllData('u1', '2026-08-31T00:00:00.000Z')

    const queried = fromMock.mock.calls.map((c) => c[0])
    expect(queried).toEqual([
      'categories',
      'subcategories',
      'tasks',
      'scheduled_blocks',
      'routine_items',
      'routine_logs',
      'settings',
    ])
    expect(payload.scheduled_blocks).toEqual([BLOCK])
    expect(payload.scheduled_blocks[0].calendar_uid).toBe('hupo-block-b1')
    expect(payload.settings?.ai_api_key).toBeNull()
  })

  it('defaults scheduled_blocks to [] when the table is empty', () => {
    const payload = buildExportPayload({
      userId: 'u1',
      exportedAt: 'x',
      tables: { tasks: [] },
      settings: null,
    })
    expect(payload.scheduled_blocks).toEqual([])
  })
})
