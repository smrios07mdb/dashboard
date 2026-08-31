# Chunk 42 deployed spot-run spec — amended (chunk 43)

This is the amended, in-repo copy of the chunk-42 spot-run spec. The original
lived outside the repo (`cowork-chunk-42-spot-run.md`) and was executed
2026-08-31 (results: `claude/chunk-42-spot-run-2026-08-31.md`). That run
surfaced three spec defects — B3 as written was untestable by design, C4/C5
asserted persistence the code did not have, and A1's spill sub-assertion was
vacuously satisfiable — plus two process gaps (no concurrency guard; the
prod CSP invalidates the page-world harness). All are corrected here. The
amended B3/C4/C5 assume **chunk 43 or later** is deployed (Today-membership
localStorage persistence; content-signature reconcile dedup).

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
unchanged.

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
  next blocks load** (chunk 43, F2 — the content-signature dedup). With the
  current week reconciled and a mirrored block in sync, drift the block by
  SQL (times only, `calendar_uid` untouched). Trigger a blocks refetch
  without any `busyRefreshKey` bump — the realtime echo from the SQL write
  itself bumps `dashboardRefreshKey`, so on prod the drift PATCH should fire
  within the echo's refetch; a reload of the page is an acceptable fallback
  trigger. Expect one `/api/calendar/events` update in the marked window and
  `GET /busy` showing the event moved to the DB times. A focus refetch past
  the busy TTL alone is still NOT a repair path (it refetches busy, not
  blocks) — do not assert on it.

## Part C — Today × priority coexistence (dashboard, no calendar)

C1 (combined row: priority chip + sun toggle), C2 (independence both
directions), C3 (chunk-33 sort wiring + picker round-trip): unchanged.

**C4 (amended chunk 43).** Cycle all four `Today list layout` variants and
Off, asserting each geometry. **"Sun toggles survive the variant changes" is
now a real assertion**: pin a task, change the variant in Settings, return —
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
  This covers the cold-start read path only; the **same-session** rollover
  (the clock crossing local midnight with the tab open) is covered by unit
  test only (chunk 44 — see its decisions-log row), because moving local
  midnight on the deployed build would need a `lib/today` clock hook and
  chunk 43 rejected shipping a test hook.

## Cleanup / end state

As the original run's table, with cleanup scoped to `Smoke-<runId>-*`:
blocks empty, run-prefixed tasks deleted, no real task touched
(`updated_at` sweep), tray hygiene empty, `/busy` back to baseline for every
touched week, `planner_writeout` restored to its §0.4 value, calendar clean
through the app/proxy (record every `hupo-block-` uid seen),
`localStorage` restored (remove `hup:todayPlan` and any keys added by the
run), harness discard verified (`navType === 'reload'` + a `timeOrigin`
later than the last cleanup write — `reload_tab` returns before the reload
commits).
