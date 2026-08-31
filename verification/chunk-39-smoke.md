# Chunk 39 smoke — results (Cowork / Chrome MCP, 2026-08-30 ~18:30–19:30 ET)

> Recorded by the orchestrator from the Cowork run report. Orchestrator citation
> audit 2026-08-30: every source citation below (`main.tsx:63`,
> `Planner.tsx:448/577-601/583`, `plannerCalendarMirror.ts:136-137`) verified
> against `56ffff4` — all accurate. F1's mechanism was subsequently pinned from
> source and is fixed in chunk 40 (see PROGRESS.md Decisions log 2026-08-30).

**Run authorization:** the operator directed this run live in chat ("build the
tests in a way we can do them now") after two same-day attempts blocked on
§0.3 (Mon–Thu 10:30–15:00 ET). Run window was **Sunday Aug 30, 18:30+ ET** —
§0.3 waived by the operator; every consequence is recorded as a deviation
below. **10 of 10 checks ran. All PASS** (two with recorded deviations, one
with a flagged app finding).

Code under test `56ffff4`; working HEAD `8625fa8` (delta vs the prompt's
`9c9659a`: one commit touching only `verification/chunk-38-smoke.md` — no app
source differs; `8625fa8` is itself the "stale Smoke Busy deleted" commit).
Branch `redesign`, tree clean except pre-existing `?? _to_delete/`.
Proxy: `https://dashboard-caldav-proxy.vercel.app` at `1fb9200` (§0.1/0.2
re-verified this run). Dev DB `dctfspcbkqvvyptddtif`, user
`9b5ce57c-8b69-42b5-ba0c-d3e21b269f85`, signed in as smrios07@gmail.com.
Calendar.app driven by computer use, **read-only** — no event was created,
edited, or deleted there by hand; every event this run created was removed
through the app/proxy.

## The two run-level deviations (operator-directed)

1. **Week under test = WEEK 36 (Aug 31 – Sep 6), not the current week.** On a
   Sunday the current week has no "tomorrow" cell and `Fill my week` is
   hard-gated (`todayIdx = 6`). All fixtures were placed on **MON Aug 31 —
   which is literally "tomorrow"** — worked on the next week's grid. The
   §0.6 baseline was taken for week 36 (and week 35: both `plannerEvents: []`
   pre-run). `Rent Due` (TUE 10:00–11:00 ET, icloud) is week 36's one real
   busy event; no fixture touched Tuesday.
2. **Check 5 exercised the future-week fill branch** (`todayIdx < 0` ⇒ cursor
   = MON 09:00), not the today-relative cursor. That branch was already
   recorded as untested by chunk 38 and remains so — it is a *packing* branch;
   chunk 39's write-out assertions (3 POSTs in order, 3 stamps, 3 events) are
   branch-independent and all held.

Also: "Reload the Planner" in check 6 was performed as SPA remount
(Dashboard → Planner) instead of a browser reload, keeping the page-world
harness alive; the in-memory busy cache is per-mount (`busyCacheRef`), so the
cold `/busy` the spec wanted was observed either way.

## Fixtures (created via PostgREST, Work/General `396b54ec…`, in order)

| Task | id | pr | est | due |
|---|---|---|---|---|
| Smoke W1 | `4e93210b-46bf-4f0f-b7c7-f407440f131c` | P1 | 45m | today 21:00 ET |
| Smoke W2 | `bd519f99-070a-4daf-b8ff-d620ec3f0a9b` | P1 | 30m | — |
| Smoke W3 | `f9f870d0-3636-4408-8669-d7b698ad42d3` | P2 | 60m | — |
| Smoke W4 | `ba3dfaa1-63c3-4c51-9003-191aefc926a1` | P3 | 30m | — |

Baseline (§0.6/0.7, verified live pre-run): `scheduled_blocks` **0**;
`planner_writeout false`, `caldav_status 'ok'`, `caldav_apple_id
srios@smu.edu`, `caldav_calendar_url …/D078C7CA-A3F1-470A-B5B3-8B17329F7364/`
(reconnect values, matching the earlier BLOCKED doc verbatim); tray
`priority=in.(1,2)&completed_at=is.null` `[]`; `tasks?title=like.Smoke*` `[]`.
§0.1 OPTIONS (cloud curl w/ Origin localhost:5173): `access-control-allow-methods:
GET, POST, PATCH, DELETE, OPTIONS` ✓. §0.2 (page-context fetch): top-level
`plannerEvents` present, `sources.icloud.ok true` ✓. **The chunk-37 stale
`Smoke Busy` is gone** (WED Sep 2 shows `9h free`; week-36 `busy` holds only
`Rent Due`) — matching HEAD's commit message.

## Results

| # | Check | Result | Note |
|---|---|---|---|
| 1 | Toggle gating | **PASS** | Row + help line verbatim (`Blocks you schedule on the Planner appear as events on the selected calendar. They are excluded from busy time so they aren't counted twice.`); `role="group"` with On/Off. (a) both enabled, Off `aria-pressed="true"`. (b) SQL `caldav_status='auth_failed'` → both **disabled** + `Connect Apple Calendar to enable.` (needs a real screen remount — same-tick double navigation does not re-run the settings load; harness note below). (c) restore `'ok'`, click On → toast verbatim `Planner blocks will sync to Apple Calendar.`, On pressed, DB `planner_writeout=true`; next Planner **week navigation** produced exactly **1** `/busy` for a week cached under the old refreshKey — the bump invalidates the cache ✓. At Planner **mount**, dev StrictMode (`main.tsx:63`) double-fires the busy effect → 2 identical `/busy`; a mount-time "exactly one" count is not assertable in dev. Console 0. |
| 2 | Place → event | **PASS** | Drag `Smoke W1` → MON 11:00 (drop preview `11:00–11:45`). Sequence from t0=drop: optimistic `POST scheduled_blocks` +12ms → `POST /api/calendar/events` `{"title":"Smoke W1","start":"2026-08-31T15:00:00+00:00","end":"…15:45…","source":"planner"}` +469ms → `{ok:true, uid:"hupo-block-02897b38…"}` → `PATCH scheduled_blocks` stamping that uid +2.49s. Toast verbatim `Placed MON 11:00.` (recorded +677ms; my observer's 80ms sampling can't order it vs the POST at +469ms — independence from the proxy is proven by check 8 instead). No busy element at the block's range (only `Rent Due` on TUE renders); header `0m→45m planned`, `44h→43h 15m free`, MON `9h→8h 15m` — each moved **once**. Force resync → 1 `/busy`: uid in `plannerEvents`, absent from `busy`. Calendar.app inspector: `Smoke W1, Aug 31 2026, 11:00AM–11:45AM`, description `Planned in Hupomnemata` (screenshot inline in transcript). Console 0. |
| 3 | Move + resize | **PASS** | Two `PATCH /api/calendar/events`, same uid, title carried: move → `18:00–18:45Z`, resize → `18:00–19:00Z`, each `{ok:true}`. Block `14:00–15:00`, h 50px. `plannerEvents[0]` = 14:00–15:00 local, still not in `busy`. Capacity mirror-neutral (`1h planned · 43h free`). Calendar.app inspector: `2:00PM–3:00PM` (screenshot). A mid-flight inspector opened between the two PATCHes read `2:00–2:45PM` — Calendar.app applies the PATCHes individually. Console 0. |
| 4 | Unschedule → gone | **PASS** | Hover → `×`: toast `Returned to tray.`; `DELETE /api/calendar/events?uid=hupo-block-02897b38…` → `{ok:true}` (**no** `missing`); DB row gone; `plannerEvents []`; Calendar.app empty at MON (screenshot). Console 0. |
| 5 | Place all | **PASS (future-week variant)** | Bar verbatim `3 proposals · 2h 15m` + `P1–P2 tasks into the earliest open weekday slots.`; dashed previews MON `09:00/09:45/10:15` (W1 37px title-only, W2 24px, W3 50px w/ range — chunk-38's preview-text finding reproduced); tray arrows `→ MON 09:00/09:45/10:15`. `Place all` → toast `3 tasks placed.`; **three `POST /events` in proposal order** (W1 13:00Z → W2 13:45Z → W3 14:15Z, all `source:"planner"`) → uids `1f90f8a6` / `600dabaf` / `50d9cf9f` → three stamps. Header `2h 15m planned · 41h 45m free`, MON `6h 45m`. `plannerEvents` 3, `busy` none of them. Calendar.app: all three at the proposed slots (screenshot + zoom). Console 0. |
| 6 | Offline → backfill | **PASS w/ flagged finding** | Page-world offline patch (pill flipped `Offline`). Schedule sheet → MON, custom `16:00` → `Add to Monday`: block `16:00–16:30`, toast `Scheduled 16:00.` only, **0** `/api/calendar/*` and 0 PostgREST requests, **outbox = 1 row** (`scheduled_blocks` insert, Dexie `dashboard-cache`). Online → outbox drained (0 left): 1 `POST scheduled_blocks` 201, still **0** `/events`; server row `calendar_uid null` ✓. Remount → week 36 load: 1 cold `/busy` but **no backfill POST** (see finding F1). Force resync → **exactly one** `POST /events` for W4 (`20:00–20:30Z`) → uid `9004ab85` stamped. Calendar.app `Smoke W4, 4–4:30PM` (screenshot). Console 0. |
| 7 | Orphan removed | **PASS** | Dashboard: nearest-ancestor row walk → `Delete task "Smoke W3"` → confirm `Delete this task?` → task DELETE 204, block cascaded, event stayed: `plannerEvents` still listed `50d9cf9f` (verified pre-reconcile). Planner → wk36 → Force resync: `DELETE /events?uid=hupo-block-50d9cf9f…` → `{ok:true}`, **no toast**. (The DELETE fired against the still-cached plannerEvents — the "before blocks reload" framing held.) Second resync: `plannerEvents` without it; Calendar.app W3 gone (screenshot). The first resync's parallel `/busy` returned a **transient proxy 502** (`{"ok":false,"error":"other"}`) → 1 console error `Planner: load busy failed {"kind":"network"…}` — proxy-side transient, recovered next resync, only console hit of the run. |
| 8 | Failure, no rollback | **PASS** | One-shot page-world 502 shim (self-restoring). Move `Smoke W2` → MON 13:00: optimistic move rendered; shim caught exactly one `PATCH /events` → 502; **one** toast, verbatim `Saved — Apple Calendar not updated` (the `toast(MIRROR_FAILED)` path, `Planner.tsx:448` — not `toast.error`; no `Could not save — retry` appeared); toast +4ms after the 502. DB `17:00–17:30Z` (new time), `calendar_uid` unchanged. Calendar.app still at 9:45 (screenshot) — expected drift. Force resync → **one** drift `PATCH /events` (`17:00–17:30Z`) `{ok:true}` → Calendar.app `1–1:30PM` (screenshot). Console 0. |
| 9 | Off → writes stop | **PASS** | Toast verbatim `Planner sync off. Existing events were left in place.`; DB `planner_writeout=false`. Move `Smoke W1` → MON 12:00: DB `16:00–16:45Z`, **zero** `/events`, no mirror toast. `plannerEvents` still lists all 3 (W1 stale at 13:00Z), `busy` still excludes them. Calendar.app kept 9:00 (stale) ✓. Console 0. |
| 10 | Disconnect + restore **[AMENDED]** | **PASS** | (1) On → toast; drift PATCH for W1 (`16:00–16:45Z`) `{ok:true}` on the next Force resync (not on the week-change pass — F1 again). (2) Disconnect → confirm (`Disconnect Apple Calendar?` / `This removes the stored credentials…`): toast verbatim `Apple Calendar disconnected.`; DB `planner_writeout=false`, `caldav_status='unconfigured'`, `caldav_apple_id` **null**, `caldav_calendar_url` **null**; write-out row both buttons **disabled** + `Connect Apple Calendar to enable.`; badge `Not connected`. (3) **SQL restore** of the §0.7 values (PATCH via PostgREST; not Test+Save — amended) → Settings remount reads `Connected · verified just now`, group re-enabled; `GET /busy` → 200, `sources.icloud.ok true` — **the untouched encrypted password still decrypts**, the substance of Test+Save. (4) On → toast; three events verified current in Calendar.app (`12–12:45`, `1–1:30`, `4–4:30`; screenshot). (5) Unschedule ×3 → each: DB DELETE 204 + `DELETE /events?uid=…` `{ok:true}`, toasts `Returned to tray.` ×3; three task DELETEs 204. Console 0. |

**Console counter per check:** fixtures 0 · 1:0 · 2:0 · 3:0 · 4:0 · 5:0 · 6:0 ·
7:**1** (transient proxy 502 on `/busy`, message quoted above; counter reset
after recording) · 8:0 · 9:0 · 10:0.

## Findings for the orchestrator

**F1 — the reconcile does not act on a week-*change* load; only on mount or a
`busyRefreshKey` bump.** Observed three times: check 6's backfill, and check
10's drift PATCH, did nothing on the `Next week` navigation pass (cold `/busy`
+ blocks fetch both completed) and then fired correctly, exactly once, on the
next Force resync; check 7's orphan delete likewise ran on the resync. The
effect is `Planner.tsx:577-601` (gates: `writeoutOn`, `tasksLoaded`,
`blocksPhase==='ready'`, `busyState.phase==='ready'`, `plannerEvents`
present), dedup `reconciled.add(key)` at `plannerCalendarMirror.ts:136-137`,
key `${weekKey}:${busyRefreshKey}` (`Planner.tsx:583`). Mechanism not pinned
down live (no instrumentation added mid-run); the shape — key consumed or a
gate false at the moment both phases settle after a week change — is for a
unit test to isolate. **On the spec's intended Mon–Thu run this path is
masked**, because fixtures live on the *current* week and reload = mount,
where reconcile fires (mount dynamics under StrictMode converge to one run
because the gates hold until data is ready). Chunk-40 candidate: reproduce in
a test (`weekOffset` change with busy resolving before/after blocks), or key
the dedup on the blocks snapshot too.

*Orchestrator addendum (2026-08-30, source read at `56ffff4`): mechanism
pinned — it is the "key consumed" shape. `busyState` and `blocksPhase` are
reset only inside their own effects, so the week-change commit renders one
frame where `weekKey` is new while both phases still read `'ready'` holding
the previous week's data; the reconcile effect (dep: `weekKey`) fires on that
frame, no-ops against the already-reconciled stale data, and burns
`${newWeekKey}:${busyRefreshKey}`. Mount works because both phases start
cold/loading. Fixed in chunk 40 (data-week tags on both loaders + gate).*

**F2 — dev StrictMode makes mount-time request counts unassertable.**
`main.tsx:63` wraps the app; the busy effect double-fires per mount (2
identical `/busy`). Week-change and Force-resync counts are exact (1). Spec
language "one `/busy` on the next Planner visit" should say "on the next week
navigation" or be counted in a production build.

**F3 — transient proxy 502** on one `/busy` (`error:"other"`, check 7, ~19:10
ET) — recovered immediately; worth remembering as noise when reading console
counters, not actionable.

## Harness notes (beyond CLAUDE.md's — all of which held)

- Same-tick double navigation (`Planner` then `Settings` clicked in one
  `execute_javascript` call) never remounts the screen — React Router settles
  once. Check 1(b) read stale state until the two clicks were split into
  separate calls. Split all remount-dependent navigations.
- The tray card **is** the schedule button (`button[aria-label="<title> —
  schedule"]`); `pointerdown` on it starts the drag. Walking up from it looks
  for a card wrapper that does not exist.
- `[role="dialog"]` matches the sync-pill popover first; scope sheet queries
  with `[data-state="open"]` (the popover lingers `data-state="closed"` in the
  DOM, and both coexist).
- Feedback-guided dropping works well: aim the pointer near the slot, read
  `[data-testid="drop-slot"]` (next call — one tick late as documented), nudge
  ±4px per 15-min step (52px/hour ⇒ 13px), then `pointerup` in its own call.
- Resizes show **no** `drop-slot` preview; the block's own aria-label/height
  update live during the drag. `resize-strip` is the handle.
- The one-shot 502 shim must wrap the *logger-wrapped* fetch and restore to
  it, so the netlog keeps recording afterwards; have it stamp
  `data-smoke-502` with method+timestamp for the report.
- Isolated-world fetches (PostgREST/proxy probes) don't pollute the
  page-world request log — clean separation of harness reads from app
  traffic. The anon apikey was stashed into a DOM attribute by the page-world
  logger (never transits the transcript).
- Outbox is directly readable from the isolated world via IndexedDB
  (`dashboard-cache` / `outbox`) — no page-world needed.
- Computer-use app grants can expire mid-run; re-resolve + re-request costs
  one operator approval. Batch Calendar.app assertions where possible.

## uid ledger (all `hupo-block-…`, all accounted for)

| uid | task | created by | removed by |
|---|---|---|---|
| `02897b38-a07d-449e-a83b-3a6d35f4a8dd` | W1 | check 2 place | check 4 unschedule DELETE `{ok:true}` |
| `1f90f8a6-f8cc-41a7-b21c-b4ddf6821dc3` | W1 | check 5 Place all | check 10 unschedule DELETE `{ok:true}` |
| `600dabaf-a1a1-4233-87b3-af9d60069b61` | W2 | check 5 Place all | check 10 unschedule DELETE `{ok:true}` |
| `50d9cf9f-c157-476b-a749-5729cb50f4eb` | W3 | check 5 Place all | check 7 orphan pass DELETE `{ok:true}` |
| `9004ab85-a85c-4091-8da4-27d89fb540f7` | W4 | check 6 backfill | check 10 unschedule DELETE `{ok:true}` |

## End state (verified by query + Calendar.app screenshot)

`scheduled_blocks` **0** (= baseline) · `tasks?title=like.Smoke*` `[]` · week-36
`plannerEvents` `[]`, `busy` = `Rent Due` only · Calendar.app shows no
`Smoke W*` event · `caldav_status 'ok'`, `caldav_apple_id srios@smu.edu`,
`caldav_calendar_url …D078C7CA-A3F1-470A-B5B3-8B17329F7364/` (= baseline
verbatim) · **`planner_writeout = true` — left ON per the amended prompt** ·
tray P1/P2 hygiene `[]` · no real task touched (fixture ids only in every
mutation) · app tab reloaded, all page-world wrappers/sinks/observers
discarded · nothing left on iCloud.

**Sequencing note:** the chunk-38 check-1 today-branch task remains
outstanding and needs `planner_writeout=false` + a Mon–Thu window; since this
run ends with the flag **true**, that run must flip it false first (one
UPDATE) and restore it after — trivially recoverable, noted so nobody treats
the flag as untouched baseline.
