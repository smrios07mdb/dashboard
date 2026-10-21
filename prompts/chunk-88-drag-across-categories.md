# Claude Code prompt — Chunk 88: drag tasks across categories (Work ↔ Personal), onto a whole list, and on touch

You are Claude Code in `/Users/sergiorios/Documents/To-Do Dashboard` (`smrios07mdb/dashboard`). Base: `27cdb88` (docs). Code = `81f2e6b` (chunk 87), which is what's deployed. Authority: `ARCHITECTURE.md` → `prompts/README.md` → this prompt.

App code only: no SQL, no migration, no proxy, no new dependency, no `vite.config.ts` / `src/sw.ts` / workflow change. `realtime.ts`, the outbox and `repo.ts` are not touched. `lib/insights.ts` is not touched.

This prompt runs end to end: implement, ship, gate, smoke, docs. On any failure, stop at that point and report.

This chunk **reverses** two lines of ARCHITECTURE §13 "Drag affordance" (the Dashboard's one-`DndContext`-per-column rule and "desktop only"). That is intended: Sergio asked for it on 2026-10-21. Update ARCHITECTURE in Step 9; do not stop on the conflict.

## Why

Sergio: "Allow me to drag tasks from one category to another, not just by clicking buttons."

Verified against the source at `27cdb88`:
- **Work → Personal is impossible by drag.** `components/CategoryColumn.tsx` mounts its own `DndContext` (~L290), so a Work task only ever sees Work's droppables. ARCH §13 says so: "a task moves across categories only through Move to…".
- **The drop target is a thin strip.** `lib/taskDragCollision.ts` (chunk 63) counts a task drop only when the pointer is inside a `subdrop:<id>` droppable. That droppable is the **header** row only (`components/SubcategoryHeader.tsx` ~L125, `useDroppable({ id: 'subdrop:' + id, data: { type: 'subcategory', subcategoryId } })`). Dropping on a list's tasks does nothing.
- **Touch has no drag.** `components/TaskRow.tsx` ~L225 `canDrag = dragEnabled && !isTouch`. The grip is hidden on touch. Phones only get ⋯ → Move to….
- **Cross-column drag would be clipped.** The task row drags by its own `transform` (`useDraggable`, ~L323). The column card is `overflow-hidden rounded-md` (`CategoryColumn.tsx` ~L276; `CategoryView.tsx` ~L602), so a row dragged out of its column disappears under the edge.
- `CategoryView.tsx` (~L608) already has one `DndContext` with `collisionDetection={taskDragCollision}` and its own `handleDragEnd` (~L540) that duplicates `CategoryColumn`'s (~L172).
- `Dashboard.tsx` `onMoveTaskToSubcategory` (~L429) does `repo.tasks.update(id, { subcategoryId })`, `upsertTask`, `toast('Task moved')`. No undo. `CategoryView.tsx` has its own copy.
- Undo precedent: `lib/taskUndo.ts` `offerCompleteUndo` (~L182) — `toast(…, { duration: UNDO_MS, action: { label: 'Undo', onClick } })`, a `used` guard, `refresh()`, `console.error` + `toast.error(SAVE_ERROR)`.
- Header drop highlight today: `SubcategoryHeader.tsx` ~L167, `isOver ? 'bg-accent-soft ring-1 ring-inset ring-[hsl(var(--ring))]' : 'hover:bg-bg-alt/60'`.

## Decisions (locked)

- **D1 — One `DndContext` on the Dashboard.**
  - `CategoryColumn` loses its `DndContext`, its `sensors` and its `handleDragEnd`. It keeps its `SortableContext`, now with `id={`subs:${category.id}`}`.
  - `Dashboard.tsx` wraps the `.category-grid` (both columns) in one `DndContext` with the same sensors CategoryColumn used, `collisionDetection={taskDragCollision}`, and the handler from D3. The Today rail stays **outside** it.
  - `CategoryView.tsx` keeps its single context; its `SortableContext` gets the same `id={`subs:${category.id}`}`.
- **D2 — A drop lands on the whole list.**
  - The `subdrop:<id>` droppable moves from the header to the **whole subcategory section** (header + task rows + add-task row; when collapsed, just the header). Put it on an inner wrapper inside `SubcategorySection` (or the `SortableSubSection` wrappers in CategoryColumn / CategoryView — your call, one place only), **not** on the `useSortable` node. Same `id` and `data` as today.
  - `SubcategoryHeader` drops its `useDroppable` and its `isOver` styling. The section wrapper shows the highlight instead, with the same tokens: `bg-accent-soft ring-1 ring-inset ring-[hsl(var(--ring))]` while `isOver` and the drop would move the task (target ≠ the task's current list). Its own list shows no highlight.
  - `taskDragCollision` keeps `pointerWithin` over `subdrop:` containers (the chunk-63 fix stays: the pointer decides, not the row's rect). Gaps between sections, the category header and the space between columns stay no-ops.
- **D3 — One drop resolver, both screens.** In `lib/taskDragCollision.ts`:
  - `resolveTaskDrop(event: DragEndEvent): { taskId: string; toSubId: string } | null` — non-null only for a `task:` drag over a `subdrop:` target whose `subcategoryId` ≠ `active.data.current.currentSubcategoryId`.
  - `taskDragCollision`, for **non-task** drags (subcategory reorder), filters `droppableContainers` to those whose `data.current?.sortable?.containerId` equals the active's `data.current?.sortable?.containerId`, then `rectIntersection`. A list can never be reordered into the other category.
  - Dashboard and CategoryView `handleDragEnd`: `resolveTaskDrop` → `onMoveTaskToSubcategory(taskId, toSubId, { viaDrag: true })`; otherwise the existing subcategory reorder, unchanged, scoped to the active's own category.
- **D4 — Drag overlay, so the row is never clipped.**
  - Task drags render through `DragOverlay` mounted at the `DndContext` level (outside the `overflow-hidden` cards): a new `components/TaskDragGhost.tsx` showing the list's hue dot (`subColor(subcategoryId)`) + the task title, one line, truncated; `bg-surface`, `border border-line`, `rounded-md`, `shadow-md`; width = the source row's initial width capped at 420 px. `dropAnimation={null}`. Portal the overlay into `document.body` (`.category-cols` is a container-query element and would offset a fixed-position ghost).
  - While a task drags, the source `TaskRow` stops applying its own `transform` and renders at `opacity: 0.4`.
  - Subcategory reorder drags keep their current `useSortable` transform look; no overlay for them.
  - Pass what the ghost needs through `useDraggable`'s `data` (`title`, `subcategoryId`) — no task lookup in the overlay.
- **D5 — Touch can drag by the grip.**
  - `TaskRow`: `canDrag = dragEnabled` (drop `!isTouch`). The grip renders on touch too. On touch its hit area is ≥ 44×44 px (padding or a pseudo-element; the glyph stays its current size) and it has `touch-action: none`, `-webkit-user-select: none`, `-webkit-touch-callout: none`. Nothing else on the row gets `touch-action` changes, so scrolling on the row is untouched.
  - The grip stays out of the tab order (chunk 77). Keyboard moves stay ⋯ → Move to….
  - Sensors unchanged (`PointerSensor` distance 5, `TouchSensor` delay 200 / tolerance 5). dnd-kit `autoScroll` stays at its default (on) so a phone can drag from Work down to Personal.
  - `SubcategoryView` still passes `dragEnabled={false}`. Subcategory reorder handles stay desktop-only.
  - ⋯ → Move to… is unchanged everywhere.
- **D6 — A move says where it went, with Undo.**
  - New `offerMoveUndo(opts: { before: Task; toLabel: string; onRestored?: (t: Task) => void })` in `lib/taskUndo.ts`, modelled on `offerCompleteUndo`: toast `Moved to {toLabel}` with `Undo` for `UNDO_MS`; Undo runs `repo.tasks.update(before.id, { subcategoryId: before.subcategoryId })`, then `onRestored`, then `refresh()`; one-shot guard; errors → `console.error('Undo move failed', e)` + `toast.error(SAVE_ERROR)`.
  - `toLabel`: `{Category} › {List}` when the category changes, else `{List}`.
  - Both `onMoveTaskToSubcategory` copies (Dashboard, CategoryView) use it for **every** move (drag and Move to…), replacing `toast('Task moved')`. The `viaDrag` option exists only so the call sites read the same; it does not change behaviour.
  - If the task's previous list has been archived by the time Undo runs, Undo still writes it back (it will surface in the Recovered card). No extra guard.
- **D7 — Tests, red-first against `27cdb88`.**
  1. `lib/taskDragCollision.test.ts`:
     - `resolveTaskDrop`: task over another list's `subdrop:` → `{ taskId, toSubId }`; over its own list → `null`; over nothing → `null`; a non-task drag → `null`.
     - Collision: pointer inside a **section's** rect below its header row → that `subdrop:`; pointer in the gap between two columns → `[]`.
     - Reorder collision ignores containers from another `subs:<categoryId>` container.
  2. `screens/Dashboard.test.tsx`: both columns sit inside **one** `DndContext`. Drive `onDragEnd` (export the handler or test through `resolveTaskDrop` + a spy, whichever the existing tests make cleaner) with a Work task over a Personal list → `repo.tasks.update` called with the Personal `subcategoryId`; a Work list reordered over a Personal list → no `subcategories` reorder call.
  3. `components/CategoryColumn.test.tsx`: the column renders no `DndContext` of its own (it renders under a parent context in the test wrapper); the existing chunk 68/75/76 cases still pass.
  4. `components/TaskRow.test.tsx`: with `(hover: none)` mocked true, the grip renders, has `touch-action: none`, and drag listeners are attached; with `dragEnabled={false}` no grip.
  5. `components/SubcategorySection.test.tsx` (or the closest existing test): the section wrapper carries the droppable (`isOver` true → highlight classes on the wrapper, not the header); own list → no highlight.
  6. `lib/taskUndo.test.ts`: `offerMoveUndo` toasts `Moved to Personal › General`; Undo patches the old `subcategoryId` once (second click no-op); a failing update → `toast.error`.
  7. `TaskDragGhost` renders the title and the hue dot.
  - **Red-first:** restore every non-test source in the change set from `27cdb88` (new tests kept). Run the touched test files in `TZ=America/New_York`. Report fail/pass per file, and name every new case that passes at base as not a regression guard. Restore the tree and confirm `git status --short` matches the change set.
  - **Existing expectations:** list each changed lookup with the reason (e.g. `Task moved` → `Moved to …`, D6; header-level `isOver` → section-level, D2). No other expectation may change.
- **D8 — Budget.** Eager JS delta ≤ **+6,300 B**, measured the chunk-79 way. *(Amended 2026-10-21 from +1,500 B: `DragOverlay` was tree-shaken out at base and costs ~4,161 B on its own; the rest of the chunk ~2,086 B. Measured head 1,058,702 B vs base 1,052,455 B = +6,247 B.)* Record base on the Mac in Step 2. Report test count and file count before/after.
- **D9 — Docs scope** (Step 9 only, after gate and smoke):
  - `PROGRESS.md`: row 88, Last-updated, decisions log D1–D6 (one row each). Known gaps:
    - **Touch drag (D5) is unit-test-only and unverified on a real iPhone.** Record it as unverified; do not ask Sergio to check it.
    - Drop into the Today rail, the Planner tray or a list's drill-down (`SubcategoryView`) is not supported.
  - `ARCHITECTURE.md` §13 "Drag affordance": replace the "desktop only", "Drop target (chunk 63)", "Changing category" and "Mobile/touch uses three-dot menu" lines with:
    - Dashboard: one `DndContext` over both columns; tasks drag across categories. Category drill-down: one context.
    - Drop target: the whole list section (`subdrop:<id>`), pointer-based (`pointerWithin`); gaps are no-ops.
    - Task drags render a `DragOverlay` ghost; list reorder stays inside its own category (`subs:<categoryId>`).
    - Touch: drag by the grip (≥ 44 px, `touch-action: none`); ⋯ → Move to… stays everywhere and is the keyboard path.
    - Every move toasts `Moved to …` with Undo.
  - Update the CategoryColumn file-header comment ("cross-category drag is chunk 9's job") and the TaskRow header comment ("Touch devices hide the grip…").
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
   Expect: no `.lock` files (delete any and re-run); HEAD `27cdb88`; only `?? prompts/chunk-88-drag-across-categories.md` untracked. If the prompt file is not on disk, write it from this prompt and say so.
2. **Base on the Mac.**
   ```bash
   npm ci && npm run build
   TZ=America/New_York npx vitest run 2>&1 | tail -5
   ```
   Record base eager JS (bytes, file count) and the test/file counts.
3. **Tests red-first** (D7).
4. **Implement** D1–D6.
5. **Gates** (Mac):
   ```bash
   npm ci && npx tsc -b && npx eslint . && TZ=America/New_York npx vitest run && TZ=UTC npx vitest run && TZ=Asia/Tokyo npx vitest run && npm run build
   git diff --stat 27cdb88 -- package.json package-lock.json
   ```
   Expect: all green in all three zones; `package.json` / lockfile diff empty; eager JS within D8.
6. **Ship the code alone.** Push without `[skip ci]`:
   ```bash
   git add src
   git status --short
   git commit -m "feat: drag tasks across categories, onto a whole list, and by the grip on touch (chunk 88)" -m "D1 one DndContext over both Dashboard columns. D2 subdrop droppable moves from the header to the whole list section; pointerWithin kept. D3 resolveTaskDrop shared by Dashboard and CategoryView; list reorder scoped to its own category. D4 DragOverlay ghost so rows are never clipped. D5 touch drags by a 44px grip with touch-action none. D6 every move toasts Moved to ... with Undo." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
   git push origin main
   gh run list --workflow "Deploy to GitHub Pages" --limit 1
   ```
   - `git status --short` before the commit must show only the D1–D7 files under `src/`, plus the untracked prompt (not staged).
   - Wait for the run to finish green. One `gh run rerun --failed` is allowed only for a GitHub-side 5xx pushing to `gh-pages` (chunk 78 rule). Anything else, stop.
7. **Gate from a clean archive.**
   ```bash
   NEW=$(git rev-parse --short HEAD)
   rm -rf /tmp/c88 && mkdir -p /tmp/c88/base /tmp/c88/head
   git archive 27cdb88 | tar -x -C /tmp/c88/base
   git archive $NEW | tar -x -C /tmp/c88/head
   diff -rq /tmp/c88/base /tmp/c88/head
   cp .env.local /tmp/c88/head/
   cd /tmp/c88/head
   npm ci && npx tsc -b && npx eslint . && TZ=America/New_York npx vitest run && TZ=UTC npx vitest run && TZ=Asia/Tokyo npx vitest run && npm run build
   cd "/Users/sergiorios/Documents/To-Do Dashboard"
   ```
   Expect: `diff -rq` lists only the change-set `src/` files; all gates green in all three zones; same eager JS as Step 5. `.env.local` needs the real `VITE_CALDAV_PROXY_URL` (CLAUDE.md, chunk 77).
8. **Live checks.**
   ```bash
   curl -s "https://smrios07mdb.github.io/dashboard/version.json?cb=$(date +%s)"
   ```
   Expect `$NEW` (re-check every 2 minutes, up to 10).

   **Smoke** with **Claude in Chrome** (Sergio's Chrome + extension), live site, desktop width (both columns side by side). Use Supabase MCP `execute_sql` for read-only checks and the step-6 cleanup only. Confirm with Sergio that no other session is running a smoke (CLAUDE.md, chunk 43). Drags use the synthesized-pointer pattern from CLAUDE.md "Smoke harness notes": `pointerdown` on the grip + ≥ 20 `pointermove`s in one `javascript_tool` call, read the state in the next call (one tick late), `pointerup` in its own call; wrap every snippet in an IIFE; assert `window.scrollY` and re-read `getBoundingClientRect()` right before dispatching.
   1. Load the tools in one ToolSearch call. Open a new tab and bring it to the foreground. If `visibilityState` is `hidden`, ask Sergio to bring the window forward and expect the first click to be swallowed. Reload until `document.scripts` serves the same `index-*.js` as the live HTML (CLAUDE.md, chunk 77c). Arm `read_console_messages` and `read_network_requests`. Record `hup:captureDest`.
   2. **Fixtures:** in **Work › General** add `Smoke-88a` and `Smoke-88b`. `execute_sql`: record their ids and `subcategory_id`, and the id of **Personal › General** (or the first live Personal list; name it in the report).
   3. **Cross-category drag onto a list body (D1/D2/D4):** drag `Smoke-88a`'s grip to a point inside the Personal list's **task area, below its header**. Before `pointerup`, report: the ghost element exists outside the column card and is fully inside the viewport (its rect vs. the column card's rect); the Personal section carries the highlight classes; the Work header does not. After `pointerup`: toast `Moved to Personal › General` (verbatim); the row shows under Personal; `execute_sql` shows the new `subcategory_id`; the network log shows exactly one task `PATCH`.
   4. **Undo (D6):** click `Undo` on that toast → `Smoke-88a` is back in Work › General (`execute_sql` confirms).
   5. **No-ops (D2/D3):** drag `Smoke-88b` and release (a) in the gap between the two columns, (b) on its own list. Each: no toast, no `PATCH` in the network log, `subcategory_id` unchanged. Then drag a **Work list's** reorder handle over a Personal list and release: the list order in both columns is unchanged after reload, and no `subcategories` write appears in the network log.
   6. **Category drill-down (D2):** open the Work drill-down, drag `Smoke-88b` into another Work list's body → toast `Moved to {List}` (no category prefix). Note the list.
   7. **Cleanup:**
      - ⋯ → Delete on both `Smoke-88` tasks, wait 9 s.
      - `execute_sql`: `delete from tasks where title like 'Smoke-88%'`; report the row count (expect 0 if the deletes committed, else 2).
      - Reload → 0 `Smoke-88` rows anywhere.
      - `hup:captureDest` is back to its step-1 value; restore it if a task add changed it.
      - No other task, list, note or routine item may be touched; list sort orders must equal their step-1 values (`execute_sql` on `subcategories` `id, sort_order` before and after).
   8. **Touch (D5):** not smokeable on prod (the CSP blocks the page-world `matchMedia` patch). Record "unit-test-only, unverified on device" — do not ask Sergio.
   9. **Console:** report every entry verbatim; expect none.
9. **Docs** (D9), only if Steps 5–8 are all green:
   ```bash
   cd "/Users/sergiorios/Documents/To-Do Dashboard"
   git add ARCHITECTURE.md PROGRESS.md prompts/chunk-88-drag-across-categories.md
   git diff --cached --stat
   git commit -m "docs(chunk-88): drag across categories, whole-list drop, touch grip, move undo; close chunk 88 [skip ci]" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
   git push origin main
   gh run list --workflow "Deploy to GitHub Pages" --limit 1
   curl -s "https://smrios07mdb.github.io/dashboard/version.json?cb=$(date +%s)"
   rm -rf /tmp/c88
   find .git -name '*.lock' -print
   git status --short
   ```
   Expect: no `src/` or `package.json` change in the docs commit; no new deploy run; `version.json` still `$NEW`; a clean tree and no locks.

   (The comment-only edits in D9 to `CategoryColumn.tsx` / `TaskRow.tsx` belong in the **code** commit in Step 6, not here.)

## Out of scope

- Dropping onto the Today rail, the Planner, a list's drill-down (`SubcategoryView`), or a category header.
- Reordering tasks within a list (there is no manual task order).
- Moving a whole list to the other category by drag.
- Keyboard drag (`KeyboardSensor`). Keyboard stays ⋯ → Move to….
- Any SQL, migration, RLS or realtime change.

## Report

Include:
- files changed + stat;
- red-first counts per file, naming non-guards;
- every existing test lookup changed, with the reason;
- the gate table on the Mac and from the clean archive (all three TZ test counts);
- eager JS base, head and delta;
- the deploy run ID and `version.json`;
- smoke results per item: ghost vs. card rects, highlight classes, each toast verbatim, `PATCH` counts, SQL results, sort orders before/after, cleanup counts, every console entry;
- the docs commit SHA and stat;
- any deviations, with a reason each;
- the final `git status --short`.
