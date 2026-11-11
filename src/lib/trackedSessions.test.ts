import { describe, expect, it } from 'vitest'

import { sessionId } from './trackedSessions'

/*
 * Chunk 98 (D12) — the deterministic id of a saved session. The golden
 * values were computed apart from this code: SHA-256 of the joined text
 * (Node's `crypto`), the first 16 bytes, version nibble 8, variant 10.
 */

const USER = '11111111-2222-4333-8444-555555555555'
const T0 = 1_800_000_000_000

describe('sessionId', () => {
  it('matches the golden values', async () => {
    // sha256 starts b57c0a63a22733f25f8a49a164405cab…
    expect(await sessionId(USER, 'focus', T0)).toBe(
      'b57c0a63-a227-83f2-9f8a-49a164405cab',
    )
    // sha256 starts e6cbfa59d1da700dfa778d4960d8aadc…
    expect(await sessionId(USER, 'meditation', T0)).toBe(
      'e6cbfa59-d1da-800d-ba77-8d4960d8aadc',
    )
  })

  it('is a UUID with version nibble 8 and variant 10', async () => {
    for (let i = 0; i < 50; i += 1) {
      const id = await sessionId(USER, i % 2 ? 'focus' : 'meditation', T0 + i)
      expect(id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      )
    }
  })

  it('gives the same id for the same session', async () => {
    expect(await sessionId(USER, 'focus', T0)).toBe(
      await sessionId(USER, 'focus', T0),
    )
  })

  it('gives another id for another kind, start or user', async () => {
    const base = await sessionId(USER, 'focus', T0)
    expect(await sessionId(USER, 'meditation', T0)).not.toBe(base)
    expect(await sessionId(USER, 'focus', T0 + 1)).not.toBe(base)
    expect(
      await sessionId('99999999-2222-4333-8444-555555555555', 'focus', T0),
    ).not.toBe(base)
  })
})
