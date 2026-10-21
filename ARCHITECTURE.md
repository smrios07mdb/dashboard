# Architecture — Personal Productivity Dashboard

**This document is canonical.** Every chunk prompt and the Design brief reference it. If anything contradicts this file, this file wins.

---

## 1. Product

Single-user installable PWA. Runs on iPhone, iPad, and Mac (Safari + installable PWA on macOS too via Chrome/Edge). Features:

- Unified dashboard of work + personal tasks, with drill-down into category and subcategory views
- User-defined subcategories within Work and Personal (CRUD + merge + reorder)
- Task CRUD, inline edit, time estimates, totals at every level
- Morning and night routine checklists inside Today (optional, collapsible)
- AI triage ("What's next?" given available time)
- Apple Calendar integration: read busy ranges, propose time blocks, create events
- Web Push notifications for task reminders (iOS 16.4+ installed PWA)
- Insights: time consumption per category and subcategory over time
- Notebook: Markdown notes, freeform or attached to one task or one subcategory
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
- Anthropic API called **by the proxy** (`POST /api/ai/triage`, chunk 55) — the browser never talks to Anthropic
- Model: the latest active Claude Haiku, resolved at runtime by the proxy (`api/_lib/ai.ts`, chunk 57 D1–D4); floor `claude-haiku-5-5`
- User-supplied API key stored AES-GCM-encrypted in `settings.ai_api_key_encrypted`; the app reads only `settings.ai_status`

---

## 3. Hosting

| Component | Where | Cost |
|---|---|---|
| App | GitHub Pages, auto-deploy from `main` to `gh-pages` via GitHub Actions | $0 |
| Proxy | Vercel (serverless functions, Hobby tier) | $0 |
| Database + Auth + Edge Functions | Supabase free tier | $0 |

GitHub Pages serves from `/dashboard/` subpath. `vite.config.ts` must set `base: '/dashboard/'`.

`npm run build` copies `dist/index.html` to `dist/404.html` post-build (`scripts/spa-fallback.mjs`, chunk 80), so a deep route (`/dashboard/settings`, `/dashboard/planner`, …) boots the app without the service worker — hard reload, first visit, deep link. Pages answers those with document status 404; that is expected. `404.html` is not precached.

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
  -- chunk 55 / migration 14: proxy-owned. The app never reads or writes the
  -- ciphertext; it reads only ai_status (see §10)
  ai_api_key_encrypted bytea,
  ai_status text not null default 'unconfigured'
    check (ai_status in ('unconfigured','ok','auth_failed')),
  caldav_apple_id text,
  caldav_app_password_encrypted bytea,
  caldav_calendar_url text,               -- the single WRITE target (chunk 39 mirrors)
  -- chunk 51 / migration 13: the READ set, [{ url, name, enabled }]. null =
  -- not initialized → the proxy reads the write target only (see §7)
  caldav_read_calendars jsonb,
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

notes                                 -- chunk 58 / migration 16
  id, user_id,
  title text not null default '',                   -- optional; '' = untitled
  body text not null default '',                    -- Markdown source
  pinned boolean not null default false,
  task_id uuid null references tasks(id) on delete set null,
  subcategory_id uuid null references subcategories(id) on delete set null,
  detached_label text null,                         -- name of what it was attached to, set when that is deleted
  detached_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),   -- set_updated_at() trigger
  check (num_nonnulls(task_id, subcategory_id) <= 1)
  -- indexes (user_id, updated_at desc), (task_id), (subcategory_id);
  -- insert/update RLS with-check also asserts a non-null task_id /
  -- subcategory_id belongs to auth.uid() (FK checks bypass RLS)
```

**RLS policies:** every table has `select / insert / update / delete` policies enforcing `auth.uid() = user_id` (or the `user_id` derived from the joined row for log tables).

**Signup trigger:** `AFTER INSERT ON auth.users` → inserts `('Work')` and `('Personal')` rows into `categories` and a default row into `settings` for the new `user_id`.

**Realtime publication.** All nine user-scoped tables (`categories`, `subcategories`, `tasks`, `routine_items`, `routine_logs`, `settings`, `push_subscriptions`, `scheduled_blocks`, `notes`) are members of the `supabase_realtime` publication with `REPLICA IDENTITY FULL`. The `FULL` identity is required so DELETE events carry `user_id` for the realtime RLS filter — without it, deletes silently drop on the client side. Any future schema migration that adds a new user-scoped table must include both `alter publication supabase_realtime add table public.<name>;` and `alter table public.<name> replica identity full;` in the same migration.

**Task priority (chunk 33, canonical for the planner series):** `tasks.priority` ∈ {1, 2, 3, null}, enforced by `08_priority_check.sql` — P1 Urgent / P2 Soon / P3 Whenever. `null` means "no priority set": renders no chip, sorts after P3, and is never coerced to 3. List sorting (`src/lib/taskSort.ts`) is a single global preference (localStorage `hupo.taskSort`, default `priority`) shared by every list. Tie-breaks: `priority` → `due_at` asc (nulls last) → `created_at` asc; `due` → `due_at` asc (nulls last) → priority → `created_at`; `estimate` → `estimate_minutes` asc → priority → `created_at`. Sort applies within the open set only — completed-row placement is whatever each list already does. Since chunk 76, P1 and P2 also mark a task near term for the horizon filter (lib/horizon).

**Today membership (chunk 41 merge; per-device chunk 43; synced chunk 64):** the dashboard's Today list is resolved in the Dashboard's `useTodayPlan` state as `(autoTodayIds(tasks) ∪ pinned) − removed` (see §13). Only the manual deltas — pins and removals — are stored, never the resolved set, so auto signals keep flowing as tasks change. From chunk 43 to chunk 64 the deltas lived per device in `localStorage['hup:todayPlan']`; since chunk 64 they are synced through `today_marks` (next paragraph), and `hup:todayPlan` is read once, written to the server as marks and removed.

**Today marks (chunk 64).** `today_marks` (migration 20) holds the manual Today deltas: `id`, `user_id`, `day` (date), `kind` (`'pin'` | `'remove'`), `updated_at` — no `created_at`, a mark has no history worth keeping. **`id` is the task's id** (primary key and FK to `tasks`, `on delete cascade`; there is no separate `task_id`), so there is at most one row per task, every device computes the same key for the same task, and a toggle is a plain upsert on `id` (`repo.todayMarks.set`; the outbox replays an offline toggle the same way, `upsertOnConflict: 'id'`) — two devices toggling the same task converge on one row, last write wins. RLS is own-rows-only, and insert/update additionally assert the task belongs to the caller (FK checks bypass RLS — the `scheduled_blocks` / `notes` rule); the table is in the `supabase_realtime` publication with `replica identity full`, mirrored in Dexie (`today_marks`, v7) and cleared by `wipeLocalCache`. **Day-scoping:** `day` is the calendar day in the user's Settings time zone the mark was made for — the frame `lib/today` derives in (chunk 66). Rows written before chunk 66 carry the browser-local day. `useTodayPlan` keeps only the marks dated today whose task is in hand; a mark for any other day is ignored and overwritten by that task's next toggle, so there is no cleanup job, a day rollover writes nothing, and the table never holds more rows than the user has tasks. A toggle on another device arrives through realtime → dashboard refresh as a changed marks set and is applied with the same operation a local toggle performs. **Newer observation wins:** the hook records this session's own toggles (task → kind + the time it wrote); where a task has both a local toggle and a today-dated mark, the later of the two decides, compared as instants (`Date.parse`), never as strings — a refresh carrying a mark from before a rapid second toggle cannot flip the row back, while a genuinely later toggle elsewhere still wins. The comparison is this device's clock against the server's `updated_at`, so a rapid pin → un-pin can show the pin for one refresh if the first write's echo is stamped later than the second toggle's local time; it settles when the second write's echo arrives (the same eventual-consistency class as the chunk-47 recency rule). A rejected write (a 4xx — offline is queued, not rejected) toasts and leaves the local plan as the user set it. **Cascade:** nothing deletes a mark except its task — deleting the task, "Wipe my data" and Replace-import (`import_replace` deletes the account's tasks, and the cascade clears their marks inside the same transaction) all remove marks that way. **Not exported:** `today_marks` is a day-scoped plan, not data worth restoring; `EXPORT_TABLES` does not include it and Merge never touches it.

**Scheduled blocks (chunk 37).** A task's slot on the Week Planner: one block per task (`unique (task_id)` — the unscheduled tray is exactly "open tasks with no block"), deleted with its task. **Done has one source of truth: `tasks.completed_at`** (chunk 37 revisions). The planner's done toggle is a single `tasks.markComplete` write; rendering derives done from the task only (`blockIsDone(task)`), so completing or un-completing a task on any surface — Dashboard, planner, bulk complete, import, AI triage — shows correctly on the planner on the next realtime refresh. The `scheduled_blocks.done` mirror column and its migration-11 triggers were dropped in chunk 39 (migration 12); there is no block-level done anywhere. Chunk 38's carryover consumes the same task-derived flag. **Apple Calendar mirror (chunk 39).** With `settings.planner_writeout` on (opt-in, Settings → Calendars; only while `caldav_status = 'ok'`), every block write is mirrored to the selected iCloud calendar *after* its Supabase write — `scheduled_blocks` is the source of truth and the event is best-effort: a calendar failure toasts once and never rolls the block back, nothing calendar-related enters the outbox, and offline placements simply leave `calendar_uid` null. `calendar_uid` holds the event's uid (`hupo-block-<uuid>`, tagged by the proxy so `/busy` excludes it and reports it as `plannerEvents` instead — the planner therefore never counts a block twice). Once per week load — deduped on `weekKey:busyRefreshKey` **plus a content signature of the visible week's blocks** (id + startAt + endAt + calendarUid, volatile fields excluded; chunk 43, F2) — the planner reconciles the visible week against `plannerEvents`: events no block claims are deleted (task delete/cascade, wipe, replace-import), blocks with a null uid are backfilled, and blocks whose event drifted ≥1 minute are rewritten. The signature makes the dedup self-invalidating: drift written after a week already reconciled (another device's write, an offline outbox drain, a failed mirror write) is repaired on that week's next blocks load with no `busyRefreshKey` bump, while an unchanged week still never re-reconciles. The signature compares timestamps as **instants**, not strings (chunk 48, D13) — an optimistic patch writes `…T20:00:00.000Z` and the saved row comes back as PostgREST's `…T20:00:00+00:00`, so before this every block save looked like new content and re-ran the whole reconcile. The dedup store keeps one entry (the last signature) per `weekKey:busyRefreshKey`, so it stays bounded. The drift comparison reads `plannerEvents` from the last `/busy` **plus a session record of the events the mirror itself wrote** (uid → the start/end it wrote; chunk 46) — the busy fetch has no dependency on blocks or mirror writes, so without the record a block mirrored since that fetch is invisible to the drift loop and silently never repaired. Where only one of the two knows a uid it decides; where both do, the drift comparison takes **whichever observed the event more recently** (chunk 47) — the `/busy` snapshot when it was fetched after the mirror's write, the record otherwise. So an event edited in Calendar.app and reported by a later `/busy` is still seen as drift and still rewritten to the DB time — one-way as ever — while a snapshot older than the mirror's own write no longer makes the mirror rewrite what it just wrote, which is what made a single drag-move fire two identical PATCHes. The backfill and drift loops additionally skip any block whose mirror write the planner is mid-way through issuing (chunk 48, D12): a move/resize/carryover patches its block optimistically and only mirrors after the Supabase write resolves, so without this the reconcile fired on the optimistic frame and wrote the very times the mirror was about to write. The mark is set synchronously before the optimistic patch and released when the hook settles; a pass that deferred a block releases its dedup key, so a mirror write that never landed is still repaired on the next blocks change. The orphan sweep deliberately reads `plannerEvents` alone (it deletes what the calendar actually reports), and skips uids the mirror itself deleted — `afterDelete`'s deletes and, since chunk 49 (D15), the sweep's own successful ones. So an unschedule's delete is never repeated by the reconcile that follows its blocks refetch, and an orphan is never re-deleted by a pass that re-runs because a previous one deferred a pending block: D12's key release lets the whole pass run again with identical arguments, and before D15 the sweep recorded nothing, so a stray planner event in the snapshot was deleted once per deferred pass. A sweep delete that *failed* records nothing, so the uid stays sweepable and the next pass retries — the rule D8 already applies to `afterDelete`'s failure path. Only the sweep reads that set, so it reaches neither the drift loop nor the backfill. The reconcile is additionally gated on the busy and blocks state carrying the visible week's identity (chunk 40), so a week-change transition frame can never consume the reconcile key against stale data. Title drift is not reconciled (`plannerEvents` carries no summary) and task-title edits are not propagated live. One-way only: edits made in Calendar.app never flow back. Turning the toggle off or disconnecting Apple Calendar leaves existing events in place. **Fill-my-week proposals (chunk 38) are client-only and ephemeral:** a `useState` snapshot of the visible week's occupancy that is never written to Supabase/Dexie, never counted toward capacity, and dropped by any block mutation, drag activation or week change — only `Place all` writes, one sequential `scheduled_blocks` insert per proposal. **Carryover moves scan the current week:** a past, unfinished block's "Move to next open slot" always targets today → Sunday of the week containing today (fetching that week's busy + blocks on demand when a past week is visible), never the visible week. All planner math is browser-local (instants ↔ local day/minute on the client; `settings.timezone` is never consulted). Overlap with busy is advisory — surfaced in the drop preview and the toast, never blocked. Last write wins on `updated_at`. **Export/import (chunk 50).** `scheduled_blocks` round-trips through the Settings export/import payload. The export is a faithful dump — `calendar_uid` included, not redacted — but **import writes `calendar_uid: null` on every incoming block row**: a re-imported uid names a VEVENT the file cannot vouch for (deleted by hand, a different calendar selected since, written by another device), and a uid that appears in neither `plannerEvents` nor the mirror's session record is a block the drift loop finds no observation for and skips forever — mirrored to nothing. Null instead re-uses the backfill path above: the next load of that block's week creates the event and stamps a fresh uid (with `planner_writeout` off at import time, blocks simply stay uid-less until it is turned on — chunk-39 behaviour), and the orphan sweep removes whatever stale event the file's uid used to name, per week, as those weeks are visited. The key is **optional on read** (absent → `[]`) and `EXPORT_VERSION` stays `1`, so every export file already on disk still imports. Replace-import deletes blocks explicitly before `tasks` (which would cascade them anyway — the list states the intent) and re-inserts them after `tasks` — since chunk 62 inside `import_replace` (migration 19, §10), in the same order; Merge upserts on `task_id`, the table's real invariant, so a file whose block targets a task that already has a different block resolves to one block rather than violating `unique (task_id)` partway through. Because the conflict update writes every column, a live block matched on `task_id` has its `calendar_uid` nulled as well, so a Merge re-mirrors those blocks on the next load of their week. "Wipe my data" still clears blocks through the `tasks` cascade.

**Notes (chunk 58).** A note is freeform or attached to exactly one task **or** one subcategory (`num_nonnulls(task_id, subcategory_id) <= 1`); a task or a subcategory may hold many notes. The title is optional. **Detach memo — server-side, never in the client.** Two `BEFORE DELETE` triggers, `tasks_notes_detach_memo` and `subcategories_notes_detach_memo`, stamp `detached_label` (the task's `title` / the subcategory's `name`) and `detached_at = now()` on every note pointing at the row being deleted; the FK's `on delete set null` then clears the link. The memo lives in the trigger because deletes also arrive by cascade, bulk delete, merge and import, where no client code runs per row. The memo functions (`notes_memo_task_delete`, `notes_memo_subcategory_delete`) are `security definer` with `search_path = ''`, so the memo is written whichever role issues the delete and is not subject to the caller's RLS. `set_updated_at` bumps `updated_at` on those notes — accepted: a detach is a change to the note. Archiving a subcategory (`archived_at`) is not a delete and changes nothing about its notes. Attaching a note clears `detached_label` / `detached_at`. **Client:** `notes` follows the `scheduled_blocks` shape at every touchpoint — Dexie v6 store, outbox registry entry, `applyServerEcho` case, one realtime handler, `repo.notes` through `writeRow` and the offline path; the sync model (§6) is unchanged. **Export/import:** `notes` is in the payload after `scheduled_blocks`, **optional on read** (absent → `[]`), `EXPORT_VERSION` stays `1`. Replace-import and "Wipe my data" delete `notes` **first**, so the triggers write no memos for a wipe; Replace re-inserts notes after `tasks` — since chunk 62 both happen inside `import_replace` (migration 19, §10), in the same order; Merge upserts on `id`. In both modes an incoming note whose `task_id` / `subcategory_id` is neither in the file's own rows nor live is written with that id `null`, `detached_label` left as the file has it (since chunk 62 Replace checks the file alone: the account is emptied in the same transaction, so no other row could be live). **`tasks.notes` was a separate, older field** (the task dialog's note), untouched by chunk 58: it was copied into this model in chunk 59 and the column was dropped in chunk 60.

**`tasks.notes` is gone (chunks 59–60).** Historical note. Chunk 59 took the column off the client and **migration 17** (`17_copy_task_notes.sql`) copied every non-blank value into one untitled note on its task (dedupe: same task + same trimmed body). **Migration 18** (`18_drop_tasks_notes.sql`, chunk 60) re-ran that insert, verified no value was left uncopied and dropped the column, in one transaction under a `share row exclusive` lock on `tasks` and without `cascade`; it is idempotent. **Migration 17 must not be re-run** — it names a column that no longer exists. A cached Dexie task row that still carries a `notes` property is ignored (no Dexie version bump).

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
  - **Per user (chunk 84).** Each outbox row carries `uid`, the user signed in when it was queued (kept current by the app-wide auth listener). A drain replays only the current user's rows — RLS would make another user's delete a silent no-op and reject their insert. Another user's rows stay queued for them and are dropped after 7 days; rows with no `uid` (pre-84) are dropped unreplayed. Inserts and upserts send `user_id` from the stamp. The sync state and Sync issues count only the current user's rows. The replay engine (`db/outbox.ts`) loads on demand.
  - **Cold start (chunk 85).** The stamp is persisted at sign-in (`localStorage['hup:lastUserId']`) and read back at load, so an op queued before the first auth event — or while `INITIAL_SESSION` has no session (offline, expired token) — still carries its user. Only `SIGNED_OUT` clears it. The app is single-user: replace-import and sample reset clear the whole outbox (won't-fix).
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
5. User picks the calendar the Planner **writes to** ("Planner writes to"), clicks Save.
6. App POSTs `/api/calendar/save-credentials`. Proxy AES-GCM-encrypts password with `CALDAV_ENCRYPTION_KEY` env var, writes `caldav_apple_id`, encrypted password, `caldav_calendar_url`, sets `caldav_status = 'ok'`, and resets `caldav_read_calendars` to `null` (chunk 51) — the Planner re-initializes the read set to every discovered calendar, all enabled, on its next mount (see "Read set vs write target" below).

**Runtime endpoints:**
| Endpoint | Purpose |
|---|---|
| `POST /api/calendar/test-credentials` | Discovery + return calendars |
| `POST /api/calendar/save-credentials` | Encrypt + persist (also resets `caldav_read_calendars` to `null`) |
| `GET /api/calendar/calendars` | Discovery with the **stored** credentials (no password in the request): `{ calendars: [{ url, name }], writeTargetUrl }`. 412 when iCloud isn't configured; 401 `auth_failed` flips `caldav_status` like `busy` (chunk 51) |
| `GET /api/calendar/busy?from&to` | Return merged `busy: [{ start, end, source, title?, calendar? }]` for range (`calendar` = iCloud display name, chunk 51) + `sources` health (`sources.icloud.calendars: [{ url, name, ok }]` per fetched calendar; `sources.icloud.ok` = at least one answered) + `plannerEvents: [{ uid, start, end }]` (iCloud objects tagged `hupo-block-…`, excluded from `busy`) |
| `POST /api/calendar/events` | Create VEVENT, return `{ uid }`; `source: 'planner'` tags the uid `hupo-block-<uuid>` and defaults the description to `Planned in Hupomnemata` |
| `PATCH /api/calendar/events` | `{ uid, title, start, end, description? }` — rebuild the VEVENT at `<calendar_url><uid>.ics` (unconditional PUT, no etag), return `{ ok }` |
| `DELETE /api/calendar/events?uid=…` | Delete the VEVENT; an upstream 404 answers `{ ok, missing: true }` (idempotent) |
| `POST /api/ai/key` | `{ api_key }` — validate against Anthropic (`GET /v1/models?limit=1`), AES-GCM-encrypt, persist, `ai_status = 'ok'`. 422 `bad_key` / 502 `upstream` store nothing (chunk 55, §10) |
| `DELETE /api/ai/key` | Clear the stored key, `ai_status = 'unconfigured'` |
| `POST /api/ai/triage` | `{ tasks, available_minutes, timezone }` → `{ ok, data }`, `data` = Anthropic's Messages JSON unmodified. 412 `missing_key`; 422 `bad_key` (also flips `ai_status = 'auth_failed'`); 502 `upstream` (§10) |
| `GET /api/health` | `{ ok: true }` |

**On 401 from iCloud:** proxy sets `caldav_status = 'auth_failed'` and returns error. App replaces the busy strip with a "Reconnect Apple Calendar" banner linking to Settings. Since chunk 74 the Dashboard shows today's busy times as a line in the Today header; the standalone strip is used only on first run and when the Today list is off. The reconnect banner is unchanged.

**Security:**
- Password encrypted with AES-GCM (Vercel env-var key) on top of Supabase at-rest encryption.
- Service role key lives only in Vercel env vars.
- JWT validated via `jose.jwtVerify` against Supabase JWKS.

**Outlook ICS feed (chunk 34 proxy / chunk 35 client).** A second, read-only busy source: the user publishes their work calendar from Outlook and pastes the ICS link into Settings. `POST /api/calendar/outlook` with `{ icsUrl }` verifies the feed and persists it AES-GCM-encrypted (`outlook_ics_url_encrypted`) along with `outlook_feed_name`/`outlook_status`; `{ icsUrl: null }` disconnects. Verification failures return `422 { ok: false, error: 'invalid_url' | 'unreachable' | 'invalid_feed' }`. `GET /api/calendar/busy` merges both sources — `busy` entries carry `source: 'icloud' | 'outlook'` (+ optional `title`) and the response includes a `sources` block with per-source health; it 412s only when NEITHER source is configured. When the feed stops responding the proxy serves `outlook_cached_busy` (stamped `outlook_fetched_at`) and flips `outlook_status='unreachable'` — the UI treats this as stale-not-lost (amber, never destructive). The ICS URL is write-only from the client: never mapped into the client `Settings` type, never prefilled, never read back. Nothing is ever written to Outlook.

**Read set vs write target (chunk 51, D2).** The proxy reads **all** of the account's event calendars but writes to one. `caldav_calendar_url` is the single **write target** — chosen in Settings at connect time, unchanged by chunk 51, and where every planner mirror lands. `caldav_read_calendars` (jsonb, `[{ url, name, enabled }]`) is the **read set**: `busy` fans out across the enabled calendars in parallel (`Promise.allSettled`, at most 6 in flight), merges the intervals and tags each `calendar: <display name>`; one failing calendar never fails the response (it is reported `ok: false` in `sources.icloud.calendars`), and the request throws only when every calendar failed — all-auth still flips `caldav_status` and answers `401 auth_failed`. The write target is **always fetched**, even when disabled or absent from the set, because planner mirrors live there and the reconcile depends on `plannerEvents`; a disabled write target contributes `plannerEvents` but no busy intervals, and the `hupo-block-` exclusion runs per calendar so a mirror never counts as busy anywhere. `null` is "not initialized" — every pre-chunk-51 row, and every row after a credential re-save or disconnect — and means the legacy single-calendar read of the write target (unnamed: no `calendar` field). The toggles live on the **Planner** (D1), not in Settings: a `CALENDARS · n/m` header chip opens a popover with a switch per calendar (default all on — subscribed and holiday calendars included, the toggle is the remedy), a `WRITE` tag on the write-target row, and a link to Settings; each toggle writes the set through the repo and bumps `busyRefreshKey` so the per-week cache drops; opening the popover re-runs discovery (`GET /api/calendar/calendars`) and appends new calendars enabled / drops vanished ones. The Planner initializes a `null` set once per mount (all discovered, all enabled) and refetches busy; a failed initialization stays `null` (`CALENDARS · –`) and retries on the next mount. The Dashboard busy strip consumes the same merged `busy` and so reflects the union without change. Nothing is written to any calendar other than the write target (D5: no app → Outlook write).

**Discovery keeps subscribed calendars; every calendar has its own color (chunk 51b).** Discovery (`test-credentials`, `GET /api/calendar/calendars`) runs the proxy's own Depth-1 PROPFIND on the calendar home rather than tsdav's `fetchCalendars`, which keeps only `<calendar/>` collections — iCloud reports every *subscribed* calendar (US Holidays, any webcal feed) as `<cs:subscribed/>`, so chunk 51 as shipped never listed them. Kept: `calendar` and `subscribed` collections whose component set is empty or includes `VEVENT`; excluded: VTODO-only collections (Reminders) and the schedule-inbox / outbox / notification collections. **Not reachable by design:** Birthdays, Siri Suggestions, "Scheduled Reminders" and any non-iCloud account (Google, Exchange, On My Mac) do not exist on iCloud CalDAV — a work calendar comes in through the Outlook ICS feed. Each discovered calendar carries iCloud's `calendar-color` normalized to `#rrggbb` (alpha dropped) and a `subscribed` flag; the read set stores `color` per entry (`[{ url, name, enabled, color? }]`, validated on both sides) and `busy` tags every interval of a colored calendar `color`. On the app, `lib/calendarColors` makes the colors **distinct in read-set order** — iCloud's color when no earlier calendar took it, else the next unused entry of a ten-hue Apple-like palette — and joins untagged iCloud intervals to it by calendar name, so a proxy that tags no color still renders distinctly. Busy blocks mix the color into the recessed tint (16%) and inset ring (42%) and carry a dot beside the source tag; the busy popover and each picker row show the same dot. **The Outlook feed is one more calendar in the color sense (chunk 51c):** the Planner passes it to `calendarColorMap` as an extra entry once `/busy` reports it configured, colored after the read set under the same distinctness rule, keyed by `outlookColorKey(feedName ?? 'Outlook')` — namespaced, because an Outlook published calendar and iCloud's default are both commonly named "Calendar". An Outlook block keeps its 135° hatch (the *source* cue — stale semantics ride on it, 55% opacity unchanged) over the color tint (the *identity* cue); without a color (pre-fetch, unconfigured) the flat `--busy-outlook*` tokens stand. The picker lists the feed last as a read-only row (dot, feed name, `FEED` tag, no switch); the chip count stays `n/m` over iCloud. The proxy is untouched and never writes to Outlook. **Tight blocks (chunk 51c):** `PLANNER.hourH`/`mHourH` are unchanged (52/48 — the drop-slot math depends on them), so a 30-minute block is 24px on desktop and 22px on mobile; `BusyBlock` renders the title from 18px, and below 30px uses `py-[2px]`, 10px type, line-height 1.1. The 14px `blockPos` floor (15 minutes) stays text-free — the popover is the reveal. `TaskBlock` already shows its title at 24px (its `tight < 40` mode has no title threshold) and was left alone. The Dashboard busy strip is text and unchanged.

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

**Reminder time zone (chunk 61):**
- The reminder picker reads and writes wall-clock times in `settings.timezone`, resolved by `loadUserTimezone` (`src/lib/userTimezone.ts`); if settings cannot be read it uses the browser's zone.
- When that zone differs from the device's, the picker shows `Times in <zone>`.
- Wall time → instant goes through `lib/zonedTime.ts` (`zonedWallToDate`, `Intl` only, so the device's zone never matters; chunk 82) — for reminders, due dates, `clock.startOfDayIso` and the Block-time working window. A wall time that occurs twice (a fall-back hour) is its earlier instant; one that is skipped (a spring-forward gap) shifts forward by the gap; a day's start is its first instant, even where midnight is skipped. Display paths still format with `date-fns-tz` `formatInTimeZone`.
- `remind_at` stays a UTC instant, so the server and client `remind_at < now()` comparisons are unchanged. Values stored before chunk 61 were not rewritten.

**iOS requirements:**
- iOS 16.4+
- PWA installed to home screen
- Notification permission granted
- Without all three: only in-app fallback fires, and only while a tab is open.

---

## 10. AI triage

Triage runs **through the proxy** (chunk 55; supersedes the original client-side call). The browser never holds, reads or sends the Anthropic key after it is saved.

**Key lifecycle.** The user pastes their own Anthropic key in Settings → `POST /api/ai/key`. The proxy validates it (`GET https://api.anthropic.com/v1/models?limit=1`), AES-GCM-encrypts it with the existing `CALDAV_ENCRYPTION_KEY` (the iCloud-password / Outlook-URL pattern — no new secret) and writes `settings.ai_api_key_encrypted` + `ai_status = 'ok'`. A rejected key (422 `bad_key`) or an unreachable Anthropic (502 `upstream`) stores nothing. `DELETE /api/ai/key` clears it. The Settings field is write-only: it renders from `ai_status` (`unconfigured` → input + Save; `ok` → "Key saved" + Replace / Remove; `auth_failed` → "Anthropic rejected the saved key" + Replace / Remove) and refetches settings after every save/remove — never optimistic, the `caldav_status` rule.

**Triage call.** `POST /api/ai/triage` with the Supabase JWT and body `{ tasks: TriageTask[] (≤300), available_minutes: 1–1440, timezone }`, where `TriageTask` is `{ task_id, title, subcategory_name, category_name, estimate_minutes, due_at, priority }` (zod-validated, strict). The proxy owns the Anthropic request:
- `POST https://api.anthropic.com/v1/messages`, headers `x-api-key: <decrypted key>` and `anthropic-version: 2023-06-01`
- Model: the latest active Haiku, resolved per chunk 57 D1–D4; floor `claude-haiku-5-5`. `max_tokens: 800`
  - **Resolve (D1).** `GET /v1/models?limit=100` with the caller's key, at most 3 pages (no `lifecycle` query filter — Anthropic answered it with 400 on 2026-10-12); the entry with `line === 'haiku'`, `lifecycle === 'active'` and the greatest `created_at` wins. The `id` text is never matched (Anthropic has no `-latest` alias, and a new model ships under a new ID).
  - **Floor (D2).** `claude-haiku-5-5` when that call fails, times out or lists no active Haiku — never another model line.
  - **Cache (D3).** In memory per warm instance, keyed by SHA-256 of the key: 24 h for a resolved model, 5 min for the floor. Nothing is persisted; Supabase is unaware of the model.
  - **Retired model (D4).** A `404 not_found_error` from `/v1/messages` drops the cache entry, re-resolves and retries once; a second failure is 502 `upstream`.
  - Resolution and the Messages call share the one 12 s budget. Each triage logs `triage model=<id> source=<resolved|floor|cache>`, with no key material.
  - The app names no model; Settings reads "Uses the latest Claude Haiku".
- System prompt frames Claude as a triage assistant
- User message: JSON of the tasks + available minutes + timezone
- Expected model output: `{ recommendations: [{ task_id, reason }], note: string }`

The proxy returns `{ ok: true, data }` with Anthropic's Messages JSON **unmodified**; extracting the text block and parsing the recommendations stays client-side (`src/lib/ai.ts`).

| Proxy response | Meaning | App error kind |
|---|---|---|
| 412 `missing_key` | no key stored | `missing-key` |
| 422 `bad_key` | Anthropic 401/403; proxy also sets `ai_status = 'auth_failed'` | `auth` |
| 401 | the Supabase JWT was rejected (not the AI key) | `network`, "Your session expired — sign in again." |
| 502 `upstream` / 5xx / fetch reject | Anthropic or the proxy unreachable | `network` |
| non-JSON, or `ok:false` with no mapped code | — | `malformed` |

**Legacy key (history).** Before chunk 55 the key lived in plaintext in `settings.ai_api_key` and was sent from the browser; the proxy migrated it into `ai_api_key_encrypted` once, on 2026-10-12 (chunk 55 D5), and chunk 56 removed every proxy reference and dropped the column (migration 15).

**Settings in export/import (chunk 16 / 55 D7 / 56 D2).** Two key lists in `src/lib/export.ts` govern the settings row. `CREDENTIAL_SETTINGS_KEYS` — the three proxy-owned ciphertexts (`caldav_app_password_encrypted`, `ai_api_key_encrypted`, `outlook_ics_url_encrypted`) — is redacted to `null` on export **and** omitted from the import's settings upsert, so a redacted null never overwrites a live secret. `IMPORT_STRIPPED_SETTINGS_KEYS` — `ai_api_key`, `ai_status`, `caldav_status`, `outlook_status` — is **not** redacted on export (the file stays a faithful dump) but is omitted on import: `ai_api_key` is the dropped legacy column that pre-chunk-55 files still carry, and the three statuses describe secrets the file does not carry, so the live row's value is the only truthful one (importing `ai_status: 'ok'` onto an account with no key would show "Key saved" while triage 412s). Both are denylists by design — no column allowlist, which would drift on every migration. **On Replace the strip is applied twice (chunk 62):** by the client (`buildReplacePayload`) and, as defence in depth, by `import_replace`'s own denylist (the same seven keys plus `user_id`); a test in `src/lib/import.test.ts` reads migration 19 and pins the two lists together.

**Replace is one transaction (chunk 62).** Replace builds the whole payload in memory (no live reads) and sends it to `public.import_replace(jsonb)` (migration 19), which deletes and reinserts the six content tables and overlays settings in one PostgREST call: all of it lands or none of it does. `security invoker`, so RLS decides whose rows it touches and a foreign `user_id` rolls the import back. The outbox is cleared and the cache wiped only after it succeeds. Merge stays a sequence of upserts (non-destructive).

**Legacy task notes in export/import (chunks 59–60).** Export no longer carries the field: it is `select('*')` and the column was dropped in chunk 60. Import still handles it, permanently, because files exported before chunk 60 carry it indefinitely: in both Replace and Merge it writes task rows **without** `notes` (the column no longer exists, so naming it would be a 400) and turns each incoming task row's non-blank `notes` into a note: untitled, attached to that task, with the task's own timestamps — the shape migration 17 writes. A note is not synthesized when one with the same `task_id` and the same trimmed body is already in the file's `notes` or already live (`repo.data.noteBodiesForTasks`; Merge only since chunk 62 — Replace empties the account in the same transaction, so it checks the file alone), so a pre-58 file imports into notes and importing anything twice adds nothing. Synthesized notes go out in the same `notes` upsert as the file's own, after `tasks`.

**Security posture.** The key is no longer visible in browser network traffic or the DOM after the one `POST /api/ai/key`. `api.anthropic.com` is no longer in the CSP's `connect-src` (chunk 55 D6), so an injected script cannot reach Anthropic at all. The remaining CSP (chunk 17, SRV-01: a build-time `<meta http-equiv="Content-Security-Policy">` injected by a `build`-only Vite plugin so dev is unconstrained) restricts `connect-src` to Supabase — including `wss://*.supabase.co` for Realtime — and the CalDAV proxy, and blocks inline/cross-origin scripts. `style-src` retains `'unsafe-inline'` for recharts' inline styles (§12) pending deployed-console confirmation that dropping it is safe. See `docs/security.md`.

---

## 11. Streak calculation rule (tasks)

A day counts toward the streak when at least one task's `completedAt` falls on that day in `settings.timezone`.

The streak is the run of counting days back from today — or from yesterday while today has none yet, so it survives until the day ends. The first day with no completion ends it.

It reads every task the Dashboard holds, in any subcategory, archived or not; deleted tasks are gone and don't count. It is derived in render (`lib/taskStreak`), so completing a task and Undo move the hero chip at once, with no refetch.

The routines streak and the 14-day grid were retired in chunk 78; `routine_items` / `routine_logs` and their sync, export and import are unchanged.

---

## 12. Insights rendering rule

If more than 8 subcategories appear in the filtered range, group all but the top 7 (by total minutes) into an "Other" bar segment with a neutral color. Tooltip on hover shows the full breakdown including grouped items.

Days are calendar days in `settings.timezone` (chunk 61), for both the x-axis window and each completion's bucket; the zone is resolved by `loadUserTimezone`, with the browser's zone as the fallback.

Insights reports estimates, not tracked time (chunk 70): the headline cards lead with tasks completed, then `Estimated time` (sum of `estimateMinutes`), and every label says estimated. When a range is empty the screen names the last completion date (an all-time `listCompletedInRange` read, only when the range returned nothing) and offers `Show 90 days`.

---

## 13. UI interaction rules

**Drill-down affordance:**
- Visible chevron (›) on every category and subcategory header — primary on mobile.
- Double-click on header is desktop accelerator.
- Long-press is NOT used for navigation (conflicts with iOS Safari).

**Drag affordance:**
- **Contexts (chunk 88):** the Dashboard has one `DndContext` over both columns, so tasks drag across categories; the Category drill-down has one context. The Today rail is outside it.
- **Drop target (chunk 88):** the whole list section (`subdrop:<id>`), pointer-based (`taskDragCollision`: `pointerWithin`); gaps, category headers and the space between columns are no-ops.
- **Ghost and reorder (chunk 88):** task drags render a `DragOverlay` ghost (portalled to `body`); list reorder stays inside its own category (`subs:<categoryId>`, `rectIntersection`).
- **Touch (chunk 88):** drag by the grip (≥ 44 px, `touch-action: none`); ⋯ → Move to… stays everywhere and is the keyboard path.
- **Feedback (chunk 88):** every move toasts `Moved to …` with Undo.
- Subcategory drill-down uses bulk-select + "Move to..." picker (no drag).
- Detect touch via `matchMedia('(hover: none)')` and conditionally attach drag handlers.

**Responsive breakpoints:**
- <640px: single column, bottom-nav tabs
- 640–1024px: two-column dashboard
- ≥1024px: sidebar + dashboard + detail
- All interactive elements ≥44pt hit target on mobile
- Settings rows (chunk 79): `SettingsRow` stacks below `sm` (title and hint above the control, `gap-2`); from `sm` up it is two columns, `sm:grid-cols-[minmax(180px,220px)_minmax(0,1fr)]`, and the control cell is `min-w-0`, so no Settings control overflows a phone.
- Every text-entry field (inputs, textareas, selects, date/time pickers) renders at ≥16px font-size on touch, compact only at `sm:` and up, so iOS Safari does not zoom the viewport on focus. `src/lib/iosFocusZoom.test.ts` fails the build on any field that does not (chunk 65).
- Small text meets WCAG AA (chunks 75, 75a). `--ink-3` is `#6b6676` (≥4.5:1 on every surface); `--ink-4` is never used for text. Text in a category or jewel colour uses its `-ink` variant (`--work-ink`, `--personal-ink`, `--jewel-*-ink`; `catInk()`); fills, borders and dots keep the base colour. Text on a tinted wash uses `--ink-2` or darker. Busy-block text uses `--busy-ink` (≥4.5:1 on any 16% calendar wash); the stale Outlook 55% fade is the one accepted exception. No text is under 11 px (`.label` included) outside the planner time grid's seven fixed-size components. `src/lib/contrast.test.ts` and `src/lib/fontFloor.test.ts` guard this.
- Every signed-in screen has one `<main id="main">` (in `ProtectedLayout`) and a `Skip to main content` link as its first focusable element (chunk 75).
- Task rows (chunk 77): each task row is one tab stop, a `role="group"` named by the task title. Tab enters it on the completion checkbox, or on the control last used in that row; ← / → move between its controls (selection checkbox, completion, title, priority chip, when chip, minutes, Today sun, ⋯), Home / End go to the first / last, nothing wraps. The grip is out of the tab order (pointer drag only; keyboard moves use ⋯ → Move to). Enter or Escape in the inline title or minutes edit returns focus to its button. Row keys are never stopped from bubbling, so global shortcuts work from any row control. A picker opened from ⋯ (priority, due date, reminder) keeps focus when the menu closes; when a picker closes, focus goes to its chip if the row shows one, else to ⋯, unless the user has already moved focus elsewhere (chunk 77a). While handing off, the menu items ignore pointer leave / move, so a mouse over the closing menu cannot pull focus back out of the picker (chunk 77b). A focused row control becomes the row's tab stop at once, so a fast Home → Tab leaves the row; `Block time` and the notes sheet open from ⋯ only once the menu has closed, and closing them returns focus to ⋯ (chunk 77c).
- `viewport-fit=cover` + `env(safe-area-inset-*)`: the top inset is applied at the AppShell wrapper (not the header alone) so the header and the InstallHint banner clear the notch / Dynamic Island; the fixed bottom nav and scroll container are padded for the home indicator.
- Page margins (chunks 51d/51e): the shell fills the window — no max-width. Default padding is declared as `--shell-side` / `--shell-top` / `--shell-bottom` on `.shell` in `index.css` (16/28/40px sides by breakpoint, 24–32px top, 32px bottom; phones add the bottom-nav clearance). Settings → Display → Page margins opens `MarginEditor`: draggable guides on the content wrapper's padding edges, live preview, Save persists `hup:shellMargins` per device (localStorage, no schema, no sync) as an inline override of those variables; saving the defaults clears the key. **Chunk 69:** the saved set reaches `.shell` as `--shell-*-saved` and is applied from `sm` up only (phones always get the defaults; the Settings row is hidden there). The saved side is a ceiling: `--shell-side: min(saved, max(default, (100vw − 900px) / 2))`, so it gives way live as the window narrows and content keeps 900px (`MARGIN_LIMITS.minContentWidth`, same figure in `index.css`). The dashboard's category grid goes two-column on a container query (`.category-cols` / `.category-grid`, 48rem), not the viewport.

**Dashboard Today panel (chunk 41 merge, built on `main`):**
- The dashboard mounts a Today panel in one of three variants — `stacked`/`banner` full-width above the columns, `rail` beside them — or `off` (renders nothing), chosen in Settings → Display ("Today list layout"). The variant preference (`localStorage['hup:todayList']`, Zustand) is a per-device display setting: no schema, no sync. Today membership itself is a `Set<taskId>` seeded from `autoTodayIds` — P1 tasks, tasks due today or overdue by `dueAt`, and `remindAt` due/overdue — days in the Settings time zone (chunk 66) — and toggled via the sun button on panel + dashboard rows; the manual pins and removals are **synced through `today_marks`** (chunk 64 — see §4 "Today marks"), one upserted row per toggle, so a plan made on one device shows on the others. They hold for the Settings-zone day they were made on and stop applying at day rollover; the auto-derived portion re-derives on every seed/reconcile, and nothing is applied until both tasks and marks have loaded. `hup:todayPlan`, the per-device localStorage entry that held the deltas from chunk 43, is read once on the first loaded render, moved onto marks (a server mark already there for today wins) and removed; nothing writes it any more. Category/Subcategory drill-downs deliberately omit the sun toggle. A due date is a calendar day set from ⋯ → Set due date…, stored as 00:00 of that day in `settings.timezone`; it never turns Overdue during its own day (chunk 66). While the plan holds fewer than three tasks (done ones count), the stacked and rail layouts suggest open tasks to pin: priority, then soonest due date, then oldest, taking turns between categories (`lib/todaySuggest`, chunk 67). Add writes an ordinary pin; Skip is session-local and writes nothing.
- Routines in Today (chunk 78): the routine checklists sit at the bottom of the Today panel in `stacked` and `rail`, and in their own card below where the panel would be in `banner` and `off`; the block is collapsed by default, with the open state per viewer in `localStorage['hup:todayRoutinesOpen']`, and `/routines` falls to the catch-all redirect.

**Week Planner (chunks 36–38):**
- `/planner` (lazy-loaded, second primary tab): desktop 7-column week grid + unscheduled tray; mobile day strip + single-day timeline. Busy overlays (chunk 36), scheduled blocks with native pointer drag / move / resize / Schedule sheet / done / unschedule (chunk 37), Fill-my-week proposals and carryover (chunk 38), opt-in Apple Calendar mirror of every block write — fire-and-forget after the Supabase write, never awaited by the optimistic handlers, with a per-week reconcile (chunk 39).
- Chunk 38 mechanics: `Fill my week` (desktop header only, disabled on a past week / weekend / with no P1–P2 tray task) proposes the earliest open 09–18 weekday slot for every P1/P2 tray task, packed sequentially around busy + scheduled + earlier proposals; proposals render as dashed previews plus dimmed `→ DAY HH:MM` tray cards until `Place all` / `Clear`. A past, not-done block goes hollow (`· unfinished`) on both breakpoints; `→` on the desktop hover row or `Move to next open slot` in the block action sheet moves it to the next open slot of the **current** week (weekends included). Done styling always wins over carry.
- Inline styles in the planner never mix a CSS shorthand with one of its longhands (React 19 conflicting-style warning); variant borders/decorations go through class names or longhands.
- Busy fetch is screen-level: one `getBusy` per visible week (Mon 00:00 → Sun 24:00, local ISO instants), simple in-memory per-week cache keyed on `dashboardRefreshKey`; `lib/busyCache`/`BusyStrip` remain the Dashboard's day-scoped concern.
- All planner day/time math is browser-local (`lib/plannerGeometry`); `settings.timezone` stays a task streak, Insights, reminder/due-date entry and Today concern; the planner stays browser-local.
- Capacity math (`lib/plannerCapacity`) already accepts busy + scheduled inputs; chunk 36 passes `scheduled = []` so "planned" is honestly 0m.
- The tray reuses the chunk-33 global sort (`hupo.taskSort` + `TaskSortControl`); the five `--busy-*` CSS variables in `src/index.css` are the only sanctioned raw values beyond the Daylight tokens.

**Notebook (chunk 58; visual spec `hupomnemata_handoff/notebook/`):**
- Route and nav: one lazy-loaded route, `notebook/:noteId?`, under `ProtectedLayout` — a single entry rather than two, so the screen and an unsaved draft stay mounted between list and note. At ≥640px `:noteId` selects the note in a two-pane view; below 640px it is a full-screen editor. An unknown id falls back to `/notebook`. Notebook is the fourth of four primary tabs: Tasks · Planner · Insights · Notebook, with Settings in the account menu (chunk 79). Below 640px the bottom nav and the shell's bottom-nav clearance are dropped on `/notebook/:noteId` — that route only.
- List: search, an All · Freeform · Attached segment, then a `PINNED` group and a `RECENT` group, each by `updatedAt` desc. The `RECENT` label shows whenever unpinned notes exist, with or without a `PINNED` group above it. A row shows the title (or the first body line in italic when untitled), a two-line excerpt, a relative time and the attachment chip. Search is client-side over the Dexie cache, case-insensitive, over title + body, highlighted with `<mark>` built from text nodes — never `innerHTML`.
- Attachment chip: category dot + subcategory name, or the task title with a `TASK` micro-label; archived subcategories render normally. A detached note (`detachedLabel` set, both links null) gets a hollow dashed chip with the name struck through.
- Notes on completed tasks are hidden by default behind a `+N ON COMPLETED TASKS` row at the bottom of the list; once revealed, a `HIDE COMPLETED TASKS’ NOTES` row hides them again. The reveal is session-scoped component state, like `SubcategorySection`'s completed-task reveal — there is no persisted hide-completed preference. Freeform and subcategory notes are never hidden.
- New note opens an unsaved draft: nothing is written until the title or body holds a non-whitespace character, and leaving an empty draft discards it. Emptying an existing note does not delete it.
- Editor: a borderless title input and a plain auto-growing `<textarea>` body — source while focused, rendered Markdown when not; clicking the rendered body focuses the textarea at the end. Body text is 16px on touch devices, 15px otherwise. No rich-editor dependency. The renderer (`src/lib/noteMarkdown.tsx`) is a pure body-string → React-nodes function that never uses `dangerouslySetInnerHTML` and supports exactly `# ` / `## ` headings, `- ` lists, blank-line paragraphs, `[text](url)` and bare `https?://` URLs. Only `http:`, `https:` and `mailto:` become links (`target="_blank" rel="noopener noreferrer"`); any other scheme renders as plain text.
- Autosave, no Save button: 600 ms debounce, flushed immediately on blur, on route change / unmount and on `visibilitychange → hidden`. Save state (`Saved` / `Syncing` / `Offline · saved on this device` / `Offline · N change(s) queued`) is derived from `syncStore`, the outbox count for that note's id and a local pending-debounce flag, and reuses the `SyncIndicator` dot (`SyncDot`).
- Attach picker: a stepped `Dialog` — Work/Personal → non-archived subcategories → "Attach to this list" plus that list's tasks (completed tasks struck and muted but pickable). Attaching sets exactly one of `taskId` / `subcategoryId`, nulls the other and clears the detach memo; the footer `Detach` and the header unlink null both. Delete is a hard delete through `DeleteConfirm`, which states that the attached task or list is not affected.
- Task side (chunk 59, handoff §4–§5; fixes in 59a). Everything below reads notes from `NotesProvider`; nothing is drilled through the screens.
- `NotesProvider` (`src/components/notebook/NotesProvider.tsx`) is mounted once inside `ProtectedLayout`. It holds every note (`repo.notes.listAll()` on mount and on `dashboardRefreshKey`) and exposes `useTaskNotes(taskId)`, `useListNotes(subcategoryId, taskIds)` (notes on the list **and** on those tasks) and `openTaskNotes(taskId, noteId?)` through `notesContext.ts`. `useNoteWriter` — the one draft / create / update / delete path, shared by the Notebook screen and the task sheet — reports each successful write to the provider, so counts move without a refetch, offline included. The provider renders the task sheet, whose module is lazy so the editor, attach picker and Markdown renderer stay out of the eager bundle.
- The sheet takes `userId` from `NotesProvider` and is not rendered until it exists (59a F1). It never calls `useSession()` itself: that hook has no user on its first render, which is the render that decides whether to open a draft.
- Task row (chunk 71): checkbox, grip (pointer), title (up to two lines), priority chip, one when-chip, minutes, Today sun and ⋯. Bell, notes and delete live only in ⋯; the row keeps no note column. The when-chip shows the due date (`2d late` / `Today` / `Tomorrow` / weekday / `Oct 24`) or, when there is none, the reminder (`Today 3:00 PM`, `Overdue`), in the Settings time zone, and opens the matching picker; completed rows have none. The ⋯ item reads `Notes` (the latest note's relative time, or the count at two or more) or `Add a note`; it replaced `Edit notes` and `EditNotesDialog`.
- Task sheet: the app `Sheet`, right at 480px on pointer and bottom at 88vh on touch, titled with the category dot and the task title. 0 notes → an unsaved draft attached to the task; 1 → that note's editor; 2+ → a newest-first list with `New note` and `Open in Notebook`, a row opening its editor with a back chevron in the title. Notes on completed tasks always show here. The embedded `NoteEditor` is given a `menu` (Open in Notebook · New note on this task · Delete note) in place of the header trash. Moving the note elsewhere toasts `Note moved.`; unlinking toasts `Detached from {task}. It is now a freeform note.`; both, and delete, return to what is left on the task or close the sheet when that was its last note — decided from the notes as they stood before the write. An open sheet with no note on screen and none on the task closes itself (59a F2).
- Subcategory header (dashboard card and CategoryView): `glyph + count` beside the open count when the list or its tasks hold notes; not a button. Both counts share one grid cell, the name truncates and the trailing controls are `shrink-0`, so the header stays on one row (59a F3).
- Subcategory drill-down: after the task list, a `NOTES · N` section with `New note here` and a card of rows (first line · relative time · `On this list` or glyph + task title). A task's note opens the sheet at that note; a list's note goes to `/notebook/:id`. `New note here` navigates to `/notebook?attach=subcategory:<id>`: the Notebook reads the param once, opens an unsaved draft attached to that list and replaces the URL with the draft's; an unknown or archived id is ignored.
- Planner: when a block's task has notes, the block action sheet shows a read-only `--surface-2` card (`NOTE` or `NOTES · N` · `updated` / `latest` + relative time · `Open →`, then the newest note's first line and a three-line excerpt); `Open →` closes it and opens the task sheet at that note. A block of 40px or more carries the note glyph after its title.
- Block time: the `Include notes in calendar event` checkbox shows when the task has at least one non-blank note in the `notes` table. The description, when included, is every such note, newest first, each as `title\n\nbody` (or the body alone), joined by a blank line.
- One link pattern (`NOTE_LINK_SOURCE` in `src/lib/notes.ts`) serves both the renderer and the list excerpt; it allows one level of balanced parentheses in the URL.
- Phone width (chunk 68): below `sm` the account trigger is a 44 px initial (full email at `≥ sm`, `aria-label` 'Account: <email>'); category headers wrap to two lines (name + count, then horizon, sort, › — no time total since chunk 86) and never exceed their column; the category grid uses `minmax(0,1fr)` columns. The top tab bar's active underline sits inside the nav (`bottom-0`), so the bar has no vertical overflow.
- Hero (chunk 70): the ring is the Today plan — done ÷ planned, from the same `resolveToday` call as the Today panel — and shows `—` when nothing is planned; XP, level and the category bars stay all-time. The streak and level chips hide at zero. Open tasks under archived or missing subcategories are listed in a `Recovered` card on the Dashboard (move to a live list, or mark done); they stay out of every other view.
- Row targets (chunk 71): the grip and the minutes button reach 24 px on pointer; the when-chip reaches 44 pt on touch.
- Undo (chunk 72): deleting a task — ⋯ → Delete or the Subcategory bulk bar — has no confirm. The task hides at once and is hard-deleted 6 s later unless Undo is pressed in the toast; until then nothing is written, so Undo restores its planner block, calendar event, Today mark and notes untouched. `lib/taskUndo.ts` owns the window: pending ids are filtered out of every `repo.tasks` list, mirrored to `localStorage['hup:pendingTaskDeletes']`, committed on `pagehide`, and leftovers are committed on the next start. Sign-out from the app (account menu, Settings → Account) awaits pending deletes, capped at 4 s, before ending the session (chunk 81). Any sign-out — those buttons, token expiry, another tab — parks the deletes still waiting on `SIGNED_OUT` (timers stopped, ids kept pending and stored), and the next signed-in start commits them (chunk 82). Each pending entry carries its task's user id: a signed-in start commits only that user's entries; another user's stay parked and are dropped after 7 days, and a page-hide flush commits only this session's own deletes (chunk 83 — RLS makes a cross-user delete a silent no-op). Completing a task (rows, Today panel, Recovered card, bulk) shows the same 6 s Undo, which restores the prior `completedAt`. Subcategory, routine-item and note deletes keep their confirms; the Planner check-off has no Undo.
- Capture (chunk 73): `N` or `⌘K` (or `+ New task` in the header, the floating + on phones) opens one capture field. `lib/captureParse` reads `p1–p3`, an estimate (`15m`, `1h30m`), a due day (`today`, `tomorrow`, a weekday — always the next one after today — or `M/D`) in the Settings time zone, and `#work` / `#personal` / `#<list>`; each recognised word shows as a chip whose × keeps the word in the title. With no list token the task goes to the last list captured into (`localStorage['hup:captureDest']`), else General in Personal, then Work. `/` searches open tasks by title and list (`lib/taskSearch`) and opens the hit's list. No Inbox list; the inline `+ New task` is unchanged.
- Ageing and the top of the Dashboard (chunk 74): open rows 28 days or older show their age (`4w`, `1y`; `lib/taskAge`, calendar days in the Settings time zone; hidden on completed rows). Once a week (per device, `localStorage['hup:lastReview']`) the Dashboard offers a review of open, unplanned tasks 90 days or older (`lib/review`): Keep, Add to Today, or Delete, one at a time; deletes run when the sheet closes, through the chunk-72 Undo. With nothing planned the hero is one line (greeting, chips, What's next?); the busy times sit in the Today header (`BusyInline`), and the standalone strip remains only on first run and with Today off. Today no longer draws a hint box under an empty header. Since chunk 74a the walk's buttons ignore a second click of a multi-click and any activation within 400 ms of an advance (`REVIEW_SETTLE_MS`), so one click acts on one task.
- Horizon (chunk 76): every list can be narrowed to near term or long term. The horizon is derived, never stored (`lib/horizon`): a task is near when it is P1 or P2, or when its due date or reminder falls within 14 calendar days in the Settings time zone (past days included); everything else is long. One global preference (`localStorage['hupo.taskHorizon']`, default `all`), a three-segment control beside the sort control on the Dashboard columns and both drill-downs. The filter applies to open rows only; counts and totals follow it; completed rows, the Today plan and the Planner are unaffected. The control stops only Enter, Space, the arrows, Home and End from bubbling, so global shortcuts work while it has focus (chunk 76a).
- Greeting name (chunk 86): the hero greets by the auth `user_metadata.name`, set in Settings → Account → Name (`supabase.auth.updateUser`); with no name it is the bare greeting — never the email local-part.
- Completed rows (chunk 86): lists and drill-downs show completions from the last 30 days only (`lib/completedAge`, `COMPLETED_VISIBLE_DAYS`); older ones live in Insights. The repo still loads every task, so XP, the streak, search and export see them all. A list whose only tasks are old completions reads `All done.`.
- No time totals (chunk 86): list and category headers (Dashboard columns, Category and Subcategory drill-downs) show open counts only. Per-row estimates, the Today panel's `to do · Xm`, the Planner and Insights keep minutes.
- Capture size (chunk 86): the capture dialog has `S · 15m` / `M · 30m` / `L · 1h` toggles (`CAPTURE_SIZES` in `lib/captureParse`). Precedence on save: a typed estimate > the picked size > 30 m. The size resets after each add and on close.
- Archived purge (chunk 86): Settings → Data → Archived items deletes, on demand, every archived routine item (logs cascade) and every archived list that holds no task and no note (`repo.data.purgeArchived`, re-read server-side in the call; body in `db/archivedPurge.ts`, loaded on first use). Online-only, no outbox; lists with tasks or notes are always kept.
- Deleting a list (chunk 87): with open tasks the dialog asks Move them to… (any live list, any category; own category first) / Mark them done / Delete them; with none, one plain confirm. Completed tasks follow Move and Delete and stay with the archived list on Mark done and on the plain confirm (`lib/deleteList`, archive only after the task step).
- Today suggestions fit free time (chunk 87): with the calendar connected, suggestions are sized to 09:00–18:00 today in the Settings zone (`lib/workDay`), from now rounded up to 15 min, minus merged busy (`lib/freeToday`), minus the plan's open estimates; the label reads `fits Xm free`, or one line says nothing fits. Unconnected, loading or error → unsized.

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
| ~~AI key exposed in browser traffic~~ | Closed in chunk 55: triage goes through the proxy and the key is AES-GCM-encrypted in `settings.ai_api_key_encrypted`, never returned to the app (§10). Residual: the proxy's `CALDAV_ENCRYPTION_KEY` now protects three secrets; `caldavAppleId` is still never written to Dexie (chunk 18) |
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
