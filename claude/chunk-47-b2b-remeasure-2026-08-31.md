# B2b re-measure (run `0831h`) — three requests, and they are the app's own

Deployed prod `https://smrios07mdb.github.io/dashboard/`, `version.json`
`{"sha":"0087cc4","builtAt":"2026-08-31T18:33:47.361Z"}`. Single assertion, one
fixture, ~12 minutes. Run owner: this session only; no evidence of another writer
(baseline `tasks like 'Smoke%'` = 0, `planner_writeout` stable at `false`).

## Verdict

**The count is real: three `/api/calendar/events` PATCHes per drag-move, all
method `PATCH`, all 200.** Both instruments agree at 3. The 0831g finding is not
an instrument artefact.

**But its attribution was wrong.** 0831g reported the multiplication as sitting
"below the app's JavaScript". It does not. Two of the three are the app's own
reconcile effect (`Planner.tsx:606`), whose dependency array includes `blocks` —
the *local* block state, which `move` patches optimistically before the DB write
and again with the saved row. Each patch is a new content signature, so
`mirror.reconcile` runs, compares the moved block against a `/busy` snapshot that
still holds the pre-move times, and issues a drift PATCH. The third is
`mirror.afterUpdate`. Nothing below the app is involved and no local dev run is
needed.

Timing is what proves it (dt from `pointerup`, `performance.getEntriesByType('resource')`):

```
+6 ms   PATCH /api/calendar/events   200  d=1003   ← reconcile, on the optimistic patchBlocks
+7 ms   PATCH /rest/v1/scheduled_blocks 200 d=624  ← the move's single DB write
+641 ms PATCH /api/calendar/events   200  d=814    ┐ reconcile (on patchBlocks(saved))
+641 ms PATCH /api/calendar/events   200  d=698    ┘ + mirror.afterUpdate — same tick
+1511.. /rest/v1/{settings,scheduled_blocks,categories,subcategories,tasks} 200  ← echo refetch
(nothing on /api/calendar/* thereafter, verified to +128 s)
```

`move` (`Planner.tsx:694–719`) awaits `repo.scheduledBlocks.update` **before**
`void mirror.afterUpdate(...)`. That await resolved at ~+631 ms. A calendar PATCH
at **+6 ms**, concurrent with the DB write, therefore cannot be the mirror's
update path. The only other caller of `deps.updateEvent` is `mirror.reconcile`.
Exactly one of the three is `afterUpdate`'s; the other two are the reconcile's.

Chunk 47's recency ranking (D9/D10) does not prevent this: it ranks the `/busy`
snapshot against the mirror's own session record, and at the moment of the move
**both** hold the pre-move times, so the drift is real by either observation.

## The two instruments, side by side

| window | `read_network_requests` (Chrome MCP, method-bearing) | `performance.getEntriesByType('resource')` |
|---|---|---|
| drag-move | **3**, each `method: PATCH`, `statusCode: 200` | **3** (+6/+641/+641) |
| unschedule (B4, same session) | **1** `DELETE …?uid=hupo-block-1b105029-…`, 200 | **2** (+12 d=711, +219 d=517) |

They agree at 3 on the move and **disagree 1-vs-2 on the delete** — D-5's
over-count, reproduced. So resource timing can duplicate a single request, the
network log does not, and on the move the non-duplicating instrument is the one
reporting 3. Read exact counts off `read_network_requests`.

**Did anything land after the post-move blocks refetch?** No. The fan-out began
at +1511 ms; the last `/events` call started at +641 ms and ended at +1455 ms.
Zero calendar calls after the refetch, in agreement with 0831g. G2's subject —
the post-refetch drift rewrite chunk 47 removed — stays fixed.

Also in the window: exactly one `scheduled_blocks` PATCH (netlog) and one DB
`updated_at` (19:46:16.162Z, mark 19:46:15.564Z). No toasts. No isolated-world
errors.

## D-2 — settled: prefixed, and under `plannerEvents`

The placement POST again produced two VEVENTs. `GET /busy` (`from`/`to`, not
`start`/`end`) immediately after placement, both arrays verbatim:

```json
{"busy":[{"start":"2026-09-01T14:00:00.000Z","end":"2026-09-01T15:00:00.000Z","title":"Rent Due","source":"icloud"}],
 "plannerEvents":[
  {"uid":"hupo-block-60ed0a5e-cce9-44ae-88a9-07b468df2429","start":"2026-09-02T14:30:00.000Z","end":"2026-09-02T15:30:00.000Z"},
  {"uid":"hupo-block-1b105029-333b-4291-b8fb-dd84c3c9a79b","start":"2026-09-02T14:30:00.000Z","end":"2026-09-02T15:30:00.000Z"}]}
```

The stray uid **carries the `hupo-block-` prefix and sits under
`plannerEvents`** — the proxy tags only `source: 'planner'` creates, so by the
spec's own rule a second planner-sourced POST reached the proxy. Resource timing
recorded exactly **one** `POST /api/calendar/events` for the placement, so the
duplicate create is not a second client fetch. Two independent runs (0831g,
0831h) reproduce it; the surviving explanation is a retry or double-execution of
the create at or beneath the proxy, invisible to the client and non-idempotent
(unlike PATCH, where a repeat is silent). Not attributed further here.

After the move, `plannerEvents` held exactly the one expected uid at the new
times (`2026-09-03T17:00–18:00Z`), matching the block row.

## What this means for the B2 count assertion

The assertion as worded ("exactly one PATCH per drag-move") is not satisfiable on
`0087cc4`, and the extra PATCHes are a real behaviour of the shipped code, not
noise: a drag-move issues three calendar writes where one would do. It is not
chunk 47's regression — chunk 47 removed the *post-refetch* rewrite, and that is
verifiably gone — but the local-state reconcile that replaces it was present all
along and had never been on a netlog.

Two options for the spec, for the operator to choose:

1. Keep the assertion at one and treat the two reconcile PATCHes as a defect to
   fix (guard `mirror.reconcile` against blocks the mirror is mid-write on, or
   exclude optimistic block states from the reconcile trigger).
2. Re-word B2b to assert "exactly one PATCH *after* the post-move blocks
   refetch" — which is G2's actual subject, passes on `0087cc4` at 0, and failed
   on `0f076e2`.

Option 1 is the one that changes behaviour; option 2 only makes the check
measure what it was written for.

## Fixture and cleanup

One fixture, `Smoke-0831h-Blk` (task `4a08c2f5-0215-4d57-90ea-b7da61bbbf7b`,
Personal › General, 60m, P3), placed Wed 10:30–11:30 ET, moved to Thu 13:00–14:00
ET, unscheduled through the app.

```
scheduled_blocks                    : 0        ✓
tasks like 'Smoke%'                 : 0        ✓
task count                          : 122      ✓ (baseline)
tasks updated_at > 19:39Z           : 0        ✓ no real task touched
planner_writeout                    : false    ✓ baseline value restored
GET /busy                           : plannerEvents [], busy = Rent Due only ✓
localStorage keys                   : unchanged ✓
harness discard (final reload)      : window.__hz* gone, all DOM sinks gone ✓
mount cost after cleanup            : 1 /busy, 0 /events ✓
```

Every `hupo-block-` uid this run created is accounted for:

| uid | origin | disposition |
|---|---|---|
| `hupo-block-1b105029-333b-4291-b8fb-dd84c3c9a79b` | B2 placement (the block's mirror) | deleted by the app's unschedule, 1 `DELETE`, verified gone |
| `hupo-block-60ed0a5e-cce9-44ae-88a9-07b468df2429` | D-2 duplicate, unclaimed | deleted through the proxy (`{"ok":true}`), verified gone |

No Calendar.app cleanup outstanding.

## Harness notes

- **`read_network_requests` returns most-recent-first and is armed at first
  call.** It survives a same-origin reload. It carries `method` and
  `statusCode`, confirming 0831g's D-3.
- **`javascript_tool` does not await promises** (confirmed again: an `async`
  IIFE returns `{}`). The DOM-sink pattern is required.
- **`GET /api/calendar/busy` takes `from`/`to`**, not `start`/`end` — the wrong
  names return `400 {"ok":false,"error":"invalid_request"}`.
- **Page-world resource timing does not see isolated-world fetches**, so harness
  probes never pollute the `PerformanceObserver` counts.
- The prod toast region observer (`section[aria-live="polite"]`, read
  `innerText` of added elements) worked as chunk 46 documents: caught
  "Returned to tray." on the unschedule.
