# Chunks 46–49 verification, run `0831k` — **counted at the app's mutation boundary**

**Driver: none. Cloud container only** — no browser, no extension, no operator's Chrome, no
auth, nothing clicked. The four assertions are counted deterministically against the real
committed module, with the real `calendarApi` driven through a stubbed `fetch`, so what is
reported is a genuine method-level HTTP log emitted by the app's own code.

Target source: `d075268` (`Chunk 49: the orphan sweep records its own deletes`).
Full suite at that commit in this container: **519/519 passed, 52/52 files.**

## Why this is the right instrument for these four assertions

`0831g`'s own D-4 said it plainly: *"The B2 count assertion counts network requests where it
means app-issued mutations."* Every browser instrument in this saga — resource timing,
`read_network_requests`, DevTools — observes the network. The assertions are about what the
app **issues**. Those differ by everything between the two: the service worker (confirmed
active on prod), retries, preflights, and the proxy. Counting at `calendarApi`'s `fetch` call
removes all of it and measures the quantity the assertions actually name.

## Results — all four pass, and none is vacuous

Same harness, four modules, only `plannerCalendarMirror.ts` swapped:

| assertion | ch46 `0f076e2` | ch47 `0087cc4` | ch48 `192df7c` | **ch49 `d075268`** | expected |
|---|---|---|---|---|---|
| move — `PATCH /api/calendar/events` **before** the post-move refetch | **3** | **2** | 1 | **1** | 1 |
| move — any `/api/calendar/events` **after** that refetch | **1** | 0 | 0 | **0** | 0 |
| unschedule — `DELETE …?uid=` | **2** | 1 | 1 | **1** | 1 |
| D15 — orphan sweep `DELETE` across two deferred passes | 1 | 1 | **2** | **1** | 1 |

Every assertion is red on at least one prior build, so each one discriminates rather than
passing by construction. Verbatim log at `d075268`:

```
S1  [{"method":"PATCH","url":"/api/calendar/events","status":200}]
    pre-write reconciles=0   PATCH before refetch=1   any /events after refetch=0
S2  [{"method":"DELETE","url":"/api/calendar/events?uid=hupo-block-AAA","status":200}]
S3  [{"method":"DELETE","url":"/api/calendar/events?uid=hupo-block-ORPHAN","status":200}]
    orphan DELETE=1   PATCH=0
```

**The `d075268` move count is timing-independent.** `pre-write reconciles=0` — `pending`
gates both the optimistic frame and the saved-row frame out of the reconcile entirely, so no
ordering, latency or overlap between them can add a PATCH. On `0f076e2` and `0087cc4` the
count depends on how the frames interleave; here it does not.

## Deployed build is the source under test

| | |
|---|---|
| gh-pages `version.json` | `{"sha":"d075268","builtAt":"2026-08-31T20:22:42.421Z"}` |
| entry | `assets/index-Buva2ihk.js`, **989,994 B** |
| planner chunk | `assets/Planner-CCdqBsem.js`, 55,278 B |
| mirror markers in that chunk | `Planner calendar mirror` ×4 (matches source ×4), `orphan delete failed` ×1, `drift update failed` ×1, `backfill failed` ×1, `Returned to tray` ×1 |

Read server-side from the `gh-pages` branch; no browser involved.

## Findings

**F-1 — the vacuous-assertion failure mode struck a fourth time, in this run, and was caught.**
S2 first read **1 on every build including `0f076e2`**, where the spec says it must be 2. Cause:
the harness `await`ed `afterDelete` before running the sweep, so chunk 46's guard was populated
by the time the sweep looked — the very concurrency the assertion exists to detect was awaited
away. Firing `afterDelete` un-awaited, with latency on the stubbed write, reproduces the live
behaviour and the assertion discriminates. This is the same shape as chunk 42's original B3,
chunk 46's B3b attempt 1, and chunk 47's G3. **Proposed spec rule: an assertion about work that
races other work must never `await` the thing it races, and every count assertion must be shown
red against the build it targets before it is reported green.**

**F-2 — `0087cc4` measures 2 here, where `0831g`/`0831h` measured 3 live. Not reconciled, and
not tuned to match.** This harness `await`s each reconcile frame in turn, so frame 1's drift
PATCH records into `written` before frame 2 runs and chunk 47's recency rule suppresses the
second. Live, the two frames fire from React effects without awaiting each other and the PATCH
takes ~800 ms to resolve, so frame 2 sees an empty record and drifts again. Adding write
latency alone did not close the gap — the sequential `await` is what differs. The live 3 and
this 2 are consistent with each other under that explanation, but it is an explanation, not a
measurement. **It does not affect the verdict on `d075268`**, where both frames are gated out.

**F-3 — §0.2's bundle-identity check reads a file that cannot contain the markers it looks for.**
The spec says to assert the **entry** JS contains the chunk-marker strings. The planner and the
whole calendar mirror are in `Planner-CCdqBsem.js`, a lazily-imported chunk that `index.html`
never references — the only place the deployed chunk set is enumerated is the service worker's
precache manifest in `sw.js`. `grep` for any mirror marker in the entry returns 0 on a correctly
deployed build. Earlier runs were unaffected only because the markers they checked
(`hup:todayPlan`, `hup:todayList`) are dashboard-level and genuinely in the entry. **Amend §0.2
to resolve the chunk set from `sw.js` and assert planner/mirror markers against the Planner
chunk.**

**F-4 — `0831j`'s entry size disagrees with the artifact.** It recorded `index-Buva2ihk.js` at
**989,711 B**; the deployed file is **989,994 B**. Vite content-hashes filenames, so the name
pins the bytes and the two cannot both be right. Minor in itself, and one more reason to read
build artifacts server-side rather than through a page.

## What this does and does not establish

**Establishes:** on `d075268`, the app issues exactly one `PATCH` per drag-move and nothing
after the post-move refetch; exactly one delete-by-uid per unschedule; and exactly one orphan
delete across deferred passes. Chunk 47's G1/G2, chunk 48's D12/D13 and chunk 49's D15 are all
confirmed at the mutation boundary, each proven against the build it fixed.

**Does not establish:** anything below the app — the service worker, transport retries, or the
proxy. If a live run on `d075268` ever shows more than one PATCH in the move window, this run
localises the cause: it is not the app's mutation boundary, because that boundary issues one.
That is precisely the question `0831g` raised (D-4, "below the app's JS") and `0831h` disputed,
and it is now settled on the app's side.

**Still open:** a live run remains the only way to see the layers below the app, and it still
needs an instrument that does not drop. The server-side proxy log is that instrument.
