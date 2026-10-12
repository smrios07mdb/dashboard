# Security notes

## AI triage key (proxied; encrypted at rest — chunk 55)

The "What's next?" triage (ARCHITECTURE.md §10) is made **by the calendar
proxy**, not the browser. The user's own Anthropic key is stored
AES-GCM-encrypted in `settings.ai_api_key_encrypted`, the same way the
iCloud app-specific password and the Outlook ICS URL are.

### What the browser can and cannot see

- The key leaves the device **once**: as the HTTPS body of
  `POST /api/ai/key` when it is saved or replaced. It is not kept in the
  form, not written to Dexie, and not in the `Settings` type.
- After that the app reads only `settings.ai_status`
  (`unconfigured` / `ok` / `auth_failed`). The Settings field is
  write-only — there is no reveal toggle because there is nothing to
  reveal.
- Triage requests go to `POST /api/ai/triage` with the Supabase JWT. The
  proxy decrypts the key in memory, calls Anthropic, and returns
  Anthropic's response. No proxy response ever contains the key.
- `api.anthropic.com` is no longer in the CSP `connect-src`, so no script
  on the page can reach Anthropic directly.

### Where the key is protected

- **At rest:** AES-256-GCM with the proxy's `CALDAV_ENCRYPTION_KEY`
  (Vercel env var), on top of Supabase at-rest encryption. The ciphertext
  is useless without that env var. Note the ciphertext column is still
  covered by the owner's row-level-security read access, as the other two
  `*_encrypted` columns are; the app never selects it by name and never
  maps it.
- **Validation before storage:** a key is checked against Anthropic
  (`GET /v1/models?limit=1`) before it is written, so a rejected or
  unverifiable key never overwrites a working one.
- **Export/import:** all three `*_encrypted` columns are redacted to
  `null` in an export and omitted from an import's settings upsert
  (`CREDENTIAL_SETTINGS_KEYS`). Before chunk 55 the Outlook ciphertext
  was missing from that list. An import also never writes the three
  status columns (`ai_status`, `caldav_status`, `outlook_status`) or the
  retired `ai_api_key` key that old export files carry
  (`IMPORT_STRIPPED_SETTINGS_KEYS`, chunk 56): a status describes a secret
  the file does not hold, so only the live row's value is truthful. The
  export does not redact those four.

### Data disclosure

Triage sends incomplete task titles, their category and subcategory,
time estimate, due date and priority to Anthropic — never notes. It now
transits the proxy on the way; the proxy does not log or store it.

### Cost / abuse note

The key is the user's own, so triage bills to their Anthropic account.
The call is capped at `max_tokens: 800` and is only made on an explicit
click (never automatically, never streamed, never stored). The endpoint
requires a valid Supabase JWT and has no per-user rate limit — acceptable
at single-user scale, and the first thing to add if that changes.

### History

Until chunk 55 the browser called Anthropic directly
(`anthropic-dangerous-direct-browser-access`) with a plaintext key in
`settings.ai_api_key`; the "future hardening path" recorded here was to
route the call through the proxy, which chunk 55 did — with the user's
key encrypted in `settings` rather than a proxy env var. The proxy
migrated the legacy plaintext value once, on 2026-10-12, and chunk 56
dropped the column (migration 15). No plaintext key column exists.

## Local data at rest (chunk 18 — PRIV-01 / PRIV-02)

The app keeps a per-device Dexie/IndexedDB cache mirror of your Supabase data so
it works offline (ARCHITECTURE.md §6).

**Before chunk 18**, two things leaked into that on-device cache that shouldn't
have persisted there:

- The Anthropic API key (`ai_api_key`) and the Apple ID (`caldav_apple_id`) were
  mirrored into the `settings` cache on every settings read — so they sat in
  cleartext in IndexedDB, not just in network traffic.
- Sign-out cleared only the Supabase session; it never wiped the cache, so a
  previous user's task titles, notes, routine history, and that cached settings
  row remained readable on a shared/borrowed device (or via DevTools) until the
  next manual wipe.

**Chunk 18 closes both:**

- `aiApiKey` and `caldavAppleId` are **never written to the Dexie cache**
  (`toCachedSettings` strips them at every cache-write site). They're only used
  online — the AI call hits `api.anthropic.com` and CalDAV ops hit the proxy —
  so they're read from the live Supabase fetch and never persisted locally,
  exactly as the encrypted CalDAV password already was. *(Chunk 55: `aiApiKey`
  no longer exists client-side at all — see the section above; the strip now
  covers `caldavAppleId` only.)*
- A single app-wide `SIGNED_OUT` listener **wipes the cache mirror on sign-out**
  (`clearLocalDataOnSignOut`), including on token expiry and sign-out from
  another tab/device — not just the account-menu button. The offline outbox is
  deliberately preserved (un-synced edits must still drain) and you're warned if
  writes are still queued.

Residual: while an offline write to the settings row is queued, its payload
(which may include a just-entered key) lives in the outbox until it drains — by
design, since the write can't sync without it. This is transient and clears on
the next successful drain.
