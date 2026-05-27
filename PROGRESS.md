# Build Progress

Last updated: 2026-05-26

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
| 6 | Dashboard read-only + dev sample data | dashboard | ☑ | Claude Code | bafffa2 + 92934c8 (fix) | — | Initial commit bafffa2 shipped a render loop: `useDashboardData` subscribed to `syncStore.lastSyncAt`, but the repo's `markSyncedNow()` stamps `lastSyncAt` on every successful read — so the effect cancel/re-run pattern fired forever and `setLoading(false)` never reached commit (220+ Supabase reads in 30s, dashboard frozen on "Loading…"). Fix in 92934c8: added `uiStore.dashboardRefreshKey` + `forceDashboardRefresh()` and swapped the effect dep; SyncIndicator's Force-resync now bumps the counter instead of calling the repo lists directly. Chunk-06 prompt's "Visible `›` on every header" was implemented with lucide `<ChevronRight />` SVG, which has no `›` text in the DOM — swapped to `<span aria-hidden>›</span>` so the smoke test (and ARCHITECTURE §13) hold by text query. Two regression tests in `Dashboard.test.tsx` cover both (lastSyncAt ticks don't refetch; ≥8 `›` chevrons render). 33 vitest tests green; smoke tests 1, 2, 4 PASS via the Cowork extension. Test 3 verified manually with caveats: with DevTools → Network → Offline + Force resync, the dashboard re-renders the same 6 subcategories + 12 tasks (repo's `isOnline()` returns false → Dexie fallback) and the SyncIndicator pill flips to `● Offline` — chunk-06's data-layer offline path PASSES. The SW-served page-reload variant could not be exercised here because `vite.config.ts` sets `devOptions.enabled: false` (SW is intentionally off in dev for HMR sanity); that part is a chunk-04 concern and is deferred to a prod-URL spot check against the deployed Pages site. Minor follow-up surfaced during the manual run: SyncIndicator's "Resyncing…" button label never appears now because `forceDashboardRefresh()` is a synchronous setState bump, so `setResyncing(true/false)` batch into one React update — pre-fix it stayed visible while awaiting real network calls. Cosmetic; no scope assigned. If addressed later, file as a revisions entry against chunk 6 rather than folding into an unrelated chunk. |
| 7 | Task CRUD | dashboard | ☑ | Claude Code | 9f315f9 | — | Chunk-7 implementation. Required two follow-up Revisions to land cleanly end-to-end — see Revisions section for chunk 5 (Bug B, c26bc23, offline contract via SW cache strategy in chunk-4 file) and chunk 2 (Bug A, b0085a1 + 05_realtime.sql, Supabase realtime publication setup). Cross-device realtime, debounce coalescing, and reload-while-offline all verified green via Cowork smoke pass 2026-05-26. First chunk in the project whose end-to-end behavior is actually verified rather than inferred from unit tests passing — that smoke pass also surfaced two pre-existing chunk-15 open questions (SyncIndicator pill recovery; outbox accumulation across sessions), logged below. |
| 8 | Subcategory management | dashboard | ☑ | Claude Code | c1daade | — | Chunk-8 implementation. Required one follow-up Revision (chunk 6, `9c3029d`, Dev-only Developer panel reachable on prod via `?dev=1` for smoke-pass seeding — see Revisions section). Smokes 1–9 PASS via Cowork 2026-05-26 against the deployed PWA at `9c3029d` (runtime-equivalent to `c1daade` at the chunk-8 surface layer). `@dnd-kit/core` + `/sortable` + `/utilities` added as new infrastructure. New components: SubcategoryHeader, AddSubcategoryInline, DeleteSubcategoryDialog, MergeSubcategoryDialog, lib/useIsTouchDevice. New repo methods: `subcategories.archive`/`reorder`, `tasks.bulkUpdate`/`bulkDelete`. Five decisions logged below. Unarchive gap raised as open question (archived subcategories persist in Dexie/Supabase but are filtered out of UI; recoverable only via Supabase Studio). |
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
| 2026-05-24 | Top-level tab navigation uses custom NavLink components (react-router-dom) wrapped in `src/components/Tabs.tsx` rather than shadcn `<Tabs>`. The URL is the source of truth for which tab is active — back/forward, deep links, and `aria-current` come for free. Visual styling matches the shadcn Tabs look so future migration is reversible. Applies to any future top-level navigation surfaces (chunk 16's mobile bottom-nav included). |
| 2026-05-24 | Protected routes share a single `<ProtectedLayout>` route that wraps `<Protected>`, `<AppShell>`, the top tab nav, and a React Router `<Outlet>`. Four children mount underneath: `/`, `/routines`, `/insights`, `/settings`. InstallHint and SyncIndicator therefore mount once across the protected app, not per-route. New protected screens added in later chunks are children of this layout, not new sibling routes. |
| 2026-05-24 | `Wipe my data` in Settings → Developer uses `repo.tasks.delete()` for tasks (hard-delete exists) and `repo.<table>.archive()` for subcategories and routine_items (chunk-5 repo only exposes archive for those, not hard-delete). `routine_logs` is left in place. Categories are untouched — no delete affordance was added in chunk 5 because the signup trigger seeds them deterministically. Same precedent applies to any future user-initiated bulk-wipe surface. |
| 2026-05-24 | Dashboard.tsx owns load + handlers; CategoryColumn and SubcategorySection extracted as pure pass-through components alongside the chunk-7 components. |
| 2026-05-24 | Mutation optimism stays component-level (await repo, then setState on success); no client-side UUID generation, no manual rollback. Offline optimism is handled inside repo + Dexie + outbox per ARCHITECTURE §6. |
| 2026-05-24 | Realtime → Dashboard refresh wired directly (src/db/realtime.ts imports useUIStore and calls forceDashboardRefresh after applying each Dexie write) rather than via a subscribe(cb) callback. |
| 2026-05-24 | Realtime-triggered Dashboard refresh debounced at 200ms to coalesce sample-data bursts and self-originated echoes into one refetch. Verified empirically via the 12-insert sample-data burst smoke. |
| 2026-05-24 | Inline-edit validation is silent: aria-invalid + red shadow on bad input; Enter is a no-op, Escape/blur reverts. Toasts reserved for completed operations ("Task added", "Task deleted") and a single "Could not save — retry" on error. |
| 2026-05-24 | Inline-edit draft state uses `string \| null` (null = not editing); no `useEffect` syncing draft ← task prop, which avoids both the React 19 set-state-in-effect lint rule and the realtime-during-edit clobber. |
| 2026-05-24 | Toast library is Sonner (matches chunk-3 mount). Chunk-7 prompt's "shadcn Toast" wording superseded. |
| 2026-05-24 | Delete confirm uses shadcn AlertDialog (not Dialog), matching chunk-6's "Wipe my data" precedent. DeleteConfirm.tsx is a reusable wrapper for chunks 8 and 10. |
| 2026-05-24 | Completed-task filter is at the render layer (SubcategorySection partitions into incomplete + completed); repo.tasks.list() still returns both, so the "Show N completed" expander always has data. |
| 2026-05-26 | One `DndContext` per `CategoryColumn`, not at `Dashboard` level. Within-category drag is all chunk 8 needs; per-column scoping keeps drop targets bounded and avoids global drag state. Cross-category drag in chunk 9 reuses the per-column pattern or lifts to a shared Dashboard-level context if scope demands. |
| 2026-05-26 | `DeleteSubcategoryDialog` and `MergeSubcategoryDialog` are fresh `AlertDialog`-based components, not extensions of chunk-7's `DeleteConfirm`. Both dialogs need internal state (radio choice for delete-with-move vs cascade; target subcategory `Select`) that `DeleteConfirm`'s flat `trigger`/`title`/`description`/`confirmLabel` API doesn't fit. Future destructive dialogs needing internal selection state follow the fresh-`AlertDialog` pattern; `DeleteConfirm` stays the wrapper for plain confirms. |
| 2026-05-26 | Bulk-write outbox entries are enqueued per-row, not as a single batched entry, for offline paths. `tasks.bulkUpdate` and `tasks.bulkDelete` both follow this — keeps chunk-15's drain shape uniform (one row per outbox entry, no special-casing for bulk ops). |
| 2026-05-26 | Archived-subcategory filtering lives in `Dashboard.tsx`'s memos (`subsByCat` + `tasksBySub` + `openTasks`) — downstream components receive already-filtered data, repo stays unopinionated. Same precedent as chunk-6's completed-task filter at `SubcategorySection`. Future render-layer filters (archived routines, filtered insights subsets) follow the same pattern: filter at the screen level closest to the rendering need. |
| 2026-05-26 | Dialog reset-on-open state uses the React-19 "adjust state during render" pattern (compare `prevOpen` vs `open` prop) instead of `useEffect`, because the `react-hooks/set-state-in-effect` lint fires on the effect form. Matches chunk-7's draft-or-null philosophy of dodging effect-driven syncs. Apply to any future modal/dialog that needs reset-on-open behavior (chunk 9's task-row context menu, chunk 10's routine editor likely consumers). |

## Open questions for Cowork review

| Date | Question |
|---|---|
| 2026-05-23 | ~~Supabase default-sender rate limit blocking prod magic-link verification.~~ Resolved same day — Resend SMTP configured (see Decisions log). |
| 2026-05-26 | (chunk 15) SyncIndicator pill doesn't recover to Synced after reconnect when outbox is non-empty. Any user writing offline once gets a stuck Offline pill until drain ships — pre-existing chunk-3/5 condition that chunk-7 smokes 2026-05-26 surfaced. |
| 2026-05-26 | (chunk 15) Outbox accumulates entries across sessions; 5 entries observed during chunk-7 smokes (4 from 2026-05-24 + 1 from today). Whether "Wipe my data" clears outbox is unverified — worth confirming when chunk 15 lands, since drain semantics depend on knowing what state Wipe leaves behind. |
| 2026-05-26 | (post-MVP, no chunk currently plans this) No UI path to unarchive subcategories. Subcategories soft-deleted in chunk 8 (via delete-with-move or merge) persist in Dexie + Supabase indefinitely but are filtered out of the UI by `Dashboard.tsx`'s memos. Recovery requires direct Supabase Studio access. Worth a future chunk if archive volume grows or if users want to undo a merge/move-delete operation. Tasks under archived subs are also filtered out, so the gap leaves a small "hidden retained state" footprint that isn't user-recoverable in-app. |

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

### Chunk 5 (c26bc23) — Bug B: offline-write contract

The chunk-5 contract per ARCHITECTURE §6 (Dexie as canonical offline source; reads
fall back to Dexie on Supabase failure) was bypassed in production because chunk-4's
workbox NetworkFirst handler on Supabase URLs returned stale 200s, so the repo's
read path never saw the network error that triggered the Dexie fallback — and its
clear + bulkPut overwrote the offline-written row with the (stale) Supabase view.

Fix: changed the workbox handler for `*.supabase.co/rest/v1/*` and `/graphql/v1/*`
from NetworkFirst to NetworkOnly (vite.config.ts). The SW is now transparent to the
Supabase read path; Dexie holds the offline contract end-to-end.

Caveat: SW behavior remains outside the unit-test surface. The new
repo.test.ts regression locks the repo half of the contract. Future chunks that
touch SW caching strategy or Supabase request headers must re-verify the offline
path end-to-end manually until SW integration tests exist.

Mini-prompt: chunk-5-revision-offline-contract.md

### Chunk 2 (b0085a1) — Bug A: Supabase realtime publication

The chunk-2 schema setup did not add the 7 user-scoped tables to the
`supabase_realtime` publication, so postgres_changes events were never broadcast
and client-side realtime subscriptions in session B were idle. The chunk-5
"realtime works" smoke was a false positive — the second tab's initial
`repo.list()` populated its cache, which was misread as a realtime echo. The
chunk-7 wiring (forceDashboardRefresh + 200ms debounce) had been structurally
correct from 9f315f9 but had no events to react to.

Fix: new migration `supabase/migrations/05_realtime.sql` adds `categories`,
`subcategories`, `tasks`, `routine_items`, `routine_logs`, `settings`,
`push_subscriptions` to the `supabase_realtime` publication, all with
`REPLICA IDENTITY FULL`. The latter is required so DELETE events carry
`user_id` for the realtime RLS filter; without it, deletes silently drop.

Mini-prompt: chunk-7-fix-forward-realtime-ui.md (the prompt aimed at chunk-7
wiring; the actual fix landed in chunk-2 territory because the bug was deeper
than the prompt's suspect surfaces).

### Chunk 6 (9c3029d) — Dev-only Developer panel reachable on prod via ?dev=1

The chunk-6 Settings → Developer section (with `loadSampleData` / `wipeMyData`
helpers) was gated on `import.meta.env.DEV`, so the production build deployed to
GH Pages had no UI path to seed sample data. Cowork's chunk-8 smoke pass blocked
at pre-flight step 5 — no Developer section was reachable on the deployed PWA,
and the helpers (imported only by `Settings.tsx`) weren't exposed on `window`
either. Earlier chunk-6 and chunk-7 smokes presumably ran against `npm run dev`
locally or saw Supabase data persisting from a prior local-dev session; chunk 8
was the first pass that genuinely needed wipe + re-seed on the deployed build.

Fix: extracted the Developer section into `src/components/DeveloperSection.tsx`
and lazy-loaded it from `src/screens/Settings.tsx` via `React.lazy` + `Suspense`.
Gate is now `import.meta.env.DEV || URLSearchParams(window.location.search).has('dev')`.
Production users see no Developer panel by default; `?dev=1` in the URL flips
the gate and triggers the lazy chunk fetch. The lazy boundary preserves Vite's
DCE: the helpers (~2.42 KB gzipped) live in their own chunk
(`DeveloperSection-CBXkMbzM.js`) that production users never download. Main
chunk grew by 277 B (the gate + `lazy()` + `Suspense` boilerplate only); user-
visible Developer strings have zero occurrences in the main chunk.

Caveat (security): `loadSampleData` writes and `wipeMyData` deletes operate on
the authenticated user's own data only (`wipeMyData` behind an `AlertDialog`
confirm, per chunk 6). Blast radius is per-user — `?dev=1` lets any
authenticated user touch their own data, not anyone else's. Acceptable for
MVP-stage / personal-productivity scope. If the project later opens to broader
users, harden by tying the gate to a specific user id or removing the
destructive helper from the user-facing surface entirely.

Mini-prompt: revisions-chunk-06-devgate.md

## How to update this file

After every chunk:

1. Flip the status emoji.
2. Add the PR link.
3. Note any blockers.
4. Add a row to "Decisions log" if anything material was decided that wasn't already in `ARCHITECTURE.md`.
5. Update the "Last updated" date at the top.
6. Sync to the GitHub Project board.
