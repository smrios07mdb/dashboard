# Claude Code prompt — Chunk 78: task streak; Routines folded into Today

You are Claude Code in `/Users/sergiorios/Documents/To-Do Dashboard` (`smrios07mdb/dashboard`). Base: `87ef7fe` (code = `e49111c`, deployed). Authority: `ARCHITECTURE.md` → `prompts/README.md` → this prompt.

App code only: no SQL, no migration, no proxy, no new dependency. `routine_items` / `routine_logs` and their repo, realtime, export and import paths are unchanged.

## Why (UX audit 2026-10-13, #12 and part of #17)

- The hero's streak is the routines streak (max of morning/night, ARCH §11). Routines have never been checked, so it reads 0 and hides, and finishing tasks never moves it.
- Routines holds a whole tab for an unused feature. The phone bar has six tabs.

Sergio's decisions (2026-10-14):
- The streak counts **tasks only**. A day counts if **any task** was completed that day.
- The Routines tab goes away. Routines become an **optional checklist inside Today**.

## Decisions (locked)

- **D1 — Task streak rule.** New `src/lib/taskStreak.ts`, pure, no `new Date()` / `Date.now()` (same rule as the old `streak.ts`; today is passed in):
  ```ts
  export function taskStreak(tasks: Pick<Task, 'completedAt'>[], todayKey: string, timeZone: string): number
  ```
  - A day `D` is **complete** iff at least one task has `completedAt` with `dateKeyIn(completedAt, timeZone) === D` (`lib/clock.ts`).
  - Streak = consecutive complete days counted back from today. If today isn't complete yet, count back from yesterday, so the streak survives until the day ends. The first incomplete day breaks it.
  - Step days with `dateKeyDaysAgo` (DST-safe), as the old module did. No lookback cap is needed: stop at the first gap.
  - Input is every task the Dashboard holds (`data.tasks`), in any subcategory, archived or not. Deleted tasks are gone, so they don't count. That is accepted.
- **D2 — Hero wiring.** In `src/screens/Dashboard.tsx`:
  - Compute the hero streak in render with `useMemo(() => taskStreak(data.tasks, clockToday(timeZone), timeZone), [data.tasks, timeZone])`. Do not compute it in `load`. Completing (or un-completing / Undo) a task updates the chip without a refetch. Both `DailyHero` mounts (first-run and normal) use it.
  - Remove `routineLogs.listByRange` and `routineItems.list` from the Dashboard `load`, and remove `STREAK_LOOKBACK_DAYS` and the `calcStreak` import.
  - `clockToday` keeps the DEV `__clockOverride` working.
  - In `src/components/gamify/DailyHero.tsx`, the chip's `title` becomes `Task streak` and it gains `aria-label={`${streak}-day task streak`}`. Its look is unchanged. It still hides at 0 (chunk 70). Update the prop's doc comment and the file header comment, and the matching comment in `lib/gamify.ts`.
- **D3 — Routines in Today.** New `src/components/TodayRoutines.tsx`, a collapsible block.
  - **Header:** a button with `aria-expanded`, which toggles the block. It reads `Routines` plus a mono count of today's checked items over today's live items (`2/5`). With no live items, the count is replaced by `Add`.
  - **Collapsed by default.** The open state is per-viewer: `localStorage['hup:todayRoutinesOpen']`, with every read and write in `try/catch`, and the default holds when storage is unavailable.
  - **Expanded:** Morning, then Night, each rendered with `RoutinePanel` in its new `compact` mode (D4). Stacked, not side by side.
  - **Placement:**
    - In the `stacked` and `rail` Today layouts, it renders inside the Today panel at the bottom of the panel body. Add a `routines?: React.ReactNode` slot to `TodayPanel` (same pattern as `busy`), render it only when `variant` is `stacked` or `rail`, and pass it from Dashboard.
    - With Today set to `banner` or `off`, Dashboard renders the block on its own directly after the Today panel (or, for `off`, where the panel would be), so routines are always reachable.
    - Not rendered in the first-run state.
- **D4 — `RoutinePanel` compact mode.** Add `compact?: boolean` (default `false`) to `src/components/RoutinePanel.tsx`. With `compact`:
  - no card chrome (no border, shadow or 22 px padding);
  - smaller heading;
  - no `StreakBadge`, no `Last 14 days` / `RoutineDotGrid`;
  - the check rows, `Edit list` / `Done`, inline rename, drag reorder (desktop) and Move up / Move down (touch), `X` remove with its confirm, the add row, and the `All done for today.` line are unchanged.
  - `calcStreak` is not computed in compact mode.
  - Non-compact is the only other caller, and D6 removes it. Since compact then becomes the only mode, you may instead strip the removed parts outright and drop the prop. Pick one, say which, and keep `RoutinePanel.test.tsx` green, with only accepted deviations.
- **D5 — Data and handlers.** Move the data load and every handler out of `src/screens/Routines.tsx` into a hook, `src/state/useRoutines.ts`: `onToggle` (with its optimistic placeholder and rollback), `onCreate`, `onRename`, `onArchive`, `reorderByIds`, `onMove`. Copy the logic as is; only the location changes.
  - The log read narrows to today only: `listByRange(todayKey, todayKey)`. No streak or grid needs history now.
  - It keeps subscribing to `uiStore.dashboardRefreshKey`.
  - `TodayRoutines` uses the hook. Load it only when the block first expands (or always, if that is simpler and costs nothing measurable); say which.
  - Toast text and the `Could not save — retry` error are unchanged.
- **D6 — Remove the tab, the route and the dead code.**
  - `src/components/Tabs.tsx`: drop the Routines entry. The order becomes Dashboard · Planner · Insights · Notebook · Settings. Drop the unused `Sun` import if it has no other use there.
  - `src/App.tsx`: delete the `routines` route and the `Routines` import. The existing catch-all `<Route path="*" element={<Navigate to="/" replace />} />` then sends bookmarks and the installed PWA to the Dashboard, so no new route is needed.
  - Delete `src/screens/Routines.tsx`, `src/components/RoutineDotGrid.tsx` + its test, `src/components/StreakBadge.tsx`, and `src/lib/streak.ts` + its test, provided nothing else imports them. Verify with `grep -rn` and list the results in the report. If anything else still imports one of them, keep that file and say why.
  - `src/screens/Primitives.tsx` (a DEV gallery) only names a `routines` id in a demo nav list. Leave it.
  - `DeveloperSection` sample data still seeds routine items. Leave it.
- **D7 — Tests, red-first against `87ef7fe`.**
  1. `src/lib/taskStreak.test.ts`:
     - no completions → 0;
     - today only → 1;
     - yesterday + the day before, none today → 2;
     - today + yesterday → 2;
     - a one-day gap breaks the streak;
     - several completions on one day count once;
     - `completedAt: null` is ignored;
     - **zone boundary:** `2026-10-14T03:30:00Z` is Oct 13 in `America/New_York` and Oct 14 in `UTC`, and the streak differs accordingly;
     - a run across the 2026-11-01 DST change in `America/New_York` stays unbroken.
  2. `Dashboard.test.tsx`:
     - Replace the `shows the canonical routines streak…` case with "the hero chip shows the task streak": tasks completed today and yesterday give `Task streak` with 2.
     - Add "completing a task updates the streak without a refetch": with no completions there is no chip; complete a task, and the chip shows 1; `repo.tasks.list` has still been called once.
     - The Dashboard no longer calls `routineLogs.listByRange` / `routineItems.list` on load. Update the two load-count assertions; these are accepted edits.
  3. `TodayRoutines.test.tsx`:
     - collapsed by default with the `n/m` count;
     - expand shows Morning and Night check rows; toggling one calls `repo.routineLogs.toggle` with today's key;
     - the open state persists via `hup:todayRoutinesOpen`, and a throwing `localStorage` still renders collapsed;
     - with no live items, it shows `Add`, and expanding offers `Edit list`.
  4. `TodayPanel.test.tsx`: the `routines` slot renders in `stacked` and `rail` and not in `banner`.
  5. `Tabs.test.tsx`: five tabs in the new order, no Routines. Update the existing lists; accepted edits.
  6. Routing, in `src/App.test.tsx`: an authed visit to `/routines` lands on the Dashboard. If `App.test.tsx` can't drive an authed route, say so and cover it with a `MemoryRouter` test of the route table instead.
  7. `RoutinePanel.test.tsx`: compact mode has no streak badge and no `Last 14 days`. Edit, add, remove and reorder still pass.
  - **Red-first:** restore the touched sources from `87ef7fe`, run the new and changed files, then restore. Report fail/pass counts and `git status --short` afterwards. Cases 1–4, 6 and the new Dashboard cases must fail at base.
- **D8 — Budget.** Eager JS delta ≤ **+1,000 B** over the Mac build of `87ef7fe`. Measure the base on the Mac first. The cloud baseline is 1,054,614 B (7 files) and is for reference only. Removing `Routines.tsx`, the dot grid and the streak badge should roughly offset the new block. If over, stop and report the measured number and what you tried.
- **D9 — Docs scope** (Step 3 only, after the gate and smoke):
  - `ARCHITECTURE.md` §11: rewrite it to the D1 rule, with one line saying the routines streak and the 14-day grid were retired in chunk 78 (data kept).
  - The §1 feature line "Daily morning + night routine checklists with streaks and 14-day history" becomes routine checklists in Today.
  - The §13/Notebook line listing six tabs: update it to five tabs.
  - The `settings.timezone` concern list (line ~422): "routines/streak" becomes "task streak".
  - `PROGRESS.md` row 78, the decisions log, Last-updated and known gaps, per convention.
  - Commit this prompt to `prompts/`.

## Steps

1. `git fetch && git checkout main && git pull --ff-only && git status --short`. Expect `87ef7fe` and a clean tree, apart from this prompt untracked.
2. Base eager JS on the Mac: `npm ci && npm run build`, then sum the `dist/index.html` script + modulepreload files, the same way as 77a–77c.
3. Write the D7 tests and run red-first.
4. Implement D1–D6.
5. Gates (Mac, clean): `npm ci && npx tsc -b && npx eslint . && npx vitest run && TZ=UTC npx vitest run && npm run build`. Measure eager JS.
6. Commit and push to `main`, alone, with no `[skip ci]`:
   ```
   feat(today): task streak; routines fold into Today, tab removed (chunk 78)

   Co-Authored-By: Claude <noreply@anthropic.com>
   ```
   The body gives D1, D3 and D6 in one line each.
7. Wait for the deploy run, then confirm live `https://smrios07mdb.github.io/dashboard/version.json?cb=<ts>` shows the new SHA.
8. **Stop.** Report back. The orchestrator runs the gate and the smoke, and docs (D9) come after as a separate `[skip ci]` commit.

## Smoke (run by the orchestrator, for reference)

On the live app in Sergio's Chrome, with throwaway `Smoke-78-*` tasks deleted at the end:
- **Streak:** with no completion today, the hero has no streak chip, or shows the run ending yesterday. Completing a smoke task shows or raises the chip at once. Undo puts it back.
- **Nav:** five tabs at desktop and at a 384 px frame. An in-app visit to `/dashboard/routines` (`history.pushState` + `popstate`, or a reload while the service worker controls the tab) lands on the Dashboard. Pages has no `404.html`, so a cold deep link without the service worker 404s. That is the same as before and is not in scope.
- **Routines in Today:** collapsed with its count. Expand in `stacked`, then switch the Today setting to `rail`, `banner` and `off`, and the block is reachable in each. Restore Sergio's setting afterwards. Checking a sample item and unchecking it again leaves no log change net. Edit list → add → remove a `Smoke-78` item.
- Console clean across a fresh reload.

## Out of scope

- The rest of #17: moving Settings into the account menu, icons, the Dashboard vs Tasks label.
- #18 and #19.
- XP and level.
- Purging archived routine items.
- Any change to `routine_items` / `routine_logs`.

## Report

D4 choice (prop vs strip), D5 load choice, `grep` results for the D6 deletions, files changed + stat, red-first counts, the gate table (NY and UTC test counts and files), eager JS base/head/delta on the Mac, deploy run + live `version.json`, any deviations with a reason each, and the final `git status --short`. On any failure, stop and report at that point.
