# Build Progress

Last updated: 2026-05-24

This file is the canonical tracker. A GitHub Project board mirrors it for visual review in Cowork.

## Status legend

- ☐ Not started
- ◐ In progress
- ☑ Shipped (PR merged, deployed, working in production)
- ⚠ Blocked

## Chunks

| # | Chunk | Repo | Status | Owner | PR / Commit | Blockers | Review notes |
|---|---|---|---|---|---|---|---|
| 1 | Scaffold + GH Pages | dashboard | ☑ | Claude Code | 1bd1b68 | — | Retroactive bookkeeping: scaffold + GH Pages deploy shipped before the formal PROGRESS.md workflow was in place, so the row was never flipped at the time. State reconstructed from the chunks that subsequently built on it. |
| 2 | Supabase schema + RLS + signup trigger | dashboard | ☑ | Claude Code | 50296c0 | — | Added SUPABASE_ANON_KEY to .env.test for RLS tests (service-role bypasses RLS). Separate supabase/tests/vitest.config.ts to isolate from app's jsdom config. Fixed bad redirect URL example in chunk-02 prompt during commit. |
| 3 | Auth + protected shell | dashboard | ☑ | Claude Code | fd6c419 | — | Scope expanded to include design-system port (CSS tokens, fonts, .label utility, AppShell) — Login requires it. Localhost magic-link roundtrip verified end-to-end. Prod URL renders correctly; prod magic-link redirect URL verified statically via email content (window.location.origin used correctly). Prod click-through not tested live due to Supabase default-sender email rate limit. |
| 4 | PWA shell | dashboard | ☑ | Claude Code | fb67581 | — | Manifest colors resolved from Obsidian tokens per prompt-time override (background_color #0a0b0e from --background, theme_color #c8d2e2 from --accent ice). Workbox precaches @fontsource woff2 directly — no Google Fonts handler needed. Added iOS PWA meta tags + apple-touch-icon link beyond the prompt (apple-mobile-web-app-capable=yes is required for navigator.standalone to flip reliably, which gates the dismiss flow). AppShell gained a topBanner slot so InstallHint mounts in App.tsx while rendering above the header. jsdom 29 localStorage/sessionStorage polyfill added in setupTests.ts. Lighthouse PWA audit ≥90 on deploy URL and iPhone Safari install flow remain to verify manually out-of-band per user instruction. |
| 5 | Data repo (Supabase + Dexie cache) | dashboard | ☑ | Claude Code | d263885 | — | Manual smoke tests passed: online write echoes to a second tab's IndexedDB via the realtime channel; offline write lands in Dexie + outbox with the expected shape and syncStore flips to 'offline'. Three useSession subscriptions to onAuthStateChange now exist (Protected, AccountMenu, RealtimeBridge) — Supabase multiplexes independent subscribers fine, so not a regression; a future useSession refactor to a single module-level subscriber is a low-priority cleanup. Repo layer throws on 4xx; sonner is used only in UI components, with consumer chunks (6+) responsible for catching and toasting. |
| 6 | Dashboard read-only + dev sample data | dashboard | ☑ | Claude Code | bafffa2 + 92934c8 (fix) | — | Initial commit bafffa2 shipped a render loop: `useDashboardData` subscribed to `syncStore.lastSyncAt`, but the repo's `markSyncedNow()` stamps `lastSyncAt` on every successful read — so the effect cancel/re-run pattern fired forever and `setLoading(false)` never reached commit (220+ Supabase reads in 30s, dashboard frozen on "Loading…"). Fix in 92934c8: added `uiStore.dashboardRefreshKey` + `forceDashboardRefresh()` and swapped the effect dep; SyncIndicator's Force-resync now bumps the counter instead of calling the repo lists directly. Chunk-06 prompt's "Visible `›` on every header" was implemented with lucide `<ChevronRight />` SVG, which has no `›` text in the DOM — swapped to `<span aria-hidden>›</span>` so the smoke test (and ARCHITECTURE §13) hold by text query. Two regression tests in `Dashboard.test.tsx` cover both (lastSyncAt ticks don't refetch; ≥8 `›` chevrons render). 33 vitest tests green; smoke tests 1, 2, 4 PASS via the Cowork extension. Test 3 verified manually with caveats: with DevTools → Network → Offline + Force resync, the dashboard re-renders the same 6 subcategories + 12 tasks (repo's `isOnline()` returns false → Dexie fallback) and the SyncIndicator pill flips to `● Offline` — chunk-06's data-layer offline path PASSES. The SW-served page-reload variant could not be exercised here because `vite.config.ts` sets `devOptions.enabled: false` (SW is intentionally off in dev for HMR sanity); that part is a chunk-04 concern and is deferred to a prod-URL spot check against the deployed Pages site. Minor follow-up surfaced during the manual run: SyncIndicator's "Resyncing…" button label never appears now because `forceDashboardRefresh()` is a synchronous setState bump, so `setResyncing(true/false)` batch into one React update — pre-fix it stayed visible while awaiting real network calls. Cosmetic only; worth fixing in chunk 7 or whenever next touched. |
| 7 | Task CRUD | dashboard | ☐ | Claude Code | — | — | — |
| 8 | Subcategory management | dashboard | ☐ | Claude Code | — | — | — |
| 9 | Task reassignment + drill-down routing | dashboard | ☐ | Claude Code | — | — | — |
| 10 | Routines tab | dashboard | ☐ | Claude Code | — | — | — |
| 11 | AI triage | dashboard | ☐ | Claude Code | — | — | — |
| 12 | CalDAV proxy | dashboard-caldav-proxy | ☐ | Claude Code | — | — | — |
| 13 | Calendar integration + reconnect UX | dashboard | ☐ | Claude Code | — | — | — |
| 14 | Notifications + race-safe `notified` flag | dashboard + supabase | ☐ | Claude Code | — | — | — |
| 15 | Offline outbox replay | dashboard | ☐ | Claude Code | — | — | — |
| 16 | Insights + export/import + a11y polish | dashboard | ☐ | Claude Code | — | — | — |

## Decisions log

| Date | Decision |
|---|---|
| YYYY-MM-DD | Chose Path B (Supabase + CalDAV proxy) over native Apple app. |
| YYYY-MM-DD | App-specific iCloud password wrapped with AES-GCM (env-var key) on top of Supabase at-rest encryption. |
| YYYY-MM-DD | Seed categories via `auth.users` signup trigger (not first-insert). |
| YYYY-MM-DD | AI key remains client-side; documented security tradeoff in ARCHITECTURE §10. |
| YYYY-MM-DD | Slot proposal uses 9–18 local working hours, 15-min granularity. |
| YYYY-MM-DD | Insights groups beyond top-7 subcategories into "Other". |
| YYYY-MM-DD | Streak ignores items created on the same day. |
| YYYY-MM-DD | Outbox replay is its own chunk (15) for testability. |
| YYYY-MM-DD | Drill-down primary affordance: visible chevron; double-click on desktop only; no long-press. |
| YYYY-MM-DD | Cross-subcategory drag on Dashboard + Category view (desktop only); menu picker on mobile. |
| 2026-05-23 | Migration files use numeric prefixes (00_, 01_, …) not Supabase CLI's default timestamps. Future migrations hand-named to match — documented in supabase/README.md. |
| 2026-05-23 | RLS schema tests run against an anon-key Supabase client (not service-role) because service-role bypasses RLS. Anon key lives in supabase/.env.test alongside URL + service-role; safe because the anon key is already public. |
| 2026-05-23 | Design tokens map to shadcn's HSL slots where concepts overlap (--bg→--background, --ink→--foreground, --ink-3→--muted-foreground, --line→--border) with Obsidian palette values. Design-only tokens (--work, --personal, --accent, --jewel-*, --surface-2, --ink-4, --accent-soft) added as net-new variables. --accent defaults to "ice". |
| 2026-05-23 | --border uses solid HSL approximation (225 8% 10%) of design's rgba(255,255,255,.055) because shadcn's HSL slot can't carry alpha cleanly for Tailwind opacity variants. Visually indistinguishable on Obsidian background; differs only if borders ever stack on non-bg surfaces. |
| 2026-05-23 | Routing uses BrowserRouter with basename={import.meta.env.BASE_URL}. createBrowserRouter is also v7-idiomatic but adds loader/action infra not needed for two routes. Documented in docs/auth.md, reversible later. |
| 2026-05-23 | Fonts bundled via @fontsource (Inter 400/500/600/700, IBM Plex Mono 500) instead of Google Fonts <link>. No render-blocking external request; will survive offline once chunk 4's service worker caches the assets. |
| 2026-05-23 | AppShell exposes a headerEnd prop (right of wordmark, left of AccountMenu) as the slot for SyncBadge in chunk 5+. AccountMenu always lives top-right. Max-width 1280, px-7. |
| 2026-05-23 | SMTP via Resend (free tier) configured in Supabase Auth → SMTP Settings using sandbox sender onboarding@resend.dev. Removes the 2/hr default-sender rate limit and unblocks chunk 14 (due-reminder edge function). Sandbox sender only delivers to the Resend account's verified email — fine for this single-user app; if the user count ever expands, swap to a verified-domain sender. Rate limit in Authentication → Rate Limits set to 30 emails/hr. |
| 2026-05-23 | Manifest `theme_color` (ice, #c8d2e2) and page `<meta name="theme-color">` (obsidian, #0a0b0e) intentionally diverge. Manifest drives install/OS chrome (Android home-screen splash, iOS install affordances); meta drives the runtime browser chrome (Android Chrome address bar). Setting both to ice would make the runtime address bar a light strip over a dark app. |
| 2026-05-23 | PWA icons rendered via `scripts/gen-icons.mjs` — a pure-Node PNG encoder, no sharp/resvg/canvas dependency. Mark is three horizontal ice bars on obsidian (task-list glyph). Future icon revisions edit the SVG + script; keep the zero-dep posture. |
| 2026-05-23 | AppShell gained a `topBanner` slot (analog to chunk 3's `headerEnd` slot) so global banners like InstallHint mount above the header without each one re-implementing the layout. Future global banners (offline indicator, etc.) should use the same slot. |
| 2026-05-23 | iOS PWA `<meta>` tags added beyond the chunk-04 prompt: `apple-mobile-web-app-capable=yes`, `-title`, `-status-bar-style=black-translucent`, `viewport-fit=cover`, plus the `apple-touch-icon` link. Required so `navigator.standalone` flips reliably for the InstallHint dismiss flow on iOS Safari. |
| 2026-05-23 | `setupTests.ts` now polyfills `localStorage` and `sessionStorage` with an in-memory Storage implementation because jsdom 29 only exposes them behind Node's experimental `--localstorage-file` flag. Affects every future test that exercises storage; tests should rely on this polyfill rather than importing a per-suite mock. |
| 2026-05-23 | Workbox `globPatterns` includes `woff2` so the bundled `@fontsource` assets are precached as part of the app shell. No runtime-caching rule for fonts is needed — the chunk-3 switch off Google Fonts means there are no third-party font requests to handle. |
| 2026-05-23 | Supabase Magic Link email template extended to include `{{ .Token }}` alongside `{{ .ConfirmationURL }}`. The default template is link-only; OTP delivery (required for iOS standalone PWA login since iOS doesn't route external URLs back to standalone PWAs) requires the token variable in the template body. Both delivery paths now coexist in one email. |
| 2026-05-23 | `verifyOtp` failures in Login.tsx surface a fixed user-facing message ("Invalid or expired code. Check your email or request a new one.") rather than passing through Supabase's AuthApiError. Trade-off: loses diagnostic detail (expired vs malformed vs rate-limited), but doesn't leak signal that could help an attacker probe valid email + token combinations. Future auth-error surfaces should follow the same pattern. |
| 2026-05-23 | Supabase project's Email OTP Length was 8 (the project default) and reset to 6 to match the universal OTP standard, the Login.tsx implementation, the email template wording, and iOS one-time-code autofill expectations. Range is 6–10 per Supabase config; 6 chosen for UX consistency since Supabase rate-limiting handles brute-force resistance regardless of length. |
| 2026-05-24 | Dexie cache tables mirror Postgres snake_case (`routine_items`, `routine_logs`, `push_subscriptions`). One identifier flows through the outbox `table` field, realtime channel bindings, and the Dexie table name — no rename layer in between. Trade-off: Dexie's JS surface reads as `db.routine_items.put(...)`, which is awkward in TS, but the consistency wins. |
| 2026-05-24 | Dexie schema v1 is the baseline established by chunk 5. Future shape changes bump `.version(N)` and add `.upgrade()` migrators; never reuse or rewrite v1. Documented in `src/db/dexie.ts` and `docs/sync.md`. |
| 2026-05-24 | Mapper naming convention: `xFromRow` (Supabase row → app type, always full) and `xToRow` (app type → Supabase row, returns `Partial<XRow>`) per entity. The `Partial` return means update payloads carry only the keys the caller passed, so server-defaulted columns (`updated_at`, etc.) aren't clobbered on update. Apply to any future tables added to the data model. |
| 2026-05-24 | Repo error taxonomy: plain `Error` with optional `status` and `code` props attached; no custom error class. 4xx errors throw and propagate to callers (UI toasts them in chunks 6+). 5xx and network failures route to the offline path so the user's work isn't lost — chunk 15's outbox replay retries on reconnect. Introduce a typed error class only when the UI needs to distinguish error categories. |
| 2026-05-24 | Online/offline detection is layered. `navigator.onLine === false` skips Supabase entirely; otherwise the repo attempts the request and treats fetch failures or responses with no status or status ≥ 500 as offline (routing to the outbox). `navigator.onLine` alone is unreliable on captive portals, so the fetch-failure check is the load-bearing signal. |
| 2026-05-24 | Realtime channel lifecycle: one channel per signed-in user named `user-<userId>`, with seven `postgres_changes` listeners filtered by `user_id=eq.<userId>` covering all user-scoped tables. `startRealtime(userId)` is idempotent on the same userId; switching userId tears down the old channel first; `stopRealtime()` removes the channel. Driven by the `RealtimeBridge` component mounted in `App.tsx`. |
| 2026-05-24 | Write-path server-echo mirror: after a successful Supabase write, the returned row is `put` into the Dexie cache to overwrite the optimistic row — so server-stamped fields (`updated_at`, defaults) land in cache without waiting for the realtime echo. The realtime echo then arrives and re-`put`s the same row idempotently. |
| 2026-05-24 | Screens trigger an explicit refetch via a `uiStore` counter (`dashboardRefreshKey` + `forceDashboardRefresh()`), not by subscribing to `syncStore.lastSyncAt`. The repo's `markSyncedNow()` stamps `lastSyncAt` on every successful read, so making the screen's load effect depend on it creates a refetch loop (caught in chunk 6, fix in commit 92934c8). New screens that need a "rerun the repo reads" cue should add their own counter to `uiStore` (or share `dashboardRefreshKey` if scope matches) and have whatever wants the refresh — Force-resync, future explicit refresh buttons — call the bump action. The realtime layer keeps Dexie warm in the background, so this is only for cases where the in-memory snapshot needs an explicit nudge. |

## Open questions for Cowork review

| Date | Question |
|---|---|
| 2026-05-23 | ~~Supabase default-sender rate limit blocking prod magic-link verification.~~ Resolved same day — Resend SMTP configured (see Decisions log). |

## Revisions

After-the-fact changes to shipped chunks go here, with the change written as its own mini-prompt that was actually run.

### 2026-05-23 · iOS PWA OTP login path (commit 0e39d85)

**Context:** Chunk-4 manual verification revealed that on iOS, magic links sent from a standalone (home-screen-installed) PWA open in Safari rather than the PWA, leaving the PWA unauthenticated. iOS doesn't route external URLs back into standalone PWAs the way Android does, and the standalone PWA has its own session storage separate from Safari. Standard fix is OTP codes alongside magic links so verification stays inside the PWA's own context.

**Mini-prompt that was run:**

Add a 6-digit OTP code login path to `src/screens/Login.tsx` alongside the existing magic-link flow.

- Keep email input + "Send magic link" button as-is.
- After successful sign-in request, transition the same screen to a code-entry view: submitted email, 6-digit code input, "Verify code" button, "Use a different email" reset link.
- Code input: digit-only, `maxLength={6}`, `inputMode="numeric"`, `autoComplete="one-time-code"`, auto-submit when 6 digits entered (guarded against double-submit with a `useRef`).
- On submit: `supabase.auth.verifyOtp({ email, token: code, type: 'email' })`. Success routes via the existing auth-state listener; failure shows a fixed-string inline error.
- Email template change: Supabase Magic Link template extended with `{{ .Token }}` so the email carries both link and code.
- 7 new tests in `Login.test.tsx`: default render, send + transition, auto-submit, digit stripping, sub-6-no-submit, error display, reset.

**Shipped:** commit 0e39d85. `npm test` 14/14 green, build green, deploy green. iPhone Safari standalone-PWA verification completed out-of-band on 2026-05-23 after resetting Supabase's Email OTP Length from 8 to 6 (project default was 8; see Decisions log).

## How to update this file

After every chunk:

1. Flip the status emoji.
2. Add the PR link.
3. Note any blockers.
4. Add a row to "Decisions log" if anything material was decided that wasn't already in `ARCHITECTURE.md`.
5. Update the "Last updated" date at the top.
6. Sync to the GitHub Project board.
