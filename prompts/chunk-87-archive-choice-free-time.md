# Claude Code prompt — Chunk 87: UX audit #4 (archive-time choice) + #9 (Today suggestions sized to free time)

You are Claude Code in `/Users/sergiorios/Documents/To-Do Dashboard` (`smrios07mdb/dashboard`). Base: `68958fa` (code = `4a84674`, deployed). Authority: `ARCHITECTURE.md` → `prompts/README.md` → this prompt.

App code only: no SQL, no migration, no proxy, no new dependency, no `vite.config.ts` / `src/sw.ts` / workflow change. `realtime.ts`, the outbox and `repo.ts` are not touched. None of the files below is on the `prompts/README.md` locked list.

This prompt runs end to end: implement, ship, gate, smoke, docs. On any failure, stop at that point and report.

## Why

The two items the UX audit (`claude/ux-audit-2026-10-13.md`) left open after chunk 86:

1. **#4 — archive-time choice.** Chunk 70 shipped only the Recovered card. Deleting a list already asks what to do with its tasks, but with gaps:
   - There is no **Mark them done** option.
   - **Move** offers only lists in the *same* category. The only list in a category can therefore only be deleted *with* its tasks.
   - The choice counts *every* task, completed ones included. A list holding only old completions is forced through Move/Delete.
2. **#9 — sizing.** Today's suggestions (chunk 67) ignore how much time is left today. Three 30 m suggestions show at 17:45 on a fully booked day.

Verified against the source at `68958fa`:
- `DeleteSubcategoryDialog.tsx` has three flows keyed on `taskCount > 0` and `otherSubsInCategory.length > 0`. `onConfirm({ moveToId? , cascadeDelete? })`. The `<select>` lists `otherSubsInCategory` only. No test file exists for it.
- `SubcategoryHeader.tsx` (~L316) mounts it with `taskCount` and `otherSubsInCategory`. `SubcategorySection.tsx` passes `taskCount={tasks.length}` (~L230) and already receives `allSubcategories` / `allCategories` (~L33–34).
- Two identical handlers: `screens/Dashboard.tsx` `onDeleteSubcategory` (~L547) and `screens/CategoryView.tsx` `onDeleteSubcategory` (~L426). Each one filters `data.tasks` by `subcategoryId`, moves or deletes, then calls `repo.subcategories.archive(id)` and toasts. The option type `{ moveToId?: string; cascadeDelete?: boolean }` is repeated in `SubcategoryHeader` (~L70), `SubcategorySection` (~L81), `CategoryColumn` (~L89, ~L383) and `CategoryView` (~L721).
- Bulk complete precedent: `SubcategoryView.tsx` (~L455–465) uses `repo.tasks.bulkUpdate(ids.map((id) => ({ id, patch: { completedAt } })))`.
- `lib/todaySuggest.ts` `suggestToday(data, todaySet, skipped, limit)` is pure. It builds per-category groups, sorts them, and takes turns until `limit`.
- `TodayPanel.tsx` (~L542) calls `suggestToday(data, todaySet, skipped, TODAY_PLAN_TARGET - all.length)` and computes `minutes` = Σ `estimateMinutes` of open plan rows (~L536). `SuggestionBlock` (~L269) renders the `Suggested` label + `Add all N`.
- `BusyStrip.tsx` `useBusyToday()` returns `{ kind: 'ready'; text }` from `getBusyDay(clockToday(timezone), timezone)` ranges. It refreshes on mount, on focus and every 5 min. It is called once in `Dashboard.tsx` (~L145) and passed to `TodayPanel` only as a ReactNode (`busyInline`, ~L752).
- Free-time precedent: `lib/plannerCapacity.ts` `computeDayFree` uses `PLANNER.workStart` / `workEnd` (09:00–18:00) and `ceil15(now)` from `lib/plannerGeometry.ts`. Wall → instant: `lib/zonedTime.ts` `zonedWallToDate(wall, tz)`. Formatter: `lib/cat.ts` `fmtMin`.

## Decisions (locked)

- **D1 — The delete-list dialog decides by open tasks.** `DeleteSubcategoryDialog.tsx`:
  - New props, replacing `taskCount` and `otherSubsInCategory`:
    - `openCount: number`: open tasks in the list.
    - `doneCount: number`: completed tasks in the list.
    - `targets: Subcategory[]`: every live list except this one, in any category.
    - `categories: Category[]`.
  - **`openCount === 0`**: one plain confirm, as today's no-task flow.
    - Description: `This list has no open tasks.`, plus ` Its N completed tasks stay in your history.` when `doneCount > 0`, plus ` This cannot be undone.`
    - Confirm `Delete` (destructive) → `onConfirm({ kind: 'none' })`.
  - **`openCount > 0`**: description `This list has N open task(s). What should happen to them?` followed by three radio cards, in this order:
    1. **Move them to…** with a `<select>` of `targets`. Use one `<optgroup label={category name}>` per category: the list's own category first, then the rest by category `sortOrder`, lists by `sortOrder` inside each. The default target is the first list of its own category, else the first of any category. The card is hidden when `targets` is empty.
    2. **Mark them done** — secondary line `They'll show in Insights.`
    3. **Delete them** (destructive text) — secondary line `This cannot be undone.`
  - Default radio: **Move** when `targets` is non-empty, else **Mark them done**.
  - Confirm labels: `Move and delete list` / `Mark done and delete list` / `Delete tasks and list`. Only the last is destructive-styled.
  - `onConfirm` payloads: `{ kind: 'move', toId }` / `{ kind: 'complete' }` / `{ kind: 'delete' }`.
  - Title stays `Delete "<name>"?`. Keep the adjust-state-during-render reset on open, and default focus on Cancel.
  - Export the option type as `DeleteListChoice = { kind: 'none' } | { kind: 'move'; toId: string } | { kind: 'complete' } | { kind: 'delete' }` from the dialog file. Use it in every place the old `{ moveToId?; cascadeDelete? }` shape is spelled out (the five sites above).
- **D2 — What each choice does with completed tasks.** No behaviour change for completed rows in Move or Delete:
  - **move**: open **and** completed tasks move to `toId`.
  - **complete**: open tasks get `completedAt = now`; completed ones stay with the archived list.
  - **delete**: open **and** completed tasks are deleted (today's cascade).
  - **none**: completed tasks stay with the archived list.
- **D3 — One handler, both screens.** New `src/lib/deleteList.ts`: `deleteList(id: string, choice: DeleteListChoice, tasks: Task[]): Promise<DeleteListResult>`.
  - It reads the list's tasks from the `tasks` argument at call time and runs the matching `repo.tasks.bulkUpdate` / `bulkDelete`. Skip the call when there are no rows. Then it calls `repo.subcategories.archive(id)`.
  - It returns `{ archived: Subcategory; updated: Task[]; deletedIds: string[] }`.
  - The archive runs only after the task step resolves. If the task step throws, nothing is archived and the error propagates.
  - `Dashboard.tsx` and `CategoryView.tsx` `onDeleteSubcategory` both call it, apply `updated` / `deletedIds` to local state with their existing `setData` shapes, `upsertSubcategory(archived)`, and toast:
    - move: `Tasks moved, list deleted`
    - complete: `Tasks marked done, list deleted`
    - delete: `List and tasks deleted`
    - none: `List deleted`
  - Errors: the existing `console.error` + `toast.error(SAVE_ERROR)`.
  - Completion goes through `bulkUpdate` only. No `offerCompleteUndo` and no `deleteTasksWithUndo`: the list is archived in the same step, so a per-task Undo would restore tasks into an archived list.
  - Open tasks that arrive in the list after the dialog opened (realtime from another device) are handled, not lost. `tasks` is read at confirm time, and anything that slips past still surfaces in the Recovered card. Do not add a server check.
- **D4 — Wiring.** `SubcategoryHeader` gains `openCount`, `doneCount`, `targets`, `categories` and drops `taskCount` for the delete dialog.
  - `MergeSubcategoryDialog` keeps its own `taskCount` / `otherSubsInCategory`. Merge is unchanged.
  - `SubcategorySection` computes `openCount` / `doneCount` from `tasks` (all of them: not the horizon-filtered rows, not the 30-day-filtered completions). It derives `targets` from `allSubcategories` (live, minus self) and passes `allCategories`.
  - `CategoryView`'s section wrapper (~L721) and `CategoryColumn` (~L89, ~L383) only change the option type.
  - Copy elsewhere: the header menu item `Delete subcategory` becomes `Delete list` (the UI says "list" since chunk 70).
- **D5 — Free time today.** New pure `src/lib/freeToday.ts`: `freeMinutesToday(ranges: BusyRange[], timezone: string, now: Date): number`.
  - Window: today in `timezone` (`clockToday(timezone)` semantics via `formatInTimeZone(now, timezone, 'yyyy-MM-dd')`), from `zonedWallToDate(`${day}T09:00`, tz)` to `…T18:00` (use `PLANNER.workStart` / `workEnd` to build the wall strings; do not hard-code 9/18 twice).
  - Start of the counted window: `max(windowStart, now rounded up to the next 15 min)`. Round in epoch ms. Every real zone offset is a multiple of 15 min, so this matches `ceil15` on wall minutes.
  - Result: `max(0, windowEnd − start − merged busy overlap)`, in whole minutes. Merge the ranges first (move `mergeRanges` out of `BusyStrip.tsx` into this module and import it back, so the two cannot drift). Clip each merged range to `[start, windowEnd]`.
  - The window applies **every day, weekends included**. The Planner's Mon–Fri rule is about week capacity; Today is about today.
  - `useBusyToday()`'s `ready` state gains `freeMin: number`, computed at return time with `new Date()`. `BusyStrip` / `BusyInline` ignore it.
- **D6 — Suggestions fit the time left.**
  - `suggestToday` gains a fifth parameter `budgetMin?: number | null`.
    - `null` / `undefined` → exactly today's result. No existing test may change.
    - A number → walk the **same** round-robin order over *all* candidates. Take a candidate only if `estimateMinutes ≤ remaining`, then subtract its estimate. Skip ones that don't fit and keep walking. Stop at `limit` or when the candidates run out.
    - `remaining` starts at `budgetMin`. A budget ≤ 0 returns `[]`.
    - Refactor so the ordered sequence is produced once and both modes read it.
  - `TodayPanel` gains `freeMin?: number | null`. Budget = `freeMin − minutes` (open plan rows' estimates), or `null` when `freeMin` is null/undefined.
  - `Dashboard.tsx` passes `freeMin={busy.kind === 'ready' ? busy.freeMin : null}` to both `TodayPanel` mounts. Calendar not connected, loading or error → no sizing (today's behaviour).
  - `SuggestionBlock` gains `budgetMin: number | null`. When it is a number, the `Suggested` label row also shows `fits {fmtMin(budget)} free` in the label style (`text-ink-3`, after the label, before `Add all`).
  - When sizing is on, the plan is under target, there are unsized candidates, and the sized list is empty, render one quiet line where the block would go. Same 12.5 px `--ink-2` style as the "Or tap the ☀" hint, and no block:
    - `No free time left today.` when budget ≤ 0.
    - else `Nothing open fits the {fmtMin(budget)} left today.`
    - In the empty-plan branch (~L691) this line replaces the block and the ☀ hint stays. In the non-empty branch (~L769) the line replaces the block.
  - `Add all`, `Skip`, the banner layout (no suggestions) and the target of 3 are unchanged.
- **D7 — Tests, red-first against `68958fa`.**
  1. New `components/DeleteSubcategoryDialog.test.tsx`:
     - 0 open / 0 done → plain confirm, `{ kind: 'none' }`.
     - 0 open / 4 done → description names the 4 completed staying, no radios.
     - 2 open with a same-category target → Move default, the select's first optgroup is the own category, confirm → `{ kind: 'move', toId }`.
     - Only other-category targets → Move offered, default target in the other category.
     - No targets → Move hidden, Done default, confirm → `{ kind: 'complete' }`.
     - Pick Delete → destructive label `Delete tasks and list`, `{ kind: 'delete' }`.
     - Reopen resets to the default.
  2. New `lib/deleteList.test.ts` (mock `repo`):
     - move updates open + completed rows' `subcategoryId` then archives.
     - complete patches only open rows with one `completedAt` then archives.
     - delete deletes all rows then archives.
     - none archives only.
     - A task step that throws → `archive` not called.
     - Archive is called after the task step resolves (order assertion).
  3. `SubcategorySection.test.tsx` (or the header test that exists): the dialog receives open/done counts from all tasks, not horizon-filtered rows. Fixture: a horizon that hides every open row still yields `openCount > 0`.
  4. New `lib/freeToday.test.ts`. Inject `now`; cases in `America/New_York` regardless of process TZ:
     - 07:00 with no busy → 540.
     - 10:07 → counted from 10:15 → 465.
     - Busy 12:00–13:00 and 12:30–14:00 overlap → merged once.
     - Busy straddling 09:00 / 18:00 → clipped.
     - Now 18:30 → 0.
     - A busy range on another day → ignored.
     - A Saturday → still 09:00–18:00.
     - The same instant evaluated in `Asia/Tokyo` gives Tokyo's window.
  5. `lib/todaySuggest.test.ts`:
     - Budget `undefined` → identical to the existing expectations.
     - Budget 45 with candidates 30/30/15 in order → first 30 + the 15.
     - Budget 0 → `[]`.
     - A large first-ranked task is skipped and later ones still fit.
     - Round-robin order is kept among the taken ones.
  6. `TodayPanel.test.tsx`:
     - `freeMin` null → today's output (no `fits` text).
     - `freeMin` 90 with a plan of one 30 m open task → label shows `fits 1h free`, and the suggestions' sum is ≤ 60.
     - `freeMin` 0 → `No free time left today.`, no `Suggested` section.
     - `freeMin` 20 with only 30 m candidates → `Nothing open fits the 20m left today.`
     - A plan already at 3 → no line.
  7. `BusyStrip.test.tsx`: `useBusyToday` ready state carries `freeMin` (mock `getBusyDay`, fake time). Existing `READY` / `EMPTY` fixtures gain a `freeMin` field. That is a fixture change, not an expectation change.
  - **Red-first:** restore every non-test source in the change set from `68958fa` (new tests kept). Run the touched test files in `TZ=America/New_York`. Report fail/pass per file, and name every new case that passes at base as not a regression guard. Restore the tree and confirm `git status --short` matches the change set.
  - **Existing expectations:** list each changed lookup with the reason, for example the menu item text `Delete subcategory` → `Delete list` (D4). No other expectation may change.
- **D8 — Budget.** Eager JS delta ≤ **+1,200 B**, measured the chunk-79 way. Base on the Mac is expected at 1,050,308 B, 11 files. If over, first check that `plannerGeometry` imports tree-shake to `PLANNER` + `ceil15` only. Tests are expected around 1,307 → ~1,345, and 108 → 111 files; report the actual numbers.
- **D9 — Docs scope** (Step 9 only, after gate and smoke):
  - `PROGRESS.md`: row 87, Last-updated, and the decisions log D1–D6 (one row each). Known gaps:
    - The free-time window is fixed at 09:00–18:00. Planner blocks are not subtracted: `/busy` excludes `hupo-block-` events and the Dashboard does not load `scheduled_blocks`.
    - Any unit-test-only item from the smoke.
  - `ARCHITECTURE.md`, one line each where relevant:
    - Deleting a list asks Move (any category) / Mark done / Delete for its open tasks, and completed tasks follow per D2.
    - Today's suggestions are sized to free time (09:00–18:00 in the Settings zone, minus busy, minus the plan's open estimates) when the calendar is connected.
  - Commit this prompt to `prompts/`.

## Steps

1. **Sync.**
   ```bash
   cd "/Users/sergiorios/Documents/To-Do Dashboard"
   find .git -name '*.lock' -print
   git fetch origin && git checkout main && git pull --ff-only
   git rev-parse --short HEAD
   git status --short
   ```
   Expect: no `.lock` files (delete any and re-run); HEAD `68958fa`; only `?? prompts/chunk-87-archive-choice-free-time.md` untracked. If the prompt file is not on disk, write it from this prompt and say so.
2. **Base on the Mac.**
   ```bash
   npm ci && npm run build
   ```
   Record base eager JS (expected 1,050,308 B, 11 files).
3. **Tests red-first** (D7).
4. **Implement** D1–D6.
5. **Gates** (Mac):
   ```bash
   npm ci && npx tsc -b && npx eslint . && TZ=America/New_York npx vitest run && TZ=UTC npx vitest run && TZ=Asia/Tokyo npx vitest run && npm run build
   git diff --stat 68958fa -- package.json package-lock.json
   ```
   Expect: all green in all three zones; `package.json` / lockfile diff empty; eager JS within D8.
6. **Ship the code alone.** Push without `[skip ci]`:
   ```bash
   git add src
   git status --short
   git commit -m "feat: delete-list asks move/done/delete for open tasks; Today suggestions fit today's free time (chunk 87)" -m "D1 dialog decides by open tasks: Move (any category) / Mark done / Delete. D2 completed rows follow move and delete, stay on done/none. D3 one deleteList helper for Dashboard and CategoryView; archive only after the task step. D5 freeMinutesToday: 09:00-18:00 in the Settings zone from now (15m), minus merged busy. D6 suggestToday takes a budget; TodayPanel shows fits Xm free or a no-fit line." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
   git push origin main
   gh run list --workflow "Deploy to GitHub Pages" --limit 1
   ```
   - `git status --short` before the commit must show only the D1–D7 files under `src/`, plus the untracked prompt (not staged).
   - Wait for the run to finish green. One `gh run rerun --failed` is allowed only for a GitHub-side 5xx pushing to `gh-pages` (chunk 78 rule). Anything else, stop.
7. **Gate from a clean archive.**
   ```bash
   NEW=$(git rev-parse --short HEAD)
   rm -rf /tmp/c87 && mkdir -p /tmp/c87/base /tmp/c87/head
   git archive 68958fa | tar -x -C /tmp/c87/base
   git archive $NEW | tar -x -C /tmp/c87/head
   diff -rq /tmp/c87/base /tmp/c87/head
   cp .env.local /tmp/c87/head/
   cd /tmp/c87/head
   npm ci && npx tsc -b && npx eslint . && TZ=America/New_York npx vitest run && TZ=UTC npx vitest run && TZ=Asia/Tokyo npx vitest run && npm run build
   cd "/Users/sergiorios/Documents/To-Do Dashboard"
   ```
   Expect: `diff -rq` lists only the change-set `src/` files; all gates green in all three zones; same eager JS as Step 5. The `.env.local` needs the real `VITE_CALDAV_PROXY_URL` (CLAUDE.md, chunk 77).
8. **Live checks.**
   ```bash
   curl -s "https://smrios07mdb.github.io/dashboard/version.json?cb=$(date +%s)"
   ```
   Expect `$NEW` (re-check every 2 minutes, up to 10).

   **Smoke** with **Claude in Chrome** (Sergio's Chrome + extension), live site. Use Supabase MCP `execute_sql` for the read-only checks and for the cleanup in step 6 only.
   1. Load the tools in one ToolSearch call. Open a new tab and bring it to the foreground. If `visibilityState` is `hidden`, ask Sergio to bring the window forward, and expect the first click after that to be swallowed. Reload until `document.scripts` serves the same `index-*.js` as the live HTML (CLAUDE.md, chunk 77c). Arm `read_console_messages`. Record `hup:captureDest`.
   2. **Free time (D5/D6), read-only:** on Tasks, report:
      - the local time;
      - the Today header's busy line verbatim;
      - the plan's open estimate total;
      - the `Suggested` label row verbatim, or the no-fit line.

      Then compute by hand: 09:00–18:00 today, from now rounded up to 15 min, minus the busy ranges shown, minus the plan's open total. It must equal the `fits …` figure, and the shown suggestions' estimates must sum to ≤ it. After 18:00 local, expect `No free time left today.` and no `Suggested` section.
   3. **Done path (D1–D3):** in the **Work** category add a list `Smoke-87d`. Add two tasks, `Smoke-87d a` and `Smoke-87d b`, from its own `New task`. Open its menu → `Delete list`. Report:
      - the description;
      - the radio labels;
      - the default radio;
      - the first optgroup label.

      Pick **Mark them done** → confirm → toast `Tasks marked done, list deleted`. Then:
      - `execute_sql`: both tasks have `completed_at` set; the list has `archived_at` set.
      - No `Recovered` card on Tasks.
   4. **Cross-category move (D1):** add a list `Smoke-87m` in **Work** with one task `Smoke-87m a`. `Delete list` → **Move them to…** → pick **Personal › General** (it must sit under a `Personal` optgroup) → confirm → toast `Tasks moved, list deleted`. `Smoke-87m a` now shows in Personal › General.
   5. **No-open path (D1):** add a list `Smoke-87n` in **Work** with no tasks → `Delete list` → report the description (`This list has no open tasks. This cannot be undone.`) → `Delete` → toast `List deleted`.
   6. **Cleanup:**
      - ⋯ → Delete on `Smoke-87m a`, wait 9 s.
      - `execute_sql`: `delete from tasks where title like 'Smoke-87%'`, then `delete from subcategories where name like 'Smoke-87%' and archived_at is not null`. Report the row counts (expect 2 and 3).
      - Reload → 0 `Smoke-87` rows anywhere and no `Recovered` card.
      - `hup:captureDest` is back to its step-1 value; restore it if a list add changed it.
      - No other task, list, note or routine item may be touched.
   7. **Console:** report every entry verbatim; expect none.
9. **Docs** (D9), only if Steps 5–8 are all green:
   ```bash
   cd "/Users/sergiorios/Documents/To-Do Dashboard"
   git add ARCHITECTURE.md PROGRESS.md prompts/chunk-87-archive-choice-free-time.md
   git diff --cached --stat
   git commit -m "docs(chunk-87): UX audit #4 archive choice, #9 suggestions fit free time; close chunk 87 [skip ci]" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
   git push origin main
   gh run list --workflow "Deploy to GitHub Pages" --limit 1
   curl -s "https://smrios07mdb.github.io/dashboard/version.json?cb=$(date +%s)"
   rm -rf /tmp/c87
   find .git -name '*.lock' -print
   git status --short
   ```
   Expect: no `src/` or `package.json` change in the docs commit; no new deploy run; `version.json` still `$NEW`; a clean tree and no locks.

## Out of scope

- Merge (`MergeSubcategoryDialog`) and the Recovered card. Both are unchanged.
- Undo for list deletion, and any server-side guard against archiving a list with open tasks.
- Subtracting Planner blocks from free time, and a configurable work window.
- Free-time sizing in the banner layout, or when the calendar is not connected.
- Any SQL, migration, RLS or realtime change.

## Report

Include:
- files changed + stat;
- red-first counts per file, naming non-guards;
- every existing test lookup changed, with the reason;
- the gate table on the Mac and from the clean archive (all three TZ test counts);
- eager JS base, head and delta;
- the deploy run ID and `version.json`;
- smoke results per item:
  - the free-time hand calculation vs the shown figure;
  - the dialog descriptions, radio labels, default and optgroup;
  - each toast;
  - the SQL results;
  - the cleanup counts;
  - every console entry;
- the docs commit SHA and stat;
- any deviations, with a reason each;
- the final `git status --short`.
