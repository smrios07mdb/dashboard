# Chunk 42 deployed spot run — results (2026-08-31, 10:30–11:39 ET)

**Outcome: complete. §0 all PASS · Part A all PASS · Part B PASS with one spec-vs-implementation
conflict (the headline finding) · Part C 3 PASS + 2 findings.** Both optional B follow-ups were
run, and both were decisive: (b) confirms chunk-40's fix works in production, (a) falsified a
repair-path claim made in this document's first revision (corrected below, and in the PROGRESS
decisions row). The `Fill my week` spill branch, only vacuously satisfied in A1, was re-run
against a fatter occupancy fixture and PASSES — see F3. Everything cleaned to baseline; nothing
left on iCloud; no real task touched; harness discard verified.

Target: **deployed prod** `https://smrios07mdb.github.io/dashboard/`. Code under test `main` @
`2fb3657` (working HEAD `ecf0f8a`, docs-only delta — "deploy verified", D3 passed). All source
citations are `git show 2fb3657:<path>`. Dev DB `dctfspcbkqvvyptddtif`, user
`9b5ce57c-8b69-42b5-ba0c-d3e21b269f85`, signed in as smrios07@gmail.com in the operator's Chrome.
Run day **Mon Aug 31** (`todayIdx` 0), first Planner visit **10:30:29 ET** — inside the §0.1
window. Driven via the local `Control Chrome` MCP (isolated world).

---

## Run-level events and deviations (read these first)

**D-1 — CSP blocks the chunk-38/39 page-world harness.** The deployed `index.html` ships a CSP the
dev server does not:
`default-src 'self'; script-src 'self'; connect-src 'self' https://*.supabase.co wss://*.supabase.co https://api.anthropic.com https://dashboard-caldav-proxy.vercel.app; …`
An appended inline `<script>` never executes, so the page-world `fetch`/`console.error` wrappers
are unavailable on prod and the chunk-38/39 harness notes do not transfer. Netlog this run =
**isolated-world `PerformanceObserver`** on resource entries (URL, `responseStatus`, duration,
completion ordering — **no HTTP method**), corroborated by DB/proxy state; toasts via
isolated-world `MutationObserver`; page `console.error` **not countable** (only
`window.onerror`/`unhandledrejection`, **zero all session**). Method attributions below are marked
where inferred. Every `/api/calendar/*` assertion is bracketed by its own marked window and
corroborated independently (uid stamps, 204s, `/busy` reads), so no assertion rests on method
inference alone.

**D-2 — CONCURRENCY INCIDENT (11:00 ET). A second agent session was running this same spec against
the same DB and iCloud calendar.** Detected on resuming after a pause: baseline was dirty with
state that was demonstrably not mine.

| Evidence | Value |
|---|---|
| Task `Smoke Drift` (P1/30m) | created **14:57:46Z** (10:57:46 ET) |
| Block `06e413c7…` | created **14:59:11Z**, updated **14:59:38Z** |
| Block time in DB | `20:30–21:00Z` (16:30–17:00 ET) |
| Same uid on iCloud | `20:00–20:30Z` (16:00–16:30 ET) |
| `planner_writeout` | `true` |

The DB/calendar gap is a **live B3 drift fixture** created 27 s after its block was placed — i.e. a
second session mid-Part-B, last write ~30 s before this session resumed. My own fixtures
(`Smoke P1a/P1b/P2/P3/Occ`) had been deleted and verified gone at 10:48, and I had set
`planner_writeout=false` then. **All mutation was stopped and the operator was asked to
adjudicate** rather than proceeding — my cleanup deletes by `title=like.Smoke*`, which matches
`Smoke Drift` and would have cascaded its block and deleted its calendar event mid-test. The
operator confirmed the other session was stopped, and this session took ownership. Foreign state
was then cleaned **calendar-event-first** (`DELETE /events?uid=hupo-block-e250f887-…` →
`{"ok":true}`, then the task delete, so the event could not be orphaned by the cascade), and
baseline was re-verified clean before any Part C fixture was created.
*Lesson for the orchestrator: this spec has no concurrency guard. Two sessions on one dev DB
silently corrupt each other's tray, sort, write-out flag and iCloud state. Worth a stated
single-owner rule, or a fixture-name namespace per session.*

**D-3 — C1 bitmap screenshot deliberately not taken.** The spec asks for a screenshot of the
combined row. The only capture paths available (`computer_screenshot`, or foregrounding the app
tab and capturing Chrome) photograph the whole screen or window, including the operator's
unrelated personal browsing and tab strip, which would then live in this run record permanently.
Captured **full computed-style + geometry evidence** instead (below), which supports the
assertion element-for-element. Available on request once the app tab is foregrounded alone.

**D-4 — `planner_writeout` was `true` at §0.4 baseline**, not false: chunk 39's recorded end state,
exactly as its own closeout predicted. Flipped to `false` by one PATCH at 10:29:50, **before any
fixture**, per that doc's standing note. Part A's precondition therefore held.

**D-5 — A0 occupancy fixture used a 5th task.** `scheduled_blocks.task_id` is UNIQUE
(`supabase/migrations/10_scheduled_blocks.sql:22`), and A1 asserts `Smoke P3` **undimmed in the
tray**, so the occupancy block could not reuse P3. A 5th task `Smoke Occ` (P3/60m) carried it.

**D-6 — the A0 occ block was deleted by SQL before Part B**, not left for the end: a null-uid block
would have been backfilled to iCloud by B1's reconcile the moment write-out went on. Ordering
choice, no assertion affected.

**D-7 — C5 tested by removing one localStorage key, not by clearing site data.** The spec's "clear
site data" would evict `sb-dctfspcbkqvvyptddtif-auth-token` and sign the operator out. Membership
turned out to need no such test at all (see C5) — the weaker, safer check was strictly sufficient.

**D-8 — a "harness survived the reload" claim in the pause handoff was wrong.** `reload_tab`
returns before the reload commits, so a follow-up call can still hit the pre-reload document and
report the harness present. What was actually found on resume was a **half-populated husk**
(`window.__smoke` truthy, `S.res` undefined). The harness was deleted and reinstalled clean, and
the final discard was verified against `navType === 'reload'` **plus** a document `timeOrigin`
later than the last cleanup write. Corrected here rather than left standing.

---

## §0 Preconditions — all PASS

- **0.1 Window.** Mon Aug 31, first Planner visit 10:30:29 ET. Page-context `new Date()` confirmed
  on the machine under test; app week header `Aug 31 – Sep 6`; mount
  `/busy?from=2026-08-31T04:00:00.000Z&to=2026-09-07T04:00:00.000Z` independently proves
  `weekStart()` = Mon Aug 31 ⇒ `todayIdx` 0. `Fill my week` was disabled *before* fixtures existed
  and enabled immediately after — the baseline tray legitimately holds **zero** real P1/P2 tasks
  (hygiene query `[]`), so the gate was tray-driven, not day-driven. Conforming.
- **0.2 Bundle identity.** Live entry `assets/index-CTFUsn62.js`, **988,210 B**, contains BOTH
  `Today list layout` AND `Write planner blocks to Apple Calendar` ⇒ merged tree. Only Supabase URL
  present: `https://dctfspcbkqvvyptddtif.supabase.co` ⇒ **project ref `dctfspcbkqvvyptddtif`** ✓,
  no stop-condition. ⚠️ The operator's open tab was serving a **stale cached bundle**
  (`index-CdPOeUhz.js`, 9,379 B, a loader containing neither string) until reloaded — any manual
  re-check must hard-reload first or it will read the wrong tree.
- **0.3 Proxy CORS for the production origin.** Cloud curl, 10:07 ET:
  ```
  OPTIONS https://dashboard-caldav-proxy.vercel.app/api/calendar/events
    Origin: https://smrios07mdb.github.io
  → HTTP/2 204
    access-control-allow-origin: https://smrios07mdb.github.io
    access-control-allow-methods: GET, POST, PATCH, DELETE, OPTIONS
    access-control-allow-headers: Authorization, Content-Type
    vary: Origin
  ```
  **No deploy blocker.** This is the first verification against the production origin; every prior
  run probed `localhost:5173` only.
- **0.4 Baseline (10:29 ET).** `scheduled_blocks` **0** · `planner_writeout` **true** → set false
  (D-4) · `caldav_status 'ok'`, `caldav_apple_id srios@smu.edu`, `caldav_calendar_url
  …/D078C7CA-A3F1-470A-B5B3-8B17329F7364/` (= the BLOCKED-doc reconnect values verbatim) · tray
  `completed_at=is.null&priority=in.(1,2)` **`[]`** · `tasks?title=like.Smoke*` **`[]`**.
  Signed-in `GET /busy` for week 36, verbatim:
  ```json
  {"ok":true,
   "busy":[{"start":"2026-09-01T14:00:00.000Z","end":"2026-09-01T15:00:00.000Z","title":"Rent Due","source":"icloud"}],
   "plannerEvents":[],
   "sources":{"icloud":{"configured":true,"ok":true},"outlook":{"configured":false,"status":"unconfigured","fetchedAt":null,"feedName":null}}}
  ```
  `Rent Due` is the only real event; **Wed Sep 2 is clean** — the chunk-37 stale `Smoke Busy` is
  confirmed gone, closing the open item the second BLOCKED doc left "unresolved".
- **0.5 Production-build bonus — PASS, and reproduced.** Planner **mount** produced **exactly 1**
  `/busy` (10:30:29, 200, 867 ms). Reproduced on a second fresh load at 11:15:38 (1 `/busy`,
  again). No StrictMode double-fire in the production build ⇒ **chunk-39 F2's "mount counts are
  unassertable" caveat is retired for deployed runs.**

---

## Part A — chunk-38 check-1, today-relative branch (`planner_writeout` false) — **PASS**

### A0 — occupancy fixture decision (from source, not guessed)

`git show 2fb3657:src/lib/plannerSchedule.ts`:

```
:117  export function dayOcc(
:121    extra: DayInterval[] = [],
:123    return [...busy, ...scheduled, ...extra]
```
and `autoFill` packs against it at

```
:265        dayOcc(d, busy, scheduled, placed),
```

`dayOcc` merges busy, scheduled blocks and already-placed proposals into **one** interval set, and
`autoFill` consults only that set — busy is **not** a separately-consulted path. Per the spec's own
branch rule this selects the **preferred manual-block option**, with zero calendar footprint and
trivial removal. The busy-avoidance sub-path traverses the identical merged set, so no proxy busy
fixture was created and none was needed. (Line :265 is the decisive citation.)

### Fixtures

PostgREST, Work/General `396b54ec-4090-49b4-843f-0799b5cd6f0a`, sequential inserts so `created_at`
strictly orders the tie-break (14:31:06.813 → 14:31:07.774Z):

| Task | id | pr | est | due |
|---|---|---|---|---|
| `Smoke P1a` | `28111f1e-07f7-48fd-8993-a3901592cc36` | 1 | 45m | 2026-08-31T21:00Z |
| `Smoke P1b` | `124d9d1f-c34f-4f03-bdf6-bf088e36ce60` | 1 | 30m | — |
| `Smoke P2` | `57d48e05-cf74-46b5-88e1-e41e446fc768` | 2 | 60m | — |
| `Smoke P3` | `db2865b3-3715-4508-8523-621a80b82edf` | 3 | 30m | — |
| `Smoke Occ` | `955cfac9-31c6-42ee-a1a1-3ef78cb0b6ce` | 3 | 60m | — (block `dec73a41-…`, `16:00–17:00Z` = 12:00–13:00 ET) |

### A1 — derivation written before the click, then observed

**Derived** (click intended in 10:37–10:49 ⇒ cursor `max(09:00, ceil15(now+10m))` = **11:00**;
occupancy [12:00–13:00]; `firstGap` needs a contiguous gap ≥ dur):
P1a 11:00–11:45 · P1b **13:00**–13:30 (the 11:45→12:00 gap is 15 m < 30 m, so it clears the occ
block) · P2 13:30–14:30 · total **2h 15m** · today's remaining capacity 6h 15m ⇒ **no spill**.

Clicked **10:38:42**. **Observed = derived exactly:**

- bar verbatim `3 proposals · 2h 15m` + `P1–P2 tasks into the earliest open weekday slots.`
- three `proposal-block`s, all `border-style: dashed`, all `aria-hidden="true"`, MON column x=475:
  `Smoke P1a` y522 h37 (title-only) · `Smoke P1b` y626 h24 (title-only) · `Smoke P2` y652 h50
  showing `13:30–14:30 · proposed`. Confirms the chunk-38 ≥40px threshold finding
  (`ProposalBlock.tsx:58`): 45 m ⇒ 37 px ⇒ title-only; only the 60 m preview carries the range.
- occupancy block rendered y574 h50 ⇒ **no overlap**: P1a ends 559 < 574, P1b starts 626 ≥ 624.
- `tray-proposed` arrows `→ MON 11:00`, `→ MON 13:00`, `→ MON 13:30` — matching each preview.
- tray opacity: P1a/P1b/P2 `0.6`; **`Smoke P3` `1`** (undimmed) ✓
- `scheduled_blocks` unchanged (occ row only); **zero** `/api/calendar/*` and zero DB writes in the
  marked window (one `/auth/v1/token?grant_type=refresh_token` 200 only).
- header capacity unchanged to the minute across the click (`1h planned · 41h 15m free` both
  sides). *Note:* against the 10:31 snapshot the free figure had moved 15 m — that is the
  free-from-now tick advancing past a quarter-hour, not the fill; the pre/post-click pair at the
  same clock minute is the assertion that matters.

**The three sub-assertions that make this the today-branch:**
1. first proposal starts at the derived **11:00 cursor, not 09:00** ✓
2. no proposal overlaps the occupancy fixture ✓ (geometry above)
3. spill — **none required**, both derived and observed; today's capacity absorbed all 2h 15m, so
   nothing reached tomorrow and `Rent Due` (Tue 10:00–11:00) was never a factor ✓
   *(The spill sub-path was therefore not exercised here; it was covered by a dedicated re-run
   later the same session — see Findings F3, which PASSES.)*

### A2 — Place all / Clear

`Clear` → bar unmounted, 0 `proposal-block`, 0 `tray-proposed`, all four cards back to opacity 1,
`Fill my week` remounted **enabled**, DB untouched. Re-fill 10:39:35 reproduced the identical
derivation. `Place all` 10:39:43:

- toast verbatim **`3 tasks placed.`**
- netlog, marked window (dt from click):
  ```
  −6 ms   /rest/v1/scheduled_blocks?select=*                    201
  +720 ms /rest/v1/scheduled_blocks?select=*                    201
  +998 ms /rest/v1/scheduled_blocks?select=*                    201
  +1116 ms …realtime refetches (blocks/tasks/categories/subcategories/settings) 200 ×5
  +1675 ms …second refetch wave 200 ×5
  ```
  **`/api/calendar/*` in this window: 0.** Whole-Part-A total for `/api/calendar/events`: **0** —
  write-out off held. (POST inferred from the 201s + effect; entries carry no method — D-1.)
- DB rows at exactly the proposed instants, all `calendar_uid null`:
  `15:00–15:45Z` / `17:00–17:30Z` / `17:30–18:30Z`
- blocks rendered `Smoke P1a, 11:00–11:45` · `Smoke P1b, 13:00–13:30` · `Smoke P2, 13:30–14:30`
- header `1h planned · 41h 15m` → `3h 15m planned · 39h free`; MON `6h 15m` → `4h free` (exactly
  −2h 15m)
- unschedule ×3 (hover-call then click-call, re-queried between each): toasts `Returned to tray.`
  ×3, DB back to the occ row alone, then the occ block deleted by SQL (D-6) ⇒ `scheduled_blocks`
  **0** = baseline.

---

## Part B — chunk-40 F1 fix live (`planner_writeout` on for this part)

**B1 — PASS** (10:41:22). Settings write-out `On` → toast verbatim
`Planner blocks will sync to Apple Calendar.`; group `aria-pressed` On=true/Off=false; DB
`planner_writeout=true`.

**B2 — PASS** (10:42:15). `Smoke P1b` dragged to today 16:00; `drop-slot` read `16:00–16:30` before
`pointerup`. Block `Smoke P1b, 16:00–16:30`; toast verbatim `Placed MON 16:00.` Netlog (dt from
drop):
```
−6 ms    /rest/v1/scheduled_blocks?select=*                     201   (optimistic insert)
+455 ms  /api/calendar/events                                   200   (2,163 ms)   ← the mirror write
+2,620 ms /rest/v1/scheduled_blocks?id=eq.75858f21-…&select=*    200   (uid stamp)
```
DB: `calendar_uid = hupo-block-eff10c57-ed51-4c62-acbb-049250bb917d`, `20:00–20:30Z`. ✓

**B3 — the headline finding. Observed: NO drift PATCH on the week-change back-load.**

Sequence: drift by SQL 10:42:47 (block → `20:30–21:00Z`, `calendar_uid` untouched) → `Next week`
10:42:53 (cold Sep 7–13 loads: blocks + `/busy`, both 200, settled) → back to the current week
10:43:23.

The back-load served **both** busy and blocks from cache — **zero network requests of any kind** in
the marked window:
```
(marked window after "Previous week" click, +0…+16 s)   [ ]      ← empty
whole-run /api/calendar/events count at 10:44:50: 1  (= B2's POST only)
```
The block rendered at the drifted `16:30–17:00`. Drift confirmed live at 10:44 —
`GET /busy` wk36 `plannerEvents`:
```json
[{"uid":"hupo-block-eff10c57-ed51-4c62-acbb-049250bb917d","start":"2026-08-31T20:00:00.000Z","end":"2026-08-31T20:30:00.000Z"}]
```
vs DB `20:30–21:00Z` — a real, unrepaired 30-minute divergence.

**Reading: this fails the chunk-42 spec's B3 expectation but conforms to chunk-40's shipped
design — a spec-vs-implementation conflict, not a regression.** Surfaced per CLAUDE.md's rule
("If a chunk prompt and ARCHITECTURE.md disagree, stop and surface the conflict") rather than
scored PASS or FAIL.

- What `5bc9a7f` actually changed: `forWeek` tags on busy/blocks state plus the guard
  `if (busyState.forWeek !== weekKey || blocksForWeek !== weekKey) return`
  (`Planner.tsx`, reconcile effect). Its purpose is to stop a week-change frame from **burning the
  new week's dedup key while holding the previous week's data**.
- What it did **not** change: the dedup itself —
  `if (reconciled.has(key)) return; reconciled.add(key)`
  (`plannerCalendarMirror.ts:136-137`), key `${weekKey}:${busyRefreshKey}`.
- The fix's own unit test #2 — *"reconciles a week exactly once per refresh key across re-visits"*
  (`Planner.test.tsx`, added in `5bc9a7f`) — **asserts that a re-visited week does NOT
  re-reconcile.** The spec's B3 sequence re-visits the current week, whose key was legitimately
  consumed at the 10:41 Planner mount (pre-drift). The observed skip is therefore the tested,
  intended behaviour.
- **Consequence for the spec:** B3 as written can never produce a PATCH under the shipped dedup
  design, on any build. Drift introduced *after* a week's reconcile has run is repaired only by a
  **`busyRefreshKey` bump** (Force resync, sync pill, wipe/import, calendar connect/disconnect) or
  a **remount** — and, per follow-up (a) below, **not** by a focus refetch, however stale the entry.

**B3 follow-up (the live analogue of chunk-40's test #1) — PASS. The fix demonstrably works.**
This is the positive counterpart that B3 could not provide. On a fresh page load (no week visited
yet), an orphan planner event was created on a **not-yet-visited** week (Mon Sep 14,
`hupo-block-8f3e3e9a-cb60-406c-a1ea-b03dfe814ab8`, 20:00–21:00Z), then Planner → `Next week` ×2.
On that week's **first load**, marked window:
```
−4 ms     /rest/v1/scheduled_blocks?select=*&start_at=lt.2026-09-21T04:00:00.000Z&…  200
−4 ms     /api/calendar/busy?from=2026-09-14T04:00:00.000Z&to=2026-09-21T04:00:00.000Z  200
+1,008 ms /api/calendar/events?uid=hupo-block-8f3e3e9a-cb60-406c-a1ea-b03dfe814ab8      200  ← orphan DELETE
```
**Exactly one** `/events` call, on the week-change load itself, with **no Force resync, no
busyRefreshKey bump, no remount** — and `GET /busy` for that week afterwards returned
`{"busy":[],"plannerEvents":[]}`, so the event was really removed from iCloud. Zero console errors.
**Chunk-40's F1 fix is confirmed working in production; the chunk-42 spec simply specified the one
sequence the design excludes.**

**B4 — PASS** (10:47:20). Hover→× on the drifted block: toast `Returned to tray.`; netlog
```
+5,573 ms /rest/v1/scheduled_blocks?id=eq.75858f21-…                                   204
+5,879 ms /api/calendar/events?uid=hupo-block-eff10c57-ed51-4c62-acbb-049250bb917d      200
```
`GET /busy` after → `plannerEvents: []`. Delete-by-uid succeeds **even against a drifted block**
(the uid, not the time, is the key). ✓

**B5 — PASS** (10:47:50, and again at 11:17:03). Write-out `Off` → toast verbatim
`Planner sync off. Existing events were left in place.`; `aria-pressed` Off=true; DB
`planner_writeout=false`. ✓

**B follow-up (a) — focus-bump drift repair — RUN, and it FALSIFIED a claim in this document's
first revision.** Source reading drove the prediction: the busy fetch effect depends on
`[weekKey, weekStartDate, busyRefreshKey, busyTick]` (`Planner.tsx:368`), but the reconcile keys on
`weekKey:busyRefreshKey` (`:611`) with deps that include `busyRefreshKey` and **not** `busyTick`
(`:627`). A focus-driven `busyTick` bump therefore refetches busy **without minting a new reconcile
key**, and the old key is already consumed.

Verified live. Setup: write-out on; block `Smoke Mirror` at `17:00–17:30Z` with its iCloud event
created at the same instants and the uid stamped (DB and calendar in agreement); Planner mounted at
T0 = 11:30:54 (reconcile consumed the week's key with nothing to repair); the block then drifted by
SQL to `17:30–18:00Z`, `calendar_uid` untouched. At T0 + **321 s**, past the 5-minute TTL,
`window.dispatchEvent(new Event('focus'))`:

```
/api/calendar/busy?from=2026-08-31T04:00:00.000Z&to=2026-09-07T04:00:00.000Z   200
/api/calendar/events                                                          0 calls
```

**The busy entry refetched and the drift was NOT repaired.**

Positive control immediately after — the sync pill's **Force resync** (a real `busyRefreshKey`
bump), same drift still in place:

```
/api/calendar/busy?from=2026-08-31T04:00:00.000Z&to=2026-09-07T04:00:00.000Z   200
/api/calendar/events                                                          200   <- drift PATCH
```

and `GET /busy` afterwards showed the event moved to `17:30–18:00Z`, matching the DB. So the
**complete, measured set of repair paths** is: a `busyRefreshKey` bump, a remount, or the first load
of a not-yet-visited week (follow-up (b)). A focus refetch past the TTL is **not** one — the first
revision of this document listed it in error, from inference rather than measurement.

---

## Part C — Today × priority coexistence (deployed dashboard, no calendar)

Fixtures (Work/General, sequential 15:03:21.250 → .960Z): `Smoke P1a` P1/45m/due 21:00Z ·
`Smoke P2` P2/60m · `Smoke P3` P3/30m (due later set to 18:00Z) · `Smoke Done` P2/30m (throwaway).

**C1 — the combined row — PASS.** One row, `594 × 41` at (720, 1391), text `Smoke P2 | P2 | 1h`,
carrying **both** controls simultaneously:

| Element | Evidence |
|---|---|
| Priority chip | `button[aria-label="Priority 2 — change priority"]`, text `P2`, 23×18 at x=1100, color `color(srgb 0.578 0.382 0.128)` on `color(srgb 0.851 0.541 0.110 / 0.16)`, radius 4px, 9.5px/500 |
| Sun toggle | `button[aria-label='Add "Smoke P2" to Today"]'`, `aria-pressed="false"`, `title="Add to Today"`, 24×24 at x=1170, color `rgb(148,143,158)` (= `--ink-3` #948f9e), `<svg viewBox="0 0 24 24">` |

`sameRow: true`, `chipLeftOfSun: true`; full action cluster in DOM order: `Mark task complete`,
`Drag to move`, title, **priority chip**, `Edit minutes`, **sun toggle**, `Set reminder`,
`Delete task`, `Actions for`. This combination existed on neither branch before chunk 41 ✓.
Bitmap screenshot deliberately omitted — see **D-3**.

**C2 — independence — PASS, both directions.**
- *Today → priority:* pre-toggle order `P1a, P2, Done, P3` (= the `priority` comparator exactly:
  P1a rank 1; P2/Done tie at rank 2 broken by `created_at`; P3 rank 3). Toggled `Smoke P2` into
  Today → DB priorities **identical** before and after (`P1a 1, P2 2, P3 3, Done 2`), relative row
  order **unchanged**. (All y-values shifted a uniform +64 px — the Today panel growing by one row,
  not a reorder.)
- *priority → Today:* set `Smoke P2` via the picker to **P3** — deliberately not P1, which would
  have made it *auto*-Today and confounded the assertion. Toast `Priority set to P3`; DB 2 → **3**
  (this also satisfies C3's picker round-trip); **Today membership unchanged** — still
  `Remove "Smoke P2" from Today`, `aria-pressed="true"`, and the panel still lists it as `PINNED`
  despite the priority change. The main list correctly reordered to `P1a, Done, P3, P2`, exactly
  as the comparator predicts once P2 becomes rank 3 (rank-3 tie broken by due-asc, so the
  due-bearing `Smoke P3` precedes the due-less `Smoke P2`).
- *panel complete action:* `Smoke Done` pinned, then completed **from inside the panel** →
  `completed_at = 2026-08-31T15:06:55.477Z` ✓ (no toast observed). The panel then read
  `2 to do · 1h 45m · 1 done`, progress `1 / 3` — the completed task **lingers in the count**,
  matching `todayPlan.ts`'s documented "in-place edits never disturb the plan … lets a
  just-completed task linger and keep counting toward done/total". Reason labels rendered
  `PRIORITY` (auto) for P1a beside `PINNED` (synthetic, `today.ts` `PINNED` rank 3) for P2.

**C3 — chunk-33 wiring intact (the D4 regression) — PASS.** Sort control renders as
`button[aria-label="Sort tasks — currently by …"]` opening a 3-option `menuitemradio` group. One
fixture tweak was applied first (`Smoke P2` estimate → 15 m) so that all three keys yield
**distinct** orders — as originally created, `priority` and `due` coincided and would not have
discriminated:

| Key | Derived | Observed | Persisted `hupo.taskSort` |
|---|---|---|---|
| Priority | P1a, P3, P2 | **P1a, P3, P2** ✓ | (default, unset) |
| Due date | P3, P1a, P2 | **P3, P1a, P2** ✓ | `due` |
| Estimate | P2, P3, P1a | **P2, P3, P1a** ✓ | `estimate` |

Button label tracked each change (`Sort · Due date`, `Sort · Estimate`). Priority picker
round-trips to the DB (C2 above). The wiring git silently dropped in the merge is **live and
correct on the deployed build** ✓.

**C4 — variants + off — PASS on the variants, FAIL on the last clause.** All four cycled through
Settings → `Today list layout`, each reflected on the dashboard (geometry measured like-for-like,
by ancestor-walk to the panel container):

| Variant | Panel | Notes |
|---|---|---|
| Stacked | **1224 × 190** @ (91, 481) | full-width card; per-row sun toggles at x=1260 |
| Rail | **300 × 182** @ (91, 481) | narrow side rail; per-row sun toggles present |
| Banner | **1224 × 114** @ (91, 481) | full-width compact band; header `Today \| MONDAY, AUG 31 \| 0 \| / 1`; **no** per-row sun toggles, no `to do ·` summary |
| Off | **absent** | 0 `Today` headings, 0 summary blocks, no panel copy of any row ✓ |

⚠️ **"sun toggles survive the variant changes" — FAILS.** Changing the variant wiped the manual pin
(`Smoke P2` reverted to `aria-pressed="false"`, panel fell to `1 to do · 45m`, `0 / 1`).
**Attribution was tested, not assumed:** re-pinning and then navigating Dashboard → Settings →
Dashboard **with the variant untouched** wiped the pin identically. **The cause is the remount, not
the variant change** — see Finding F1. Because the variant control lives on Settings, every variant
change necessarily incurs that remount, so the clause can never hold as written.

*Side-observation:* with the panel **Off**, the row-level sun toggles still render at x=1170 and
remain operable — a user can toggle tasks into a plan that is not displayed anywhere. Not a spec
item; flagged for product.

**C5 — client-local membership — the spec's premise is wrong about the code.**
- Toggling a task into Today produced **zero network requests** (marked window empty) and created
  **no** localStorage key — keys before and after were identically
  `["hupo.taskSort","sb-dctfspcbkqvvyptddtif-auth-token","caldav:lastVerifiedAt","hup:todayList"]`.
  No schema, no sync, no persistence of any kind ✓ (the underlying claim holds, and more strongly
  than the spec supposed).
- **Membership does NOT survive a reload.** Pinned `Smoke P2`, reloaded, verified genuinely fresh
  (`navType: "reload"`, `window.__smoke` absent): the pin was **gone** (`aria-pressed="false"`,
  panel back to `1 to do · 45m`) while all three tasks persisted.
- Therefore the "clearing site data resets it" half is **moot** — there is nothing stored to clear
  (which is also why D-7's narrower check was sufficient).

---

## Findings for the orchestrator

**F1 — Today membership is lost on every Dashboard remount (new, user-visible).**
`useTodayPlan` holds membership in `useState`, seeded `autoTodayIds(tasks)` and reconciled only
when the task-**id** set changes identity (`src/state/todayPlan.ts`). Nothing persists it: only the
*layout variant* is stored (`hup:todayList`, `src/state/todayList.ts:24`). So every navigation away
and back — and every reload — silently discards **both** manual pins and manual removals, re-deriving
membership from the auto signals. Observed three times this run (variant change, plain
Settings round-trip, reload), each time reverting `Smoke P2` and the panel counts. The header of
`todayPlan.ts` calls persistence "the deferred persistence decision in the PR", so this is a known
deferral rather than a bug — but chunk 42's C4/C5 were written expecting the opposite, and a user
who pins three tasks and visits Settings loses all three. **Decide the deferral, and amend C4/C5.**

**F2 — B3 as specified is untestable; chunk-40's fix is nonetheless confirmed working.** Full
argument in Part B. Two concrete asks: (a) **amend the spec's B3** to exercise the *first* load of
a not-yet-visited week (which passes — the follow-up above), or to bump `busyRefreshKey` before
expecting a repair; (b) decide whether "drift created after a week's reconcile is repaired only on
a bump or a remount" is acceptable product behaviour. It is currently *undetectable to the user*:
the block simply shows the DB time while iCloud keeps the old one, with no indicator.

**F3 — the spill-to-tomorrow sub-path is now exercised and PASSES** (it was only vacuously
satisfied in A1, where today's capacity absorbed all 2h 15m). Re-run at 11:32:11 with a fatter
occupancy fixture — `Smoke Occ` blocking today 12:00–17:00, leaving 15 m before it and 60 m after —
and estimates 45m / 30m / 90m. Derived from source before clicking, cursor `ceil15(11:32+10m)` =
11:45:

| Task | Derived | Observed |
|---|---|---|
| `Smoke P1a` 45m | MON 17:00–17:45 (only today-gap that fits) | `→ MON 17:00`, x=475, y=834, h=37 |
| `Smoke P1b` 30m | **spills** → TUE 09:00–09:30 (fits before `Rent Due`) | `→ TUE 09:00`, x=613, y=418, h=24 |
| `Smoke P2` 90m | **spills** → TUE 11:00–12:30 (90m will not fit the 09:30–10:00 gap, so it packs *around* `Rent Due`) | `→ TUE 11:00`, x=613, y=522, h=76, label `11:00–12:30 · proposed` |

Bar read `3 proposals · 2h 45m`; `Smoke P3` undimmed at opacity 1; zero network requests.
Geometry corroborates at 52 px/hour: TUE 09:00 = y418 ⇒ y522 is exactly +2 h = 11:00, and MON 17:00
= 418 + 8×52 = 834. **So the answer to A1's sub-assertion 3, for the record: the packer *packs
around* `Rent Due` rather than merely clearing it** — one proposal immediately before it
(09:00–09:30), one starting exactly at its end (11:00), and 10:00–11:00 left untouched. Tomorrow's
09:00 cursor, the spill boundary and live busy-avoidance are all now covered.

**F4 — no concurrency guard in the spec.** See **D-2**. Two sessions on one dev DB corrupted each
other within minutes; only the timestamp forensics distinguished whose fixtures were whose.

**F5 — the deployed CSP invalidates the chunk-38/39 harness.** See **D-1**. Any future prod smoke
should budget for isolated-world-only observation (no method-level netlog, no page `console.error`
counter) or add a build-time test hook.

---

## Cleanup / end state — verified 11:17:33 ET, equals baseline

| Check | Result |
|---|---|
| `scheduled_blocks` | **`[]`** (= baseline 0) |
| `tasks?title=like.Smoke*` | **`[]`** (all of P1a/P2/P3/Done deleted; titles echoed on DELETE) |
| `tasks?updated_at=gte.2026-08-31T14:29:00Z` | **`[]`** — **no real task created, completed, reprioritized or otherwise modified** |
| tray hygiene `completed_at=is.null&priority=in.(1,2)` | **`[]`** |
| wk36 `/busy` | `busy` = `Rent Due` only · `plannerEvents` **`[]`** |
| wk38 (Sep 14–20) `/busy` | `busy` **`[]`** · `plannerEvents` **`[]`** (orphan B gone) |
| `planner_writeout` | **`false`** |
| CalDAV columns | `caldav_status 'ok'`, `caldav_apple_id srios@smu.edu`, `caldav_calendar_url …D078C7CA-…/` — **baseline verbatim, untouched** |
| Calendar.app | **nothing created by hand; nothing needing hand-deletion.** Every event this run created (B2 mirror, orphan Sep 14 ×2) was removed through the app or the proxy, each `{"ok":true}` |
| Foreign state (D-2) | `Smoke Drift` + block + its iCloud event removed, event-first |
| localStorage | restored to pre-run keys exactly: `hupo.taskSort` and `hup:todayList` removed (both absent pre-run); `sb-…-auth-token` and `caldav:lastVerifiedAt` untouched |
| Console | **zero** `window.onerror` / `unhandledrejection` for the whole session (page `console.error` not countable — D-1) |
| Harness | **discard verified**: `window.__smoke` undefined, `navType: "reload"`, document `timeOrigin` 15:17:41Z — later than the final cleanup write at 15:17:33Z |

---

## Harness notes (prod-specific — delta vs the chunk-38/39 notes)

- **CSP kills page-world injection on prod** (D-1). `PerformanceObserver` on `resource` entries in
  the Control-Chrome isolated world is the workable substitute: entries land on **completion**,
  carry `responseStatus` but **no method**; keep a per-step `mark` and bracket every assertion.
- **`reload_tab` returns before the reload commits.** A follow-up call can hit the pre-reload
  document and wrongly report injected state as surviving (D-8). Verify a reload against
  `navType === 'reload'` **and** a `performance.timeOrigin` later than your last known write.
- **Popovers and menus need a full pointer/mouse sequence.** A bare `.click()` does **not** open
  the sort menu or reliably drive the Settings segmented buttons; dispatching
  `pointerdown, mousedown, pointerup, mouseup, click` with real coordinates does. Read the opened
  menu on the **next** call (`[data-state="open"]`; closed popovers linger in the DOM).
- **Locate the Today panel by ancestor-walk from a row control to the container carrying the
  `to do ·` summary.** Banner mode has **no** per-row sun toggles and no summary line, so a
  toggle-anchored or text-anchored locator false-negatives there and looks like "panel absent" —
  cross-check with the `Today` `h2` before recording an absence.
- **Measure variant geometry with one method.** An "innermost element containing the text"
  heuristic returns a nested 198×59 header for Stacked, not the 1224×190 card; comparing that
  against an ancestor-walk measurement for Rail is meaningless.
- **Both breakpoint branches are in the DOM** — filter `offsetParent !== null` on every query — and
  the Today panel renders a *second* copy of each row's toggle (panel copies at x≈1260 carry
  `aria-pressed=null`; main-list rows at x≈1170 carry the real `aria-pressed`).
- **`Control Chrome` returns the bare string `missing value` when the injected JS throws**, which
  is indistinguishable from a transport failure — wrap every call body in `try/catch` and return
  `'ERR:' + e.message`, or you will misdiagnose a stale-object bug as a dead connection.
- **`execute_javascript` without `tab_id` targets the active tab**, so it follows the operator if
  they switch tabs mid-run. Always pass `tab_id`, and re-assert `location.pathname` when it matters.
- Sequential PostgREST inserts (awaited in a loop, not `Promise.all`) are required to fix the
  `created_at` tie-break the comparators depend on.
