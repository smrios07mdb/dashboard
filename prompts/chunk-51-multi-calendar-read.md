# Chunk 51 — Multi-calendar iCloud read (proxy + app) · Planner calendar picker

**Repos:** `smrios07mdb/dashboard-caldav-proxy` (`main`, HEAD `1fb9200`) and `smrios07mdb/dashboard` (`main`, HEAD `6de87ab`; last code SHA on gh-pages `ba10f74`). **Prerequisite (met):** chunk 50 closed at `909390d` + docs `1220208`.

Run per `CLAUDE.md` and `prompts/README.md`. Authority order: `ARCHITECTURE.md` → `prompts/README.md` → this prompt. If this prompt and `ARCHITECTURE.md` disagree, stop and surface it.

Read the committed source before writing anything. This prompt was written against `1fb9200` (proxy) and `6de87ab` (app); if a file differs from its description here, the file wins and you say so in the report.

**Numbering note (D4):** chunk 51 was previously reserved for the Notebook tab. Notebook is now chunk 52. Task 5 renumbers the references.

---

## Why this chunk exists

The Planner and the Dashboard busy strip read exactly one Apple calendar — `settings.caldav_calendar_url`, chosen from a dropdown in Settings at connect time (chunk 13). Live `/busy` for week 36 returns a single event. The operator has events across several iCloud calendars; every calendar other than the selected one is invisible.

This chunk makes the proxy read **all** of the account's event calendars (per-calendar on/off, default all on) while keeping `caldav_calendar_url` as the single **write target** for chunk-39 mirrors. The picker lives on the Planner, not in Settings.

## Locked decisions (never relitigate)

- **D1** — Read all VEVENT calendars; per-calendar toggles; default all on; toggles in a Planner-header "Calendars" popover. Connect flow and write-target dropdown stay in Settings.
- **D2** — Read set is a new column `settings.caldav_read_calendars jsonb` `[{ url, name, enabled }]`. `caldav_calendar_url` is unchanged and remains the write target.
- **D3** — Proxy fans out across enabled calendars with `Promise.allSettled`; one failure does not fail the response; every iCloud interval carries `calendar: <display name>`.
- **D4** — This is chunk 51; Notebook → 52.
- **D5** — No app → Outlook write. Do not touch the Outlook path.

## Files to read first

Proxy:
- `api/calendar/busy.ts` (the single-calendar read; `TaggedInterval`; `sources` block), `api/_lib/caldav.ts` (`getBusy`, `discover`, `PLANNER_UID_RE`, `calendarName`, `classifyError`), `api/_lib/supabase.ts` (`CalDavSettings` l.21–33, `SELECT_COLS` l.36–37, `getSettings`, `updateSettings`), `api/calendar/test-credentials.ts` (discovery call pattern), `api/calendar/save-credentials.ts`, `api/_lib/http.ts`, `tests/endpoints.test.ts`, `tests/caldav.test.ts`, `README.md` (endpoint table l.31–38).

App:
- `src/lib/calendarApi.ts` — `BusySource` l.235, `BusySources` l.241, `GetBusyResult` l.271, `getBusy` l.278, `testCredentials`/`saveCredentials` (~l.200–232)
- `src/screens/Planner.tsx` — header render `header(withFill)` l.1126–1167, `StaleChip` l.160 (header-chip pattern), busy effect + `busyCacheRef` l.273–371, `busyRefreshKey` l.202
- `src/components/planner/BusyPopover.tsx` — source line l.85 (hard-coded `ICLOUD · PERSONAL`), `BusyBlock.tsx`
- `src/components/BusyStrip.tsx`, `src/lib/busyCache.ts` (Dashboard consumer — must keep compiling untouched)
- `src/db/types.ts` (`Settings` l.87–98), `src/db/mappers.ts` (`settingsFromRow` ~l.250–270, `settingsToRow` ~l.302–315), `src/db/repo.ts` (`settingsRepo` ~l.1014–1050), `src/db/dexie.ts` (versioning rules), `src/db/realtime.ts` (locked — read only)
- `src/screens/Settings.tsx` — Apple Calendar section l.539–640, l.761–782 (dropdown stays; help text changes)
- `src/state/uiStore.ts` (`busyRefreshKey` bump)
- `supabase/migrations/09_outlook_ics.sql`, `12_planner_writeout.sql` (migration style), `03_rls.sql`
- `ARCHITECTURE.md` §7 (setup flow, runtime endpoint table), §4 settings columns, §14
- Tests: `tests/endpoints.test.ts`, `tests/caldav.test.ts`, `src/screens/Planner.test.tsx`, `src/screens/Settings.test.tsx`, `src/lib/calendarApi.test.ts`, `src/db/repo.test.ts`

---

## Task 0 — Migration (app repo)

`supabase/migrations/13_caldav_read_calendars.sql`, idempotent, in the migration-12 comment style:

```sql
-- Chunk 51 (ARCHITECTURE.md §7) — multi-calendar iCloud read.
-- `caldav_calendar_url` stays the single WRITE target (chunk 39 mirrors).
-- `caldav_read_calendars` is the READ set: [{ url, name, enabled }].
-- null = not initialized → proxy falls back to reading the write target only
-- (legacy behavior). The app initializes it to all-enabled on first Planner
-- mount, and Settings clears it back to null on credential re-save/disconnect.
alter table public.settings
  add column if not exists caldav_read_calendars jsonb;
```

No RLS/realtime changes (settings already covered). Apply to the dev project out-of-band via MCP `execute_sql` (chunk-33/35/37/39 precedent) and say so in the report.

## Task 1 — Proxy

### 1a. `api/_lib/supabase.ts`
Add `caldav_read_calendars: unknown` to `CalDavSettings` and to `SELECT_COLS`. Add a validated parser (in `caldav.ts` or a small `_lib/readSet.ts`):

```ts
export interface ReadCalendar { url: string; name: string; enabled: boolean }
export function parseReadCalendars(v: unknown): ReadCalendar[] | null
```
Returns `null` for null/non-array/invalid; drops malformed entries; dedupes by `url`.

### 1b. `api/_lib/caldav.ts`
Refactor `getBusy` into two layers, keeping the exported name and signature working for `tests/caldav.test.ts`:

- `getCalendarBusy(calendarUrl, appleId, password, from, to): Promise<BusyResult>` — the existing single-calendar body, unchanged semantics. `PLANNER_UID_RE` exclusion stays here so it applies on **every** calendar fetched.
- `getBusy(calendars: Array<{ url; name; enabled }>, writeTargetUrl: string | null, appleId, password, from, to): Promise<MultiBusyResult>`:
  - Fetch set = enabled calendars ∪ `{ writeTargetUrl }` (the write target is always fetched because `plannerEvents` live there). Cap concurrency at **6** (simple pool over `Promise.allSettled`).
  - Busy intervals come only from **enabled** calendars; each interval gets `calendar: name` (write target's name if it is in the read set, else `'Planner'`… no — if the write target is not enabled, contribute **no** busy intervals from it, only `plannerEvents`).
  - `plannerEvents` = union across all fetched calendars (mirrors only exist on the write target today; union is future-proof and costs nothing).
  - Per-calendar outcome recorded: `{ url, name, ok: boolean, kind?: CalDavErrorKind }`.
  - Throw only if **every** fetched calendar failed. If all failures are `kind: 'auth'`, throw a `CalDavError('auth', …)` so `busy.ts` keeps the reconnect-banner contract; otherwise throw the first error. Partial failure → resolve with `ok: false` entries.

`BusyInterval` gains `calendar?: string`. Keep `discover()` as-is.

### 1c. `api/calendar/busy.ts`
- Build the read set: `parseReadCalendars(settings.caldav_read_calendars)`. If `null` → legacy: `[{ url: caldav_calendar_url, name: '', enabled: true }]`.
- Call the new `getBusy`. Map intervals to `TaggedInterval` with `source: 'icloud'` and `calendar`.
- `sources.icloud` becomes `{ configured, ok, calendars: [{ url, name, ok }] }`. `ok` = at least one calendar succeeded. An all-auth failure still flips `caldav_status = 'auth_failed'` exactly as today.
- Outlook block: untouched.

### 1d. New endpoint `api/calendar/calendars.ts` — `GET /api/calendar/calendars`
Runs `discover()` with the **stored** credentials (decrypt `caldav_app_password_encrypted`; no password in the request). Response:

```json
{ "ok": true, "calendars": [{ "url", "name" }], "writeTargetUrl": "<caldav_calendar_url>" }
```
`412 no_credentials` when iCloud isn't configured; `401 { error: 'auth_failed' }` on auth (and flip `caldav_status`, via `caldavErrorResponse`); `502` otherwise. Wrap in `calendarRoute`. Check `api/_lib/http.ts` needs nothing new (GET already allowed).

### 1e. `save-credentials.ts`
Also set `caldav_read_calendars: null` on save (fresh connection → app re-initializes to all-on). Update the zod body? No — body unchanged.

### 1f. Tests (proxy) — proven red first
- `tests/caldav.test.ts`: fan-out (3 calendars → merged, sorted, `calendar` tagged), disabled calendar excluded but write target still yields `plannerEvents`, partial failure resolves with `ok:false` entry, all-fail throws, all-auth-fail throws `kind:'auth'`, concurrency pool (≥7 calendars → never more than 6 in flight; use a counter in the mock), `parseReadCalendars` edge cases.
- `tests/endpoints.test.ts`: `busy` with null read set = legacy single fetch; `busy` with read set; `sources.icloud.calendars` shape; new `calendars` endpoint (200/412/401); `save-credentials` nulls the read set.
- Run each new test file against `1fb9200` first and record the red in the report.

### 1g. Docs (proxy)
`README.md`: endpoint table row for `GET /api/calendar/calendars`; `busy` row response shape (`calendar`, `sources.icloud.calendars`); a short "Read set vs write target" paragraph under the write-out section. Bump nothing else.

Commit proxy as one code commit. **Do not deploy** — `vercel --prod` is an operator step; say so in the report and list the two checks (OPTIONS preflight + `GET /api/calendar/calendars` returns non-404) that prove the new build is live.

## Task 2 — App: types, mappers, repo, API client

- `src/db/types.ts`: `export interface ReadCalendar { url: string; name: string; enabled: boolean }`; `Settings.caldavReadCalendars: ReadCalendar[] | null`.
- `src/db/mappers.ts`: `settingsFromRow` parses `caldav_read_calendars` defensively (invalid → `null`); `settingsToRow` writes it when defined.
- `src/db/repo.ts` `settingsRepo`: no new method needed if `update` is generic; if `update` whitelists keys, add the key. Default row (`~l.1046`) gets `caldavReadCalendars: null`. Dexie: settings is cached — follow `dexie.ts` versioning rules if the schema string changes (it likely doesn't; confirm and state).
- `src/lib/calendarApi.ts`:
  - `BusySource` gains `calendar?: string`.
  - `BusySources.icloud` gains `calendars?: { url; name; ok }[]` (optional — pre-chunk-51 proxy compatibility, same stance as `plannerEvents`).
  - New `listCalendars(): Promise<{ calendars: DiscoveredCalendar[]; writeTargetUrl: string | null }>` → `GET /api/calendar/calendars`. Reuse `callProxy` + `CalendarError` mapping.
- `src/lib/calendarApi.test.ts`: `listCalendars` happy path + 412/401 mapping; `getBusy` passes `calendar` through.

## Task 3 — App: Planner "Calendars" picker (D1)

In `Planner.tsx` header (`header(withFill)`, l.1126–1167), add a **Calendars** control next to the week nav / free-total, rendered only when `caldavStatus === 'ok'`. Desktop and mobile (mobile header at l.1251). Pattern: shadcn `Popover` (content authoring, not destructive → per `prompts/README.md` neither `Dialog` nor `AlertDialog` is required; `Popover` is fine). Component: `src/components/planner/CalendarPicker.tsx`.

Behavior:
- Trigger: quiet chip in the `StaleChip` family, label `CALENDARS · <enabled>/<total>` (e.g. `CALENDARS · 4/6`). While the read set is `null` and initializing: `CALENDARS · …`.
- Content: one row per calendar — name, switch (shadcn `Switch`), and a small `WRITE` tag on the write-target row (informational; the switch still works on it — disabling it hides its busy events but mirrors continue). Footer line: `Planner blocks write to <write target name>. Change in Settings.` (plain text, no link needed — but a `Link` to `/dashboard/settings` is acceptable if trivially available).
- Toggling: optimistic local state; `settingsRepo.update({ caldavReadCalendars })` on each change (debounce 300 ms if two toggles land back-to-back — optional). On success, bump `busyRefreshKey` (uiStore) so the per-week cache invalidates and the next `/busy` reflects the change. On error, toast (Sonner) and revert. No `useEffect` syncing draft ← prop; use draft-or-null per `prompts/README.md`.
- **Initialization:** on Planner mount, if `caldavStatus === 'ok'` and `settings.caldavReadCalendars === null`, call `listCalendars()` once, write `caldav_read_calendars` = all discovered, all `enabled: true`, then bump `busyRefreshKey`. Guard with a ref so StrictMode / re-renders never double-write. If `listCalendars` fails with auth → the existing reconnect path (do not add a second banner); other failure → stay `null`, chip reads `CALENDARS · –`, retry on next mount only.
- **Refresh:** opening the popover re-calls `listCalendars()` to pick up calendars created since init; new calendars are **appended as `enabled: true`** and persisted; calendars that vanished upstream are dropped. Failures on this refresh are silent (toast-free) — show the stored set.
- Empty state (0 calendars): `No event calendars found on this Apple ID.`

`BusyPopover.tsx` l.85: replace `'ICLOUD · PERSONAL'` with `` `ICLOUD · ${(block.calendar ?? 'Calendar').toUpperCase()}` ``. Outlook branch unchanged. Thread `calendar` through whatever `BusyBlock`/`WeekBlock` type carries `source` (check `plannerSchedule.ts` `WeekBusyBlock` or equivalent — name from source, not memory).

`BusyStrip.tsx` / `busyCache.ts`: must compile untouched (they take `BusyRange[]`). Confirm and state.

Tests — proven red first:
- `src/components/planner/CalendarPicker.test.tsx`: renders rows + counts; toggle calls repo with updated array and bumps `busyRefreshKey`; error reverts + toasts; write-target row shows `WRITE`; empty state.
- `src/screens/Planner.test.tsx`: null read set → `listCalendars` called once and settings written all-enabled (and **not** twice under StrictMode double-mount); `caldavStatus !== 'ok'` → no chip, no call; popover label from `calendar` field.
- `src/db/repo.test.ts` / mapper test: round-trip of `caldavReadCalendars`, invalid jsonb → `null`.

## Task 4 — Settings (small)

`Settings.tsx` Apple Calendar section: the dropdown label becomes **"Planner writes to"** with help text `Blocks you schedule on the Planner are created on this calendar. Which calendars the Planner reads is set on the Planner itself.` Disconnect also clears `caldavReadCalendars` to `null` locally (the proxy clears it on re-save). `Settings.test.tsx`: label/help text assertions updated.

## Task 5 — Docs (same pass, per CLAUDE.md)

- `ARCHITECTURE.md` §7: settings-columns list gains `caldav_read_calendars`; setup flow step 6 notes the read set; runtime endpoint table gains `GET /api/calendar/calendars` and the new `busy` response fields; one paragraph "Read set vs write target" (D2). Keep §14 rows untouched.
- `PROGRESS.md`: chunk 51 entry; Notebook entry renumbered 52.
- Decisions log: D1–D5 dated 2026-09-02, verbatim from the "Locked decisions" section above.
- Renumber Notebook references 51 → 52 wherever they exist in `PROGRESS.md`, `ORCHESTRATION.md`, `CLAUDE.md`, `DESIGN_BRIEF.md`, and any `prompts/*notebook*` / docs-prep file. `grep -rn "chunk 51\|chunk-51\|Chunk 51" --include=*.md` first; list every hit and its disposition in the report.
- `prompts/chunk-51-multi-calendar-read.md`: commit this prompt verbatim.

## Guards

- Do not modify `api/calendar/events.ts`, `api/_lib/busyExpand.ts`, `api/_lib/ics.ts`, `api/calendar/outlook.ts`, `src/lib/plannerCalendarMirror.ts`, `src/db/realtime.ts`, `src/lib/insights.ts`, or anything under `design/`.
- No dark theme, no Appearance toggle.
- Code commits push without `[skip ci]`; if a trailing docs-only commit is needed, `[skip ci]`. `version.json` tracks the last code-affecting SHA only.
- `.env.local` with the four `VITE_*` placeholders must exist for the app suite to collect.

## Gate (report all, verbatim numbers)

Proxy: `npm ci`, `tsc --noEmit`, `npx vitest run` (count vs `1fb9200` baseline; new tests proven red against `1fb9200`), `npm run lint`.
App: `npm ci`, `tsc --noEmit`, `npx vitest run` (count vs `6de87ab` baseline = 531; delta must equal the number of new tests exactly; proven red against `6de87ab`), `npm run lint` (2 pre-existing errors allowed, no new ones), `npm run build`.

Report: both SHAs, test counts before/after, list of red-then-green test files, the `grep` renumber table, migration application confirmation, the explicit note that the proxy is **not** deployed and what the operator must run.
