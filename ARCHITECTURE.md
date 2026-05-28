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
  last_daily_reset date

push_subscriptions
  id, user_id,
  endpoint text not null,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now(),
  unique (user_id, endpoint)
```

**RLS policies:** every table has `select / insert / update / delete` policies enforcing `auth.uid() = user_id` (or the `user_id` derived from the joined row for log tables).

**Signup trigger:** `AFTER INSERT ON auth.users` → inserts `('Work')` and `('Personal')` rows into `categories` and a default row into `settings` for the new `user_id`.

**Realtime publication.** All seven user-scoped tables (`categories`, `subcategories`, `tasks`, `routine_items`, `routine_logs`, `settings`, `push_subscriptions`) are members of the `supabase_realtime` publication with `REPLICA IDENTITY FULL`. The `FULL` identity is required so DELETE events carry `user_id` for the realtime RLS filter — without it, deletes silently drop on the client side. Any future schema migration that adds a new user-scoped table must include both `alter publication supabase_realtime add table public.<name>;` and `alter table public.<name> replica identity full;` in the same migration.

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
| `GET /api/calendar/busy?from&to` | Return `[{ start, end }]` for range |
| `POST /api/calendar/events` | Create VEVENT, return `{ uid }` |
| `GET /api/health` | `{ ok: true }` |

**On 401 from iCloud:** proxy sets `caldav_status = 'auth_failed'` and returns error. App replaces the busy strip with a "Reconnect Apple Calendar" banner linking to Settings.

**Security:**
- Password encrypted with AES-GCM (Vercel env-var key) on top of Supabase at-rest encryption.
- Service role key lives only in Vercel env vars.
- JWT validated via `jose.jwtVerify` against Supabase JWKS.

---

## 8. Slot proposal algorithm ("Block time" feature)

1. Working window: 09:00–18:00 in `settings.timezone` (default `America/New_York`).
2. Granularity: 15-minute steps.
3. Start: `max(now + 15min, next working window start)`.
4. For each candidate slot of length `task.estimate_minutes`, reject if it overlaps any cached busy range.
5. Return the first 3 non-overlapping candidates within next 24h.
6. If fewer than 3 found, label the sheet "Limited availability — only N slot(s) found".

Busy ranges are fetched every 5 minutes and on window focus; cached in Dexie keyed by date.

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

---

## 14. Known limitations and tradeoffs

| Limitation | Mitigation |
|---|---|
| IndexedDB is per-browser-profile; clearing site data wipes the cache | Export/import in Settings; Supabase data unaffected |
| iOS PWA storage can be evicted under pressure | Outbox drains on every reconnect; failures surfaced in UI |
| Supabase realtime free tier: 200 concurrent connections, 2M messages/month | Single-user — not a constraint |
| CalDAV latency 1–3s | Busy ranges cached 5min client-side |
| No push from iCloud to proxy | Poll busy ranges on focus + every 5min |
| AI key exposed in browser traffic | Documented; future: proxy AI calls |
| iOS PWA sessions evicted after ~7 days inactivity | Re-login is expected; documented |
| iOS Web Push requires installed PWA + 16.4+ | In-app fallback for other contexts |

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
