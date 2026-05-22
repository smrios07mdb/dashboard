# Chunk 12 — CalDAV proxy (separate repo)

**Goal:** Deployed Vercel functions that broker iCloud CalDAV with encrypted credential storage.
**Dependencies:** Chunks 2, 3 of the main repo. Develops in a separate repo `dashboard-caldav-proxy`.
**Effort:** ~5h.

> Run this prompt in a **fresh `dashboard-caldav-proxy` repo**, not in `dashboard`.
> Reference `ARCHITECTURE.md` §7 (calendar proxy) of the main repo.

## What to build

### Project setup

Initialize a Vercel TypeScript project:
- `package.json` with `vercel` CLI as dev dep
- TypeScript with strict mode
- Deps: `@supabase/supabase-js`, `tsdav`, `jose`, `zod`
- Dev deps: `@types/node`, `vitest`
- `vercel.json` defining the `/api/` routes
- ESLint + Prettier configs

### Env vars (Vercel)

| Var | Value |
|---|---|
| `SUPABASE_URL` | The Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Service role key (server-only) |
| `SUPABASE_JWKS_URL` | `${SUPABASE_URL}/auth/v1/.well-known/jwks.json` |
| `CALDAV_ENCRYPTION_KEY` | 32-byte base64 string for AES-GCM |

Document in README how to generate `CALDAV_ENCRYPTION_KEY`: `openssl rand -base64 32`.

### Auth middleware

`api/_lib/auth.ts`:
- `requireUser(req): Promise<{ userId: string }>` — validates `Authorization: Bearer <jwt>` header
- Uses `jose.createRemoteJWKSet(new URL(SUPABASE_JWKS_URL))` + `jose.jwtVerify`
- Extracts `sub` claim as `userId`
- Throws on invalid/missing — caller returns 401

### Supabase admin client

`api/_lib/supabase.ts`:
- Exports a singleton Supabase client created with the service role key
- `getSettings(userId)`, `updateSettings(userId, patch)` helpers

### Crypto

`api/_lib/crypto.ts`:
- `encrypt(plain: string): Promise<Buffer>` — AES-GCM with `CALDAV_ENCRYPTION_KEY`, returns IV + ciphertext + tag concatenated
- `decrypt(blob: Buffer): Promise<string>` — inverse
- Use Node's built-in `crypto.subtle` or `crypto` module (no external lib)

### CalDAV client

`api/_lib/caldav.ts`:
- `discover(appleId, password): Promise<{ calendars: { url, name }[] }>` — uses tsdav to list calendars
- `getBusy(calendarUrl, appleId, password, from, to): Promise<{ start, end }[]>`
- `createEvent(calendarUrl, appleId, password, { title, start, end, description, uid }): Promise<void>` — POSTs an iCalendar VEVENT
- All errors normalize to typed shapes: `{ kind: 'auth' | 'network' | 'other', message }`
- iCloud CalDAV base: `https://caldav.icloud.com/`

### Endpoints

`api/calendar/test-credentials.ts` (POST):
- Body: `{ apple_id: string, app_password: string }` (zod-validated)
- Calls `requireUser(req)`
- Calls `caldav.discover(apple_id, app_password)`
- On 401 from iCloud → 401 to client with `{ ok: false, error: 'auth' }`
- On success → `{ ok: true, calendars: [...] }`

`api/calendar/save-credentials.ts` (POST):
- Body: `{ apple_id, app_password, calendar_url }`
- Calls `requireUser(req)`
- Encrypts `app_password` with `crypto.encrypt`
- Updates settings via admin client: `caldav_apple_id`, `caldav_app_password_encrypted`, `caldav_calendar_url`, `caldav_status = 'ok'`
- Returns `{ ok: true }`

`api/calendar/busy.ts` (GET):
- Query: `from`, `to` (ISO strings)
- Calls `requireUser(req)`
- Loads settings; if no creds, return 412 Precondition Failed
- Decrypts password
- Calls `caldav.getBusy(...)`
- On 401 from iCloud → update `caldav_status = 'auth_failed'`, return 401 with `{ ok: false, error: 'auth_failed' }`
- On success → `{ ok: true, busy: [{ start, end }, ...] }`

`api/calendar/events.ts` (POST):
- Body: `{ title, start, end, description? }`
- Calls `requireUser(req)`
- Loads settings; decrypts; calls `caldav.createEvent` with a UUID
- Same 401 handling as busy
- Returns `{ ok: true, uid }`

`api/health.ts` (GET):
- Returns `{ ok: true }` — for uptime monitoring

### CORS

All `/api/calendar/*` endpoints respond to OPTIONS with appropriate CORS headers. Allowed origins: the GitHub Pages URL of the main repo AND `http://localhost:5173`. List configurable via env var `ALLOWED_ORIGINS` (comma-separated).

### Tests

`tests/auth.test.ts` — valid JWT passes; invalid returns 401. Mock `jose`.
`tests/crypto.test.ts` — round-trip encrypt/decrypt.
`tests/endpoints.test.ts` — mock the supabase client and tsdav; verify endpoint logic (status updates on auth failure, encryption on save, etc.).

### Deploy

- Connect the repo to Vercel
- Set all env vars in Vercel project settings
- First deploy
- Confirm `https://<vercel-url>/api/health` returns `{ ok: true }`

### README

`README.md` covering:
- Architecture (refer to main repo's ARCHITECTURE.md §7)
- Env var setup
- How to generate `CALDAV_ENCRYPTION_KEY`
- Deploy steps to Vercel
- After deploy: add the URL to the main `dashboard` repo's `.env.local` and GH Actions secret as `VITE_CALDAV_PROXY_URL`
- Local dev: `vercel dev`
- iCloud app-specific password instructions (link to https://appleid.apple.com/account/manage)

## Files to create

```
package.json
tsconfig.json
vercel.json
.gitignore
.env.example
README.md
api/health.ts
api/calendar/test-credentials.ts
api/calendar/save-credentials.ts
api/calendar/busy.ts
api/calendar/events.ts
api/_lib/auth.ts
api/_lib/supabase.ts
api/_lib/crypto.ts
api/_lib/caldav.ts
tests/auth.test.ts
tests/crypto.test.ts
tests/endpoints.test.ts
```

## Acceptance criteria

- `npm test` passes
- Deployed to Vercel; `/api/health` returns `{ ok: true }`
- With a valid Supabase JWT and a real iCloud app-specific password: `/api/calendar/test-credentials` returns the user's calendar list
- `/api/calendar/save-credentials` writes encrypted password to Supabase `settings`
- `/api/calendar/events` creates an event that appears in Calendar.app within seconds
- Any endpoint without a valid JWT returns 401
- 401 from iCloud updates `caldav_status = 'auth_failed'` and returns a structured error

## Do NOT

- Ship a Supabase migration from this repo (chunk 2 already added the columns)
- Store the app-specific password unencrypted anywhere, even in logs
- Log decrypted credentials
- Allow CORS from `*` — restrict to known origins

## How to test

1. Set up Vercel env vars
2. `vercel dev` locally
3. Get a valid Supabase JWT from the main app (log it from `supabase.auth.getSession()`)
4. `curl -X POST http://localhost:3000/api/calendar/test-credentials -H "Authorization: Bearer $JWT" -d '{"apple_id":"...","app_password":"..."}'`
5. Confirm calendar list returns
6. Save credentials
7. Hit `/api/calendar/events` to create a test event → confirm it appears in Calendar.app
8. Deploy to Vercel; repeat against production URL
