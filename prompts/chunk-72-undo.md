# Chunk 72: Undo for delete and complete (UX audit #13)

**Runs on:** Claude Code, in `~/Documents/To-Do Dashboard` on Sergio's Mac (repo `smrios07mdb/dashboard`). You write the code and the tests. App code only: no SQL, no migration, no proxy, no new dependency.

**Bases:**
- App `smrios07mdb/dashboard` @ `c1aeee6` (docs). Last code commit `4fdac3e` (chunk 71), which is what's live.
- Proxy untouched.

**Authority:** `ARCHITECTURE.md` → `prompts/README.md` → this prompt. Read first: `CLAUDE.md`, `prompts/README.md`, `src/db/repo.ts` (`tasksRepo`: `list`, `listBySubcategory`, `listIncomplete`, `listCompletedInRange`, `delete`, `bulkDelete`, `markComplete`, `bulkUpdate`), `src/db/outbox.ts`, `src/screens/Dashboard.tsx` (`onCompleteTask`, `onDeleteTask`, the combo counter, `RecoveredTasks` and Today wiring), `src/screens/CategoryView.tsx`, `src/screens/SubcategoryView.tsx` (`onCompleteTask`, `onDeleteTask`, `onBulkComplete`, `onBulkDelete`, the bulk bar's `DeleteConfirm`), `src/components/TaskMenu.tsx`, `src/components/DeleteConfirm.tsx`, `src/components/ProtectedLayout.tsx`, `src/state/uiStore.ts` (`forceDashboardRefresh`), `src/App.tsx` (the sonner `Toaster`), `src/screens/Planner.tsx` (how a block whose task is missing renders), `src/components/TaskRow.test.tsx`, and `supabase/migrations/10_scheduled_blocks.sql`, `16_notes.sql`, `20_today_marks.sql` (what a task delete cascades to).

**Scope:** UX audit 2026-10-13 (`ux-audit-2026-10-13.md` in the Claude project), finding 13. Nothing else from the audit.

---

## The problem, as committed at `c1aeee6`

- **Delete:** ⋯ → Delete and the Subcategory bulk bar's `Delete N` each open a "This cannot be undone." confirm, then hard-delete at once. The delete cascades server-side: the task's `scheduled_blocks` row (and through the planner mirror its Apple Calendar event) and its `today_marks` row go, and its notes are detached. Nothing can be restored.
- **Complete:** checking a task off has no undo except finding it in the collapsed "N completed" section. Bulk complete is the same.

---

## Locked decisions (Sergio, 2026-10-13)

### D1 Deferred delete, not soft-delete

- A task delete hides the task at once and runs the real `repo.tasks.delete` / `bulkDelete` **6 s later** unless Undo is pressed. Until then nothing is written anywhere, so Undo restores the task with its block, calendar event, Today mark and note links untouched.
- No migration, no `deleted_at` column, no Trash view.

### D2 One module owns the pending window: `src/lib/taskUndo.ts` (new)

Pure TypeScript plus `sonner` and the stores; no React.

```ts
export const UNDO_MS = 6000

/** Hide `tasks` now; hard-delete them after UNDO_MS unless undone. */
export function deleteTasksWithUndo(opts: {
  tasks: Task[]                      // the full rows, kept for restore
  onRestore?: (tasks: Task[]) => void // re-insert into the calling screen's state
}): void

/** Toast "Task completed" / "N tasks completed" with Undo after a successful complete. */
export function offerCompleteUndo(opts: {
  before: Task[]                     // the rows as they were before the complete
  onRestored?: (tasks: Task[]) => void
}): void

export function isPendingDelete(id: string): boolean
export function withoutPendingDeletes<T extends { id: string }>(rows: T[]): T[]
export function flushPendingDeletes(): void        // commit everything now (pagehide)
export function resumePendingDeletes(): void       // commit leftovers from storage (startup)
```

Rules:
- **Pending set:** a module-level `Map<id, { at: number }>`. Mark ids pending **before** any await (the chunk-43–50 guard-before-await rule). An id already pending is ignored, so a double delete commits once.
- **Timer, not toast:** the commit runs from the module's own `setTimeout(UNDO_MS)`, never from sonner's `onAutoClose` / `onDismiss`. Closing the toast with its ✕ does not commit early or cancel.
- **Commit:** one `repo.tasks.bulkDelete(ids)` per scheduled batch (one id → still fine). On success: drop the ids from the pending set and from storage. `repo` already handles offline (outbox). On a thrown client error: drop them, `toast.error('Could not save — retry.')`, and call `useUIStore.getState().forceDashboardRefresh()` so the task reappears.
- **Undo:** clear the timer, drop the ids from the pending set and from storage, call `onRestore(tasks)` if given, then `forceDashboardRefresh()`. Nothing is written to Supabase or Dexie.
- **Storage:** mirror the pending map synchronously to `localStorage['hup:pendingTaskDeletes']` as `[{ id, at }]`, every read/write in `try/catch`. Seed the in-memory map from it at module load, so lists filter leftovers before anything else runs.
- **`flushPendingDeletes`:** cancel every timer and commit every pending id now (fire-and-forget); storage is cleared only when that commit resolves.
- **`resumePendingDeletes`:** for each stored entry, commit at `max(0, at + UNDO_MS − now)`. No toast; Undo is not offered for leftovers.
- **Toast copy:** delete — `Task deleted` / `N tasks deleted`; complete — `Task completed` / `N tasks completed`. Both `toast(text, { duration: UNDO_MS, action: { label: 'Undo', onClick } })`.

### D3 Lists hide pending deletes at the repo

- `tasksRepo.list`, `listBySubcategory`, `listIncomplete` and `listCompletedInRange` return `withoutPendingDeletes(rows)` on both the online and the fallback path. The Dexie cache keeps the row; only the returned array is filtered.
- So a screen loaded during the 6 s (CategoryView, SubcategoryView, Planner, What's next, Notebook, Insights) never shows the task. No screen adds its own filter.
- Planner: a block whose task is filtered out must render nothing and write nothing (confirm from the source; if it would write, stop and report).

### D4 Delete entry points

- **`TaskMenu`:** ⋯ → Delete becomes a plain `DropdownMenuItem` (Trash icon, destructive text) whose `onSelect` calls `onDelete`. `DeleteConfirm` and its import leave `TaskMenu`. Update the header comment.
- **Single delete** in Dashboard, CategoryView and SubcategoryView: `onDeleteTask(id)` removes the task from screen state (and, in SubcategoryView, from the selection), then `deleteTasksWithUndo({ tasks: [task], onRestore })`. The old `toast('Task deleted')` goes; the module's toast replaces it.
- **Bulk delete** (SubcategoryView): the bulk bar's `DeleteConfirm` is removed — `Delete N` is a plain button calling `onBulkDelete`, which removes the selected tasks from state, clears the selection, then `deleteTasksWithUndo({ tasks, onRestore })`.
- `onRestore` re-inserts the held rows into that screen's `data.tasks` (by id, no duplicates) while the screen is mounted.
- **Unchanged:** subcategory delete (`DeleteSubcategoryDialog`, including "delete with its tasks"), routine-item, note and Developer-section deletes keep their confirms; `sample-data.ts` keeps its direct delete. `DeleteConfirm` itself is unchanged.

### D5 Complete entry points

- Dashboard, CategoryView and SubcategoryView `onCompleteTask(id, completed)`: when `completed` is true and the write succeeds, call `offerCompleteUndo({ before: [taskBeforeWrite], onRestored })`. Unchecking (`completed === false`) shows no toast.
- Undo for a single complete calls `repo.tasks.markComplete(id, false)` and upserts the result. This covers the Dashboard rows, the Today panel (it calls Dashboard's `onCompleteTask`) and the Recovered card (same handler).
- **Bulk complete** (SubcategoryView): after the write, `offerCompleteUndo({ before })` replaces the existing `N tasks completed` toast. Undo calls `repo.tasks.bulkUpdate` restoring each task's own prior `completedAt` (`null` for open ones; a task that was already complete keeps its old stamp).
- A failed Undo write: `toast.error('Could not save — retry.')`, state left as the server has it.
- **Unchanged:** the Planner block check-off, the completion celebration (+XP floater, row flush), the combo counter. Undo does not reverse the floater; XP and counts recompute from data.

### D6 App lifecycle

- `ProtectedLayout`: once a user is present, call `resumePendingDeletes()` once per mount, and add a `pagehide` listener that calls `flushPendingDeletes()` (removed on unmount).
- No `visibilitychange` flush: backgrounding the PWA must not cancel the chance to Undo on return. A killed app is covered by `resumePendingDeletes` on the next start.

### D7 What does not change

- `DeleteConfirm`, `DeleteSubcategoryDialog`, `RoutinePanel`, `NoteEditor`, `Settings`, `DeveloperSection`.
- `src/db/outbox.ts`, `src/db/realtime.ts`, `repo.tasks.delete` / `bulkDelete` / `markComplete` / `bulkUpdate` bodies, `lib/today.ts`, `state/todayPlan.ts`, `lib/plannerCalendarMirror.ts`, `Planner.tsx`.
- `TaskRow` (chunk 71) and its props.
- `package.json` / `package-lock.json`.

### D8 Tests (you write them)

**`src/lib/taskUndo.test.ts`** (new), fake timers, `repo` and `sonner` mocked, `localStorage` cleared per test:
1. `deleteTasksWithUndo` with one task: `isPendingDelete` true at once; `bulkDelete` not called at 5,999 ms; called once with `[id]` at 6,000 ms; pending and storage cleared after.
2. Undo at 3 s: `bulkDelete` never called (advance to 10 s); `onRestore` called with the row; `forceDashboardRefresh` called; storage cleared.
3. The same id deleted twice inside the window → one `bulkDelete` call.
4. Two tasks in one call → one `bulkDelete` with both ids; one toast reading `2 tasks deleted`.
5. `bulkDelete` rejects with a client error → pending cleared, `toast.error` called, `forceDashboardRefresh` called.
6. Closing the toast (sonner `onDismiss`) neither commits nor cancels: commit still lands at 6 s.
7. `flushPendingDeletes` at 2 s → `bulkDelete` called immediately; nothing further at 6 s.
8. Storage seeded with `{ id: 'a', at: now − 10 s }` and `{ id: 'b', at: now − 2 s }` before module load (`vi.resetModules` + dynamic import): both `isPendingDelete` true; `resumePendingDeletes` commits `a` at once and `b` at 4 s.
9. `withoutPendingDeletes` drops exactly the pending ids.
10. `offerCompleteUndo` with one open task: toast `Task completed` with an Undo action; Undo → `markComplete(id, false)` and `onRestored` with its result.
11. `offerCompleteUndo` with two tasks, one previously complete (`completedAt` X): Undo → one `bulkUpdate` restoring `null` and X respectively.

**`src/db/repo.test.ts`** (existing): one test that `tasksRepo.list()` omits a pending id on the fallback path and on the online path.

**Screens** (add to the existing `src/screens/Dashboard.test.tsx` and `src/screens/SubcategoryView.test.tsx`):
- Dashboard: ⋯ → Delete removes the row with **no** `alertdialog`; a `Task deleted` toast with `Undo` shows; clicking Undo brings the row back and `repo.tasks.bulkDelete` / `delete` is never called.
- Dashboard: checking a row off shows `Task completed` with Undo; Undo calls `markComplete(id, false)`; unchecking shows no toast.
- SubcategoryView: select two → `Delete 2` removes both with no `alertdialog`; `2 tasks deleted` toast; Undo restores both.
- SubcategoryView: bulk complete → `2 tasks completed` toast; Undo calls `bulkUpdate` with the prior `completedAt` values.

**`src/components/TaskRow.test.tsx`:** replace `(6) ⋯ → Delete still shows the confirm` with `(6) ⋯ → Delete calls onDelete with no confirm` (no `alertdialog`, `onDelete` called once). One-line comment naming chunk 72. Keep every other test as is.

Any other existing lookup that breaks only because the confirm is gone or a toast's text changed: change only that lookup, with a one-line comment naming chunk 72. List them.

**Red-first:** with everything written, restore the source files from `c1aeee6` (delete `taskUndo.ts` for the run) and run only the new/changed test files:

```bash
mkdir -p "$TMPDIR/c72"
for f in src/db/repo.ts src/components/TaskMenu.tsx src/components/ProtectedLayout.tsx src/screens/Dashboard.tsx src/screens/CategoryView.tsx src/screens/SubcategoryView.tsx; do mkdir -p "$TMPDIR/c72/$(dirname $f)"; cp "$f" "$TMPDIR/c72/$f"; git show c1aeee6:$f > "$f"; done
mkdir -p "$TMPDIR/c72/src/lib"; mv src/lib/taskUndo.ts "$TMPDIR/c72/src/lib/taskUndo.ts"
npx vitest run src/lib/taskUndo.test.ts src/db/repo.test.ts src/components/TaskRow.test.tsx src/screens/Dashboard.test.tsx src/screens/SubcategoryView.test.tsx
for f in src/db/repo.ts src/components/TaskMenu.tsx src/components/ProtectedLayout.tsx src/screens/Dashboard.tsx src/screens/CategoryView.tsx src/screens/SubcategoryView.tsx src/lib/taskUndo.ts; do cp "$TMPDIR/c72/$f" "$f"; done
git status --short
```

Adjust both file lists to what you actually changed and created, and add any other test file you changed to the `vitest run` line. Report pass/fail counts per test file, and name every new test that passes against the old code (say so; don't count them as guards). The final `git status --short` must match your change set exactly.

### D9 Commit routing

- **One code commit**, pushed **alone**, **no `[skip ci]`**. Expected files: `src/lib/taskUndo.ts`, `src/lib/taskUndo.test.ts`, `src/db/repo.ts`, `src/db/repo.test.ts`, `src/components/TaskMenu.tsx`, `src/components/ProtectedLayout.tsx`, `src/screens/Dashboard.tsx`, `src/screens/CategoryView.tsx`, `src/screens/SubcategoryView.tsx`, `src/components/TaskRow.test.tsx`, `src/screens/Dashboard.test.tsx`, `src/screens/SubcategoryView.test.tsx`, plus any test file whose lookups D8 lets you change. Anything else: stop and report before committing.
- Subject: `Chunk 72: Undo for delete and complete (UX audit #13)`.
- Gates before the push, on a clean `npm ci`: `tsc -b` clean; `eslint .` 0 problems; `vitest run` all green; `TZ=UTC npx vitest run` all green; `npm run build` green.
- Base figures at `c1aeee6` (orchestrator, cloud container, Node 22, clean clone, placeholder `.env.local` including `VITE_CALDAV_PROXY_URL`): `vitest run` **940 / 940** in **85** files in `UTC`, `America/New_York` and `America/Los_Angeles`; eager JS **1,039,815 B** (your Mac measured **1,040,822 B** at the same code). Report your own base on the Mac and your after.
- Eager JS limit: **+3 kB**.
- After the push: deploy run id and result; live `version.json` read cache-busted.

---

## Sequence

### 1. Code (Claude Code, Sergio's Mac)

```bash
cd ~/Documents/To-Do\ Dashboard
git fetch origin
git checkout main
git pull --ff-only origin main
git log -1 --oneline
```

Expect `c1aeee6`. If `main` is anywhere else, stop and report.

```bash
rm -rf node_modules
npm ci
npx vitest run
npm run build
python3 -c "import re,os;h=open('dist/index.html').read();f=set(re.findall(r'(?:src|href)=\"/dashboard/(assets/[^\"]+\.js)\"',h));print(len(f),sum(os.path.getsize('dist/'+x) for x in f))"
```

Record the base. Implement D1–D7, write the D8 tests, run red-first. Then:

```bash
npx tsc -b
npx eslint .
npx vitest run
TZ=UTC npx vitest run
npm run build
python3 -c "import re,os;h=open('dist/index.html').read();f=set(re.findall(r'(?:src|href)=\"/dashboard/(assets/[^\"]+\.js)\"',h));print(len(f),sum(os.path.getsize('dist/'+x) for x in f))"
git diff --stat c1aeee6 -- package.json package-lock.json
git add src/lib/taskUndo.ts src/lib/taskUndo.test.ts src/db/repo.ts src/db/repo.test.ts src/components/TaskMenu.tsx src/components/ProtectedLayout.tsx src/screens/Dashboard.tsx src/screens/CategoryView.tsx src/screens/SubcategoryView.tsx src/components/TaskRow.test.tsx src/screens/Dashboard.test.tsx src/screens/SubcategoryView.test.tsx
git status --short
git commit
git push origin main
```

Add any other test file you changed under D8 to the `git add` line. `git status --short` after `git add` must show only the D9 files staged. The commit body lists D1–D6 in one line each and ends with the `Co-Authored-By` trailer per `CLAUDE.md`.

**Stop after the push and report.** Do not write docs. Do not run the smoke.

### 2. Gate + smoke (orchestrator, not you)

Gate: clean clone at your SHA in the cloud container — scope diff against `c1aeee6`, `tsc -b`, `eslint .`, `vitest run` in three zones, build, eager JS, deployed CSS hash match, chunk-72 markers in the deployed JS (`hup:pendingTaskDeletes`, `tasks deleted`, `tasks completed`), live `version.json`.

Smoke: deployed app in Sergio's Chrome via the Claude in Chrome extension. Writes are limited to **one throwaway task, `Smoke-72`**, created in Personal › General and removed at the end; no other task is touched.
- Create `Smoke-72`. Check it off → `Task completed` toast with Undo → Undo → the row is open again; Supabase `tasks` row has `completed_at` null.
- ⋯ → Delete → no confirm dialog; the row disappears; `Task deleted` toast with Undo → Undo → the row returns; Supabase row still present throughout.
- ⋯ → Delete again, open the Work category during the window → `Smoke-72` absent there too; wait 8 s → Supabase row gone; `localStorage['hup:pendingTaskDeletes']` empty.
- ⋯ on any other task still lists Move to, Set priority…, Set due date…, Set reminder…, Block time, Notes / Add a note, Delete (opened and closed with Escape, nothing chosen).
- Console clean.

### 3. Docs (`[skip ci]`, after the orchestrator's gate and smoke pass)

**`ARCHITECTURE.md` §13**
- Append: "Undo (chunk 72): deleting a task — ⋯ → Delete or the Subcategory bulk bar — has no confirm. The task hides at once and is hard-deleted 6 s later unless Undo is pressed in the toast; until then nothing is written, so Undo restores its planner block, calendar event, Today mark and notes untouched. `lib/taskUndo.ts` owns the window: pending ids are filtered out of every `repo.tasks` list, mirrored to `localStorage['hup:pendingTaskDeletes']`, committed on `pagehide`, and leftovers are committed on the next start. Completing a task (rows, Today panel, Recovered card, bulk) shows the same 6 s Undo, which restores the prior `completedAt`. Subcategory, routine-item and note deletes keep their confirms; the Planner check-off has no Undo."

**`PROGRESS.md`**
- Row 72 ☑: the step-1 SHA, gates (both runner zones), red-first counts, test count and file count, eager JS before/after, deploy run, live `version.json`, the orchestrator's gate and smoke result, changed lookups, deviations numbered.
- Decisions log: D1–D6 (2026-10-13, chunk 72), one row each. D1's row states that deferred delete was chosen over a soft-delete column.
- Last-updated paragraph per the chunk-54 convention; the chunk-71 paragraph moves to Update history, relabelled `Prior update:` (prefix only).

Commit this prompt as `prompts/chunk-72-undo.md` in the same commit. If row 72 must name the docs SHA, record it in an immediate `[skip ci]` follow-up (chunk-54 convention).

---

## Out of scope

- Soft-delete column, Trash view, undo for subcategory / routine / note deletes.
- Undo on the Planner block check-off; undo for move, priority, due, reminder or edits.
- A keyboard shortcut for Undo.
- Capture and search (#7), row age (#10), contrast tokens (#14), row as a single tab stop (#16).

## Report back

- **Step 1:** commit SHA; `git diff --stat c1aeee6 <SHA>`; gates (`tsc -b`, `eslint .`, test count and file count in both runner zones, build); red-first counts and the non-guard tests named; eager JS before / after / delta; the empty `package.json` diff; deploy run id and result; live `version.json`.
- What the Planner does with a block whose task is pending delete (D3), from the source.
- Existing test lookups you changed, listed.
- Anything you built that departs from D1–D8, and why.
- Every deviation, numbered.
