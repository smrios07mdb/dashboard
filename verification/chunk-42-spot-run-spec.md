# Chunk 42 deployed spot-run spec — amended (chunks 43, 46)

This is the amended, in-repo copy of the chunk-42 spot-run spec. The original
lived outside the repo (`cowork-chunk-42-spot-run.md`) and was executed
2026-08-31 (results: `claude/chunk-42-spot-run-2026-08-31.md`). That run
surfaced three spec defects — B3 as written was untestable by design, C4/C5
asserted persistence the code did not have, and A1's spill sub-assertion was
vacuously satisfiable — plus two process gaps (no concurrency guard; the
prod CSP invalidates the page-world harness). All are corrected here. The
amended B3/C4/C5 assume **chunk 43 or later** is deployed (Today-membership
localStorage persistence; content-signature reconcile dedup).

A behavioural re-run of the chunk-43/44 changes on 2026-08-31 (record:
`claude/chunk-43-44-rerun-2026-08-31.md`) confirmed both live and produced
three further findings, closed in chunk 46. B3b, the B4 delete count, C4's
option wording, C5's rollover assertion and the Part B ordering are amended
below against **chunk 46 or later**.

Target: **deployed prod** `https://smrios07mdb.github.io/dashboard/`, dev DB
`dctfspcbkqvvyptddtif`, operator signed in. Run window: **Mon–Thu, first
Planner visit 10:30–15:00 ET** — required for Part A's today-relative cursor
(`ceil15(now+10m)`); a future-week run exercises only the off-schedule
Monday-09:00 branch (CLAUDE.md).

## Run rules (added chunk 43 — read before any fixture is created)

- **Single owner.** Exactly one agent session runs this spec against the dev
  DB + iCloud calendar at a time. Before §0, confirm with the operator that
  no other session is active; if mid-run evidence of another writer appears
  (fixtures you didn't create, `planner_writeout` flipping), STOP all
  mutation and ask the operator to adjudicate. Two sessions on this DB
  corrupted each other within minutes on 2026-08-31.
- **Per-run fixture prefix.** Pick a short run id (e.g. the start timestamp,
  `0831a`) and prefix every fixture title: `Smoke-<runId>-P1a`,
  `Smoke-<runId>-Occ`, … Cleanup deletes ONLY
  `title=like.Smoke-<runId>-*` — never bare `Smoke*`, which matches another
  session's fixtures and cascades their blocks and calendar events.
- **Prod harness = isolated world only.** The deployed `index.html` ships a
  CSP (`script-src 'self'`) that blocks page-world `<script>` injection, so
  the chunk-38/39 page-world notes do NOT transfer. Netlog via an
  isolated-world `PerformanceObserver` on resource entries (URL,
  `responseStatus`, completion order — **no HTTP method**; mark windows and
  corroborate via DB/proxy state); toasts via `MutationObserver`; page
  `console.error` is not countable — use `window.onerror` /
  `unhandledrejection` only. No build-time test hook exists (decision
  recorded in PROGRESS, chunk 43): don't budget for one.

## §0 Preconditions

Unchanged from the original run (see the results doc for the executed form):

- 0.1 run window as above; verify `todayIdx` via the mount `/busy` range.
- 0.2 bundle identity: hard-reload, then assert the entry JS contains the
  chunk-marker strings and only the dev Supabase URL. (An open tab serves a
  stale cached loader — always hard-reload first.)
- 0.3 proxy CORS for the production origin (OPTIONS preflight → 204 with
  `access-control-allow-origin: https://smrios07mdb.github.io`).
- 0.4 baseline: `scheduled_blocks` empty of run-owned rows; `planner_writeout`
  noted and set `false` before any fixture; tray hygiene
  (`completed_at=is.null&priority=in.(1,2)` → `[]`); no `Smoke-*` tasks;
  signed-in `GET /busy` snapshot recorded.
- 0.5 bonus: Planner mount fires exactly 1 `/busy` on the production build.

## Part A — Fill my week, today-relative branch (`planner_writeout` false)

A0/A2 unchanged (manual occupancy block via a dedicated `Smoke-<runId>-Occ`
task — `scheduled_blocks.task_id` is UNIQUE; delete the occ block by SQL
before Part B so B1's backfill can't push it to iCloud).

**A1 (amended chunk 43): the spill sub-assertion must be forced, not
vacuous.** The original fixture set (45m/30m/60m against a 1-hour occupancy
block) left today's capacity able to absorb everything, so "spill packs
around busy" passed vacuously. Required shape (validated live as the F3
re-run on 2026-08-31):

- Occupancy: block **today 12:00–17:00** (5h) via `Smoke-<runId>-Occ`.
- Estimates: P1a 45m, P1b 30m, P2 90m; one real busy event on tomorrow's
  morning (the standing `Rent Due` Tue 10:00–11:00 serves when today is Mon).
- Derive before clicking, from cursor `max(09:00, ceil15(now+10m))`. Expected
  shape: exactly one proposal fits today (in the gap after the occ block),
  and the other two **spill to tomorrow and pack around the busy event** —
  one before it, one starting at its end, the busy hour untouched.
- Assert all three sub-assertions: (1) first proposal at the derived cursor,
  not 09:00; (2) no overlap with the occupancy block; (3) the spill placed
  tomorrow around busy, per the derivation. A run where nothing spills is a
  fixture failure, not a pass.

`proposal-block` is `aria-hidden` — assert on `innerText` + geometry
(52px/hour), never `getByRole`.

## Part B — write-out + reconcile (`planner_writeout` on)

B1 (Settings toggle → toast + DB), B2 (drag-place → optimistic insert,
`/api/calendar/events` mirror write, uid stamp), B4 (unschedule deletes the
event by uid, even drifted), B5 (toggle off leaves events in place):
unchanged in substance.

**B4 count (added chunk 46, F2).** Exactly **one** delete-by-uid per
unschedule. The 2026-08-31 run observed two identical
`/api/calendar/events?uid=…` deletes (+9 ms and +184 ms after the click,
both 200): the mutation's own `afterDelete`, then the orphan sweep of the
reconcile triggered by the blocks refetch, whose `plannerEvents` snapshot
still listed the just-deleted event. That was a chunk-43 regression (before
the content signature, `blocks: []` hit the dedup and returned early);
chunk 46 guards the sweep with a set of uids the mirror itself deleted. A
second delete in the unschedule window is now a **regression**, not noise.
This assertion was **not** satisfied by the chunk-46 build (`0f076e2`): the
guard existed but was populated only after the delete's network await, and
the live timings above are exactly the concurrent case — the sweep fired at
+184 ms while the mirror's own delete ran until ~+594 ms — so a run against
that build would still have seen two. It holds from chunk 47 (`0087cc4`),
which populates the set before the await.

**B2 count (added chunk 47, G2).** Exactly **one** `/api/calendar/events`
PATCH per drag-move of a mirrored block. A second identical PATCH in the
move window is a regression of the same class as B4's: the post-move blocks
refetch is a new content signature, so the reconcile runs, and until chunk 47
its drift loop compared the moved block against a `/busy` snapshot fetched
before the mirror's own write and rewrote the times it had just written.
This was never measured before chunk 47 because every prior run drifted
blocks by SQL rather than dragging them, so the move path's reconcile was
never on a netlog. Chunk 47 ranks the two observations by recency (D9), so
the pre-move snapshot no longer overrides the mirror's own record.

**Required setup — force one `/busy` refresh between the placement and the
move.** In Part B's own order the week is mounted before the block is placed,
so the snapshot in memory was fetched before the mirrored event existed and
`plannerEvents` never mentions its uid. The drift loop then falls to the
mirror's own record on *every* build, that record was just refreshed by the
move's own PATCH, and no second PATCH fires either way — the assertion passes
vacuously, the third instance of the failure mode that made chunk 42's
original B3 and chunk 46's B3b attempt 1 unfalsifiable. So after placing the
block, force one `/busy` refresh (a page reload or Force resync both do it)
and confirm `GET /busy` lists the uid at its placed times; only then drag it.
This is **setup for B2b, not a repair trigger**: B3b's "no reload fallback"
rule forbids reloading in order to *produce* a repair the echo failed to
produce, and does not forbid establishing the precondition an assertion needs.
B2b's PATCH must still come from the move's own mutation and the reconcile
that follows it — no reload inside the marked move window. Measured against
the two committed modules with the same fixture and only the order changed,
this is the discriminator: with the interposed refresh, `0f076e2` (chunk 46)
fires **2** PATCHes and `0087cc4` (chunk 47) fires **1**; without it, both
fire 1. Two PATCHes in the marked window is the real failure.

**B3 (re-scoped, chunk 43).** The original B3 — drift by SQL, navigate away
and back, expect a drift PATCH on the back-load — is excluded by design:
the back-load serves both caches, and chunk-40's own test asserts a
re-visited week with unchanged data does not re-reconcile. Two cases replace
it:

- **B3a — first load of a not-yet-visited week** (passes against chunk 40+).
  On a fresh page load, create an orphan planner event
  (`hupo-block-<uuid>`) on a week not yet visited this session; navigate to
  it. Expect exactly one `/api/calendar/events` call (the orphan delete) in
  the week-change load's marked window, with no Force resync, no
  `busyRefreshKey` bump, no remount; `GET /busy` for that week afterwards
  shows `plannerEvents: []`.
- **B3b — drift after a week already reconciled is repaired on that week's
  next blocks load** (chunk 43, F2 — the content-signature dedup; chunk 46,
  F1 — the mirror's session record). With the current week reconciled and a
  mirrored block in sync, drift the block by SQL (times only, `calendar_uid`
  untouched). Trigger a blocks refetch without any `busyRefreshKey` bump —
  the realtime echo from the SQL write itself bumps `dashboardRefreshKey`,
  so the drift PATCH fires within the echo's refetch. Expect one
  `/api/calendar/events` update in the marked window and `GET /busy` showing
  the event moved to the DB times.

  **Why the 2026-08-31 attempt 1 failed, and why it now passes.** That run
  placed the block and drifted it in the same session, and saw no PATCH.
  This was a **snapshot gap, not a dedup failure** — chunk 43's content
  signature worked correctly and the reconcile did run. The reconcile
  compared against `busyState.busy.plannerEvents`, the snapshot from the
  last `/busy` fetch, whose effect deps are
  `[weekKey, weekStartDate, busyRefreshKey, busyTick]` — nothing about
  blocks and nothing about mirror writes. The event had been created *after*
  that fetch, so the snapshot did not mention it: backfill skipped the block
  (it had a uid) and the drift loop found no entry for that uid and gave up.
  A silent no-op with nothing to compare against. Chunk 46 closes it — the
  mirror now keeps a session record of the events it wrote (uid → start/end)
  and falls back to it for uids `plannerEvents` does not mention, so the
  spec's original sequence works as written and discriminates. Attempt 2 of
  that run passed only because it used a block whose event predated the
  session's `/busy`.

  **No reload fallback.** Do NOT reload the page when the echo produces no
  PATCH. A reload is a remount, and a remount refetches `/busy` — which
  repaired drift before chunk 43 and before chunk 46 too, so a run that
  falls back to it cannot tell either fix from its absence. If the echo's
  refetch does not produce the PATCH, that is a **failure to report**, not a
  cue to try another trigger.

  **Negative control (keep).** A focus refetch past the busy TTL alone is
  still NOT a repair path — it refetches busy, not blocks, so no reconcile
  runs. Do not assert a repair on it.

## Part C — Today × priority coexistence (dashboard, no calendar)

C1 (combined row: priority chip + sun toggle), C2 (independence both
directions), C3 (chunk-33 sort wiring + picker round-trip): unchanged.

**C4 (amended chunk 43; wording corrected chunk 46).** The `Today list
layout` control has exactly **four** options, and `Off` is one of them —
earlier wording ("all four variants plus Off") read as five and was wrong.
Cycle all four options, `Off` included, asserting each geometry.
**"Sun toggles survive the variant changes" is now a real assertion**: pin a
task, change the variant in Settings, return —
the pin must survive the remount (chunk 43 persists membership deltas to
`localStorage['hup:todayPlan']`).

**C5 (amended chunk 43).** Client-local membership, now with persistence:

- Toggling a task into Today produces **zero network requests** and writes
  only `localStorage['hup:todayPlan']`
  (`{ date: 'YYYY-MM-DD', pinned: [], removed: [] }` — deltas, never the
  resolved set). No schema, no sync — the underlying client-local claim
  still holds.
- **Membership survives a reload**: pin a task, verify a genuine reload
  (`navType === 'reload'`), the pin is still present; a manual removal of an
  auto (P1) task equally survives.
- Removing the `hup:todayPlan` key and reloading resets membership to the
  auto derivation (the "clear site data" half, scoped to the one key —
  clearing all site data would sign the operator out, D-7).
- **Day rollover (new)**: write a `hup:todayPlan` entry whose `date` is
  yesterday (keep real pins in it), reload — the stale entry is discarded:
  yesterday's pins do not resurface and yesterday's removals do not stick.
  Assert on the **derived membership**, not on the key's presence — that is
  the right pattern and the 2026-08-31 run used it correctly. Then, as a
  separate assertion (chunk 46, F3): the stale entry is also **removed** from
  `localStorage`, not merely ignored — immediately after the reload and
  before touching any sun toggle,
  `localStorage.getItem('hup:todayPlan') === null`. (Read it before any
  toggle: the first toggle rewrites the key under today's date.)
  This covers the cold-start read path only; the **same-session** rollover
  (the clock crossing local midnight with the tab open) is covered by unit
  test only (chunk 44 — see its decisions-log row), because moving local
  midnight on the deployed build would need a `lib/today` clock hook and
  chunk 43 rejected shipping a test hook.

## Cleanup / end state

**Part B ordering (corrected chunk 46).** B5 must run **before** B4. B5
confirms that existing events survive the write-out flip, and after B4 has
unscheduled the block there is no event left to confirm. The order the
2026-08-31 run used, and the one to follow: place the block → flip
`planner_writeout` **off** with the block still live → confirm via
`GET /busy` that the event is still there (B5) → flip **on** → unschedule
and assert exactly one delete-by-uid (B4) → flip **off** to land on the
§0.4 baseline.

As the original run's table, with cleanup scoped to `Smoke-<runId>-*`:
blocks empty, run-prefixed tasks deleted, no real task touched
(`updated_at` sweep), tray hygiene empty, `/busy` back to baseline for every
touched week, `planner_writeout` restored to its §0.4 value, calendar clean
through the app/proxy (record every `hupo-block-` uid seen),
`localStorage` restored (remove `hup:todayPlan` and any keys added by the
run), harness discard verified (`navType === 'reload'` + a `timeOrigin`
later than the last cleanup write — `reload_tab` returns before the reload
commits).

## Scope note — verifying the chunk-47 build (added chunk 47)

The natural verification against `0087cc4` is **B3b + the B2 move count +
the B4 delete count**, not the whole spec: those three are the assertions
chunk 47's two changes can move, and B3b is the one that proves the
recency rule did not cost D3 its repair. This short run is **not**
window-constrained — Part A's Mon–Thu / 10:30–15:00 ET rule exists for the
today-relative cursor and none of the three touches it. The run rules above
(single owner, `Smoke-<runId>-*` prefix, isolated-world harness only) still
apply in full.
