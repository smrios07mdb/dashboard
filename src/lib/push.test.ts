import { describe, expect, it } from 'vitest'

import { urlBase64ToUint8Array } from './push'

/*
 * Only the pure helper is unit-tested here. The subscribe / unsubscribe
 * flows depend on a live ServiceWorkerRegistration + PushManager and are
 * operator-verified on-device (see docs/notifications.md) per the chunk-14
 * brief's "note brittleness rather than force it" stance.
 */
describe('urlBase64ToUint8Array', () => {
  it('decodes a fully padded base64 string to the right bytes', () => {
    // 'AQID' -> 0x01 0x02 0x03
    expect(Array.from(urlBase64ToUint8Array('AQID'))).toEqual([1, 2, 3])
  })

  it('adds the missing base64url padding before decoding', () => {
    // 'AQI' (padding stripped) -> 'AQI=' -> 0x01 0x02
    expect(Array.from(urlBase64ToUint8Array('AQI'))).toEqual([1, 2])
  })

  it('maps the URL-safe alphabet (-, _) back to (+, /)', () => {
    // '-_' -> '+/' -> single byte 0xFB (251)
    expect(Array.from(urlBase64ToUint8Array('-_'))).toEqual([251])
  })

  it('returns a Uint8Array instance', () => {
    expect(urlBase64ToUint8Array('AQID')).toBeInstanceOf(Uint8Array)
  })

  it('produces 65 bytes for a P-256-length VAPID public key (87 base64url chars)', () => {
    const key = 'B' + 'A'.repeat(86) // 87 chars, all in the base64 alphabet
    expect(urlBase64ToUint8Array(key)).toHaveLength(65)
  })
})
