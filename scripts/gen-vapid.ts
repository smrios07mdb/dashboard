/*
 * Generate a VAPID key pair for Web Push (ARCHITECTURE.md §9, chunk 14).
 *
 * Run (Node >= 22 strips TS types natively):
 *     node scripts/gen-vapid.ts
 * Or the canonical tool:
 *     npx web-push generate-vapid-keys --json
 *
 * Prints { publicKey, privateKey, subject }. These are P-256 keys in the
 * base64url encoding web-push expects: publicKey = the 65-byte uncompressed EC
 * point; privateKey = the 32-byte scalar (the JWK `d`). Uses Node's built-in
 * Web Crypto, so this reference script needs no dependencies.
 *
 * Wire the SAME matched pair into all FIVE places (see docs/notifications.md):
 *     VITE_VAPID_PUBLIC_KEY -> .env.local                 (local dev)
 *     VITE_VAPID_PUBLIC_KEY -> GitHub Actions secret       (prod build)
 *     VAPID_PUBLIC_KEY      -> Supabase secret
 *     VAPID_PRIVATE_KEY     -> Supabase secret
 *     VAPID_SUBJECT         -> Supabase secret (mailto:you@example.com)
 *
 * The public key must be BYTE-IDENTICAL in the client (VITE_VAPID_PUBLIC_KEY)
 * and the Edge Function (VAPID_PUBLIC_KEY) and matched to the private key — any
 * mismatch makes every push 401 at the push service. The private key + subject
 * live ONLY as Supabase secrets; never ship them to the client or commit them.
 */
const { subtle } = globalThis.crypto

function toBase64Url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64url')
}

const keyPair = await subtle.generateKey(
  { name: 'ECDSA', namedCurve: 'P-256' },
  true,
  ['sign', 'verify'],
)

const rawPublic = new Uint8Array(await subtle.exportKey('raw', keyPair.publicKey))
const jwkPrivate = await subtle.exportKey('jwk', keyPair.privateKey)

console.log(
  JSON.stringify(
    {
      publicKey: toBase64Url(rawPublic),
      privateKey: jwkPrivate.d, // already base64url
      subject: 'mailto:you@example.com',
    },
    null,
    2,
  ),
)
