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
