# Architecture — Personal Productivity Dashboard

**This document is canonical.** Every chunk prompt and the Design brief reference it. If anything contradicts this file, this file wins.

---

## 1. Product

Single-user installable PWA. Runs on iPhone, iPad, and Mac (Safari + installable PWA on macOS too via Chrome/Edge). Features:

- Unified dashboard of work + personal tasks, with drill-down into category and subcategory views
- User-defined subcategories within Work and Personal (CRUD + merge + reorder)
- Task CRUD, inline edit, time estimates, totals at every level
- Daily morning + night routine checklists with streaks and 14-day history
- AI triage ("What's next?" given available time)
- Apple Calendar integration: read busy ranges, propose time blocks, create events
- Web Push notifications for task reminders (iOS 16.4+ installed PWA)
- Insights: time consumption per category and subcategory over time
- Cross-device sync via Supabase

---

## 2. Stack

**Frontend**
- Vite + React + TypeScript
- Tailwind CSS + shadcn/ui
- Zustand (UI state only — never cached data)
- Dexie (IndexedDB wrapper, offline cache)
- date-fns
- recharts
- @dnd-kit/core
- react-router-dom
- @supabase/supabase-js
- vite-plugin-pwa (manifest + service worker)
- Vitest

**Backend (data)**
- Supabase: Postgres + Auth (magic link) + RLS + Realtime + Edge Functions

**Backend (calendar)**
- Separate repo `dashboard-caldav-proxy`
- Vercel serverless functions, TypeScript
- `tsdav` for CalDAV
- `jose` for JWT verification against Supabase JWKS

**AI**
- Anthropic API called client-side with `anthropic-dangerous-direct-browser-access: true`
- Model: `claude-haiku-4-5`
- User-supplied API key stored in `settings.ai_api_key`

---

## 3. Hosting

| Component | Where | Cost |
|---|---|---|
| App | GitHub Pages, auto-deploy from `main` to `gh-pages` via GitHub Actions | $0 |
| Proxy | Vercel (serverless functions, Hobby tier) | $0 |
| Database + Auth + Edge Functions | Supabase free tier | $0 |

GitHub Pages serves from `/dashboard/` subpath. `vite.config.ts` must set `base: '/dashboard/'`.

---

## 4. Data model (canonical)

All Postgres tables have `id uuid primary key default gen_random_uuid()` and `user_id uuid not null references auth.users(id) on delete cascade` unless noted. All timestamps are `timestamptz`.

```sql
categories
  id, user_id, name text not null check (name in ('Work','Personal'))
  -- seeded by auth.users signup trigger; not user-editable

subcategories
  id, user_id,
  category_id uuid not null references categories(id) on delete cascade,
  name text not null,
  sort_order int not null default 0,
  archived_at timestamptz null

tasks
  id, user_id,
  subcategory_id uuid not null references subcategories(id) on delete restrict,
  title text not null,
  notes text,
  estimate_minutes int not null default 0,
  due_at timestamptz,
  remind_at timestamptz,
  notified boolean not null default false,
  priority int,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()

routine_items
  id, user_id,
  routine text not null check (routine in ('morning','night')),
  label text not null,
  sort_order int not null default 0,
  archived_at timestamptz null,
  created_at timestamptz not null default now()

routine_logs
  id, user_id,
  routine_item_id uuid not null references routine_items(id) on delete cascade,
  date_key date not null,
  completed boolean not null default true,
  unique (user_id, routine_item_id, date_key)

settings
  user_id uuid primary key references auth.users(id) on delete cascade,
  ai_api_key text,
  caldav_apple_id text,
  caldav_app_password_encrypted bytea,
  caldav_calendar_url text,
  caldav_status text not null default 'unconfigured'
    check (caldav_status in ('unconfigured','ok','auth_failed')),
  timezone text not null default 'America/New_York',
  last_daily_reset date,
  -- Outlook ICS feed (chunk 35 / migration 09; proxy-owned except the three
  -- readable status columns — see §7)
  outlook_ics_url_encrypted bytea,
  outlook_feed_name text,
  outlook_status text not null default 'unconfigured'
    check (outlook_status in ('unconfigured','ok','unreachable')),
  outlook_cached_busy jsonb,
  outlook_fetched_at timestamptz

push_subscriptions
  id, user_id,
  endpoint text not null,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now(),
  unique (user_id, endpoint)

scheduled_blocks                      -- chunk 37 / migration 10; chunk 39 / migration 12
  id, user_id,
  task_id uuid not null unique references tasks(id) on delete cascade,
  start_at timestamptz not null,
  end_at timestamptz not null,
  calendar_uid text,                                -- iCloud mirror uid (`hupo-block-…`); null = not written
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),   -- set_updated_at() trigger
  check (end_at > start_at)
  -- index (user_id, start_at); insert/update RLS with-check also asserts
  -- the referenced task belongs to auth.uid() (FK checks bypass RLS)
```

**RLS policies:** every table has `select / insert / update / delete` policies enforcing `auth.uid() = user_id` (or the `user_id` derived from the joined row for log tables).

**Signup trigger:** `AFTER INSERT ON auth.users` → inserts `('Work')` and `('Personal')` rows into `categories` and a default row into `settings` for the new `user_id`.

**Realtime publication.** All eight user-scoped tables (`categories`, `subcategories`, `tasks`, `routine_items`, `routine_logs`, `settings`, `push_subscriptions`, `scheduled_blocks`) are members of the `supabase_realtime` publication with `REPLICA IDENTITY FULL`. The `FULL` identity is required so DELETE events carry `user_id` for the realtime RLS filter — without it, deletes silently drop on the client side. Any future schema migration that adds a new user-scoped table must include both `alter publication supabase_realtime add table public.<name>;` and `alter table public.<name> replica identity full;` in the same migration.

**Task priority (chunk 33, canonical for the planner series):** `tasks.priority` ∈ {1, 2, 3, null}, enforced by `08_priority_check.sql` — P1 Urgent / P2 Soon / P3 Whenever. `null` means "no priority set": renders no chip, sorts after P3, and is never coerced to 3. List sorting (`src/lib/taskSort.ts`) is a single global preference (localStorage `hupo.taskSort`, default `priority`) shared by every list. Tie-breaks: `priority` → `due_at` asc (nulls last) → `created_at` asc; `due` → `due_at` asc (nulls last) → priority → `created_at`; `estimate` → `estimate_minutes` asc → priority → `created_at`. Sort applies within the open set only — completed-row placement is whatever each list already does.

**Scheduled blocks (chunk 37).** A task's slot on the Week Planner: one block per task (`unique (task_id)` — the unscheduled tray is exactly "open tasks with no block"), deleted with its task. **Done has one source of truth: `tasks.completed_at`** (chunk 37 revisions). The planner's done toggle is a single `tasks.markComplete` write; rendering derives done from the task only (`blockIsDone(task)`), so completing or un-completing a task on any surface — Dashboard, planner, bulk complete, import, AI triage — shows correctly on the planner on the next realtime refresh. The `scheduled_blocks.done` mirror column and its migration-11 triggers were dropped in chunk 39 (migration 12); there is no block-level done anywhere. Chunk 38's carryover consumes the same task-derived flag. **Apple Calendar mirror (chunk 39).** With `settings.planner_writeout` on (opt-in, Settings → Calendars; only while `caldav_status = 'ok'`), every block write is mirrored to the selected iCloud calendar *after* its Supabase write — `scheduled_blocks` is the source of truth and the event is best-effort: a calendar failure toasts once and never rolls the block back, nothing calendar-related enters the outbox, and offline placements simply leave `calendar_uid` null. `calendar_uid` holds the event's uid (`hupo-block-<uuid>`, tagged by the proxy so `/busy` excludes it and reports it as `plannerEvents` instead — the planner therefore never counts a block twice). Once per week load (`weekKey:busyRefreshKey`) the planner reconciles the visible week against `plannerEvents`: events no block claims are deleted (task delete/cascade, wipe, replace-import), blocks with a null uid are backfilled, and blocks whose event drifted ≥1 minute are rewritten. Title drift is not reconciled (`plannerEvents` carries no summary) and task-title edits are not propagated live. One-way only: edits made in Calendar.app never flow back. Turning the toggle off or disconnecting Apple Calendar leaves existing events in place. **Fill-my-week proposals (chunk 38) are client-only and ephemeral:** a `useState` snapshot of the visible week's occupancy that is never written to Supabase/Dexie, never counted toward capacity, and dropped by any block mutation, drag activation or week change — only `Place all` writes, one sequential `scheduled_blocks` insert per proposal. **Carryover moves scan the current week:** a past, unfinished block's "Move to next open slot" always targets today → Sunday of the week containing today (fetching that week's busy + blocks on demand when a past week is visible), never the visible week. All planner math is browser-local (instants ↔ local day/minute on the client; `settings.timezone` is never consulted). Overlap with busy is advisory — surfaced in the drop preview and the toast, never blocked. Last write wins on `updated_at`. `scheduled_blocks` is NOT part of the export/import payload yet (deferred — see §14); Replace-import and "Wipe my data" clear it through the `tasks` cascade.

**Client-only tables (Dexie):**

```
outbox
  id (auto), op ('insert'|'update'|'delete'), table (text),
  payload (json), created_at, attempts (default 0), last_error (text, null)
```

Cache mirrors of all user-scoped Postgres tables live in Dexie (no `user_id` column needed — cache is per-device).

---

## 5. Auth

- Supabase magic link (OTP) to user's email.
- Session persists via Supabase JS client.
- Sign-out clears the session and stops realtime subscriptions.
- **iOS PWA caveat:** sessions can be evicted after ~7 days of inactivity. Re-login is expected behavior.
- Redirect URLs configured in Supabase project: production GitHub Pages URL with `/dashboard/` subpath AND `http://localhost:5173/dashboard/`.

---

## 6. Sync model

- **Source of truth:** Supabase.
- **Cache:** Dexie mirrors all user-scoped tables.
- **Reads:** repo tries Supabase first; on network failure returns Dexie cache.
- **Writes (online):** Supabase write succeeds → mirror to Dexie cache.
- **Writes (offline):** write optimistically to Dexie cache AND enqueue in outbox.
- **Realtime:** Postgres changes subscription updates Dexie cache while connected.
- **Outbox replay:** drains FIFO on (a) app load, (b) `window.online` event, (c) successful auth refresh.
  - 5xx / network failure → increment `attempts`, exponential backoff `2^attempts` seconds capped at 5 min.
  - 4xx with `attempts >= 5` → move to "failed" bucket surfaced in Settings → Sync issues.
- **Cross-device awareness of unsynced peers is NOT modeled in v1.** Devices see each other's changes only when both are online.

**Sync indicator states:**
| State | Meaning |
|---|---|
| `synced` | Outbox empty, online |
| `syncing` | Outbox > 0, currently draining |
| `offline` | No network |
| `sync_issues` | One or more rows in failed bucket |

---

## 7. Apple Calendar (CalDAV via proxy)

**Why proxy:** iCloud CalDAV requires Basic auth with an app-specific password. Browsers can't do this reliably (CORS, credential handling). The proxy stores the password encrypted and brokers all calls.

**Setup flow:**
1. User generates app-specific password at appleid.apple.com.
2. Enters Apple ID + password in Settings → clicks "Test connection".
3. App POSTs `/api/calendar/test-credentials` with Supabase JWT in `Authorization` header.
4. Proxy verifies JWT, runs CalDAV discovery against `caldav.icloud.com`, returns list of calendars.
5. User picks a calendar, clicks Save.
6. App POSTs `/api/calendar/save-credentials`. Proxy AES-GCM-encrypts password with `CALDAV_ENCRYPTION_KEY` env var, writes `caldav_apple_id`, encrypted password, `caldav_calendar_url`, sets `caldav_status = 'ok'`.

**Runtime endpoints:**
| Endpoint | Purpose |
|---|---|
| `POST /api/calendar/test-credentials` | Discovery + return calendars |
| `POST /api/calendar/save-credentials` | Encrypt + persist |
| `GET /api/calendar/busy?from&to` | Return merged `busy: [{ start, end, source, title? }]` for range + `sources` health + `plannerEvents: [{ uid, start, end }]` (iCloud objects tagged `hupo-block-…`, excluded from `busy`) |
| `POST /api/calendar/events` | Create VEVENT, return `{ uid }`; `source: 'planner'` tags the uid `hupo-block-<uuid>` and defaults the description to `Planned in Hupomnemata` |
| `PATCH /api/calendar/events` | `{ uid, title, start, end, description? }` — rebuild the VEVENT at `<calendar_url><uid>.ics` (unconditional PUT, no etag), return `{ ok }` |
| `DELETE /api/calendar/events?uid=…` | Delete the VEVENT; an upstream 404 answers `{ ok, missing: true }` (idempotent) |
| `GET /api/health` | `{ ok: true }` |

**On 401 from iCloud:** proxy sets `caldav_status = 'auth_failed'` and returns error. App replaces the busy strip with a "Reconnect Apple Calendar" banner linking to Settings.

**Security:**
- Password encrypted with AES-GCM (Vercel env-var key) on top of Supabase at-rest encryption.
- Service role key lives only in Vercel env vars.
- JWT validated via `jose.jwtVerify` against Supabase JWKS.

**Outlook ICS feed (chunk 34 proxy / chunk 35 client).** A second, read-only busy source: the user publishes their work calendar from Outlook and pastes the ICS link into Settings. `POST /api/calendar/outlook` with `{ icsUrl }` verifies the feed and persists it AES-GCM-encrypted (`outlook_ics_url_encrypted`) along with `outlook_feed_name`/`outlook_status`; `{ icsUrl: null }` disconnects. Verification failures return `422 { ok: false, error: 'invalid_url' | 'unreachable' | 'invalid_feed' }`. `GET /api/calendar/busy` merges both sources — `busy` entries carry `source: 'icloud' | 'outlook'` (+ optional `title`) and the response includes a `sources` block with per-source health; it 412s only when NEITHER source is configured. When the feed stops responding the proxy serves `outlook_cached_busy` (stamped `outlook_fetched_at`) and flips `outlook_status='unreachable'` — the UI treats this as stale-not-lost (amber, never destructive). The ICS URL is write-only from the client: never mapped into the client `Settings` type, never prefilled, never read back. Nothing is ever written to Outlook.

**Planner block mirror (chunk 39).** The Week Planner writes its blocks to the selected iCloud calendar through the same events endpoint family (see §4 for the client-side semantics). The exclusion of mirrored events from busy is **proxy-side by design**: the client's capacity math (`plannerCapacity.ts`) subtracts busy *and* scheduled, and the only place the `hupo-block-` tag is visible is the raw VEVENT's `UID` line — so `caldav.getBusy` splits objects into `intervals` and `plannerEvents` before anything reaches the client. `uid`s are validated `^[A-Za-z0-9-]{1,80}$` (no path characters). The Outlook path is untouched; `plannerEvents` is `[]` when iCloud is not configured.

---

## 8. Slot proposal algorithm ("Block time" feature)

1. Working window: 09:00–18:00 in `settings.timezone` (default `America/New_York`).
2. Granularity: 15-minute steps.
3. Start: `max(now + 15min, next working window start)`.
4. For each candidate slot of length `task.estimate_minutes`, reject if it overlaps any cached busy range.
5. Return the first 3 non-overlapping candidates within next 24h.
6. If fewer than 3 found, label the sheet "Limited availability — only N slot(s) found".

Busy ranges are fetched every 5 minutes and on window focus; cached in Dexie keyed by date.

The Week Planner (chunk 36/37) applies the same freshness model at week granularity: its per-week busy cache has a 5-minute TTL, refetches on window focus when stale, and is invalidated only by an explicit `uiStore.busyRefreshKey` bump (`forceBusyRefresh()` — called from the sync pill's Force-resync, cache wipe, import, and calendar connect/disconnect). It deliberately does **not** follow `dashboardRefreshKey`, so a planner write (whose realtime echo bumps that key) causes zero proxy requests; scheduled blocks and tasks still refetch on that key.

---

## 9. Notifications

**Web Push:**
- VAPID keys generated once (see `/scripts/gen-vapid.ts`).
- Public key in `VITE_VAPID_PUBLIC_KEY`. Private key in Supabase secret.
- Service worker handles `push` and `notificationclick` events.
- Subscriptions stored in `push_subscriptions`.

**Server fire:**
- Supabase Edge Function `notify-due-reminders` runs every minute (cron).
- Conditional update for race safety: `UPDATE tasks SET notified = true WHERE remind_at < now() AND notified = false AND user_id = $1 RETURNING id, title, remind_at`.
- Only claimed rows trigger a push.

**Client fallback:**
- While a tab is open, polls every 60s with the same conditional UPDATE.
- Exactly-once guaranteed by the conditional UPDATE (whoever wins the row gets to notify).

**iOS requirements:**
- iOS 16.4+
- PWA installed to home screen
- Notification permission granted
- Without all three: only in-app fallback fires, and only while a tab is open.

---

## 10. AI triage

Client-side call to `https://api.anthropic.com/v1/messages`:
- Header `anthropic-dangerous-direct-browser-access: true`
- Header `x-api-key: <user key from settings>`
- Header `anthropic-version: 2023-06-01`
- Model `claude-haiku-4-5`, `max_tokens: 800`
- System prompt frames Claude as a triage assistant
- User message: JSON of incomplete tasks (id, title, subcategory_name, category_name, estimate_minutes, due_at, priority) + available minutes
- Expected response: `{ recommendations: [{ task_id, reason }], note: string }`

**Security tradeoff (documented):** The API key is visible in browser network traffic on the user's device. Acceptable for single-user personal use. Future hardening: route through the proxy with key as server env var.

**Compensating control (chunk 17, SRV-01):** a build-time `<meta http-equiv="Content-Security-Policy">` (injected by a `build`-only Vite plugin so dev is unconstrained) restricts `connect-src` to Supabase — including `wss://*.supabase.co` for Realtime — the Anthropic API, and the CalDAV proxy, and blocks inline/cross-origin scripts; this bounds where an injected script could exfiltrate the in-DOM key. `style-src` retains `'unsafe-inline'` for recharts' inline styles (§12) pending deployed-console confirmation that dropping it is safe.

---

## 11. Streak calculation rule

A routine has a streak of N when every routine_item that **existed at start-of-day** (00:00 in `settings.timezone`) was completed for N consecutive days ending yesterday — or today if all checked.

Items created on day X are **not required** for day X's streak credit.

Items archived on day X are **not required** for day X's streak credit; archival takes effect from the day of archival forward. Equivalently, an item is required for day X iff it was created before X began and was not archived before X ended.

---

## 12. Insights rendering rule

If more than 8 subcategories appear in the filtered range, group all but the top 7 (by total minutes) into an "Other" bar segment with a neutral color. Tooltip on hover shows the full breakdown including grouped items.

---

## 13. UI interaction rules

**Drill-down affordance:**
- Visible chevron (›) on every category and subcategory header — primary on mobile.
- Double-click on header is desktop accelerator.
- Long-press is NOT used for navigation (conflicts with iOS Safari).

**Drag affordance:**
- Cross-subcategory drag enabled on Dashboard and Category drill-down (desktop only).
- Subcategory drill-down uses bulk-select + "Move to..." picker (no drag).
- Mobile/touch uses three-dot menu "Move to..." cascading picker everywhere.
- Detect touch via `matchMedia('(hover: none)')` and conditionally attach drag handlers.

**Responsive breakpoints:**
- <640px: single column, bottom-nav tabs
- 640–1024px: two-column dashboard
- ≥1024px: sidebar + dashboard + detail
- All interactive elements ≥44pt hit target on mobile
- Inline inputs render at ≥16px font-size on touch (compact only at `sm:` and up) so iOS Safari does not zoom the viewport on focus.
- `viewport-fit=cover` + `env(safe-area-inset-*)`: the top inset is applied at the AppShell wrapper (not the header alone) so the header and the InstallHint banner clear the notch / Dynamic Island; the fixed bottom nav and scroll container are padded for the home indicator.

**Week Planner (chunks 36–38):**
- `/planner` (lazy-loaded, fifth primary tab): desktop 7-column week grid + unscheduled tray; mobile day strip + single-day timeline. Busy overlays (chunk 36), scheduled blocks with native pointer drag / move / resize / Schedule sheet / done / unschedule (chunk 37), Fill-my-week proposals and carryover (chunk 38), opt-in Apple Calendar mirror of every block write — fire-and-forget after the Supabase write, never awaited by the optimistic handlers, with a per-week reconcile (chunk 39).
- Chunk 38 mechanics: `Fill my week` (desktop header only, disabled on a past week / weekend / with no P1–P2 tray task) proposes the earliest open 09–18 weekday slot for every P1/P2 tray task, packed sequentially around busy + scheduled + earlier proposals; proposals render as dashed previews plus dimmed `→ DAY HH:MM` tray cards until `Place all` / `Clear`. A past, not-done block goes hollow (`· unfinished`) on both breakpoints; `→` on the desktop hover row or `Move to next open slot` in the block action sheet moves it to the next open slot of the **current** week (weekends included). Done styling always wins over carry.
- Inline styles in the planner never mix a CSS shorthand with one of its longhands (React 19 conflicting-style warning); variant borders/decorations go through class names or longhands.
- Busy fetch is screen-level: one `getBusy` per visible week (Mon 00:00 → Sun 24:00, local ISO instants), simple in-memory per-week cache keyed on `dashboardRefreshKey`; `lib/busyCache`/`BusyStrip` remain the Dashboard's day-scoped concern.
- All planner day/time math is browser-local (`lib/plannerGeometry`); `settings.timezone` stays a routines/streak concern.
- Capacity math (`lib/plannerCapacity`) already accepts busy + scheduled inputs; chunk 36 passes `scheduled = []` so "planned" is honestly 0m.
- The tray reuses the chunk-33 global sort (`hupo.taskSort` + `TaskSortControl`); the five `--busy-*` CSS variables in `src/index.css` are the only sanctioned raw values beyond the Daylight tokens.

---

## 14. Known limitations and tradeoffs

| Limitation | Mitigation |
|---|---|
| IndexedDB is per-browser-profile; clearing site data wipes the cache | Export/import in Settings; Supabase data unaffected |
| Local cache (task titles + notes) is cleartext in IndexedDB while signed in | Wiped on `SIGNED_OUT` (chunk 18 — token expiry / multi-tab too); outbox preserved + warned |
| iOS PWA storage can be evicted under pressure | Outbox drains on every reconnect; failures surfaced in UI |
| Supabase realtime free tier: 200 concurrent connections, 2M messages/month | Single-user — not a constraint |
| CalDAV latency 1–3s | Busy ranges cached 5min client-side |
| No push from iCloud to proxy | Poll busy ranges on focus + every 5min |
| AI key exposed in browser traffic | Documented (docs/security.md). NOT cached at rest — `aiApiKey`/`caldavAppleId` are never written to Dexie (chunk 18); future: proxy AI calls |
| iOS PWA sessions evicted after ~7 days inactivity | Re-login is expected; documented |
| iOS Web Push requires installed PWA + 16.4+ | In-app fallback for other contexts |
| `scheduled_blocks` are not in the export/import payload (chunk 37) | Deferred to a later chunk; blocks are server-side only and cascade with tasks on wipe/replace-import |

---

## 15. Repos and env vars

**Repo: `dashboard`**
| Env var | Purpose | Where |
|---|---|---|
| `VITE_SUPABASE_URL` | Supabase project URL | `.env.local`, GitHub Actions secret |
| `VITE_SUPABASE_ANON_KEY` | Supabase anon (public) key | `.env.local`, GitHub Actions secret |
| `VITE_CALDAV_PROXY_URL` | Vercel deploy URL of the proxy | `.env.local`, GitHub Actions secret |
| `VITE_VAPID_PUBLIC_KEY` | Web Push VAPID public key | `.env.local`, GitHub Actions secret |

**Repo: `dashboard-caldav-proxy`**
| Env var | Purpose |
|---|---|
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Service role — never exposed to client |
| `SUPABASE_JWKS_URL` | `${SUPABASE_URL}/auth/v1/.well-known/jwks.json` |
| `CALDAV_ENCRYPTION_KEY` | 32-byte base64 for AES-GCM password wrap |

**Supabase project secrets (for Edge Function):**
| Secret | Purpose |
|---|---|
| `VAPID_PRIVATE_KEY` | Sign Web Push payloads |
| `VAPID_PUBLIC_KEY` | Sent in push registration |
| `VAPID_SUBJECT` | `mailto:` contact for push provider |
