import { describe, expect, it } from 'vitest'

import { buildExportPayload, EXPORT_VERSION, redactSettings } from './export'

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
    expect(payload.settings?.caldav_app_password_encrypted).toBeNull()
    expect(payload.settings?.ai_api_key).toBeNull()
  })
})
