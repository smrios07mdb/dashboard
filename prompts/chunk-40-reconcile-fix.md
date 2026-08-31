# Chunk 40 — prepend note (read before Task 0; overrides Task 0 steps 1–2)

Discovered at the chunk-41 gate: local `redesign` is **two** commits ahead of
`origin/redesign` (`9c9659a`), not one —

- `8625fa8` "Chunk 38: stale Smoke Busy deleted" (known to the prompt), and
- `3ca0a41` "Chunk 39: Cowork smoke results" (new — Cowork committed its own
  record locally after the prompt was written).

Task 0 steps 1–2 are replaced by the following; everything else in the chunk-40
prompt stands unchanged.

**Step 1 (replaces step 1).** Inspect both local commits before pushing:
`git show --stat 8625fa8` and `git show --stat 3ca0a41`. Both must touch
`verification/` (and at most other docs) — **no `src/` paths**. If either
touches `src/`, stop and report; the prompt's F1 analysis is pinned to
`56ffff4`/`9c9659a` source and a source-bearing local commit would invalidate
the "tree unchanged" assumption. Otherwise push both
(`git push origin redesign`) and quote both stat blocks in the report.

**Step 2 (replaces step 2).** The operator-supplied `chunk-39-smoke.md` is the
orchestrator's canonical record: the Cowork run report **plus** a provenance
header and an *Orchestrator addendum* inside finding F1 (the pinned mechanism).
Reconcile it with whatever `3ca0a41` committed:

- If `3ca0a41` created `verification/chunk-39-smoke.md` with substantially the
  same report (same 10-check table, findings, uid ledger): **keep the committed
  file** and edit into it only the two orchestrator blocks from the supplied
  file — the `> Recorded by the orchestrator…` header block at the top, and the
  italic `*Orchestrator addendum (2026-08-30, source read at `56ffff4`)…*`
  paragraph at the end of the F1 finding. These edits land in the Task 0
  closeout commit.
- If `3ca0a41` used a different path/filename, committed a partial or
  materially different record, or committed something else entirely: save the
  supplied file verbatim as `verification/chunk-39-smoke.md` (renaming/removing
  the divergent file in the same commit) and state exactly what diverged.
- Either way, `verification/chunk-39-smoke.md` must end up containing both
  orchestrator blocks; quote a `grep -c "Orchestrator"` on the final file.

**Consequential tweaks.** In Task 0 step 3, the row-39 append's file reference
stays `verification/chunk-39-smoke.md` regardless of which reconciliation path
was taken. In the report's diff section, use
`git diff --stat 9c9659a..<chunk-40 sha>` as written — it will now include the
two pushed local commits; call that out so the stat isn't misread as chunk-40
scope creep.

Nothing about D1–D6, the F1 fix, the regression test, or the deploy.yml bump
changes.

---

# Chunk 40 — chunk-39 closeout · planner reconcile week-change fix (F1) · deploy-workflow bump

**Repo:** `smrios07mdb/dashboard` only (`redesign`; `origin/redesign` HEAD `9c9659a`; the working tree additionally carries the local, unpushed commit `8625fa8` — see Task 0 step 1). Proxy `dashboard-caldav-proxy` is **not touched** this chunk (stays at `1fb9200`). **Prerequisite (met):** chunk-39 smoke 10/10 PASS (`verification/chunk-39-smoke.md`, supplied alongside this prompt).

Run per `CLAUDE.md` and `prompts/README.md`. Authority order: `ARCHITECTURE.md` → `prompts/README.md` → this prompt. If this prompt and `ARCHITECTURE.md` disagree, stop and surface it.

Read the committed source before writing anything. This prompt was written against `9c9659a` (whose `src/` is byte-identical to `56ffff4`, the smoke's code under test — the orchestrator verified the F1 analysis below directly against `56ffff4`); if a file differs from its description here, the file wins and you say so in the report.

**Roadmap note.** The chunk-39 prompt named the `redesign` → `main` merge as the next step. The orchestrator's pre-merge divergence check found `main` is **6 commits ahead of the merge-base** (`cbca987`): the Today-list feature (`TodayPanel.tsx`, `lib/today.ts`, `state/todayList.ts`/`todayPlan.ts`, Dashboard/Settings/TaskRow wiring, `today_list_handoff/`), two Insights visual fixes (`dd994cc`, `42fc923`), and the `peaceiris/actions-gh-pages` v4 CI bump (`575c5e2`) required on Node 24 runners. The merge is therefore its own chunk (41: `main` → `redesign` integration + Today port; 42: `redesign` → `main` + deploy). This chunk takes only the CI bump (D4) and fixes F1 so the merged code is clean. Do not merge in either direction.

---

## Why this chunk exists

The chunk-39 smoke passed 10/10 but flagged F1: the per-week calendar reconcile (orphan delete, backfill, drift repair) never runs on an in-session week navigation — only on mount or a `busyRefreshKey` bump. The orchestrator pinned the mechanism from source (D2). The repair is small, and it must land before `redesign` reaches `main`.

## Files to read first

- `src/screens/Planner.tsx` — the week-change adjust-during-render block (~l.250), `busyState` + its effect (~l.258–351), the blocks effect (~l.363–407), `loadWeekOccupancy` (~l.760+, untouched), the reconcile effect (l.577–601)
- `src/lib/plannerCalendarMirror.ts` — `reconcile` (l.134+), the `reconciled` Set; **no change to this file**
- `src/lib/plannerCalendarMirror.test.ts`, `src/lib/calendarApi.ts` (mock surface for the regression test), `src/App.test.tsx` (screen-test harness patterns), `src/setupTests.ts`
- `.github/workflows/deploy.yml` (redesign copy — v3) and `origin/main:.github/workflows/deploy.yml` (v4; sole delta is line 35)
- `verification/chunk-39-smoke.md` (supplied file — Task 0 commits it), `verification/chunk-39-smoke-spec.md` (Task 0 amends it), `CLAUDE.md`, `PROGRESS.md`
- `ARCHITECTURE.md` §4 (reconcile paragraph), §13

---

## Task 0 — chunk 39 closeout (own commit, before any chunk-40 code)

1. **Push the local commit first.** Run `git log origin/redesign..HEAD --oneline`. If `8625fa8` ("stale Smoke Busy deleted", touches only `verification/chunk-38-smoke.md`) is present, push it before anything else. If your clone does not contain it, do **not** recreate it — flag it in the report and continue; the orchestrator will route the handoff.
2. **Commit the smoke record.** The operator supplies `chunk-39-smoke.md` alongside this prompt. Save it **verbatim** as `verification/chunk-39-smoke.md`.
3. **`PROGRESS.md` row 39**, append: "**Smoke (2026-08-30, `verification/chunk-39-smoke.md`):** 10/10 PASS via Cowork Chrome MCP against `56ffff4` (working HEAD `8625fa8`), proxy `1fb9200`. Run-level deviations (operator-waived §0.3, Sunday run): week under test = week 36, all fixtures on MON Aug 31; check 5 exercised the future-week fill branch (`todayIdx < 0`) — the write-out assertions (3 POSTs in proposal order, 3 stamps, 3 events) are branch-independent and held. Highlights: toggle gating incl. SQL-forced `auth_failed` disabled state; place → event with proxy-independent optimistic UI; move+resize as two PATCHes on one uid; unschedule DELETE; Place all; offline placement → outbox drain → backfill; orphan delete after a task cascade; forced 502 → `Saved — Apple Calendar not updated` with no rollback and drift repair on resync; toggle-off stops writes; disconnect clears + SQL-restored credentials still decrypt (Test+Save equivalence). Console: 1 hit total (transient proxy 502 on `/busy`, check 7 — F3). Findings: F1 reconcile skips week-change loads (mechanism pinned by the orchestrator, fixed this chunk — chunk 40), F2 dev StrictMode double-fires the mount busy effect so mount-time request counts are unassertable (spec amended), F3 transient. uid ledger closed; end state = baseline except `planner_writeout=true` left ON per the amended prompt."
4. **Spec amendments** (`verification/chunk-39-smoke-spec.md`) — spec errors/clarifications, not code:
   - Everywhere a check counts `/busy` requests "on the next Planner visit" or at mount: reword to count on the next **week navigation** or Force resync (exact = 1); add one note that dev StrictMode double-fires the mount busy effect, so mount counts are only assertable in a production build (F2).
   - Check 10 step 3: record the SQL restore of the §0.7 CalDAV values as the accepted equivalent of Test+Save — the untouched encrypted password decrypting on the next `/busy` proves the same substance, with no credential typed.
   - Check 6: "Reload the Planner" may be an SPA remount (Dashboard → Planner); `busyCacheRef` is per-mount, so the cold `/busy` is observed either way.
   - Add a "Runs" line pointing at `verification/chunk-39-smoke.md`.
5. **`CLAUDE.md` harness notes**, add (condensed from the run): remount-dependent navigations must be split into separate `execute_javascript` calls — same-tick double navigation never remounts (React Router settles once); the tray card **is** the schedule button (`button[aria-label="<title> — schedule"]`) — `pointerdown` on it starts the drag, there is no card wrapper above it; scope sheet queries with `[data-state="open"]` — `[role="dialog"]` matches the lingering sync-pill popover first; feedback-guided dropping: aim near the slot, read `[data-testid="drop-slot"]` on the next call, nudge ±13px per 15-min step (52px/hour), `pointerup` in its own call; resizes render no `drop-slot` preview — assert the block's live aria-label/height, `resize-strip` is the handle; one-shot failure shims must wrap the logger-wrapped fetch and restore to it, stamping a DOM attribute with method+timestamp; isolated-world fetches don't pollute the page-world request log (keep harness reads there; secrets travel via DOM attributes, never the transcript); the outbox is readable from the isolated world via IndexedDB (`dashboard-cache`/`outbox`); computer-use app grants can expire mid-run — batch Calendar.app assertions.
6. **Decisions log**, one row dated 2026-08-30: "Smoke-run operator steps are redesigned to be agent-executable wherever possible: DB state flips by SQL (PostgREST/MCP) replace UI credential re-entry — chunk-39 check 10 restored the CalDAV row by SQL instead of Test+Save; the untouched encrypted password decrypting on the next `/busy` proves the same substance. Only genuinely non-delegable steps (device OAuth, typing a credential) remain with the operator."
7. Save this prompt as `prompts/chunk-40-reconcile-fix.md`. `PROGRESS.md` "Last updated" → 2026-08-30. `npm test` (462/462), `tsc -b`, build green. Commit: `Chunk 39 closeout: smoke record, spec amendments, harness notes; chunk-40 prompt`. Push.

---

## Locked decisions (flag conflicts, don't relitigate)

**D1 — Scope.** F1 fix in `Planner.tsx` only, plus its regression test, plus the `deploy.yml` v4 bump (D4), plus docs. **Not this chunk:** any merge (either direction), the Today port, proxy changes, the week-boundary re-PUT item (row-39's out-of-scope note — stays recorded, untouched), `plannerCalendarMirror.ts` (the dedup semantics are correct; the bug is the caller feeding it a burned key), the failed-blocks-read UI behavior beyond D3's stamp rule.

**D2 — F1 mechanism (verified at `56ffff4`; treat as established fact).** On a week change, `weekKey` (l.234) updates in render, but `busyState` and `blocksPhase` are reset only inside their own effects (l.279+, l.373+). The week-change commit therefore renders one frame where `weekKey` is the new week while both phases still read `'ready'` holding the **previous** week's data. The reconcile effect (deps include `weekKey`) fires on that frame, runs against stale data — a no-op, since that data was already reconciled under its own key — and burns `${newWeekKey}:${busyRefreshKey}` at `plannerCalendarMirror.ts:137`. When the new week's data settles, `reconciled.has(key)` skips it. Mount works because both phases start cold/loading; a `busyRefreshKey` bump works because it mints a fresh key. This matches all three live observations (checks 6, 7, 10).

**D3 — The fix: data-week identity tags.** Do **not** demote phases or alter the stale-while-refetch visuals (R2/R3 stand — refreshing never dims, old overlays stay up).
- `BusyState` gains `forWeek: string | null` (initial `null`). Every `setBusyState` site inside the busy effect stamps the effect-closure `weekKey` its data belongs to — the fresh-cache `ready` branch, the `refreshing`/`loading` branch, the fetch-resolved `ready`, and the error/`not_configured` branches alike. (Only the `ready` stamps are load-bearing for the gate; stamp the rest for coherence.)
- Blocks: new `const [blocksForWeek, setBlocksForWeek] = useState<string | null>(null)`. Stamp it with the effect's `weekKey` alongside `setBlocksPhase` in the cache-hit branch and in the resolved `.then` branch. **Do not stamp it in the `.catch` branch** — the catch sets phase `'ready'` with a possibly-empty/stale list, and a reconcile fed an empty list would orphan-delete every mirror event for the week. Leaving the stamp stale on failure means a failed blocks read can never feed the reconcile; this closes an F1-adjacent hazard that exists today (note it in the report as such).
- Reconcile effect: add the gate `if (busyState.forWeek !== weekKey || blocksForWeek !== weekKey) return` (alongside the existing phase gates) and add `blocksForWeek` to the dep array (`busyState` is already there).
- Nothing else in the effect changes: same key, same `mirror.reconcile` call, same `tasksLoaded`/`plannerEvents` gates.

**D4 — deploy.yml.** Take `origin/main`'s `.github/workflows/deploy.yml` **verbatim** (`git checkout origin/main -- .github/workflows/deploy.yml`); the orchestrator verified the only delta is `peaceiris/actions-gh-pages@v3` → `@v4` (line 35). Inert on `redesign` (deploys fire from `main` only), but the chunk-42 merge deploy fails on Node 24 runners without it. Include in the chunk-40 commit; call out the one-line diff in the report.

**D5 — Regression test (red → green, mandatory).** Preferred vehicle: a screen-level test (new `src/screens/Planner.test.tsx`, or extend an existing screen-test harness) that mounts the Planner with mocked `repo`/`calendarApi`/settings (`plannerWriteout: true`, `caldavStatus: 'ok'`), lets the initial week's busy + blocks resolve, then navigates to the next week whose mocked `/busy` returns a `plannerEvents` entry with a uid no block claims — and asserts `calendarApi.deleteEvent` is called for that orphan **without** any `busyRefreshKey` bump. Prove redness: run the new test once with the D3 gate commented out (or against a stash of the pre-fix effect) and quote the failure in the report, then land it green. If mounting `Planner` in jsdom proves infeasible within the pass (pointer/layout machinery), the sanctioned fallback — say so explicitly — is: extract the full gate condition into an exported pure predicate (e.g. `reconcileReady(...)` in `Planner.tsx` or a sibling module), unit-test it including the stale-transition frame (new `weekKey`, old-week `'ready'` phases, mismatched tags ⇒ false), and keep the mounted assertion as a TODO recorded in the report. Target: 462 + ≥3; `tsc -b`, build, lint (3 pre-existing errors outside scope) green.

**D6 — Docs.** `ARCHITECTURE.md` §4 reconcile paragraph: one sentence — the reconcile is additionally gated on the busy and blocks state carrying the visible week's identity, so a week-change transition frame can never consume the reconcile key against stale data. `PROGRESS.md` row 40 + one Decisions row dated 2026-08-30: "(chunk 40) Chunk-39 F1: the planner reconcile never ran on an in-session week navigation — the reconcile effect fires on the week-change commit while `busyState`/`blocksPhase` still hold the previous week's `ready` data (both reset only inside their own effects), consuming `${newWeekKey}:${busyRefreshKey}` against stale data; the real data then found the key burned. Fix: busy and blocks state carry the `weekKey` their data belongs to and the reconcile gate requires both tags to equal the visible week; a failed blocks read never stamps its tag, so a reconcile can never run against an empty failed load. Stale-while-refetch visuals unchanged." A second Decisions row recording the roadmap discovery: "`main` is 6 commits ahead of the redesign merge-base (Today list, two Insights fixes, gh-pages v4 CI bump) — the merge splits into chunk 41 (`main` → `redesign` integration + Today port into the Daylight UI) and chunk 42 (`redesign` → `main` + deploy + the Mon–Thu deployed spot run, which also covers the outstanding chunk-38 check-1 today branch)."

---

## Acceptance criteria

- ☐ Task 0 landed first as its own commit; `8625fa8` pushed (or its absence flagged); `verification/chunk-39-smoke.md` committed verbatim.
- ☐ With the fix: a week navigation whose new week has an orphan/backfill/drift condition reconciles it on that load, exactly once, with no `busyRefreshKey` bump — proven by the D5 test.
- ☐ The regression test was demonstrably red against the pre-fix gate (failure output quoted in the report).
- ☐ A failed blocks read leaves `blocksForWeek` unstamped and the reconcile does not run for that load.
- ☐ `deploy.yml` matches `origin/main`'s byte-for-byte.
- ☐ `plannerCalendarMirror.ts`, `plannerCapacity.ts`, `plannerGeometry.ts`, `busyCache.ts`, `realtime.ts`, `calendarApi.ts` untouched (diff-verifiable). No proxy commits.
- ☐ 462 + ≥3 tests, `tsc -b`, build green; lint = the 3 pre-existing errors.

## Do NOT

- Merge `main` and `redesign` in either direction, cherry-pick the Today commits, or touch `today_list_handoff/` paths.
- Demote busy/blocks phases on week change, dim on refresh, or otherwise alter R2/R3 stale-while-refetch behavior.
- Change the reconcile key shape, the `reconciled` Set semantics, or anything in `plannerCalendarMirror.ts`.
- Touch the week-boundary re-PUT item (stays a recorded out-of-scope row).
- Add instrumentation, timers, or retries to the reconcile path.

## Commit + report

Task 0 commit (above) → `Chunk 40: reconcile week-change fix (F1) — data-week tags on busy/blocks state; gh-pages v4` → `PROGRESS: fill chunk-40 commit SHA (<sha>)`. Push all. Report: SHAs; `git diff --stat 9c9659a..<sha>` (plus `8625fa8` push confirmation); the red-test failure output and the green tail; test/`tsc`/build/lint tails; the `deploy.yml` one-line diff; every deviation with reason; anything conflicting with `ARCHITECTURE.md` or the source.

The orchestrator verifies the committed source at the exact SHA before writing the chunk-41 prompt (`main` → `redesign` integration; the Today port-vs-drop decision is the operator's and is being taken separately). No new smoke this chunk — the F1 behavior is covered by the D5 test, and the live path gets exercised in chunk 42's Mon–Thu deployed spot run.
