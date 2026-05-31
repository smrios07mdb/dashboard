# Chunk 17 — Audit: security hardening + isolation tests

**Goal:** Close the four boundary/supply-chain findings from the security audit and prove RLS write-isolation. No user-facing UI changes.
**Findings:** AUTH-03 (RLS write test), CLI-01/SRV-04 (SW URL guard), SRV-01 (CSP), SRV-03 (Edge dep pin), SRV-06 (dep note).
**Dependencies:** Chunks 2, 14.
**Effort:** ~3h.

> Reference `ARCHITECTURE.md` §10 (AI key tradeoff — the CSP is the compensating control for the in-DOM key), §14 (limitations), §15 (env vars — proxy host for `connect-src`). Apply `prompts/README.md` (cross-chunk substitutions and conventions) and `prompts/chunk-17-brief.md` (pre-flight resolutions) before this prompt.

## What to build

### 1. RLS write-isolation regression test — AUTH-03

Current `schema.test.ts` proves SELECT isolation only; it never proves a client can't write as another user. RLS `WITH CHECK (auth.uid() = user_id)` is the single control standing between this app and a multi-user breach, and the import/outbox paths deliberately forward a client-controllable `user_id` into it — so this is the cheapest, highest-leverage insurance in the audit.

Add to `schema.test.ts` (follow the existing auth/setup pattern), authenticated as user A:

- `INSERT` into `tasks` with `user_id` = user B's uuid → expect RLS rejection (error or 0 rows written).
- `UPDATE` a row A owns, attempting to set `user_id` = B → expect rejection / no-op.
- Repeat the INSERT check for at least one more user-scoped table (e.g. `subcategories`) to confirm the policy generalizes.

### 2. Service-worker target-URL guard — CLI-01 / SRV-04

`notificationTargetUrl()` (`src/lib/pushPayload.ts:65-69`) returns the push-payload `url` verbatim into `client.navigate` / `clients.openWindow` (`src/sw.ts:91-110`) with no same-origin check. Not exploitable today (forging a payload needs the VAPID private key, and `client.navigate` is spec-restricted to same-origin) — this is cheap hardening so a future regression can't turn it into an open redirect.

- Resolve via `new URL(url, self.registration.scope)`; accept only same-origin paths under the app's `BASE_PATH` (`/dashboard/`). Anything else → fall back to `BASE_PATH`.
- Unit-test in `pushPayload.test.ts`: (a) an absolute external URL → falls back; (b) a `/dashboard/../evil` traversal → falls back; (c) a valid `/dashboard/...` path → passes through.

### 3. Content-Security-Policy — SRV-01

`index.html` ships no CSP and GitHub Pages can't set response headers, so there's no CSP at any layer. There's no current XSS sink (verified), but the blast radius is unusually high because the Anthropic key lives in the same page context. Add a `<meta http-equiv="Content-Security-Policy">` to `index.html`. Starting policy:

```
default-src 'self';
connect-src 'self' https://*.supabase.co https://api.anthropic.com https://dashboard-caldav-proxy.vercel.app;
script-src 'self';
style-src 'self' 'unsafe-inline';
img-src 'self' data:;
font-src 'self';
worker-src 'self';
manifest-src 'self';
object-src 'none';
base-uri 'self';
frame-ancestors 'none';
```

Then validate in the deployed build (not just dev — Vite dev injects inline scripts the production build doesn't): open the console on the GH Pages URL and exercise the app, the recharts insights screen, and an offline reload (SW). `style-src 'unsafe-inline'` is included because recharts sets inline `style` attributes; if console shows zero style violations you may drop it — log whichever you choose in the decisions log. Confirm Anthropic, Supabase, and the proxy are reachable (i.e. `connect-src` is complete) and nothing else is silently blocked.

### 4. Pin the Edge Function dependency — SRV-03

`supabase/functions/notify-due-reminders/deno.json` pins `web-push@3.6.7` exactly but uses a floating `@supabase/supabase-js@2` with no committed lockfile. This is the highest-privilege code in the system (runs with the service-role key), so reproducible deploys matter most here.

- Pin `@supabase/supabase-js` to an exact version in `deno.json`.
- Generate and commit a `deno.lock` for the function (`deno cache --lock=deno.lock --lock-write supabase/functions/notify-due-reminders/index.ts` or equivalent) so deploys are tamper-evident and reproducible.

### 5. Dependency note — SRV-06 (no code change)

Add a one-line checklist item to the Revisions/notes: on the next dependency bump, sanity-check the unusual `lucide-react@1.16.0` pin in the dashboard `package.json` (confirm it resolves to the intended package/version). `npm audit` is currently 0 vulnerabilities — keep it there.

## Files to create/modify

```
supabase/tests/schema.test.ts                       (modify — RLS write-isolation tests)
src/lib/pushPayload.ts                              (modify — same-origin/BASE_PATH guard)
src/lib/pushPayload.test.ts                         (modify — 3 SW URL guard cases)
src/sw.ts                                           (modify — pass scope as the guard base)
index.html                                          (modify — CSP <meta>; or build-only — see brief §4)
supabase/functions/notify-due-reminders/deno.json    (modify — pin @supabase/supabase-js exact)
supabase/functions/notify-due-reminders/deno.lock    (new — committed lockfile)
PROGRESS.md → Revisions/notes                        (SRV-06 dep note — COWORK lane, not Claude Code)
```

## Acceptance criteria

- New RLS write tests fail against a deliberately weakened policy and pass against the real one.
- SW URL tests pass for all three cases above.
- Deployed build runs with the CSP meta present, no unexpected console CSP violations, and AI triage + Supabase sync + CalDAV calls all still work.
- `deno.lock` committed; `@supabase/supabase-js` pinned exact.
- `npm run build` + `npm test` green; deploy green.

## Do NOT

Touch any UI component, the auth flow, the repo/Dexie layer, or `ARCHITECTURE.md` (other than logging the CSP `style-src` decision).
