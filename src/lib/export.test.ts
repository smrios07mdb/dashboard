import { describe, expect, it } from 'vitest'

import { buildExportPayload, EXPORT_VERSION, redactSettings } from './export'

describe('redactSettings', () => {
  it('nulls caldav_app_password_encrypted but preserves other fields', () => {
    const out = redactSettings({
      user_id: 'u1',
      timezone: 'America/New_York',
      ai_api_key: 'k',
      caldav_app_password_encrypted: 'SUPER-SECRET',
    })
    expect(out?.caldav_app_password_encrypted).toBeNull()
    expect(out?.timezone).toBe('America/New_York')
    expect(out?.ai_api_key).toBe('k')
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
        routine_items: [],
        routine_logs: [],
      },
      settings: { user_id: 'u1', caldav_app_password_encrypted: 'SECRET' },
    })

    expect(payload.version).toBe(EXPORT_VERSION)
    expect(payload.version).toBe(1)
    expect(payload.user_id).toBe('u1')
    expect(payload.exported_at).toBe('2026-05-29T00:00:00.000Z')
    expect(payload.tasks).toHaveLength(2)
    expect(payload.settings?.caldav_app_password_encrypted).toBeNull()
  })
})
