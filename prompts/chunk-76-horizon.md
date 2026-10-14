# Chunk 76: Near term / Long term — a horizon filter on every list

**Runs on:** Claude Code, in `~/Documents/To-Do Dashboard` on Sergio's Mac (repo `smrios07mdb/dashboard`). You write the code and the tests. App code only: no SQL, no migration, no proxy, no new dependency, no new column.

**Bases:**
- App `smrios07mdb/dashboard` @ `57e1c8f` (chunks 75 + 75a docs, `[skip ci]`). Last code commit `cfef25b` (chunk 75a), which is what's live and gate-verified. `57e1c8f` → `f8cdf4a` → `cfef25b` are docs-only on top of that code.
- Proxy untouched.

**Authority:** `ARCHITECTURE.md` → `prompts/README.md` → this prompt. Read first:
- `CLAUDE.md`, `prompts/README.md`.
- `src/lib/taskSort.ts` and `src/components/TaskSortControl.tsx` (the global-preference pattern this chunk copies).
- `src/lib/taskAge.ts` and `src/lib/whenLabel.ts` (the calendar-day math), `src/lib/clock.ts` (`dateKeyIn`).
- `src/components/SubcategorySection.tsx` (`visibleIncomplete`, the linger set, the three empty states) and its test.
- `src/components/CategoryColumn.tsx` (header: pill, total, sort control) and its test.
- `src/screens/Dashboard.tsx`, `src/screens/CategoryView.tsx`, `src/screens/SubcategoryView.tsx` (where `sortKey` is held and threaded) and their tests.
- `src/components/PriorityChip.tsx` (the P1/P2/P3 semantics live in `taskSort.ts`'s header comment).

**Scope:** one feature from lived use (2026-10-13): Sergio wants to shuffle the Work and Personal lists by near term vs long term. Nothing else.

---

## The problem, as committed at `cfef25b`

Every list shows every open task, in one sort order. There is no way to look at only what's close, or only what's far. Adding a third list is the wrong shape: a task is still Work or Personal; "near" or "long" is a second axis on the same task.

## What already exists, and why there is no new column

- `tasks.priority` is `1` Urgent / `2` Soon / `3` Whenever / `null` (chunk 33). That is already the manual lever for "how soon".
- `tasks.due_at` and `tasks.remind_at` already carry dates (chunks 61, 66, 71).

So the horizon is **derived**, never stored: a task is near term when its priority or its dates say so; everything else is long term. No migration, no picker, no row chip. If lived use shows priority isn't enough, a stored override is a later chunk.

---

## Locked decisions (orchestrator, 2026-10-13)

### D1 Derivation: `src/lib/horizon.ts` (new)

Pure TypeScript: no React, no storage. `now` is always passed in or defaulted.

```ts
import type { Task } from '@/db/types'

export type Horizon = 'near' | 'long'
export type HorizonFilter = 'near' | 'long' | 'all'

/** A due date or reminder this many calendar days out, or less, is near term. */
export const NEAR_TERM_DAYS = 14

/** Whole calendar days from now's day to iso's day in timeZone; null if iso does not parse. */
export function daysFromNow(iso: string, timeZone: string, now?: Date): number | null

/** Near when P1/P2, or when due or reminder is within NEAR_TERM_DAYS (past days count). Otherwise long. */
export function taskHorizon(task: Task, timeZone: string, now?: Date): Horizon

/** Identity for 'all'; otherwise the open rows whose horizon matches. */
export function filterByHorizon<T extends Task>(tasks: T[], filter: HorizonFilter, timeZone: string, now?: Date): T[]

export const HORIZON_STORAGE_KEY = 'hupo.taskHorizon'
export const DEFAULT_HORIZON: HorizonFilter = 'all'
export const HORIZON_OPTIONS: { value: HorizonFilter; label: string }[]  // Near · Long · All, in that order

export function loadHorizonFilter(): HorizonFilter   // localStorage[HORIZON_STORAGE_KEY]; DEFAULT_HORIZON on any throw or bad value
export function storeHorizonFilter(f: HorizonFilter): void  // swallows any throw
```

- **Day math:** the `taskAge.ts` frame. `dateKeyIn(iso, timeZone)` and `dateKeyIn(now, timeZone)` → `Date.UTC` midnights → divide by one day. `daysFromNow` is negative for a past day, `0` for today.
- **`taskHorizon` rule, in order:**
  1. `priority === 1 || priority === 2` → `near`.
  2. `dueAt` parses and `daysFromNow(dueAt) <= NEAR_TERM_DAYS` → `near`. A late due date (negative) is near.
  3. `remindAt` parses and `daysFromNow(remindAt) <= NEAR_TERM_DAYS` → `near`. An overdue reminder is near.
  4. Otherwise `long`. That includes `priority === 3`, `priority === null`, unparsable dates, and no dates at all.
- **`filterByHorizon`** classifies only the rows it is given. Callers pass the open set; completed rows are never classified.
- **Window:** `14`, a module constant. Not a Settings field in this chunk.

### D2 The control: `src/components/HorizonControl.tsx` (new)

A three-segment control, not a menu. Sits beside `TaskSortControl` everywhere that control is mounted.

- **Markup:** a `div` with `role="radiogroup"` and `aria-label="Horizon"`, holding three `button type="button" role="radio"` children, one per `HORIZON_OPTIONS` entry, with `aria-checked`. Texts: `Near`, `Long`, `All`.
- **Chrome:** the same pill as `TaskSortControl`'s trigger — `rounded-sm border border-line font-mono text-[11px] font-medium uppercase tracking-[0.1em]` — as one bordered group with the segments separated by `border-l border-line`. The checked segment is `bg-bg-alt text-ink`; the others `text-ink-3 hover:text-ink`. Focus: `focus-visible:ring-2 focus-visible:ring-ring` on the segment. Segment padding `px-2 py-1`; the group has no padding.
- **Events:** each segment stops `click` and `dblclick` propagation (the Dashboard column header is a drill target, same reason as `TaskSortControl`).
- **Keyboard:** Left/Right and Up/Down move the checked segment and call `onChange`; Home/End go to the first/last. Tab enters the group on the checked segment only (`tabIndex={0}` on it, `-1` on the rest).
- **Props:** `{ value: HorizonFilter; onChange: (f: HorizonFilter) => void; className?: string }`.

### D3 One global preference, three screens

The same shape as `sortKey` (chunk 33): held in `useState(loadHorizonFilter)` on each screen, written through `storeHorizonFilter` on change, one value for every list in the app.

- **`Dashboard.tsx`:** `const [horizon, setHorizon] = useState<HorizonFilter>(loadHorizonFilter)` next to `sortKey`; `onChangeHorizon` beside `onChangeSortKey`. Pass `horizon` and `onChangeHorizon` to each `CategoryColumn`, and `timeZone` is already passed.
- **`CategoryColumn.tsx`:** new props `horizon: HorizonFilter`, `onChangeHorizon`. Mount `<HorizonControl value={horizon} onChange={onChangeHorizon} />` immediately before `<TaskSortControl …>` in the header's second wrapping group. Pass `horizon` down to every `SubcategorySection`.
  - **The pill and the total follow the filter.** `open` becomes the open rows after `filterByHorizon(open, horizon, timeZone ?? browserTimezone())`; the `N open` pill and `fmtMin(total)` read from that. With `all` nothing changes.
- **`CategoryView.tsx`:** same state pair; mount the control immediately before `TaskSortControl` in the header (`ml-auto` moves to the `HorizonControl`; the sort control follows it with a gap of 2, so wrap the two in a `div className="ml-auto flex items-center gap-2"` like SubcategoryView's). `openCount` / `openMinutes` read from `filterByHorizon(allTasks, horizon, timeZone)`. Pass `horizon` to every `SortableSubSection` → `SubcategorySection`.
- **`SubcategoryView.tsx`:** same state pair; mount the control first inside the existing `ml-auto flex items-center gap-2` div, before the `Show N done` button. `incomplete` stays as is; a new `visibleIncomplete = filterByHorizon(incomplete, horizon, timeZone)`. `visibleTasks = showCompleted ? [...visibleIncomplete, ...completed] : visibleIncomplete`. The header's `N open · Xm` reads from `visibleIncomplete`. Select-all and the bulk toolbar operate on `visibleTasks` as today, so they only ever touch what is on screen.

### D4 `SubcategorySection` filters the open set

New required prop `horizon: HorizonFilter`. In the `visibleIncomplete` computation, apply the filter to the open rows only, before the sort:

```ts
const openNow = tasks.filter((t) => !t.completedAt)
const shown = new Set(filterByHorizon(openNow, horizon, tz).map((t) => t.id))
const visibleIncomplete = tasks
  .filter((t) => shown.has(t.id) || linger.has(t.id) || justCompletedIds.has(t.id))
  .sort(compareTasks(sortKey))
```

where `tz = timeZone ?? browserTimezone()` (`lib/userTimezone`). Lingering just-completed rows stay visible whatever the filter, as today.

- The header's `incompleteCount` / `incompleteMinutes` read from the filtered open rows (`shown`), so the section's count matches its rows.
- **Empty states**, in order:
  1. `tasks.length === 0` → `No tasks here.` (unchanged).
  2. `visibleIncomplete.length === 0 && openNow.length > 0` → one muted line, `Nothing near term.` or `Nothing long term.` (never shown with `all`, since then `visibleIncomplete` is empty only when `openNow` is).
  3. `visibleIncomplete.length === 0 && completed.length > 0 && !showCompleted` → `All done. N completed.` (unchanged).
- The completed bucket and its expander are unchanged: the filter never hides a completed row.

### D5 What does not change

- **Today:** `lib/today.ts`, `lib/todaySuggest.ts`, `state/todayPlan.ts`, `TodayPanel`, the review (`lib/review.ts`). The Today plan still draws from every open task.
- **Planner** tray and grid, Notebook, Insights, Settings, capture and search, the Recovered card.
- **TaskRow:** no horizon chip, no menu item. `TaskMenu`, `PriorityPicker`, `SetDuePopover`, `SetReminderPopover` untouched.
- **Data:** `src/db/*`, every migration, `lib/taskSort.ts`, `lib/taskAge.ts`, `lib/whenLabel.ts`.
- **Chunk 75 / 75a rules** (ARCH §13): the new control's text is `text-ink-3` or darker and 11 px; `src/lib/contrast.test.ts` and `src/lib/fontFloor.test.ts` must stay green unchanged.
- **Packages:** `package.json` / `package-lock.json`.

### D6 Tests (you write them)

**`src/lib/horizon.test.ts`** (new). `now = new Date('2026-10-13T16:00:00Z')`, `timeZone = 'America/New_York'`, a `mk()` task factory with `priority: null`, `dueAt: null`, `remindAt: null`, `completedAt: null`:
1. `daysFromNow`: today → `0`; `2026-10-27T12:00:00Z` → `14`; `2026-10-28T12:00:00Z` → `15`; `2026-10-10T12:00:00Z` → `-3`; garbage → `null`.
2. **Day boundary:** `2026-10-28T03:30:00Z` is still Oct 27 in New York → `14` there, `15` in `UTC`.
3. `taskHorizon`: P1 → near; P2 → near; P3 → long; null → long; due in 14 days → near; due in 15 → long; due 3 days late → near; reminder in 14 → near; reminder in 15 → long; overdue reminder → near; P3 with due tomorrow → near (dates win over P3); unparsable due with no priority → long.
4. `filterByHorizon`: `all` returns the same array (identity, `toBe`); `near` and `long` partition the open set with no overlap and no loss; order is preserved.
5. `loadHorizonFilter` / `storeHorizonFilter` survive a throwing `localStorage`; a stored `'bogus'` reads as `'all'`.

**`src/components/HorizonControl.test.tsx`** (new):
- Three radios, the checked one matches `value`, only it is in the tab order.
- Click on `Long` calls `onChange('long')`.
- ArrowRight from `Near` calls `onChange('long')`; End calls `onChange('all')`; ArrowLeft from `Near` wraps to `all` (or stays — pick one, test it, say which).
- A click does not reach a parent `onClick` or `onDoubleClick`.

**`src/components/SubcategorySection.test.tsx`** (extend): with `horizon: 'near'`, a P2 task and a dated task render while a P3 undated task does not; the count in the header matches; with every open row long and `horizon: 'near'`, `Nothing near term.` shows and the `N completed` expander still shows its rows; with `'all'` nothing is filtered.

**`src/components/CategoryColumn.test.tsx`** (extend): the pill reads `1 open` with `horizon: 'near'` when one of two open tasks is P2, and `2 open` with `'all'`.

**`src/screens/SubcategoryView.test.tsx`** (extend): switching the control to `Long` hides a P1 row and keeps an undated P3 row; `Show N done` still reveals completed rows under `Long`; the header count follows.

**`src/screens/Dashboard.test.tsx`, `CategoryView.test.tsx`** (extend, one case each): the control is present, and choosing `Near` writes `hupo.taskHorizon`.

**Other existing tests.** Every existing test that mounts `SubcategorySection` or `CategoryColumn` directly must pass `horizon: 'all'` (the prop is required). List the files you touched for that reason, with a one-line comment naming chunk 76.

**Red-first:**
- `horizon.ts` and `HorizonControl.tsx` do not exist at the base, so their test files fail to load there by construction; report that as one line.
- The behavioural red-first: with everything written, restore `SubcategorySection.tsx` and `SubcategoryView.tsx` from the base and run their tests:

```bash
BASE=cfef25b
mkdir -p "$TMPDIR/c76/src/components" "$TMPDIR/c76/src/screens"
cp src/components/SubcategorySection.tsx "$TMPDIR/c76/src/components/SubcategorySection.tsx"
cp src/screens/SubcategoryView.tsx "$TMPDIR/c76/src/screens/SubcategoryView.tsx"
git show $BASE:src/components/SubcategorySection.tsx > src/components/SubcategorySection.tsx
git show $BASE:src/screens/SubcategoryView.tsx > src/screens/SubcategoryView.tsx
npx vitest run src/components/SubcategorySection.test.tsx src/screens/SubcategoryView.test.tsx
cp "$TMPDIR/c76/src/components/SubcategorySection.tsx" src/components/SubcategorySection.tsx
cp "$TMPDIR/c76/src/screens/SubcategoryView.tsx" src/screens/SubcategoryView.tsx
git status --short
```

Report pass/fail counts per file. Name every new or extended test that passes against the old code (say so; don't count it as a guard). The final `git status --short` must match your change set exactly.

### D7 Commit routing

- **One code commit**, pushed **alone**, **no `[skip ci]`**.
- **Expected files:**
  - New: `src/lib/horizon.ts`, `src/lib/horizon.test.ts`, `src/components/HorizonControl.tsx`, `src/components/HorizonControl.test.tsx`.
  - Changed: `src/components/SubcategorySection.tsx`, `src/components/SubcategorySection.test.tsx`, `src/components/CategoryColumn.tsx`, `src/components/CategoryColumn.test.tsx`, `src/screens/Dashboard.tsx`, `src/screens/Dashboard.test.tsx`, `src/screens/CategoryView.tsx`, `src/screens/CategoryView.test.tsx`, `src/screens/SubcategoryView.tsx`, `src/screens/SubcategoryView.test.tsx`.
  - Plus any test file D6 lets you fix for the required prop.
  - Anything else: stop and report before committing.
- **Subject:** `Chunk 76: Near term / Long term horizon filter on every list`.
- **Gates before the push**, on a clean `npm ci`: `tsc -b` clean; `eslint .` 0 problems; `vitest run` all green; `TZ=UTC npx vitest run` all green; `npm run build` green.
- **Base figures** at `cfef25b` (orchestrator, cloud container, Node 22, clean clone; chunk 75a gate):
  - `vitest run` **1118 / 1118** in **100** files, in `America/New_York` and in `UTC`.
  - Eager JS **1,049,533 B** (7 files, container). Your Mac reads higher than the container (your chunk-75 after was 1,050,542 B); run your own base on the Mac **in both zones** and report it with your after.
- **Eager JS limit: +4 kB.** Nothing here is lazy; if you are over, say why.
- **After the push:** deploy run id and result; live `version.json` read cache-busted.

---

## Sequence

### 1. Code (Claude Code, Sergio's Mac)

```bash
cd ~/Documents/To-Do\ Dashboard
git fetch origin
git checkout main
git pull --ff-only origin main
git log -3 --oneline
```

Expect `57e1c8f`, `f8cdf4a`, `cfef25b`, top to bottom. If `main` is anywhere else, stop and report.

```bash
rm -rf node_modules
npm ci
npx vitest run
TZ=UTC npx vitest run
npm run build
python3 -c "import re,os;h=open('dist/index.html').read();f=set(re.findall(r'(?:src|href)=\"/dashboard/(assets/[^\"]+\.js)\"',h));print(len(f),sum(os.path.getsize('dist/'+x) for x in f))"
```

Record the base. Implement D1–D5, write the D6 tests, run red-first. Then:

```bash
npx tsc -b
npx eslint .
npx vitest run
TZ=UTC npx vitest run
npm run build
python3 -c "import re,os;h=open('dist/index.html').read();f=set(re.findall(r'(?:src|href)=\"/dashboard/(assets/[^\"]+\.js)\"',h));print(len(f),sum(os.path.getsize('dist/'+x) for x in f))"
git diff --stat cfef25b -- package.json package-lock.json
git add src/lib/horizon.ts src/lib/horizon.test.ts src/components/HorizonControl.tsx src/components/HorizonControl.test.tsx src/components/SubcategorySection.tsx src/components/SubcategorySection.test.tsx src/components/CategoryColumn.tsx src/components/CategoryColumn.test.tsx src/screens/Dashboard.tsx src/screens/Dashboard.test.tsx src/screens/CategoryView.tsx src/screens/CategoryView.test.tsx src/screens/SubcategoryView.tsx src/screens/SubcategoryView.test.tsx
git status --short
git commit
git push origin main
```

- Add any test file you fixed under D6 to the `git add` line.
- `git status --short` after `git add` must show only the D7 files staged.
- The commit body lists D1–D4 in one line each and ends with the `Co-Authored-By` trailer per `CLAUDE.md`.

**Stop after the push and report.** Do not write docs. Do not run the smoke.

### 2. Gate + smoke (orchestrator, not you)

**Gate:** clean clone at your SHA in the cloud container. It runs:
- the scope diff against `57e1c8f`;
- `tsc -b`, `eslint .`, and `vitest run` in three zones;
- red-first reproduced;
- the build and eager JS;
- chunk-76 markers in the deployed JS: `hupo.taskHorizon`, `Nothing near term.`, `Nothing long term.`;
- the live `version.json`.

**Smoke:** deployed app in Sergio's Chrome via the Claude in Chrome extension, tab in the foreground. No writes to Sergio's tasks; `localStorage['hupo.taskHorizon']` is read before and restored after.
1. Dashboard: both columns show the control, `All` checked, counts unchanged from the base.
2. `Near` on the Work column: both columns switch (one preference); the pills and totals drop to the P1/P2/dated rows; a subcategory with no near rows reads `Nothing near term.`; the `N completed` expander still opens.
3. `Long`: the complement; no row appears in both views.
4. Open a category, then a subcategory: the control shows the same value; the header counts match the rows; `Show N done` still reveals completed rows.
5. Reload: the choice survives. Set it back to `All`.
6. Keyboard: Tab lands on the checked segment; ArrowRight moves it and the lists update.
7. 382 px frame: the Dashboard column header wraps without sideways scroll with the control present.
8. Contrast and font floor (chunk 75 script): the control's text passes AA and is ≥ 11 px on Dashboard, Category and Subcategory views.
9. Console: clean.

### 3. Docs (`[skip ci]`, after the orchestrator's gate and smoke pass)

**`ARCHITECTURE.md` §13.** Append:

> Horizon (chunk 76): every list can be narrowed to near term or long term. The horizon is derived, never stored (`lib/horizon`): a task is near when it is P1 or P2, or when its due date or reminder falls within 14 calendar days in the Settings time zone (past days included); everything else is long. One global preference (`localStorage['hupo.taskHorizon']`, default `all`), a three-segment control beside the sort control on the Dashboard columns and both drill-downs. The filter applies to open rows only; counts and totals follow it; completed rows, the Today plan and the Planner are unaffected.

**`ARCHITECTURE.md` §4 (priority note).** After the priority semantics, append one sentence: `Since chunk 76, P1 and P2 also mark a task near term for the horizon filter (lib/horizon).`

**`PROGRESS.md`:**
- **Row 76 ☑**, directly after row 75a: the step-1 SHA; gates in both runner zones, Mac base in both zones; red-first counts; test count and file count; eager JS before / after; deploy run and live `version.json`; the orchestrator's gate and smoke result; test files fixed for the required prop; deviations, numbered.
- **Decisions log:** D1–D4 (2026-10-13, chunk 76), one row each. D1's row states that the horizon is derived from priority and dates by choice (no column), with the 14-day window as a module constant.
- **Last-updated paragraph:** per the chunk-54 convention. The chunks 75 and 75a paragraph moves to Update history, relabelled `Prior update:` (prefix only).

Commit this prompt as `prompts/chunk-76-horizon.md` in the same commit, copied from the file, not retyped. If row 76 must name the docs SHA, record it in an immediate `[skip ci]` follow-up (chunk-54 convention).

---

## Out of scope

- A stored `tasks.horizon` column or any override picker; a horizon chip on the row.
- Making the window a Settings field; a third "unsorted" bucket.
- Feeding the horizon into Today's suggestions, the review walk, or the Planner tray.
- Any change to the sort comparator or to priority semantics.

## Report back

- **Step 1:**
  - commit SHA and `git diff --stat 57e1c8f <SHA>`;
  - gates (`tsc -b`, `eslint .`, test count and file count in both runner zones, build), with the Mac base in both zones;
  - red-first counts, with the non-guard tests named;
  - eager JS before / after / delta;
  - the empty `package.json` diff;
  - deploy run id and result;
  - live `version.json`.
- Existing test files fixed for the required `horizon` prop, listed.
- Which ArrowLeft-from-first behaviour you chose (wrap or stay).
- Anything you built that departs from D1–D6, and why.
- Every deviation, numbered.
