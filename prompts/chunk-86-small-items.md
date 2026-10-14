# Claude Code prompt — Chunk 86: UX audit #19 (name, old completions, totals + size, archived purge, Notebook button)

You are Claude Code in `/Users/sergiorios/Documents/To-Do Dashboard` (`smrios07mdb/dashboard`). Base: `698bd24` (code = `3acc806`, deployed). Authority: `ARCHITECTURE.md` → `prompts/README.md` → this prompt.

App code only: no SQL, no migration, no proxy, no new dependency, no `vite.config.ts` / `src/sw.ts` / workflow change. `realtime.ts` and the outbox are not touched. None of the files below is on the `prompts/README.md` locked list.

This prompt runs end to end: implement, ship, gate, smoke, docs. On any failure, stop at that point and report.

## Why

UX audit #19 (`claude/ux-audit-2026-10-13.md`), the last open finding. Sergio's calls (2026-10-14):

1. **Greeting:** shows `Smrios07` (the email local-part). The greeting reads **Sergio**: a name you set, never the email.
2. **Completed rows grow without limit** (`67 COMPLETED`). Completions older than **30 days** leave the lists and live only in Insights.
3. **Category totals** (`7h 30m`) are sums of the default 30 m estimate (28 of 28 open tasks). **Both:** hide the totals, and ask for a size (S / M / L) at capture.
4. **103 archived lists and 122 archived routine items** sync to every device, against 7 and 9 live. Add a purge.
5. **Notebook empty state** shows two `New note` buttons.

Verified against the source at `698bd24`:
- `gamify/DailyHero.tsx` `displayName(user)` (~L77): prefers `user_metadata.name` / `full_name` / `display_name`, then falls back to the email local-part.
- `SubcategorySection.tsx`: `completed` (~L134) feeds `bucketCompleted` (~L220), the `N completed` expander (~L294) and `All done. N completed.` (~L255). `screens/SubcategoryView.tsx`: `completed` (~L170) feeds `Show N done` (~L557), `visibleTasks` (~L184) and `All done. N completed.` (~L587).
- Totals: `SubcategoryHeader.tsx` `fmtMin(incompleteMinutes)` (~L253), passed from `SubcategorySection` (`minutes`, ~L229); `CategoryColumn.tsx` `fmtMin(total)` (~L259); `CategoryView.tsx` `{openCount} open · {formatMinutes(openMinutes)}` (~L616); `SubcategoryView.tsx` `{visibleIncomplete.length} open · {formatMinutes(openMinutes)}` (~L539).
- Capture: `QuickCapture.tsx` `submit()` saves `parsed.estimateMinutes ?? DEFAULT_MINUTES` (~L166).
- FKs (`01_tables.sql`, `16_notes.sql`): `tasks.subcategory_id … on delete restrict`; `routine_logs.routine_item_id … on delete cascade`; `notes.subcategory_id … on delete set null`. No repo method deletes a subcategory or a routine item today.
- `notebook/NoteList.tsx`: the header `New note` button (~L177) and the empty-state `DashedCard` action (~L249) both call `onNew`.

## Decisions (locked)

- **D1 — Name.**
  - `screens/Settings.tsx` `AccountSection`: a new `SettingsRow` titled `Name` above `Email`. A text input (`aria-label="Name"`, max 40 chars, prefilled from `user.user_metadata.name`) and a `Save` button. Save calls `supabase.auth.updateUser({ data: { name } })` with the trimmed value; an empty value saves `name: null`. Success toast `Name saved`; on error, toast the message (or `Could not save your name. Try again.`). Save is disabled while unchanged or saving. The hint reads `Used in the greeting.`.
  - `gamify/DailyHero.tsx` `displayName`: delete the email local-part fallback. With no name in the metadata the heading is the bare greeting. Update the doc comment (chunk 86: a name you set, never the email).
  - `useSession` already re-renders on `USER_UPDATED`; do not change `lib/auth.ts`.
- **D2 — Completions older than 30 days leave the lists.**
  - New `src/lib/completedAge.ts`: `COMPLETED_VISIBLE_DAYS = 30` and `isRecentCompletion(task, now = new Date()): boolean`, true when `completedAt` is set and `now − completedAt < 30 × 24 h`.
  - `SubcategorySection.tsx`: `completed` becomes recent completions only. Lingering / just-completed rows are unaffected. The empty-state branches: open rows hidden by the horizon → unchanged; no open rows and ≥ 1 recent completion → `All done. N completed.` (N = recent); no open rows and no recent completion but the list has tasks → `All done.`. A list whose only tasks are old completions must never render an empty body.
  - `SubcategoryView.tsx`: the same rule for `completed`, `Show / Hide N done`, `visibleTasks` and the empty copy (`All done.` when nothing recent).
  - Unchanged: the repo still loads every task; XP, level, the streak, Insights, search and export see every completion.
- **D3 — No time totals on lists or categories.** Remove the four sites above. `SubcategoryHeader` loses the `incompleteMinutes` prop and its slot (no reserved width left behind); `SubcategorySection` stops computing `minutes`; `CategoryColumn` stops computing `total` and keeps the wrapping control row; `CategoryView` and `SubcategoryView` headers read `N open`. Drop `openMinutes` / `formatMinutes` imports only if nothing else uses them. Unchanged: each row's estimate, the Today panel's `to do · Xm`, the Planner, Insights.
- **D4 — Size at capture.** `QuickCapture.tsx`: below the chips row, a `Size` group of three toggle buttons — `S · 15m`, `M · 30m`, `L · 1h` — `role="group"` `aria-label="Size"`, each `aria-pressed`. None pressed on open. Pressing one selects it; pressing it again clears it. Precedence on save: a typed estimate token (`15m`, `1h`) wins, then the picked size, then `DEFAULT_MINUTES`. While a typed estimate is present the group is still shown but no button reads pressed. The size resets after each save (with the text) and on close. Sizes live in `lib/captureParse.ts` as `CAPTURE_SIZES = [{ key: 'S', minutes: 15 }, { key: 'M', minutes: 30 }, { key: 'L', minutes: 60 }] as const`. The dialog's description gains `Pick a size, or type 15m.`. Keyboard shortcuts (`useCaptureShortcuts`) are unchanged. `AddTaskInline` is unchanged.
- **D5 — Purge archived rows, on demand.**
  - `db/repo.ts` `dataRepo`, two online-only methods (throw `new Error('offline')` when `isOnline()` is false; no outbox, no Dexie fallback — the `deleteAllForUser` pattern at `repo.ts` ~L912):
    - `archivedCounts(): Promise<{ routineItems: number; lists: number; listsKept: number }>` — archived routine items; archived subcategories with no task (any state) and no note (`lists`); archived subcategories that have a task or a note (`listsKept`).
    - `purgeArchived(): Promise<{ routineItems: number; lists: number }>` — deletes every archived routine item (their logs cascade), then deletes the archived subcategories that have no task and no note (re-checked server-side in this call, by `.in('id', ids)` after reading `tasks.subcategory_id` and `notes.subcategory_id` for the archived ids). Then removes the same ids from Dexie (`routine_items`, `subcategories`, and `routine_logs` rows of the deleted items). Returns what it deleted.
  - Lists that hold tasks or notes are never deleted (`tasks` FK is `restrict`, and the Recovered card and detached-note memos depend on them).
  - `screens/Settings.tsx` `DataSection`: a new `SettingsRow` titled `Archived items` after `Local cache`. Hint: `Lists and routine items you archived still sync to every device. Removing them deletes them for good; lists that still hold tasks or notes are kept.` Button `Remove archived…` (outline, `Trash2`), disabled offline or while busy. It opens a dialog that loads `archivedCounts()` and reads `Remove N archived lists and M archived routine items? K archived lists that still hold tasks or notes are kept. This can't be undone.` (omit the K sentence when K = 0; when N + M = 0 the dialog reads `Nothing to remove.` and the confirm is disabled). Confirm `Remove` (destructive) → `purgeArchived()` → toast `Removed N lists and M routine items` → `forceDashboardRefresh()`. Load or purge failure → toast `Could not remove archived items. Try again.`. No typed confirmation.
- **D6 — One `New note`.** `NoteList.tsx`: the empty-state `DashedCard` has no action button; its body becomes `Notes can stand alone or sit beside a task or list. Start one with New note, or from any task's menu.`. The header button is unchanged.
- **D7 — Tests, red-first against `698bd24`.**
  1. New `src/lib/completedAge.test.ts`: 29 d 23 h ago → recent; 30 d ago → not; `completedAt` null → not; `now` injected.
  2. `SubcategorySection.test.tsx`: a 40-day-old completion is not in the expander count or rows; a 2-day-old one is; a list with only old completions renders `All done.`; a list with open rows + old completions shows no expander.
  3. `screens/SubcategoryView.test.tsx`: `Show N done` counts recent only; all-old → `All done.`.
  4. `CategoryColumn.test.tsx` and `SubcategorySection.test.tsx` (the header renders inside it): no `Xh Ym` / `Xm` total in the header (assert by the old text for a fixture with known minutes); `screens/CategoryView.test.tsx` / `SubcategoryView.test.tsx` header reads `N open` with no `·`.
  5. `capture/QuickCapture.test.tsx`: no size pressed on open; pick `L` + `Call Bob` → `create` gets `estimateMinutes: 60`; pick `S` + `Call Bob 45m` → 45 and no button pressed; nothing picked → 30; pressing `M` twice → unpressed; after a save the size is cleared.
  6. `DailyHero.test.tsx`: `user_metadata.name: 'Sergio'` → heading `…, Sergio`; email `smrios07@…` with no metadata → bare greeting (no `Smrios07`).
  7. `screens/Settings.test.tsx`: Name row prefilled; Save calls `supabase.auth.updateUser({ data: { name: 'Sergio' } })` with trimmed input; empty → `{ data: { name: null } }`; the email still appears exactly once (chunk 79 case unchanged). Archived items: the dialog shows the counts sentence; confirm calls `purgeArchived` once and toasts; `0 + 0` → `Nothing to remove.` with the confirm disabled; offline → button disabled.
  8. `src/db/repo.test.ts`: `purgeArchived` deletes archived routine items, deletes only archived subcategories with no task and no note, never issues a delete on a subcategory id that has a task or note, removes the deleted ids from Dexie, and throws offline without calling Supabase. `archivedCounts` returns the three numbers for a fixture.
  9. `notebook/NotesProvider.test.tsx` (it already renders the Notebook's `New note`, ~L241), or a new `notebook/NoteList.test.tsx` if the empty state is not reachable there: with no notes exactly one `New note` button.
  - **Red-first:** restore every non-test source in the change set from `698bd24` (new tests kept), run the touched test files in `TZ=America/New_York`, report fail/pass per file, and name every new case that passes at base as not a regression guard. Restore the tree and confirm `git status --short` matches the change set.
  - **Existing expectations:** cases that assert a header total or the `Smrios07`-style fallback will change. List each changed lookup with the reason. No other expectation may change.
- **D8 — Budget.** Eager JS delta ≤ **+1,500 B** (measured the chunk-79 way; base on the Mac expected 1,048,830 B, 8 files). Settings is eager; if over, move the archived-items dialog body into a lazy chunk before anything else. Tests expected around 1,272 → ~1,300, 107 → 108 files; report actual.
- **D9 — Docs scope** (Step 9 only, after gate and smoke):
  - `PROGRESS.md`: row 86; Last-updated; decisions log D1–D6 (one row each); known gaps — add: the purge was not run live (Sergio runs it from Settings when he wants), and any unit-test-only item from the smoke.
  - `ARCHITECTURE.md`: one line each where relevant — greeting name from auth `user_metadata.name`, never the email; lists show completions from the last 30 days, older ones only in Insights; no time totals on list/category headers; capture size precedence (typed > S/M/L > 30 m); Settings → Data → Archived items purge (online-only, keeps lists with tasks or notes).
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
   Expect: no `.lock` files (delete any and re-run); HEAD `698bd24`; only `?? prompts/chunk-86-small-items.md` untracked. If the prompt file is not on disk, write it from this prompt and say so.
2. **Base on the Mac.**
   ```bash
   npm ci && npm run build
   ```
   Record base eager JS (expected 1,048,830 B, 8 files).
3. **Tests red-first** (D7).
4. **Implement** D1–D6.
5. **Gates** (Mac):
   ```bash
   npm ci && npx tsc -b && npx eslint . && TZ=America/New_York npx vitest run && TZ=UTC npx vitest run && TZ=Asia/Tokyo npx vitest run && npm run build
   git diff --stat 698bd24 -- package.json package-lock.json
   ```
   Expect: all green in all three zones; `package.json` / lockfile diff empty; eager JS within D8.
6. **Ship the code alone.** Push without `[skip ci]`:
   ```bash
   git add src
   git status --short
   git commit -m "feat: name in the greeting, 30-day completed lists, no header totals, size at capture, archived purge, one New note (chunk 86)" -m "D1 Settings name via auth user_metadata; no email fallback. D2 completions older than 30 days leave the lists. D3 list/category time totals removed. D4 S/M/L size in capture (typed > size > 30m). D5 Settings > Data purge of archived routine items and empty archived lists. D6 Notebook empty state loses its duplicate button." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
   git push origin main
   gh run list --workflow "Deploy to GitHub Pages" --limit 1
   ```
   - `git status --short` before the commit must show only the D1–D7 files under `src/` plus the untracked prompt (not staged).
   - Wait for the run to finish green. One `gh run rerun --failed` is allowed only for a GitHub-side 5xx pushing to `gh-pages` (chunk 78 rule). Anything else, stop.
7. **Gate from a clean archive.**
   ```bash
   NEW=$(git rev-parse --short HEAD)
   rm -rf /tmp/c86 && mkdir -p /tmp/c86/base /tmp/c86/head
   git archive 698bd24 | tar -x -C /tmp/c86/base
   git archive $NEW | tar -x -C /tmp/c86/head
   diff -rq /tmp/c86/base /tmp/c86/head
   cp .env.local /tmp/c86/head/
   cd /tmp/c86/head
   npm ci && npx tsc -b && npx eslint . && TZ=America/New_York npx vitest run && TZ=UTC npx vitest run && TZ=Asia/Tokyo npx vitest run && npm run build
   cd "/Users/sergiorios/Documents/To-Do Dashboard"
   ```
   Expect: `diff -rq` lists only the change-set `src/` files; all gates green in all three zones; same eager JS as Step 5. The `.env.local` needs the real `VITE_CALDAV_PROXY_URL` (CLAUDE.md, chunk 77).
8. **Live checks.**
   ```bash
   curl -s "https://smrios07mdb.github.io/dashboard/version.json?cb=$(date +%s)"
   ```
   Expect `$NEW` (re-check every 2 minutes, up to 10).

   **Smoke** with **Claude in Chrome** (Sergio's Chrome + extension), live site:
   1. Load the tools in one ToolSearch call. Open a new tab and bring it to the foreground; if `visibilityState` is `hidden`, ask Sergio to bring the window forward (expect the first click after that to be swallowed). Reload until `document.scripts` serves the same `index-*.js` as the live HTML (CLAUDE.md, chunk 77c). Arm `read_console_messages`.
   2. **Name (D1):** before saving, the hero heading has no `Smrios07` (bare greeting). Settings → Account → Name: type `Sergio`, Save → toast `Name saved`. Back on Tasks → heading ends `, Sergio`. Leave it set — this is Sergio's chosen end state.
   3. **Totals (D3):** on Tasks, no category header and no list header shows a time total; the Work drill-down header reads `N open` with no `·`; a list drill-down the same. Report the header texts.
   4. **Old completions (D2):** on Personal › General's drill-down (or the list with the most completions), report `Show N done` and, through Supabase REST (read-only), the count of that list's completions with `completed_at` within the last 30 days — they must match. On Tasks, report each list's `N completed` expander text.
   5. **Size (D4):** press `N`, type `Smoke-86 #personal`, press `L` (the `L · 1h` button), Enter → the row shows `1h`. Then `Smoke-86b 15m #personal`, press `M`, Enter → the row shows `15m`. Escape.
   6. **Notebook (D6):** if the Notebook has notes, use a same-origin check that the empty state is not reachable; otherwise count `New note` buttons on `/notebook` → exactly 1. Report which.
   7. **Archived items (D5), read-only:** Settings → Data → `Remove archived…` → report the dialog sentence verbatim, then **Cancel**. Do **not** confirm — the purge is Sergio's to run; record it as not run live.
   8. **Cleanup:** ⋯ → Delete on `Smoke-86` and `Smoke-86b`, wait 9 s, reload → 0 `Smoke-86` rows. No other task, note, list or routine item may be touched. `hup:captureDest` restored to its value before the smoke (record it in step 1).
   9. **Console:** report every entry verbatim; expect none.
9. **Docs** (D9), only if Steps 5–8 are all green:
   ```bash
   cd "/Users/sergiorios/Documents/To-Do Dashboard"
   git add ARCHITECTURE.md PROGRESS.md prompts/chunk-86-small-items.md
   git diff --cached --stat
   git commit -m "docs(chunk-86): UX audit #19; close chunk 86 [skip ci]" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
   git push origin main
   gh run list --workflow "Deploy to GitHub Pages" --limit 1
   curl -s "https://smrios07mdb.github.io/dashboard/version.json?cb=$(date +%s)"
   rm -rf /tmp/c86
   find .git -name '*.lock' -print
   git status --short
   ```
   Expect: no `src/` or `package.json` change in the docs commit; no new deploy run; `version.json` still `$NEW`; a clean tree and no locks.

## Out of scope

- Audit #4's archive-time choice (move / complete / delete open tasks when archiving a list) and #9's sizing of Today suggestions against free time — later chunks.
- Auto-archiving or deleting old completed tasks; they stay in the database.
- The Today panel's `to do · Xm`, per-row estimates, the Planner, Insights.
- `AddTaskInline`'s minutes field; `useCaptureShortcuts`.
- Any SQL, migration, RLS or realtime change.

## Report

Include:
- files changed + stat;
- red-first counts per file, naming non-guards;
- every existing test lookup changed, with the reason;
- the gate table on the Mac and from the clean archive (all three TZ test counts);
- eager JS base, head and delta;
- the deploy run ID and `version.json`;
- smoke results per item: the hero heading before and after, header texts, the done-count vs REST count, the two size rows, the Notebook button count, the purge dialog sentence, and every console entry;
- the docs commit SHA and stat;
- any deviations, with a reason each;
- the final `git status --short`.
