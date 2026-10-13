# Chunk 70: Truthful numbers (UX audit #3, #4, #5, #12 zero chips)

**Runs on:** Claude Code, in `~/Documents/To-Do Dashboard` on Sergio's Mac (repo `smrios07mdb/dashboard`). You write the code and the tests. App code only: no SQL, no migration, no proxy, no new dependency.

**Bases:**
- App `smrios07mdb/dashboard` @ `b93fa4a` (docs). Last code commit `ff24a33` (chunk 69), which is what's live.
- Proxy untouched.

**Authority:** `ARCHITECTURE.md` → `prompts/README.md` → this prompt. Read first: `CLAUDE.md`, `prompts/README.md`, `src/components/gamify/DailyHero.tsx`, `src/components/gamify/DailyHero.test.tsx`, `src/lib/gamify.ts`, `src/lib/today.ts` (`resolveToday`), `src/components/TodayPanel.tsx` (how it counts `doneCount` / `all.length`), `src/screens/Dashboard.tsx`, `src/screens/Dashboard.test.tsx`, `src/screens/Insights.tsx`, `src/screens/Insights.test.tsx`, `src/lib/chartLabel.ts`, `src/lib/chartLabel.test.ts`, `src/db/repo.ts` (`tasks.listCompletedInRange`), and ARCHITECTURE §11, §12, §13.

**Scope:** UX audit 2026-10-13 (`ux-audit-2026-10-13.md` in the Claude project), findings 3, 4, 5, and the "hide chips that read zero" part of 12. Nothing else from the audit.

---

## The problem, as committed at `b93fa4a`

- **#3** `DailyHero` captions its ring "today" but feeds it `calcStats(liveTasks).ratio`: all-time done ÷ all-time total. Live it reads "80% TODAY", "94/117 done", "Almost there — the finish line is close." with nothing completed in 41 days. The file header admits it.
- **#4** Every screen drops tasks whose `subcategoryId` is not a live subcategory (`liveSubIds` in `Dashboard.tsx`). Five open tasks sit under archived subcategories and cannot be found, completed or moved. Today's `DeleteSubcategoryDialog` already forces move or delete, so these are leftovers; the fix is a way to reach them.
- **#5** Insights sums `estimateMinutes` of completed tasks and labels it "total time logged". 91 of 94 completed tasks carry the 30 m default. At the default 30-day range the screen shows "No time logged yet." with no way forward.
- **#12 (zero chips)** The streak chip renders "0 days" and the level chip renders even when there is no XP.

---

## Locked decisions

### D1 The hero ring measures today's plan

- `Dashboard.tsx` computes the plan's figures with the same call `TodayPanel` uses: `resolveToday(todayData, todaySet, timeZone)`; `done` = rows whose task has `completedAt`, `total` = row count. Compute it once per render after the loading check and before the first-run branch (both `DailyHero` mounts get it; the first-run one will read 0/0). Pass it as a new required prop `today: { done: number; total: number }`.
- `DailyHero`:
  - Ring `value` = `done / total`, or `0` when `total === 0`.
  - Ring centre: `{pct}%` when `total > 0`; an em dash `—` (no `%`) when `total === 0`. The `today` caption stays.
  - The ring element gets `aria-label`: `Today: <done> of <total> planned tasks done` when `total > 0`, `Today: nothing planned` otherwise. If `ProgressRing` can't take one, wrap it; don't change `ProgressRing.tsx`.
  - Encouragement line reads the plan, with this copy (first match wins):

    | Condition | Line |
    |---|---|
    | `total === 0` | `Nothing planned yet — pick a few for today.` |
    | `done === 0` | `Nothing done yet — knock out the first one.` |
    | `done >= total` | `Today's plan is cleared. Beautifully done.` |
    | ratio ≥ 0.66 | `Almost there — the finish line is close.` |
    | ratio ≥ 0.33 | `You're on a roll. Keep the momentum.` |
    | else | `Good start. One at a time.` |

  - The trailing figure becomes `· <done>/<total> today`, shown only when `total > 0`. The all-time `· x/y done` figure is removed.
  - XP, level, the level sliver and the Work/Personal `CatBar`s keep their current all-time inputs (`calcStats`, `catProgress`).
  - Rewrite the header comment's "The ring is captioned 'today' but computes overall completion…" paragraph to say the ring is the Today plan (chunk 70) and XP/level/bars are all-time.
- No change to `lib/today.ts`, `state/todayPlan.ts`, `TodayPanel.tsx`, `lib/gamify.ts`.

### D2 Zero chips are hidden

- The streak chip renders only when `streak > 0`.
- The level chip (LVL · XP) renders only when `stats.xp > 0`.
- If both are hidden, their wrapper renders nothing (no empty flex row with a 10 px top margin).

### D3 Insights says "estimated" and has a way out of empty

UI only. **`src/lib/insights.ts` and its tests are untouchable** (aggregation core); do not edit them.

- Stat cards, in this order (the "Active subcategories" card is removed):

  | Label | Value | Hint |
  |---|---|---|
  | `Last <range> days` | completed task count — sum of `summary[].tasks` | `tasks completed` |
  | `Estimated time` | `fmtMinutes(totalMinutes)` | `sum of task estimates` |
  | `Daily average` | unchanged | `estimated, across all categories` |
  | `Most-touched` | unchanged | `by estimated time` |

- Header kicker `Where the time went` → `What got done`.
- Summary table column `Minutes` → `Est. time`.
- `chartLabel`: `Completed minutes per day…` → `Estimated minutes completed per day for the last <range> days, <category phrase>, by subcategory.` Update `chartLabel.test.ts` to the new strings.
- Trend chip, chart, colours, "Other" grouping: unchanged.
- Empty state (`totalMinutes === 0` after load):
  - Title: `Nothing completed in the last <range> days.`
  - Body, first match wins:
    - The range query returned no tasks at all **and** an all-time completion exists → `Last completion was <date>.` `<date>` is the latest `completedAt`, formatted with `Intl.DateTimeFormat('en-US', { timeZone: tz, month: 'short', day: 'numeric' })`, adding `year: 'numeric'` when that year differs from the current year in `tz`. E.g. `Sep 2`.
    - Otherwise (never completed anything, or the range has tasks the category filter / archived subcategories hide) → `Complete a task and it shows up here. Try a wider range or another category.`
  - When `range < 90`: a `Show 90 days` button that does exactly what clicking the `90d` pill does (including setting `loading`).
- Last-completion lookup: inside the existing `load()`, only when the range query returns zero rows, call `repo.tasks.listCompletedInRange('1970-01-01T00:00:00.000Z', <now ISO>)` and keep the max `completedAt` (or `null`). Store it in the same `.then` as the other state. No new repo method, no extra effect, no query when the range has rows.

### D4 Recovered tasks are reachable

- `Dashboard.tsx` derives `orphanTasks`: tasks with `completedAt === null` whose `subcategoryId` is not in `liveSubIds` (archived **or** missing), sorted by `createdAt` ascending. Also a `subNameById` map over **all** `data.subcategories`.
- New component `src/components/RecoveredTasks.tsx`, prop-driven, no repo import:
  ```ts
  type RecoveredTasksProps = {
    tasks: Task[]
    subNameById: Record<string, string>
    liveSubcategories: Subcategory[]
    categories: Category[]
    onMove: (taskId: string, subcategoryId: string) => void
    onComplete: (taskId: string) => void
  }
  ```
  - A `<section aria-labelledby>` card styled like the surrounding cards (surface, `--line` border, radius, `--shadow-md`). Heading `Recovered` with the count beside it; hint: `These open tasks were in lists that have since been deleted. Move each into a list, or mark it done.`
  - One row per task: the title (wraps, no truncation), a muted `from <name>` (or `from a deleted list` when the id isn't in `subNameById`), a native `<select>` with `aria-label="Move <title> to"`, a disabled placeholder option `Move to…` selected by default, and one `<optgroup label="<category name>">` per category in `categories` order containing that category's live subcategories in `sortOrder`; choosing one calls `onMove(task.id, subId)`. Then a `Done` button, `aria-label="Mark <title> done"`, calling `onComplete(task.id)`.
  - Renders `null` when `tasks` is empty.
  - Touch targets ≥ 44 px on touch (reuse `useIsTouchDevice` if you need it; prefer `min-h-11` on both controls everywhere, which is simpler).
- Wiring: in the normal and all-clear render paths, directly after `<DailyHero>` and before `AllClearBanner`. `onMove` → existing `onMoveTaskToSubcategory`; `onComplete` → existing `onCompleteTask(id, true)`. Not rendered in the first-run path (there is nowhere to move to).
- Orphans are still excluded from the hero, Today, columns and `selectDashboardState`; this chunk only makes them reachable.
- No delete control here, no change to `DeleteSubcategoryDialog`, merge, `CategoryView`, or the repo.

### D5 What does not change

- `lib/insights.ts` + tests, `lib/gamify.ts`, `lib/streak.ts`, `lib/today.ts`, `state/todayPlan.ts`, `TodayPanel.tsx`, `ProgressRing.tsx`, `CatBar.tsx`, `src/db/*`, `src/db/realtime.ts`.
- Routines, the streak rule (ARCH §11), the "Decide whether Routines earns its tab" part of #12, the streak re-basing part of #12.
- Greeting/display name (#19), Insights default range (stays 30).
- `package.json` / `package-lock.json`.

### D6 Tests (you write them)

**`src/components/gamify/DailyHero.test.tsx`** — update `renderHero` to pass `today` and accept `streak` / `tasks` overrides; keep the two bar-order tests. Add:
1. `today={{ done: 1, total: 3 }}` → ring centre shows `33` and `%`; text `1/3 today` present; the ring's aria-label is `Today: 1 of 3 planned tasks done`; no `/2 done`-style all-time figure (assert `queryByText(/ done$/)` against the old suffix shape, or equivalent).
2. `today={{ done: 0, total: 0 }}` → centre `—`, no `%` in the ring; `Nothing planned yet — pick a few for today.`; no `today` fraction text; aria-label `Today: nothing planned`.
3. `today={{ done: 3, total: 3 }}` → `Today's plan is cleared. Beautifully done.`
4. `streak={0}` → no element with `title="Check-in streak"`; `streak={2}` → present and shows `2`.
5. No completed tasks → no LVL chip; one completed task → LVL chip present.

**`src/components/RecoveredTasks.test.tsx`** (new):
1. Empty `tasks` → renders nothing.
2. Two tasks: one whose sub id is in `subNameById` (`from Old list`), one not (`from a deleted list`); heading shows `Recovered` and `2`.
3. The select has one optgroup per category in prop order, each listing only that category's live subs in `sortOrder`; the placeholder `Move to…` is selected.
4. Selecting a sub calls `onMove(taskId, subId)` once; clicking `Done` calls `onComplete(taskId)` once.

**`src/screens/Dashboard.test.tsx`**:
1. Hero reads the plan: one open Priority-1 task plus one old completed task in a live sub → hero ring shows `0` + `%` and `0/1 today` (not `50`).
2. Orphans: an open task under an archived sub → `Recovered` section with its title; choosing a live sub calls `tasksUpdate(id, { subcategoryId })`.
3. No orphans → no `Recovered` heading.

**`src/screens/Insights.test.tsx`**: update (a) to the D3 cards (`Last 30 days` shows the task count, `Estimated time` shows `8h`, no `Active subcategories`); update (c) to the new empty title; add:
- (e) range query empty, all-time query returns one task completed `2026-09-02T15:00:00.000Z` → `Last completion was Sep 2.` and a `Show 90 days` button; clicking it sets the `90d` pill `aria-pressed="true"`. Make the year assertion independent of the run date (pin the clock or assert the `Sep 2` prefix).
- (f) range query empty, all-time query empty → generic body, no `Last completion`.

**`src/lib/chartLabel.test.ts`**: new strings.

Existing lookups that break only because of copy changed by D1–D3: change only that lookup, with a one-line comment naming chunk 70. List them.

**Red-first:** with everything written, restore the source files from `b93fa4a` (delete `RecoveredTasks.tsx` for the run) and run only the new/changed test files:

```bash
mkdir -p "$TMPDIR/c70"
for f in src/components/gamify/DailyHero.tsx src/screens/Dashboard.tsx src/screens/Insights.tsx src/lib/chartLabel.ts; do mkdir -p "$TMPDIR/c70/$(dirname $f)"; cp "$f" "$TMPDIR/c70/$f"; git show b93fa4a:$f > "$f"; done
mkdir -p "$TMPDIR/c70/src/components"; mv src/components/RecoveredTasks.tsx "$TMPDIR/c70/src/components/RecoveredTasks.tsx"
npx vitest run src/components/gamify/DailyHero.test.tsx src/components/RecoveredTasks.test.tsx src/screens/Dashboard.test.tsx src/screens/Insights.test.tsx src/lib/chartLabel.test.ts
for f in src/components/gamify/DailyHero.tsx src/screens/Dashboard.tsx src/screens/Insights.tsx src/lib/chartLabel.ts src/components/RecoveredTasks.tsx; do cp "$TMPDIR/c70/$f" "$f"; done
git status --short
```

Adjust the file list to what you actually changed and created. Report pass/fail counts per test file, and name every new test that passes against the old code (they assert things that were already true; say so, don't count them as guards). The final `git status --short` must match your change set exactly.

### D7 Commit routing

- **One code commit**, pushed **alone**, **no `[skip ci]`**. Expected files: `DailyHero.tsx`, `DailyHero.test.tsx`, `RecoveredTasks.tsx`, `RecoveredTasks.test.tsx`, `Dashboard.tsx`, `Dashboard.test.tsx`, `Insights.tsx`, `Insights.test.tsx`, `chartLabel.ts`, `chartLabel.test.ts`. Anything else: stop and report before committing.
- Subject: `Chunk 70: Truthful numbers (UX audit #3, #4, #5, #12)`.
- Gates before the push, on a clean `npm ci`: `tsc -b` clean; `eslint .` 0 problems; `vitest run` all green; `TZ=UTC npx vitest run` all green; `npm run build` green.
- Base figures at `b93fa4a` (orchestrator, cloud container, Node 22, clean clone): `vitest run` **904 / 904** in **82** files, both zones; eager JS **1,036,610 B**. Report your own base on the Mac and your after.
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

Expect `b93fa4a`. If `main` is anywhere else, stop and report.

```bash
rm -rf node_modules
npm ci
npx vitest run
npm run build
python3 -c "import re,os;h=open('dist/index.html').read();f=set(re.findall(r'(?:src|href)=\"/dashboard/(assets/[^\"]+\.js)\"',h));print(len(f),sum(os.path.getsize('dist/'+x) for x in f))"
```

Record the base. Implement D1–D4, write the D6 tests, run red-first. Then:

```bash
npx tsc -b
npx eslint .
npx vitest run
TZ=UTC npx vitest run
npm run build
python3 -c "import re,os;h=open('dist/index.html').read();f=set(re.findall(r'(?:src|href)=\"/dashboard/(assets/[^\"]+\.js)\"',h));print(len(f),sum(os.path.getsize('dist/'+x) for x in f))"
git diff --stat b93fa4a -- package.json package-lock.json
git add src/components/gamify/DailyHero.tsx src/components/gamify/DailyHero.test.tsx src/components/RecoveredTasks.tsx src/components/RecoveredTasks.test.tsx src/screens/Dashboard.tsx src/screens/Dashboard.test.tsx src/screens/Insights.tsx src/screens/Insights.test.tsx src/lib/chartLabel.ts src/lib/chartLabel.test.ts
git status --short
git commit
git push origin main
```

`git status --short` after `git add` must show only the D7 files staged. The commit body lists D1–D4 in one line each and ends with the `Co-Authored-By` trailer per `CLAUDE.md`.

**Stop after the push and report.** Do not write docs. Do not run the smoke.

### 2. Gate + smoke (orchestrator, not you)

Gate: clean clone at your SHA in the cloud container — scope diff against `b93fa4a`, `tsc -b`, `eslint .`, `vitest run` in both zones, build, eager JS, deployed CSS/JS hash match, live `version.json`.

Smoke: deployed app in Sergio's Chrome via the Claude in Chrome extension, **read-only** (nothing moved, completed or deleted):
- Hero ring shows the Today plan's figure, not 80%; with an empty plan it shows `—` and the "Nothing planned yet" line.
- Streak chip absent (streak 0); LVL chip present.
- `Recovered` lists 5 tasks, each with a `from …` line and a populated Move-to select.
- Insights at 30 days: `Nothing completed in the last 30 days.`, `Last completion was Sep 2.`, `Show 90 days`; at 90 days the cards read `tasks completed` / `Estimated time`, and the table column reads `Est. time`.
- Console clean.

### 3. Docs (`[skip ci]`, after the orchestrator's gate and smoke pass)

**`ARCHITECTURE.md`**
- §12 — append: "Insights reports estimates, not tracked time (chunk 70): the headline cards lead with tasks completed, then `Estimated time` (sum of `estimateMinutes`), and every label says estimated. When a range is empty the screen names the last completion date (an all-time `listCompletedInRange` read, only when the range returned nothing) and offers `Show 90 days`."
- §13 — append: "Hero (chunk 70): the ring is the Today plan — done ÷ planned, from the same `resolveToday` call as the Today panel — and shows `—` when nothing is planned; XP, level and the category bars stay all-time. The streak and level chips hide at zero. Open tasks under archived or missing subcategories are listed in a `Recovered` card on the Dashboard (move to a live list, or mark done); they stay out of every other view."

**`PROGRESS.md`**
- Row 70 ☑: the step-1 SHA, gates (both runner zones), red-first counts, test count and file count, eager JS before/after, deploy run, live `version.json`, the orchestrator's gate and smoke result, deviations numbered.
- Decisions log: D1–D4 (2026-10-13, chunk 70), one row each.
- Last-updated paragraph per the chunk-54 convention; the chunk-69 paragraph moves to Update history, relabelled `Prior update:` (prefix only).

Commit this prompt as `prompts/chunk-70-truthful-numbers.md` in the same commit. If row 70 must name the docs SHA, record it in an immediate `[skip ci]` follow-up (chunk-54 convention).

---

## Out of scope

- Rebasing the streak on planned-task completion, and the Routines-tab question (rest of #12).
- Due-date chip on rows (#6), row redesign (#8), undo (#13), capture (#7).
- Why the orphans exist (the delete dialog already forces a choice); auto-archiving old completions (#19).
- Settings phone overflow (rest of #18).

## Report back

- **Step 1:** commit SHA; `git diff --stat b93fa4a <SHA>`; gates (`tsc -b`, `eslint .`, test count and file count in both runner zones, build); red-first counts and the non-guard tests named; eager JS before / after / delta; the empty `package.json` diff; deploy run id and result; live `version.json`.
- Existing test lookups you changed, listed.
- Anything you built that departs from D1–D6, and why.
- Every deviation, numbered.
