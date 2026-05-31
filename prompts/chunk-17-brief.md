# Claude Code brief — Chunk 17 — Audit: security hardening + isolation tests

**Execute `prompts/chunk-17-audit.md` against `ARCHITECTURE.md` §10 / §14 / §15, applying `prompts/README.md` first.** This brief does not replace the prompt — it resolves the pre-flight decisions and flags the gotchas the prompt leaves implicit. Build per the prompt; apply the resolutions below where they add detail.

**Author/owner:** Claude Code (code + tests + the same-chunk `index.html` / `deno.json` / `deno.lock` edits, plus the single sanctioned `ARCHITECTURE.md` one-liner — see resolution 1). Cowork owns the deployed-build verification, the live RLS-test run, the PR merge, and the `PROGRESS.md` + Decisions-log backfill — listed under "Cowork follow-ups" and keyed off the chunk-17 commit SHA + green deploy.

**Dependencies (both shipped):** chunk 2 (Supabase schema + RLS `WITH CHECK (auth.uid() = user_id)`) and chunk 14 (Web Push SW + `lib/pushPayload` + the `notify-due-reminders` Edge Function). This is the **`dashboard`** repo (unlike chunk 12).

---

## Pre-flight resolutions — read before building

### 1. Lane split: ARCHITECTURE.md is yours; PROGRESS.md / Decisions log / README are NOT

Per `CLAUDE.md` and `prompts/README.md`, the `PROGRESS.md` backfill, the **Decisions log**, and `README.md` are Cowork's lane. Your done-ness ends at code + tests + `index.html` + `deno.json`/`deno.lock`.

- **Finding 5 (SRV-06) is a `PROGRESS.md` Revisions note → Cowork, not you.** Do not edit `PROGRESS.md` for it (or anything else). It's in the Cowork follow-ups below.
- **The CSP `style-src` decision (finding 3) — reconcile the two records.** The prompt says "log whichever you choose in the decisions log" and "Do NOT touch ARCHITECTURE.md (other than logging the CSP style-src decision)." Resolution: ARCH edits are Claude Code's lane, so you **may** add the one sanctioned one-liner to `ARCHITECTURE.md` §10 or §14 (the CSP is the compensating control for the in-DOM AI key, plus your kept/dropped `'unsafe-inline'` choice). The **Decisions-log row** (in `PROGRESS.md`) is the separate Cowork record — don't write it. If you'd rather keep ARCH untouched, just **report** the decision and Cowork captures it in both places. Either way: do not touch `PROGRESS.md`.

### 2. RLS write test — authenticate as the USER, mind the FK chain, assert "rejected OR 0 rows"; live run is Cowork's

- **Use a signed-in client as user A — never the service-role `admin` client.** The service role bypasses RLS, so a write test run through `admin` proves nothing. Mirror the existing `anon.auth.signInWithPassword({ email, password })` pattern; the existing SELECT-isolation tests are the template.
- **FK chain (this is the easy thing to get wrong).** The signup trigger seeds `categories` (`Work`/`Personal`) + `settings` only — **no subcategories** (ARCH §4). `tasks.subcategory_id` is `NOT NULL references subcategories(id)`. So to attempt a `tasks` insert you must first, **as user A**, fetch A's `Work` category id and create a subcategory `S_A`. Then:
  - **INSERT (tasks):** as A, `insert({ user_id: userB.id, subcategory_id: S_A, title: '…' })` → expect rejection. RLS `WITH CHECK (auth.uid() = user_id)` fails because `auth.uid() = A ≠ B` (the FK is satisfied, so the rejection isolates the RLS behavior cleanly).
  - **UPDATE (tasks):** as A, insert a normal task (`user_id = A`, `subcategory_id = S_A`), then `update({ user_id: userB.id })` on it → expect rejection / no-op. `USING` lets A target its own row; `WITH CHECK` rejects the new `user_id = B`.
  - **INSERT (subcategories, generalization):** as A, `insert({ user_id: userB.id, category_id: <A's Work cat id>, name: '…' })` → expect rejection.
- **Assert robustly.** A `WITH CHECK` INSERT violation comes back as a PostgREST error (`code 42501`, "new row violates row-level security policy"). The cross-user UPDATE may surface as either an error **or** zero affected rows depending on how `USING`/`WITH CHECK` interact. So assert **`error !== null` OR the returned/affected rows are empty** — chain `.select()` to observe the row count. Don't hard-code "must be an error."
- **The "fails against a weakened policy" criterion is a live-DB check Cowork runs.** The sandbox can't reach `*.supabase.co`. Your bar: tests written, type-check, and pass `npm run test:supabase` in an env that can reach Supabase (`supabase/.env.test`, gitignored, holds `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` / `SUPABASE_ANON_KEY`). Cowork runs them green against the real policy and red against a temporary `WITH CHECK (true)` on a throwaway DB, then restores.
- **Secrets:** never commit `.env.test*`. A stray **`supabase/.env.test.save` is currently untracked and NOT matched by `.gitignore`** (it ignores `.env.test`, not `.env.test.save`). Leave it out of the commit; flag to the operator.

### 3. SW URL guard — the helper is global-free, so inject the base; keep existing tests green

- `notificationTargetUrl` lives in `pushPayload.ts`, which is **deliberately free of DOM/worker globals** (see the file header) so it unit-tests in node/jsdom. `self.registration.scope` does not exist there — you can't reference it inside the helper.
- **Add an optional `base` parameter with a sane default:** `notificationTargetUrl(notificationData, base = `${DEFAULT_ORIGIN}${BASE_PATH}`)` where `DEFAULT_ORIGIN` is any fixed absolute origin (e.g. `'https://localhost'`). Resolve `const resolved = new URL(url, base)`. Accept **only if** `resolved.origin === new URL(base).origin` **and** `resolved.pathname.startsWith(BASE_PATH)`; otherwise return `BASE_PATH`. Return the **same-origin path** (`resolved.pathname + resolved.search + resolved.hash`), not the absolute href — this keeps the existing call sites and the 4 existing assertions (`/dashboard/...` and the null/`{}`/`{url:123}` → `/dashboard/` cases) green without edits.
- **`sw.ts` call site (line 73):** pass the real scope — `notificationTargetUrl(event.notification.data, self.registration.scope)`. `scope` is the absolute registration URL (e.g. `https://<user>.github.io/dashboard/`), so prod uses the real origin while tests use the default.
- **The 3 new cases (all pass an explicit base):** (a) `https://evil.example/x` → origin mismatch → `BASE_PATH`; (b) `/dashboard/../evil` → `new URL` normalizes to `/evil`, not under `/dashboard/` → `BASE_PATH`; (c) `/dashboard/subcategory/s1` → under base → returns the path. (Bonus: protocol-relative `//evil.com/x` resolves to a foreign origin → `BASE_PATH`, so the guard catches that too.)

### 4. CSP — `wss:` for Realtime is the likely silent breakage; decide dev-vs-prod; hosts confirmed

- **Add `wss://*.supabase.co` to `connect-src`.** Supabase **Realtime** (the locked `src/db/realtime.ts` `postgres_changes` subscription, ARCH §6) connects over a **WebSocket** to `wss://<ref>.supabase.co`. A `connect-src` entry with an `https:` scheme is **not guaranteed to authorize a `wss:`** socket to that host (the CSP scheme-upgrade allowances are http→https and ws→wss, **not** https→wss; only same-origin `'self'` implies its own ws/wss). The prompt's starter policy lists only `https://*.supabase.co`, so as written it can **silently block Realtime and kill cross-device live sync**. Final line:
  `connect-src 'self' https://*.supabase.co wss://*.supabase.co https://api.anthropic.com https://dashboard-caldav-proxy.vercel.app;`
- **Hosts are confirmed (connect-src is otherwise complete):** the deployed proxy origin is exactly `https://dashboard-caldav-proxy.vercel.app` (matches the prompt) and Supabase is `https://dctfspcbkqvvyptddtif.supabase.co` (matches `*.supabase.co`); Anthropic is `https://api.anthropic.com`. No project-hash surprise in the Vercel URL.
- **A `<meta http-equiv>` CSP applies whenever `index.html` is served — including `npm run dev`.** Vite dev injects inline scripts and an HMR `ws://localhost` socket that `script-src 'self'` + this `connect-src` will block. The prompt's intent is to validate the **production** build. Two acceptable implementations — **pick one and report which + why:**
  - (a) **Literal:** put the meta in `index.html`. Simplest, but `npm run dev` will throw CSP errors; you'd validate only via `npm run build && npm run preview`. Poor dev DX.
  - (b) **(recommended) build-only injection:** add a tiny `transformIndexHtml` hook to `vite.config.ts` gated to build (`apply: 'build'` / `NODE_ENV === 'production'`) that injects the meta, leaving dev unconstrained. **The `vite.config.ts` workbox block is a locked subsystem (`prompts/README.md`) — do NOT modify the workbox config**; a separate small HTML-transform plugin alongside it is fine, but call out that `vite.config.ts` changed so Cowork's verification accounts for it.
- **`style-src 'unsafe-inline'`:** keep it for now — recharts sets inline `style` attributes (ARCH §12 Insights). On the deployed build, exercise the Insights/recharts screen and watch the console; if **zero** `style-src` violations appear you may drop `'unsafe-inline'`. Report the observed result + your choice (resolution 1 covers where it's logged).
- **Sanity vs. the current page:** `index.html` already carries theme-color/apple-mobile meta, `/favicon.svg`, `/icons/apple-touch-icon.png` (img-src `'self'` ✓), and the `/src/main.tsx` module script (prod → hashed same-origin, script-src `'self'` ✓). Fonts are self-hosted via `@fontsource` (font-src `'self'` ✓ — no external origin). SW + workbox precache + PWA manifest are all same-origin (worker-src / manifest-src / connect-src `'self'` ✓).

### 5. Edge dep pin + `deno.lock` — pin a real published 2.x; generate from `index.ts`; confirm deploy

- `deno.json` floats `@supabase/supabase-js@2`; the function imports `createClient` (`index.ts:20`) and already-pinned `web-push@3.6.7` (`index.ts:19`). **Pin `@supabase/supabase-js` exact** — don't invent a version. Resolve the version the function actually uses with `deno info supabase/functions/notify-due-reminders/index.ts` (or match the Supabase Edge runtime's supported `@supabase/supabase-js`), then set `"@supabase/supabase-js": "npm:@supabase/supabase-js@2.x.y"`.
- **Generate the lock against the function's own import map** (run from the function dir so it picks up that `deno.json`): the prompt's `deno cache --lock=deno.lock --lock-write index.ts`. On Deno 2 where `--lock-write` is removed, `deno cache --lock=deno.lock index.ts` (with `--frozen=false`) regenerates it. Commit `supabase/functions/notify-due-reminders/deno.lock`.
- **Confirm the deploy isn't broken:** `supabase functions deploy notify-due-reminders` must succeed with the lock present (the CLI bundles via Deno; a mismatched lock fails the deploy). This is operator/Cowork-verified post-merge (sandbox has no project access). Your local bar: pinned `deno.json`, committed `deno.lock`, clean `deno check` / `deno cache`.

### 6. SRV-06 is already sanity-checked — no code action

`lucide-react@1.16.0` resolves to the **official** `https://registry.npmjs.org/lucide-react/-/lucide-react-1.16.0.tgz` with a valid sha512 integrity in `package-lock.json`, and `npm audit` (prod) reports **0 vulnerabilities** — i.e. the odd-looking `1.16.0` pin is the genuine package, not a typosquat. The Revisions note is a "re-confirm at next bump" reminder only. **Claude Code: no action.** (Cowork adds the `PROGRESS.md` note.)

---

## Build scope (per the prompt — summary)

- **`supabase/tests/schema.test.ts`** — RLS write tests: cross-user `tasks` INSERT rejected; `tasks` UPDATE-to-foreign-user rejected/no-op; `subcategories` cross-user INSERT rejected (resolution 2).
- **`src/lib/pushPayload.ts`** — same-origin + `BASE_PATH` guard in `notificationTargetUrl` via an injected `base` (resolution 3).
- **`src/lib/pushPayload.test.ts`** — 3 guard cases (external / traversal / valid) + keep existing cases green.
- **`src/sw.ts`** — pass `self.registration.scope` to `notificationTargetUrl` (line 73).
- **`index.html`** (or build-only via `vite.config.ts` transform — resolution 4) — CSP meta, with `wss://*.supabase.co` added.
- **`supabase/functions/notify-due-reminders/deno.json`** — pin `@supabase/supabase-js` exact (resolution 5).
- **`supabase/functions/notify-due-reminders/deno.lock`** — new, committed (resolution 5).

## Acceptance criteria (from the prompt)

- New RLS write tests fail against a deliberately weakened policy and pass against the real one (**live — Cowork-verified**).
- SW URL tests pass for external / traversal / valid.
- Deployed build runs with the CSP meta present, no unexpected console CSP violations, and AI triage + Supabase sync (incl. Realtime `wss`) + CalDAV calls all still work (**Cowork-verified on the GH Pages URL**).
- `deno.lock` committed; `@supabase/supabase-js` pinned exact.
- `npm run build` + `npm test` green (local, Claude Code); deploy green (Cowork).

## Do NOT

- Touch any UI component, the auth flow, the repo/Dexie layer (`src/db/*`), or the locked subsystems in `prompts/README.md` — **especially the `vite.config.ts` workbox block** (a separate build-only HTML transform is OK; the workbox config is not).
- Touch `PROGRESS.md`, the Decisions log, or `README.md` — Cowork's lane (incl. SRV-06).
- Commit any `.env.test*` secrets (note the stray untracked `supabase/.env.test.save`).
- Edit `ARCHITECTURE.md` beyond the single sanctioned one-liner (CSP-as-compensating-control / `style-src` choice) in §10/§14.

## Cowork follow-ups (after the chunk-17 SHA + green deploy — NOT part of this chunk's code)

1. **Deployed-build CSP verification** (Cowork, Chrome MCP on the GH Pages URL): load the app; exercise the recharts Insights screen, AI triage, a CalDAV call, and an offline reload (SW); confirm **zero** unexpected CSP violations; confirm the Realtime **`wss://*.supabase.co`** socket connects (the resolution-4 gotcha); confirm Anthropic + Supabase + proxy all reachable. Record the `style-src 'unsafe-inline'` keep/drop result.
2. **Live RLS write-test run** (Cowork): run `npm run test:supabase` against the real project (sandbox can't reach `*.supabase.co`); confirm green against the real policy and **red** against a temporary `WITH CHECK (true)` on a throwaway DB, then restore.
3. **PR merge** (Cowork, **GitHub UI** — the GitHub connector is read-only, "Resource not accessible by integration").
4. **`PROGRESS.md` row 17 + Decisions log** (Cowork): flip ☐→☑ with the chunk-17 SHA; review notes (CSP `wss` addition, `style-src` choice + dev/prod CSP approach, exact `@supabase/supabase-js` version, SW guard return-shape, the stray `.env.test.save`); Decisions-log rows for the CSP `style-src` choice + the SRV-06 `lucide-react` re-confirm note; bump Last updated. I'll generate this Cowork spec once the chunk-17 SHA exists.

## Commit message

```
feat(security): chunk 17 — RLS write-isolation tests, SW URL guard, CSP, Edge dep pin (ARCH §10/§14/§15)

AUTH-03: cross-user INSERT/UPDATE rejection tests (tasks + subcategories).
CLI-01/SRV-04: same-origin + /dashboard/ guard in notificationTargetUrl.
SRV-01: CSP <meta> (connect-src incl. wss://*.supabase.co for Realtime).
SRV-03: pin @supabase/supabase-js exact + commit deno.lock.
```

## Done when

- `npm run build` + `npm test` green; `deno cache` / `deno check` clean for the function.
- RLS write tests (3 cases) + SW guard tests (3 cases) written; existing `pushPayload` cases still green.
- CSP meta present (with `wss`); `deno.json` pinned exact; `deno.lock` committed.
- **Report back:** which CSP implementation (in-html vs build-only transform) + whether `npm run dev` still works; the `style-src` keep/drop result + console observations; the exact `@supabase/supabase-js` version pinned; the `notificationTargetUrl` return-shape choice. Then Cowork runs the deployed verification + live RLS run + PR merge + the row-17 / Decisions-log backfill.
