# Chunk 39 smoke spec — Apple Calendar write-out for planner blocks (for Cowork / Chrome MCP)

Target: **local dev server** on the `redesign` branch at the chunk-39 commit or
later (see PROGRESS row 39) against the **deployed proxy at `1fb9200` or
later** (`vercel --prod` from the proxy clone — the smoke assumes the new
proxy; old-vs-new tolerance is unit-tested only, not smoked). Operator starts
`npm run dev` and signs in first; the app URL is whatever Vite prints
(usually `http://localhost:5173`). Calendar.app signed into the same iCloud
account, showing the calendar selected in Settings.

Surface under test: **Settings → Calendars** (check 1) and the **Planner**
tab — desktop grid (`[data-branch="desktop"]`, ≥640px) for the rest.

**Cleanup is now in-app.** This is the first smoke whose fixtures leave
nothing on iCloud: every planner event is removed by `Unschedule` (which
calls `deleteEvent`) or by the reconcile's orphan pass, and check 9's
leftover events are deleted with `Unschedule` after re-enabling the toggle.
No Calendar.app hand-deletes; record every `hupo-block-` uid you see anyway.

Harness caveats — all from CLAUDE.md "Smoke harness notes"; read that section
first:

- **Drag.** Synthesize the pointer sequence (`pointerdown` → ≥10
  `pointermove`s on `window` → a **separate** `execute_javascript` call for
  `pointerup`). Assert `window.scrollY === 0` and re-read
  `getBoundingClientRect()` immediately before dispatching coordinates. The
  drop preview `[data-testid="drop-slot"]` appears one tick after the moves.
- **Hover action rows land one tick late** — dispatch the hover in one call,
  read/click `→`/`✓`/`×` in the next.
- **Both branches are always mounted.** Scope every selector with
  `[data-branch="desktop"]`.
- **`execute_javascript` does not await promises.** Route `fetch`/repo results
  through two hidden sink nodes (PostgREST vs toast observer) and read them
  in the next call.
- **Supabase token expires ~10 min in.** Read it from
  `localStorage['sb-dctfspcbkqvvyptddtif-auth-token']` per request.
- **Console clean.** Install the page-world `console.error` wrapper via an
  appended `<script>` that counts into a `data-*` attribute on `<body>`.
- **Offline (check 6).** Patch `navigator.onLine` to `false` and dispatch
  `offline` from a page-world `<script>` (isolated-world patches never reach
  `lib/network.ts`); restore + dispatch `online` afterwards.
- Screenshots are inline in the Cowork transcript only.

Proxy reads used throughout (JWT from the localStorage token; `$BASE` =
`VITE_CALDAV_PROXY_URL`):

```
GET $BASE/api/calendar/busy?from=<weekStart ISO>&to=<weekStart+7d ISO>
  → busy[] (source-tagged) + plannerEvents[] ({ uid, start, end })
```

DB reads (dev project `dctfspcbkqvvyptddtif`):

```
select id, task_id, start_at, end_at, calendar_uid from public.scheduled_blocks order by start_at;
select planner_writeout, caldav_status from public.settings;
```

Data setup (current week; today Mon–Thu so tomorrow is a weekday):

- Apple Calendar connected (`caldav_status = 'ok'`), `planner_writeout = false`
  at start.
- Four open Work tasks with no block, in this order: `Smoke W1` (P1, 45m, due
  today), `Smoke W2` (P1, 30m), `Smoke W3` (P2, 60m), `Smoke W4` (P3, 30m).
  No other P1/P2 tasks in the tray.
- Note `select count(*) from scheduled_blocks` and the `plannerEvents` count
  for the current week before starting (expect 0 planner events).

Record results as `verification/chunk-39-smoke.md` in the chunk-38 table
format (check / PASS-FAIL / note), and commit it.

## Checks

| # | Action | Expected |
|---|---|---|
| 1 | **Toggle gating.** Settings → Calendars. (a) With Apple Calendar connected and ok. (b) Set `caldav_status='auth_failed'` via SQL, Force resync, revisit Settings. (c) Restore `ok`. Click **On**. | Row `Write planner blocks to Apple Calendar` with help line `Blocks you schedule on the Planner appear as events on the selected calendar. They are excluded from busy time so they aren't counted twice.`; `role="group"` of the same name with `On`/`Off` buttons. (a) both enabled, `Off` has `aria-pressed="true"`. (b) both disabled + `Connect Apple Calendar to enable.`. (c) click On → toast `Planner blocks will sync to Apple Calendar.`, `On` `aria-pressed="true"`, `settings.planner_writeout = true`, `uiStore.busyRefreshKey` +1 (one `/busy` request on the next Planner visit). |
| 2 | **Place → event.** Planner, current week. Drag `Smoke W1` to tomorrow 11:00. Note the day-header `free` and the header `planned`/`free` **before** the drop. | Chunk-37 toast `Placed DAY 11:00.` unchanged and immediate. Within ~3s: network shows `POST /api/calendar/events` with body `source: "planner"` → `{ ok, uid: "hupo-block-…" }`, then a PostgREST `PATCH scheduled_blocks` stamping `calendar_uid`. DB row has `calendar_uid` = that uid. Calendar.app shows `Smoke W1` tomorrow 11:00–11:45 with description `Planned in Hupomnemata`. Force resync → `GET /busy` returns the event in `plannerEvents` and **not** in `busy`; the grid shows **no** busy block at 11:00–11:45 (only the task block); the day-header `free` equals before − 45m and `planned` = before + 45m — i.e. exactly what chunk 38 showed without the mirror. Console 0. |
| 3 | **Move + resize → event moves.** Drag the `Smoke W1` block to tomorrow 14:00; then resize its bottom edge to 15:00. | Two `PATCH /api/calendar/events` calls (`uid` = the stamped uid, `start`/`end` = the new instants, `title: "Smoke W1"`), each `{ ok: true }`. Calendar.app shows 14:00–15:00. Force resync → `plannerEvents[0]` = 14:00–15:00 local, still absent from `busy`. Capacity figures unchanged by the mirror (compare to the block alone). |
| 4 | **Unschedule → event gone.** Hover the block → `×`. | Toast `Returned to tray.`; `DELETE /api/calendar/events?uid=<uid>` → `{ ok: true }`; DB row gone; Calendar.app no longer shows it; Force resync → `plannerEvents` empty. |
| 5 | **Place all → three events.** `Fill my week` → `Place all`. | Toast `3 tasks placed.`; three `POST …/events` with `source: "planner"` in proposal order, three PATCH stamps; three `calendar_uid`s in the DB; three events in Calendar.app at the proposed slots; `plannerEvents` has 3 entries and `busy` has none of them. |
| 6 | **Offline place → null uid → backfill on reconnect + reload.** Go offline (page-world patch). Schedule `Smoke W4` via the Schedule sheet at tomorrow 16:00. Go online. Reload the Planner (busy cache is in-memory → a fresh `/busy`). | Offline: block appears, outbox 1 row, **no** `/events` request, no mirror toast. Online + outbox drained: DB row exists with `calendar_uid null`. After reload, once busy + blocks are loaded: one `POST …/events` (`source: "planner"`) + one stamp; `calendar_uid` set; Calendar.app shows `Smoke W4` 16:00–16:30. Exactly one such POST (reconcile runs once per week load). |
| 7 | **Task delete → orphan removed on next load.** On the Dashboard, delete task `Smoke W3` (its block cascades). Return to the Planner and Force resync. | Before resync `plannerEvents` still lists W3's uid (the event is now an orphan). After resync, once blocks load: `DELETE …/events?uid=<W3 uid>` → `{ ok: true }`; Calendar.app no longer shows `Smoke W3`; the next `/busy` has no entry for it. No toast (reconcile is background); console 0 (a warn is acceptable only if iCloud errored). |
| 8 | **Failure toast, no rollback.** Temporarily break the proxy URL for one call (e.g. patch `fetch` in page world to 502 the next `/events` request), then move a block. | Chunk-37 optimistic move + no chunk-37 error toast; one toast `Saved — Apple Calendar not updated` (plain, not error); DB row has the new time; `calendar_uid` unchanged. Restore `fetch`; Force resync → the reconcile's drift pass PATCHes the event to the new time. |
| 9 | **Toggle off → events stay; writes stop.** Settings → `Off`. Back on the Planner, move a remaining block. | Toast `Planner sync off. Existing events were left in place.`; `settings.planner_writeout = false`. The move: DB updated, **zero** `/events` requests, no mirror toast. Calendar.app still shows the (now stale-time) events. Force resync → `plannerEvents` still lists them, still absent from `busy` (exclusion is proxy-side and independent of the toggle). |
| 10 | **Disconnect clears the flag; cleanup.** Settings → `On` again (reconcile will re-sync the stale event), then Disconnect Apple Calendar → confirm. Reconnect (Test + Save), then On. Unschedule every smoke block; delete the four tasks. | After Disconnect: `planner_writeout = false`, row disabled with the hint. After reconnect + On: the remaining blocks' events are current. Each Unschedule → `DELETE …/events` → `{ ok: true }`. End state: `scheduled_blocks` count = pre-smoke; `plannerEvents` = `[]`; Calendar.app shows no `Smoke W*` events; **nothing left on iCloud** — record the uids that passed through. Console 0 throughout. |
