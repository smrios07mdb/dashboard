# Security notes

## AI triage key (client-side Anthropic call)

The "What's next?" triage (ARCHITECTURE.md §10) calls the Anthropic
Messages API **directly from the browser**, using the
`anthropic-dangerous-direct-browser-access: true` header and the user's
own API key.

### The tradeoff

The API key is sent in a request header from the user's device. That
means:

- The key is **visible in the browser's network traffic** (DevTools →
  Network) on that device, and to any browser extension with request
  access.
- There is **no server-side secret**: anyone with access to the signed-in
  browser session can read the key.

### Why this is acceptable here

This is a **single-user personal-productivity app** (ARCHITECTURE.md §1,
§14). The key:

- Is supplied by the same person who owns the device and the session.
- Is stored in `settings.ai_api_key`, protected by Supabase **row-level
  security** — only its owner can read or write that row.
- Is never shared with any third party other than Anthropic, the service
  the key is for.

In other words, the only party who can see the key is the person who
typed it in. The "exposure" is to the user's own browser. For a personal
app, that is an acceptable tradeoff — the alternative (a server-side
proxy) adds infrastructure and a second place to leak from, for no real
gain at single-user scale.

### Cost / abuse note

Because the key is the user's own Anthropic key, all triage usage bills
to the user's Anthropic account. The call is capped at `max_tokens: 800`
and is only made on an explicit "Get recommendations" click (never
automatically, never streamed, never stored).

### Future hardening path

If this app ever opens to multiple users, or the key needs to be hidden
from the client, route the AI call through the existing CalDAV proxy
(`dashboard-caldav-proxy`, ARCHITECTURE.md §7) instead of calling
Anthropic from the browser:

- Store the Anthropic key as a **server-side env var** on the proxy
  (never sent to the client), the same way `CALDAV_ENCRYPTION_KEY` and
  the Supabase service-role key already live there.
- Add a `POST /api/ai/triage` endpoint that verifies the Supabase JWT
  (as the calendar endpoints already do), reads the incomplete tasks /
  available time from the request, and makes the Anthropic call
  server-side.
- The browser then only ever talks to the proxy, and the key never
  appears in client network traffic.

This is explicitly **out of scope for chunk 11** (see the chunk prompt's
"Do NOT" list) — documented here, not built.

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
  exactly as the encrypted CalDAV password already was.
- A single app-wide `SIGNED_OUT` listener **wipes the cache mirror on sign-out**
  (`clearLocalDataOnSignOut`), including on token expiry and sign-out from
  another tab/device — not just the account-menu button. The offline outbox is
  deliberately preserved (un-synced edits must still drain) and you're warned if
  writes are still queued.

Residual: while an offline write to the settings row is queued, its payload
(which may include a just-entered key) lives in the outbox until it drains — by
design, since the write can't sync without it. This is transient and clears on
the next successful drain.
