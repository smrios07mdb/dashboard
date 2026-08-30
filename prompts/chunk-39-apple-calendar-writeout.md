# Chunk 39 — Apple Calendar write-out for planner blocks (proxy + app) · migration pass

**Repos:** `smrios07mdb/dashboard-caldav-proxy` (`main`, HEAD `d9ca515`) and `smrios07mdb/dashboard` (`redesign`, HEAD `2da6ab3` once the operator has pushed the two smoke-results commits; code HEAD `03a62f7` / chunk-38 `486dfe6`). **Prerequisite (met):** chunk-38 smoke 10/10 PASS (`6cbd44a` + `2da6ab3`); check 1's today-relative branch is being re-run separately by Cowork and does not gate this chunk (it exercises code this chunk doesn't touch).

Run per `CLAUDE.md` and `prompts/README.md`. Authority order: `ARCHITECTURE.md` → `prompts/README.md` → this prompt. If this prompt and `ARCHITECTURE.md` disagree, stop and surface it.

Read the committed source before writing anything. This prompt was written against `d9ca515` (proxy) and `486dfe6` (app); if a file differs from its description here, the file wins and you say so in the report.

**This is the last chunk on the committed roadmap** (Decisions log 2026-08-29: 37 placement → 38 proposals/carryover → 39 write-out). After it the remaining work is merging `redesign` → `main`.

---

## Why this chunk exists

A block on the Week Planner is a commitment; today it lives only in Supabase. Chunk 39 mirrors it to the user's Apple Calendar so the time is visible everywhere the user looks — and, because the mirror comes back through `/api/calendar/busy`, it also has to stop the planner from counting the same minutes twice. It also carries the deferred migration pass (drop the `scheduled_blocks.done` mirror column + its migration-11 triggers).

## Files to read first

Proxy (`dashboard-caldav-proxy`):
- `api/calendar/events.ts` (POST only; `randomUUID` uid; `Body` zod schema), `api/calendar/busy.ts` (response shape: `merged` + `sources`), `api/_lib/caldav.ts` (`getBusy` loop over `fetchCalendarObjects`, `createEvent`, `buildVEvent`, `classifyError`, `CalDavError` kinds), `api/_lib/http.ts` (`corsHeaders` — `GET, POST, OPTIONS` only; `calendarRoute`; `caldavErrorResponse`), `api/_lib/tsdav.ts` (createRequire wrapper — **new tsdav functions must be re-exported here**), `api/_lib/busyExpand.ts` (shared with Outlook — leave its contract alone), `tests/endpoints.test.ts` (`describe('events')` from l.512; mocking pattern), `tests/caldav.test.ts`, `README.md`, `vercel.json`.

App (`dashboard`):
- `src/lib/calendarApi.ts` — `callProxy`, `CalendarError` kinds, `createEvent` (l.311), `getBusy`/`GetBusyResult` (l.237–284)
- `src/screens/Planner.tsx` — `place`/`move`/`resize`/`unschedule`/`carryMove`/`acceptFill`, `busyCacheRef`, `blocksCacheRef`, `patchBlocks`, `loadWeekOccupancy`
- `src/db/types.ts` (`ScheduledBlock` l.52 — `done: boolean` goes; `Settings` l.87), `src/db/mappers.ts` (`scheduledBlockToRow` l.155 and the `done` comment; `settingsToRow` l.302), `src/db/repo.ts` (`scheduledBlocksRepo` l.885, `settingsRepo` l.1014), `src/db/dexie.ts` (versioning rules), `src/db/outbox.ts` (`SPECS`), `src/db/realtime.ts` (locked — read only)
- `src/lib/plannerSchedule.ts` — `WeekScheduledBlock.done` (l.33) and `scheduledToWeekBlocks` (l.91) reference the column
- `src/screens/Settings.tsx` — Apple Calendar section (`caldavStatus` l.480, connect `save` ~l.560, `disconnect` l.570–586, `isConnected` l.592); `verifyAndSave`/Outlook section for the row pattern
- `supabase/migrations/10_scheduled_blocks.sql`, `11_scheduled_blocks_done_sync.sql` (both triggers + functions are dropped this chunk), `03_rls.sql`, `05_realtime.sql`
- `ARCHITECTURE.md` §4 (scheduled blocks), §7 (runtime endpoint table), §8, §14 (two deferred rows), §13
- `verification/chunk-38-smoke.md` (both runs — Task 0 records them), `verification/chunk-38-smoke-spec.md`, `CLAUDE.md` harness notes

---

## Task 0 — chunk 38 closeout (app repo, own commit, before any chunk-39 code)

1. **`PROGRESS.md` row 38**, append: "**Smoke (2026-08-30, `verification/chunk-38-smoke.md`, `6cbd44a` + `2da6ab3`):** 10/10 PASS. 6–10 on the current week (Sunday): carry on current week, carry from a past week (1 busy request, cold cache), mobile action sheet, done-beats-carry incl. cross-branch realtime, console 0 throughout — chunk-37's done-toggle residual confirmed gone. 1–5 on a future week (`todayIdx < 0` passes `fillable`): packing MON 09:00 → 09:45 → 10:15 exactly as derived, tray dimming, Clear, Place all (3 rows, tab B at 1008 ms), proposals cleared at drag activation with console 0 at drag start and drop — the chunk-37 `PlannerTray` residual does not reproduce; check 5 both halves discriminating. Check 1's today-relative cursor branch is covered by a separate Mon–Thu run (recorded in the same file when it lands)."
2. **Spec amendments** (`verification/chunk-38-smoke-spec.md`), all three are spec errors, not code:
   - Check 7: "last Friday" → "the Friday of the **previous** week (computed from the week start, not `now − 2d`)".
   - Check 6: assert ` · unfinished` on the **accessible name**; the visible suffix appears only at ≥40px (a 30m block is 24px).
   - Check 1: the range line `HH:MM–HH:MM · proposed` appears only on previews ≥40px — the 45m preview (37px) is title-only; only the 60m preview shows the range.
   Add a "Runs" line pointing at both sections of `verification/chunk-38-smoke.md`.
3. **`CLAUDE.md` harness notes**, add: hover action rows land one tick late (dispatch hover in one call, read/click in the next); `execute_javascript` does not await promises — results go through hidden sink nodes, **two** of them (PostgREST vs toast observer); the Supabase access token expires ~10 min in — read it from `localStorage['sb-<ref>-auth-token']` per request; a **future week** exercises Fill-my-week off-schedule (`todayIdx < 0`) but not the today-relative cursor; `proposal-block` is `aria-hidden` — assert `innerText`/geometry; the device shell has no GitHub credentials — Cowork commits, the operator pushes.
4. **Decisions log**, one row dated 2026-08-30: "Smoke specs state day-of-week and time-of-day preconditions as hard gates and are run only inside them; when a run is forced outside them, the closest discriminating variant is recorded as a *variant* with the untested branch named explicitly (chunk-38 checks 1–4 on a future week)."
5. Save this prompt as `prompts/chunk-39-apple-calendar-writeout.md`. "Last updated" → 2026-08-30. `npm test` (433/433), `tsc -b`, build green. Commit: `Chunk 38 closeout: smoke record, spec amendments, harness notes; chunk-39 prompt`. Push.

---

## Locked decisions (flag conflicts, don't relitigate)

**D1 — Scope.** Proxy: `PATCH` and `DELETE` for events, planner-event tagging, planner-event exclusion from busy (+ a side channel for reconciliation). App: opt-in setting, write-out on place/`Place all`/move/resize/`carryMove`, delete on unschedule, per-week reconcile (orphans + backfill), Settings row, migration 12 (`calendar_uid`, `planner_writeout`, drop `done` + triggers). **Not this chunk:** two-way sync (edits made in Calendar.app never flow back), Outlook writes, writing done state to the event, `scheduled_blocks` in export/import (stays deferred — record it), `settings.timezone` in planner math, any `realtime.ts` change.

**D2 — Source of truth is `scheduled_blocks`; iCloud is a best-effort mirror.** Every write goes to Supabase first (existing paths, unchanged). The calendar call follows, only when `settings.planner_writeout` is true and the write-out is possible (`caldavStatus === 'ok'`, online). A calendar failure never rolls back the block: it toasts once (`Saved — Apple Calendar not updated`, D11) and leaves `calendar_uid` as it was; the reconcile (D9) repairs it on the next load. Offline placements therefore create blocks with `calendar_uid = null` that get backfilled later — no calendar calls ever enter the outbox.

**D3 — Migration `12_planner_writeout.sql`** (applied out-of-band via raw SQL, chunk-37/38 precedent; idempotent):
```sql
-- (a) chunk-37 revisions deferred this: the mirror column and its triggers go.
drop trigger if exists tasks_sync_scheduled_block_done on public.tasks;
drop trigger if exists scheduled_blocks_done_from_task on public.scheduled_blocks;
drop function if exists public.sync_scheduled_block_done();
drop function if exists public.scheduled_block_done_from_task();
alter table public.scheduled_blocks drop column if exists done;
-- (b) the iCloud mirror handle. null = not written (yet).
alter table public.scheduled_blocks add column if not exists calendar_uid text;
-- (c) opt-in.
alter table public.settings add column if not exists planner_writeout boolean not null default false;
```
No RLS/publication/replica-identity changes (both tables already covered). Verify with `information_schema.columns` (no `done`, `calendar_uid` present, `planner_writeout` present with default false) and `pg_trigger`/`pg_proc` (four objects gone); quote the queries in the report.

**D4 — Proxy: planner events are tagged by UID.** `POST /api/calendar/events` body gains `source?: 'planner'`. When `source === 'planner'`, `uid = 'hupo-block-' + randomUUID()` and `DESCRIPTION` defaults to `Planned in Hupomnemata`; otherwise unchanged (the chunk-13 Block Time sheet keeps plain UUIDs and stays busy). Constant `PLANNER_UID_PREFIX = 'hupo-block-'` exported from `api/_lib/caldav.ts`.

**D5 — Proxy: update + delete.** Same file `api/calendar/events.ts`, method-dispatched (Vercel file routing; no `[uid].ts`):
- `PATCH /api/calendar/events` body `{ uid, title, start, end, description? }` — all of `title/start/end` required (the proxy rebuilds the whole VEVENT; it never reads the old one). `updateEvent(calendarUrl, appleId, password, event)` → tsdav `updateCalendarObject({ calendarObject: { url: `${calendarUrl}${uid}.ics`, data: buildVEvent(event) }, headers })` — no etag, unconditional overwrite. Response `{ ok: true }`.
- `DELETE /api/calendar/events?uid=…` — `deleteEvent(...)` → tsdav `deleteCalendarObject({ calendarObject: { url: `${calendarUrl}${uid}.ics` }, headers })`. **Idempotent:** an iCloud 404 returns `{ ok: true, missing: true }` (200); the app treats missing as deleted.
- `uid` validated by zod `^[A-Za-z0-9-]{1,80}$` (no path characters). 400 `invalid_request` otherwise. Preserve the existing `calendarUrl` trailing-slash handling — check what `createCalendarObject` builds from `filename` today and construct the object URL identically.
- `corsHeaders`: `Access-Control-Allow-Methods: GET, POST, PATCH, DELETE, OPTIONS`.
- `api/_lib/tsdav.ts`: re-export `updateCalendarObject`, `deleteCalendarObject`.
- Errors through `caldavErrorResponse` as today (401 auth flips `caldav_status`; 502 network/other). Non-404 non-2xx → `classifyError`.

**D6 — Proxy: busy excludes planner events and reports them.** In `caldav.getBusy`, an object whose data contains a `UID:hupo-block-` line is **not** expanded into `intervals`; instead its uid and expanded `[start,end]` (via `expandCalendarBusy` — first instance) go to a second array. `getBusy` returns `{ intervals, plannerEvents: Array<{ uid, start, end }> }` (update the busy route and its tests accordingly); `/api/calendar/busy`'s JSON gains a top-level `plannerEvents: [...]` (iCloud only; `[]` when iCloud is not configured). Outlook path untouched. **Why proxy-side:** the client's capacity math (`plannerCapacity.ts`, untouchable) subtracts busy *and* scheduled; the only place the tag is visible is the raw VEVENT.

**D7 — App: `calendarApi.ts`.** `createEvent` gains `source?: 'planner'`; new `updateEvent({ uid, title, start, end, description? })` and `deleteEvent(uid)` (→ `{ missing: boolean }`); `GetBusyResult` gains `plannerEvents?: Array<{ uid: string; start: string; end: string }>` (optional — the Dashboard busy strip and `busyCache.ts` ignore it; do not touch them). Error mapping unchanged.

**D8 — App: propagation from `Planner.tsx`.** A single `useCalendarMirror()`-style module (`src/lib/plannerCalendarMirror.ts`, pure-ish: takes `repo`, `calendarApi`, the enabled flag, and returns `{ afterCreate, afterUpdate, afterDelete, reconcile }`) so `Planner.tsx` stays readable. Rules:
- After `place` / each `acceptFill` create / `carryMove` on a block without a uid: `createEvent({ title: task.title, start: startAt, end: endAt, source: 'planner' })` → `repo.scheduledBlocks.update(id, { calendarUid: uid })` (a second Supabase write; its realtime echo refetches blocks — that's fine, R2 means no busy refetch).
- After `move` / `resize` / `carryMove` on a block **with** a uid: `updateEvent({ uid, title: task.title, start, end })`.
- Before `unschedule` (and after the Supabase delete succeeds): `deleteEvent(uid)` when present.
- Task-title changes are **not** propagated live (the reconcile's update pass covers them — D9); done state is not written.
- All calls are fire-and-forget from the handler's perspective (`void mirror.afterCreate(...)`): the optimistic UI and toasts of chunks 37/38 are unchanged and never wait on iCloud.
- Skipped entirely (no call, no toast) when `!settings.plannerWriteout || settings.caldavStatus !== 'ok' || !isOnline()`.

**D9 — App: reconcile per week (the sync that keeps the mirror honest).** When write-out is enabled and the visible week has **both** busy (`plannerEvents` present) and blocks loaded, run once per `weekKey` + `busyRefreshKey` (guarded by a `Set` ref so it never repeats for the same load):
1. **Orphans:** `plannerEvents` uids not equal to any visible block's `calendarUid` → `deleteEvent(uid)`. This is how blocks removed by a task delete/cascade, a Wipe, or a replace-import lose their calendar events.
2. **Backfill:** visible blocks with `calendarUid === null` → create as in D8 (covers offline placements and enabling the toggle after blocks exist).
3. **Drift:** visible blocks whose `plannerEvents` entry differs in start/end by ≥1 minute, or whose task title changed — `updateEvent`. (Title drift needs the event summary; the proxy's `plannerEvents` entry carries none — so title drift is **out of scope**; document it. Time drift only.)
Sequential, errors logged to `console.warn` only (no toast — reconcile is background), never blocks render, never runs on past weeks' orphans older than the visible week (only what `/busy` returned for that range).

**D10 — Settings row.** In the Apple Calendar section, below the connected state, a settings row `Write planner blocks to Apple Calendar` with a switch (reuse whatever toggle primitive Settings already uses for booleans — if none exists, a `Button variant="outline"` pair `On`/`Off` is acceptable; do not add a new shadcn component just for this). Enabled only when `isConnected && caldavStatus === 'ok'`; help line (`--ink-3`): `Blocks you schedule on the Planner appear as events on the selected calendar. They are excluded from busy time so they aren't counted twice.` Writes `repo.settings.update(userId, { plannerWriteout })`; on turning **on**, `forceBusyRefresh()` so the next Planner load reconciles (backfills existing blocks). Turning **off** leaves existing events in place (no mass delete — record as a deliberate decision). Disconnecting Apple Calendar sets `plannerWriteout = false` alongside the existing clears.

**D11 — Copy (final).** Failure toast on a foreground write (D8): `Saved — Apple Calendar not updated` (`toast`, not `toast.error`, once per handler invocation). Settings: row label and help line above; toggle-on toast `Planner blocks will sync to Apple Calendar.`; toggle-off `Planner sync off. Existing events were left in place.` No new toasts on success paths — the chunk-37/38 toasts stand.

**D12 — Types + Dexie.** `ScheduledBlock`: drop `done`, add `calendarUid: string | null`. `WeekScheduledBlock`: drop `done` (nothing reads it since R1 — confirm with grep and remove the field + the `done: b.done` copy in `scheduledToWeekBlocks`; fix tests). Row mapper: `calendar_uid` ↔ `calendarUid`; delete the R1 `done` comment. Dexie: bump to **v5** with the same `scheduled_blocks` index string (schema unchanged; the bump documents the shape change per the file's header rules — if the header says an unchanged index needs no bump, follow the file and say so). `Settings` + mapper: `plannerWriteout: boolean`.

**D13 — Busy overlay + capacity.** No client change: with D6 the planner events never reach `busyToWeekBlocks`, so `computeDayFree`/`computeCapacity` see each block once (as `scheduled`). Add a unit test in the **proxy** (`tests/caldav.test.ts`) proving a `hupo-block-` object is excluded from intervals and present in `plannerEvents`, and one in the app (`Planner`-level or `plannerSchedule`) is unnecessary — but `WeekGrid.test.tsx` gets a case that a `plannerEvents` entry is not rendered as a `BusyBlock` (feed `getBusy`'s parsed result through whatever the test already mocks).

**D14 — Deploy order.** Proxy first: tests green → commit → **operator** runs `vercel --prod` from the proxy clone (Hobby tier, no git-push deploy) → operator verifies with the curl steps you write in the report (PATCH + DELETE round trip on a throwaway `source: 'planner'` event, then `GET /busy` shows it in `plannerEvents` and not in the intervals; finally DELETE returns `missing: true` on a second call). Only then the app commit — the app tolerates the old proxy (no `plannerEvents` ⇒ no reconcile; PATCH/DELETE 405 ⇒ the D11 toast), but the smoke assumes the new one.

**D15 — Style rule stands.** No inline shorthand/longhand conflicts in anything you touch (Settings row included).

---

## Tests

Proxy: `events` describe gains PATCH happy path (rebuilt VEVENT, correct object URL, no `If-Match`), PATCH 400 on bad uid / missing fields, DELETE happy path, DELETE 404 → `{ ok: true, missing: true }`, POST with `source: 'planner'` → uid prefixed + default description; `busy` gains the exclusion + `plannerEvents` case (iCloud) and asserts Outlook output unchanged; CORS test asserts the new methods. `caldav.test.ts`: `updateEvent`/`deleteEvent`/`getBusy` split.
App: mapper round-trip for `calendarUid` (and no `done`); `settingsToRow` for `plannerWriteout`; `plannerCalendarMirror.test.ts` — create-then-stamp, update when uid present, delete before/after, skip when disabled/offline/not-ok, reconcile orphans + backfill + time drift, reconcile runs once per key; `calendarApi.test.ts` for the two new functions and `plannerEvents` parsing; Settings test for the row gating. Repo tests updated for the dropped `done`.
Target: proxy all green (+≥10); app 433 + ≥20, `tsc -b`, `npm run build`, `npm run lint` (3 pre-existing outside scope).

## Smoke spec

Author `verification/chunk-39-smoke-spec.md` (Cowork, chunk-38 format, all CLAUDE.md harness notes). Checks: toggle gating in Settings; place → event appears in Calendar.app + `calendar_uid` set + busy overlay does **not** show it + day `free` unchanged by the mirror; move/resize → event moves (Calendar.app + `GET /busy plannerEvents`); unschedule → event gone; offline place → `calendar_uid null`, reconnect + reload → backfilled; delete the task on the Dashboard → next Planner load deletes the orphan; `Place all` → three events; toggle off → events stay; proxy old-vs-new tolerance is not smoked (unit only). Fixture cleanup is now **`deleteEvent` via the app** — the first smoke spec that leaves nothing on iCloud; say so.

## Docs

`ARCHITECTURE.md`: §7 endpoint table (PATCH, DELETE, `plannerEvents`, `source`), §4 scheduled-blocks paragraph (mirror semantics, `calendar_uid`, `done` dropped, reconcile), §14 (remove the write-out row; keep the export/import row), §13 planner bullet. Proxy `README.md`: the three endpoint changes + the UID convention. `PROGRESS.md` row 39 + Decisions log rows (D2 best-effort mirror + reconcile, D6 proxy-side exclusion, D10 toggle-off leaves events). `docs/calendar.md` if it documents endpoints.

## Acceptance criteria

- ☐ Migration 12 applied and verified by query (no `done`, no migration-11 triggers/functions, `calendar_uid`, `planner_writeout`).
- ☐ Proxy: PATCH/DELETE work against iCloud (operator curl round trip quoted); planner UIDs excluded from busy and listed in `plannerEvents`; Outlook output byte-identical for the same feed.
- ☐ With the toggle on: place/Place all/move/resize/carryMove/unschedule reach iCloud; the planner never renders the mirror as busy; capacity figures identical with the toggle on and off for the same blocks.
- ☐ Toggle off / disconnected / offline: zero proxy write calls; blocks behave exactly as chunk 38.
- ☐ Reconcile deletes orphans and backfills null uids on the visible week, once per load.
- ☐ `realtime.ts`, `vite.config.ts`, `05_realtime.sql`, `plannerGeometry.ts`, `plannerCapacity.ts`, `busyCache.ts`, `BlockTimeSheet.tsx`, `lib/slots.ts`, `lib/streak.ts`, `lib/insights.ts` untouched (diff-verifiable). `busyExpand.ts` untouched.
- ☐ Task 0 landed first as its own commit.

## Do NOT

- Roll back a block when iCloud fails, queue calendar calls in the outbox, or await calendar calls inside the optimistic handlers.
- Filter planner events client-side or change `plannerCapacity.ts` to compensate — the exclusion is proxy-side (D6).
- Mass-delete events on toggle-off or disconnect.
- Read events back from iCloud to update blocks (one-way only).
- Add `[uid].ts` routes, etags/If-Match, or a second events file.
- Write to Outlook; touch `busyExpand.ts`'s contract; add `scheduled_blocks` to export/import.
- Skip the source read — `Planner.tsx` is ~1150 lines now; the mirror module is how you keep it that way.

## Commit + report

Proxy: one commit `feat: planner event write-out — PATCH/DELETE, hupo-block UID tagging, busy exclusion + plannerEvents` → operator `vercel --prod` → curl verification. App: Task 0 commit → `Chunk 39: Apple Calendar write-out — mirror, reconcile, migration 12` → `PROGRESS: fill chunk-39 commit SHA (<sha>)`. Push both. Report: all SHAs; test/`tsc`/build/lint tails for both repos; migration verification queries + results; the exact curl commands for the operator with expected responses; `git diff --stat 486dfe6..<app-sha>` and `d9ca515..<proxy-sha>`; every deviation with reason; anything in the locked decisions conflicting with `ARCHITECTURE.md` or the source.

The orchestrator verifies both repos at their exact SHAs before the smoke; after the chunk-39 smoke, the next prompt is the `redesign` → `main` merge.
