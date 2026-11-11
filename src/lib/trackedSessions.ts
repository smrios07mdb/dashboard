/*
 * Tracked sessions (chunk 98 — ARCHITECTURE.md §4): the deterministic row id.
 *
 * A saved focus phase or breathing session is identified by who ran it, what
 * it was and the millisecond it started. Deriving the row id from exactly
 * those three means the same session written twice — an acknowledgement lost
 * between the menu bar shell and its web view, two drains racing, an outbox
 * replay after an online write — always lands on one row (`upsert` on `id`).
 *
 * Pure apart from Web Crypto. No I/O, no React.
 */

export type SessionKind = 'focus' | 'meditation'

/**
 * SHA-256 of `userId|kind|startedAtMs`, its first 16 bytes laid out as a
 * UUID with version nibble `8` (RFC 9562's "custom" version) and the RFC
 * variant `10`.
 */
export async function sessionId(
  userId: string,
  kind: SessionKind,
  startedAtMs: number,
): Promise<string> {
  const text = `${userId}|${kind}|${startedAtMs}`
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(text),
  )
  const bytes = new Uint8Array(digest).slice(0, 16)
  bytes[6] = (bytes[6] & 0x0f) | 0x80
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}
