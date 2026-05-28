# Claude Code brief — Chunk 12 — CalDAV proxy

**Execute `prompts/chunk-12-caldav-proxy.md` against `ARCHITECTURE.md` §7 (and §15 env tables).** This brief does not replace the prompt — it resolves the pre-flight decisions and flags the integration points the prompt leaves implicit. Build per the prompt; apply the resolutions below where they differ or add detail.

**Author/owner:** Claude Code (new chunk, same as 1–11). Cowork runs the chunk-12 smoke pass afterward.

**Dependencies (all shipped):** main-repo chunks 2 (Supabase schema + the `settings` CalDAV columns) and 3 (auth). Chunks 1–11 are done, so the parallel-eligibility window is moot — just build it.

---

## Pre-flight resolutions — read before building

### 1. Wrong-repo guard — this is NOT the `dashboard` repo

This chunk builds in a **separate repo, `dashboard-caldav-proxy`**, with no shared code or deploy. Before building: confirm Claude Code is opened in the `dashboard-caldav-proxy` root and that the repo is empty/scaffold-only. If you find dashboard app code, you're in the wrong repo — stop. (Per ORCHESTRATION Phase 0, both repos were created up front; this one may be empty.)

### 2. PROGRESS.md does not live in this repo — don't create one

`PROGRESS.md`, `ARCHITECTURE.md`, and the chunk tracker are all in the `dashboard` repo. This chunk's done-ness ends at **code + tests + this repo's README**. Do **not** create or look for a `PROGRESS.md` here, and don't try to flip row 12. The row-12 backfill (☐→☑) is a separate Cowork pass in the `dashboard` repo, keyed off the Vercel deploy going green — it's listed under "Cross-repo follow-ups" below.

### 3. ARCHITECTURE.md isn't in this repo — bring §7 with you

The canonical reference (`ARCHITECTURE.md` §7 calendar proxy, §15 env tables) is in `dashboard`. Paste §7 + the `dashboard-caldav-proxy` env table from §15 alongside the prompt when you run it, so the build matches canon. ARCH still wins on any disagreement — if the prompt and §7 diverge, surface it rather than silently picking.

### 4. Secrets discipline — placeholders only, never commit real keys

`.env.example` gets **placeholder** values only. Do **not** generate or commit real secrets. Specifically:
- `SUPABASE_SERVICE_ROLE_KEY` (server-only, bypasses RLS) and `CALDAV_ENCRYPTION_KEY` are set by the operator in **Vercel project settings**, not in the repo.
- The `CALDAV_ENCRYPTION_KEY` was already generated in Phase 0 (`caldav-key.txt`) — don't mint a new one; the README just documents `openssl rand -base64 32`.
- `.gitignore` must cover `.env`, `.env.local`, `.vercel`.

### 5. JWT verification gotcha — confirm the project actually publishes JWKS

§7 specifies `jose.createRemoteJWKSet(SUPABASE_JWKS_URL)` + `jwtVerify`. That assumes the Supabase project signs JWTs with **asymmetric keys** published at `…/auth/v1/.well-known/jwks.json`. If the project is still on the **legacy shared HS256 secret**, the JWKS endpoint won't serve usable verification keys and every call will 401. Before wiring `auth.ts`: hit the JWKS URL and confirm it returns a key set. If it doesn't, either (a) enable JWT signing keys on the project first, or (b) verify with the symmetric secret instead — and flag the deviation. Don't ship an auth layer that can't actually verify.

### 6. Service-role writes MUST scope to the JWT `sub`

`save-credentials` (and any settings write) runs with the service role key, which **bypasses RLS**. The only thing preventing a cross-user write is scoping every read/write to the `userId` extracted from the verified JWT (`sub`). Never accept or trust a `user_id` from the request body. The prompt's bodies don't include one — keep it that way.

### 7. Encryption ↔ DB column encoding must match

`crypto.encrypt` returns `IV + ciphertext + tag` as a Buffer; it's stored in `settings.caldav_app_password_encrypted` and read back by `decrypt`. Check the column type from chunk 2's migration (in `dashboard`): if it's `text`, base64-encode on write and decode on read; if `bytea`, pass bytes through. The round-trip test must exercise the **stored encoding**, not just in-memory Buffer→Buffer, or you'll pass tests and fail in production. Use Node's built-in `crypto` (no external lib), per the prompt.

### 8. Runtime + library currency — verify, don't assume

- Pin the Vercel function **Node runtime to a currently-supported LTS** (check Vercel's current supported versions; old Node majors get deprecated and break deploys). Set it in `package.json` `engines` / `vercel.json`.
- Build the `caldav.ts` wrapper against the **installed `tsdav` version's actual API** (its surface has shifted across versions — `createDAVClient`, calendar discovery, calendar-object creation). Don't code to an assumed signature; check the installed version.
- `jose`, `zod`, `@supabase/supabase-js`, `vitest` — install current; no pinned-stale versions.

### 9. CORS origin is host-only

`ALLOWED_ORIGINS` takes scheme+host **origins**, not paths. The app's origin is `https://<your-gh-username>.github.io` (the `/dashboard/` subpath is not part of the origin) plus `http://localhost:5173`. Setting the full `/dashboard/` URL will silently fail CORS. Default to those two; keep it env-configurable; never `*` (per the prompt's Do NOT).

---

## Build scope (per the prompt — summary)

- **Project setup:** `package.json`, strict `tsconfig.json`, `vercel.json` (routes + runtime), `.gitignore`, `.env.example`, ESLint + Prettier, deps `@supabase/supabase-js` / `tsdav` / `jose` / `zod`, dev deps `@types/node` / `vitest` / `vercel`.
- **`api/_lib/auth.ts`** — `requireUser(req)` via JWKS (resolution 5), extracts `sub`.
- **`api/_lib/supabase.ts`** — service-role singleton + `getSettings(userId)` / `updateSettings(userId, patch)` (resolution 6).
- **`api/_lib/crypto.ts`** — AES-GCM encrypt/decrypt, Node crypto only (resolution 7).
- **`api/_lib/caldav.ts`** — tsdav `discover` / `getBusy` / `createEvent`; typed errors `{ kind: 'auth'|'network'|'other' }`; base `https://caldav.icloud.com/` (resolution 8).
- **Endpoints:** `api/health.ts`; `api/calendar/test-credentials.ts`; `api/calendar/save-credentials.ts`; `api/calendar/busy.ts` (412 if no creds); `api/calendar/events.ts`. Zod-validate bodies. On iCloud 401 → set `caldav_status='auth_failed'` + structured error.
- **CORS** on all `/api/calendar/*` (resolution 9).
- **Tests:** `tests/auth.test.ts` (mock jose), `tests/crypto.test.ts` (round-trip per resolution 7), `tests/endpoints.test.ts` (mock supabase + tsdav).
- **`README.md`** per the prompt (env setup, key generation, Vercel deploy, post-deploy wiring into `dashboard`, `vercel dev`, app-specific-password link).

---

## Acceptance criteria (from the prompt)

- `npm test` passes (mocked).
- Deployed to Vercel; `/api/health` returns `{ ok: true }`.
- Valid Supabase JWT + real iCloud app-specific password → `/api/calendar/test-credentials` returns the calendar list.
- `/api/calendar/save-credentials` writes the **encrypted** password to `settings`.
- `/api/calendar/events` creates an event that appears in Calendar.app within seconds.
- Any endpoint without a valid JWT → 401.
- iCloud 401 → `caldav_status='auth_failed'` + structured error.

The live-iCloud criteria are **operator-verified manually post-deploy** (Claude Code has no creds and shouldn't touch a real calendar). Claude Code's bar is: code + green mocked tests + a README that makes the manual verification runnable.

---

## Do NOT

- Ship a Supabase migration from this repo (chunk 2 owns the columns).
- Store the app-specific password unencrypted anywhere — including logs.
- Log decrypted credentials, ever.
- Allow CORS from `*`.
- Create a `PROGRESS.md` here or touch the `dashboard` repo (resolution 2).
- Generate or commit real secrets (resolution 4).

---

## Cross-repo follow-ups (operator + Cowork, after deploy — NOT part of this chunk's code)

1. **Deploy** (operator): connect repo to Vercel, set the four env vars, deploy, confirm `/api/health`.
2. **Wire into `dashboard`** (operator): add the Vercel URL as `VITE_CALDAV_PROXY_URL` to `dashboard/.env.local` **and** as a GitHub Actions secret (same name). Needed before chunk 13.
3. **PROGRESS.md row 12** (Cowork, in `dashboard`): flip ☐→☑ with the proxy's commit SHA, review notes (JWKS-vs-shared-secret finding, encoding choice, Node/tsdav versions), bump Last updated, sync board — keyed off the green deploy. I'll generate this Cowork spec once the proxy commit SHA exists.

---

## Commit message

```
feat: CalDAV proxy — Vercel functions brokering iCloud calendar (ARCH §7)

JWT-verified (jose/JWKS) serverless endpoints: health, test-credentials,
save-credentials, busy, events. AES-GCM credential wrap via Node crypto,
tsdav CalDAV client, CORS restricted to app origins. Unit tests mock
jose/supabase/tsdav. Secrets are Vercel-only; .env.example is placeholders.
```

---

## Done when

- `npm test` green; build clean.
- Deployed; `/api/health` ok; live cred test returns calendars; event lands in Calendar.app; 401 without JWT; iCloud-401 flips `caldav_status`.
- No secrets committed (`.env.example` placeholders only).
- **Report back:** the JWT-verification finding (JWKS published vs. legacy shared secret, and which path you took), the `caldav_app_password_encrypted` column type + the encoding you used, the chosen Node runtime + `tsdav` version, and the CORS origins set. Then operator does the deploy + `dashboard` wiring, and Cowork runs the chunk-12 smoke pass + the row-12 backfill.
