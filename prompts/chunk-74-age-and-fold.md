# Chunk 74: Task age, weekly review and a shorter top of the Dashboard (UX audit #10, #11)

**Runs on:** Claude Code, in `~/Documents/To-Do Dashboard` on Sergio's Mac (repo `smrios07mdb/dashboard`). You write the code and the tests. App code only: no SQL, no migration, no proxy, no new dependency.

**Bases:**
- App `smrios07mdb/dashboard` @ `1584920` (docs). Last code commit `f3865be` (chunk 73), which is what's live.
- Proxy untouched.

**Authority:** `ARCHITECTURE.md` → `prompts/README.md` → this prompt. Read first:
- `CLAUDE.md`, `prompts/README.md`.
- `src/screens/Dashboard.tsx` (the two returns, `onDeleteTask`, `upsertTask`, `toggleToday`, `liveSubIds`).
- `src/components/gamify/DailyHero.tsx` and its test.
- `src/components/TodayPanel.tsx` (the header, the four body branches) and its test.
- `src/components/BusyStrip.tsx`, `src/components/ReconnectBanner.tsx`.
- `src/components/TaskRow.tsx` (the grid template and the when chip) and its test.
- `src/components/RecoveredTasks.tsx` (card shell and button classes to reuse).
- `src/lib/whenLabel.ts` (calendar-day math), `src/lib/clock.ts` (`dateKeyIn`).
- `src/lib/taskUndo.ts` (`deleteTasksWithUndo`), `src/state/todayPlan.ts` (`toggleToday(id, force)`).
- `src/components/ui/dialog.tsx`, `src/components/ProtectedLayout.tsx` (the chunk-73 `lazy` pattern).
- `src/lib/iosFocusZoom.test.ts`.

**Scope:** UX audit 2026-10-13 (`ux-audit-2026-10-13.md` in the Claude project), findings 10 and 11. Nothing else from the audit.

---

## The problem, as committed at `1584920`

- **No sense of age.** All 23 of Sergio's open tasks are 96–142 days old and look identical to one added today. Nothing ever asks whether an old task still matters.
- **The first task row is far down.** Measured on the live app (`f3865be`) at 1456 × 853, Today layout `stacked`, with the Recovered card showing:

  | Element | Top (px) | Height (px) |
  |---|---|---|
  | Busy strip | 174 | 42 |
  | Hero | 240 | 221 |
  | Recovered | — | 416 |
  | Today card (with suggestions) | 925 | 341 |
  | **First task row** | **1465** | — |

  - The busy strip is a full card for one line of text.
  - With nothing planned, the hero spends 221 px on an em-dash ring, a sentence that repeats the Today header, a level sliver and two all-time bars.
  - When Today has neither rows nor suggestions, it still draws a dashed hint box under a header that already says "Nothing planned yet."

---

## Locked decisions (orchestrator, 2026-10-13)

### D1 Age on the row: `src/lib/taskAge.ts` (new)

Pure TypeScript: no React, no storage. `now` is always passed in or defaulted.

```ts
export type TaskAge = { days: number; text: string; long: string }

/** Whole calendar days from createdAt's day to now's day, in timeZone; null if createdAt does not parse. */
export function ageDays(createdAt: string, timeZone: string, now?: Date): number | null

/** The row's age label, or null under 28 days. */
export function taskAge(createdAt: string, timeZone: string, now?: Date): TaskAge | null
```

- **Day math:** the same frame as `lib/whenLabel.ts`. Take `dateKeyIn(createdAt, timeZone)` and `dateKeyIn(now, timeZone)`, convert each key to a UTC midnight with `Date.UTC`, and divide the difference by one day.
- **Threshold:** `days < 28` → `null`.
- **Text:**
  - `days < 365` → `${Math.floor(days / 7)}w` (`4w` … `52w`).
  - `days >= 365` → `${Math.floor(days / 365)}y`.
- **Long:** `Added <date> · <n> week(s) ago`, or `Added <date> · <n> year(s) ago` from 365 days.
  - `<date>` is `MMM d` in `timeZone` (`Jul 9`), with `, yyyy` added when the year differs from now's year.
  - Singular at 1 (`1 year ago`). `n` matches the text's number.
- **TaskRow:**
  - The age shows on **open** rows only: `const age = completed ? null : taskAge(task.createdAt, tz)`, with `tz` the row's existing zone.
  - It gets its own grid slot, `age ? 'auto' : null`, after the reminder slot and before minutes.
  - Markup (not a button, not focusable):

    ```tsx
    <span className="whitespace-nowrap font-mono text-[11px] tabular-nums text-ink-3" title={age.long}>
      <span aria-hidden>{age.text}</span>
      <span className="sr-only">{age.long}</span>
    </span>
    ```

  - It appears on every screen that renders `TaskRow` (Dashboard, Category, Subcategory).

### D2 Weekly review: `src/lib/review.ts`, `src/components/ReviewPrompt.tsx`, `src/components/ReviewSheet.tsx` (new)

**`lib/review.ts`** is pure apart from two storage helpers:

```ts
export const REVIEW_AGE_DAYS = 90
export const REVIEW_EVERY_DAYS = 7
export const REVIEW_KEY = 'hup:lastReview'

/** Open tasks under a live subcategory, not in today's plan, at least 90 days old; oldest createdAt first, then id. */
export function reviewCandidates(
  data: { subcategories: Subcategory[]; tasks: Task[] },
  todaySet: ReadonlySet<string>,
  timeZone: string,
  now: Date,
): Task[]

/** True when lastIso is null or unparsable, or at least 7 × 24 h before now. */
export function isReviewDue(lastIso: string | null, now: Date): boolean

export function loadLastReview(): string | null   // localStorage[REVIEW_KEY]; null on any throw
export function storeLastReview(now: Date): void  // writes now.toISOString(); swallows any throw
```

- "At least 90 days old" means `ageDays(...) >= REVIEW_AGE_DAYS` (D1's math).
- A live subcategory is one that exists with `archivedAt === null`.

**The prompt: `ReviewPrompt`.**
- **Placement:** on the Dashboard, after `RecoveredTasks` and before `AllClearBanner`.
- **When it shows:** `candidates.length > 0` and `isReviewDue(lastReview, now)`.
  - The Dashboard holds `lastReview` in state, initialised from `loadLastReview()`.
  - It derives `candidates` with `reviewCandidates(todayData, todaySet, timeZone, new Date())`.
- **Markup:**
  - A `section aria-label="Review old tasks"` in the Recovered card shell (same border, surface, radius and shadow, `px-5 py-3`), as one wrapping row.
  - The text is `12 tasks are older than 90 days.`, or `1 task is older than 90 days.` for one.
  - Two buttons, using RecoveredTasks' button classes (`min-h-11`):
    - `Review`, which opens the sheet.
    - `Not now`, which calls `storeLastReview(new Date())` and sets `lastReview` so the prompt hides.

**The sheet: `ReviewSheet`.**
- **Loading:** lazy-loaded with `React.lazy`, in the chunk-73 manner (mounted on first open).
- **Container:** a Radix `Dialog` from `@/components/ui/dialog`.
  - Heading `Review` (`.label` style). `DialogDescription`, sr-only: `Keep, plan or delete each old task.`
- **Snapshot:** the candidates are snapshotted when the sheet opens. Nothing the sheet does reorders or shrinks the walk.
- **One task at a time:**
  - A progress line `3 of 12` (`.label` style).
  - The title (`text-[16px]`, wraps, never truncated).
  - One muted line: `Work › Deals · Added Jul 9 · 14 weeks ago` (the category, the subcategory, D1's `long`).
- **Three buttons** (`min-h-11`), each advancing to the next task:
  - `Keep` — does nothing.
  - `Add to Today` — calls `onToggleToday(task.id, true)` at once.
  - `Delete` — adds the id to the sheet's delete list. Nothing is written yet.
- **The end:** after the last task the body shows `Done — 5 kept · 3 added to Today · 4 deleted` and a `Done` button.
- **Closing:** every close (`Done`, Escape, the close button, mid-walk) calls `onClose(deleteIds)` exactly once.
  - **Why deletes wait for the close:** while the modal dialog is open, sonner's Undo toast cannot be clicked.

**The Dashboard on close:**
1. `storeLastReview(new Date())` and set `lastReview`, so the prompt hides.
2. If `deleteIds` is not empty, take those rows out of `data.tasks` and call `deleteTasksWithUndo({ tasks, onRestore: (rows) => rows.forEach(upsertTask) })`.
   - That shows one `N tasks deleted` (or `Task deleted`) toast with Undo, the chunk-72 path.
   - Add a Dashboard handler `onDeleteTasks(ids)` beside `onDeleteTask` for this; it does not change `onDeleteTask`.

Tasks the walk never reached are left alone.

`hup:lastReview` is per device on purpose: no schema change. A second device may ask once more that week.

### D3 The hero collapses to one line when nothing is planned

In `DailyHero`, `const compact = today.total === 0`.

**Compact layout** (same outer card, padding `12px 18px`, no radial glows):
- One flex row with `flex-wrap`, `align-items: center` and a `gap` of 12.
- The greeting `h1`, at `fontSize: 20`.
- The streak and level chips, exactly as today (still hidden at zero).
- The `I have __ min` / `What's next?` pill, pushed right with `marginLeft: 'auto'`.
- **Not rendered:** the ring, the encouragement line, the level sliver, the category bars.

**With a plan** (`today.total > 0`) the hero is unchanged.

This applies to both Dashboard returns (first-run passes `total: 0`, so it is compact).

### D4 The busy line moves into the Today header: `src/components/BusyStrip.tsx`

**`useBusyToday` (new export).** Move the existing fetch logic into `export function useBusyToday(): BusyToday`, unchanged:
- the same two effects;
- focus and 5-minute refresh;
- `withSessionRetry`;
- the `auth_failed` re-read of settings.

```ts
export type BusyToday =
  | { kind: 'hidden' }              // settings not loaded yet, or unconfigured
  | { kind: 'reconnect' }           // caldav_status auth_failed
  | { kind: 'loading' }
  | { kind: 'ready'; text: string } // formatBusyRanges(...), '' when there are no ranges
  | { kind: 'error' }
```

**`BusyStrip({ busy })` (default export).** Becomes presentational:
- `loading` / `ready` / `error` render today's strip with today's texts (`No busy times today`, `Couldn’t load busy times — retry on next refresh.`).
- `hidden` / `reconnect` render nothing.

**`BusyInline({ busy })` (new export).** A single `span`:

| `busy` | Renders |
|---|---|
| `hidden` / `reconnect` | nothing |
| `loading` | `<Skeleton className="h-3 w-24" />` |
| `ready` with text | `Busy 12–12:30` |
| `ready`, empty | `No busy times` |
| `error` | `Busy times unavailable` |

Text class: `font-mono text-[12px] text-ink-3 whitespace-nowrap`.

**Dashboard.**
- Call `const busy = useBusyToday()` once, above the early returns.
- `busy.kind === 'reconnect'` → `<ReconnectBanner className="mb-6" />` first in both returns (ARCH §7 unchanged).
- First-run, or `todayVariant === 'off'` → `<BusyStrip busy={busy} />` where the strip sits today.
- Otherwise there is no strip, and `TodayPanel` gets `busy={<BusyInline busy={busy} />}`.

**TodayPanel.**
- New optional prop `busy?: React.ReactNode`, rendered in the title row after the date label.
- That row becomes `flex flex-wrap items-center` with `rowGap: 2`, so the narrow rail wraps instead of overflowing.
- All variants that render (stacked, rail, banner) take it.

### D5 Today drops the dashed hint

In `TodayPanel`'s non-banner body, the branch `visible.length === 0 && suggestions.length === 0` renders nothing (`bodyEl = null`). No dashed box, in either its "All done for today." or its "Tap the sun…" form.

The header line is unchanged, and it already covers both cases:
- `Nothing planned yet.`
- `Plan cleared — every today task done.`

The suggestion branch (with its `Or tap the sun on any task.` line) and the row list are unchanged.

### D6 What does not change

- **Hero with a plan:** the ring, `encourage()`, XP and level math, `WhatsNextSheet`.
- **Data and plan logic:** `lib/today.ts`, `lib/todaySuggest.ts`, `state/todayPlan.ts`, `lib/taskUndo.ts`, `src/db/*` (no new repo method), `RecoveredTasks`.
- **Busy fetching:** `ReconnectBanner`, and the busy fetch cadence, cache and formatting (`getBusyDay`, `formatBusyRanges`, `mergeRanges`).
- **TaskRow:** every column other than the new age slot; the when chip, priority chip, sun and menu behave as before.
- **Elsewhere:** Planner, Notebook, Insights, Settings, capture and search (chunk 73).
- **Packages:** `package.json` / `package-lock.json`.

### D7 Tests (you write them)

**`src/lib/taskAge.test.ts`** (new). `now = new Date('2026-10-13T16:00:00Z')`, `timeZone = 'America/New_York'`:
1. 27 days → `null`; 28 → `4w`; 97 → `13w`, long `Added Jul 8 · 13 weeks ago`; 364 → `52w`; 365 → `1y`, long including the year; 800 → `2y`.
2. **Day boundary:** `createdAt = 2026-09-15T03:30:00Z` (still Sep 14 in New York) gives 29 days in New York and 28 in `UTC`.
3. Unparsable `createdAt` → `ageDays` null, `taskAge` null.

**`src/lib/review.test.ts`** (new):
- `reviewCandidates` keeps open, live, unplanned tasks at ≥ 90 days and orders them oldest-first (ties by id).
- It drops completed tasks, tasks under archived or missing subcategories, planned tasks and 89-day tasks.
- `isReviewDue`: `null` → true; 6 d 23 h → false; 7 d → true; garbage → true.
- `loadLastReview` / `storeLastReview` survive a throwing `localStorage`.

**`src/components/ReviewSheet.test.tsx`** (new), three candidates:
- The progress line reads `1 of 3`.
- `Keep` advances.
- `Add to Today` calls `onToggleToday(id, true)` and advances.
- `Delete` advances and writes nothing.
- The end line reads `Done — 1 kept · 1 added to Today · 1 deleted`.
- `Done` calls `onClose` once with the deleted id.
- Escape mid-walk calls `onClose` once with only the ids marked so far.

**`src/components/BusyStrip.test.tsx`** (new): `BusyInline` and `BusyStrip` for each `BusyToday` kind (texts above; nothing for `hidden` and `reconnect`).

**`src/components/TaskRow.test.tsx`** (extend; system time fixed):
- A 100-day-old open row shows `14w` with the long text in `title` and in the sr-only span.
- No age on a 10-day row or on a completed row.
- The age is not a button and adds no tab stop.

**`src/components/gamify/DailyHero.test.tsx`:**
- **Rewrite** `shows an em dash and a prompt when nothing is planned`. With `total: 0` there is no `img` named `Today: …`, no `Nothing planned yet — pick a few for today.`, and no category bars; the greeting `h1` and the `What's next?` button are present.
- **Keep** every other case as is.
- **Add:** with `total: 0` and `streak: 2`, the streak chip still shows.

**`src/components/TodayPanel.test.tsx`:**
- **Rewrite** `keeps the empty hint when there is nothing to suggest`: only `Nothing planned yet.` shows, and nothing matches `/to plan your day/`.
- **Rewrite** the all-done case that asserts `All done for today.`: `Plan cleared — every today task done.` shows, and `All done for today.` does not.
- **Add:** a `busy` node renders inside the header in stacked, rail and banner.

**`src/screens/Dashboard.test.tsx`:**
- **Rewrite** `renders the hero ring %, done readout and spark pill from real data`. With nothing planned, there is no ring `img`; the spark pill is still there.
- **Add:**
  - With settings `caldavStatus: 'auth_failed'`, the reconnect banner shows and no busy text shows.
  - With `ok` and `stacked`, the busy text is inside the Today panel and there is no standalone strip.
  - With `todayList` `off`, the standalone strip shows.
  - Two 120-day-old open tasks and no `hup:lastReview` → `2 tasks are older than 90 days.` shows. `Not now` hides it and writes the key. A key 3 days old → no prompt.
  - `Review` → `Delete` on the first task → Escape. That row leaves the columns, a `Task deleted` toast with Undo shows, and Undo brings it back.

**Other existing tests.** Any existing test that breaks **only** because an age label now renders on an old fixture row: fix it by giving that fixture a recent `createdAt` (preferred) or by narrowing the lookup, with a one-line comment naming chunk 74. List them.

`src/lib/iosFocusZoom.test.ts` must stay green (no edit to it).

**Red-first:**
- The new modules don't exist at `1584920`, so their test files fail to load there by construction; report that as one line.
- The behavioural red-first: with everything written, restore three components from `1584920` and run their tests:

```bash
mkdir -p "$TMPDIR/c74/src/components/gamify"
cp src/components/TaskRow.tsx "$TMPDIR/c74/src/components/TaskRow.tsx"
cp src/components/TodayPanel.tsx "$TMPDIR/c74/src/components/TodayPanel.tsx"
cp src/components/gamify/DailyHero.tsx "$TMPDIR/c74/src/components/gamify/DailyHero.tsx"
git show 1584920:src/components/TaskRow.tsx > src/components/TaskRow.tsx
git show 1584920:src/components/TodayPanel.tsx > src/components/TodayPanel.tsx
git show 1584920:src/components/gamify/DailyHero.tsx > src/components/gamify/DailyHero.tsx
npx vitest run src/components/TaskRow.test.tsx src/components/TodayPanel.test.tsx src/components/gamify/DailyHero.test.tsx
cp "$TMPDIR/c74/src/components/TaskRow.tsx" src/components/TaskRow.tsx
cp "$TMPDIR/c74/src/components/TodayPanel.tsx" src/components/TodayPanel.tsx
cp "$TMPDIR/c74/src/components/gamify/DailyHero.tsx" src/components/gamify/DailyHero.tsx
git status --short
```

Report pass/fail counts per file. Name every new or rewritten test that passes against the old code (say so; don't count it as a guard). The final `git status --short` must match your change set exactly.

### D8 Commit routing

- **One code commit**, pushed **alone**, **no `[skip ci]`**.
- **Expected files:**
  - New: `src/lib/taskAge.ts`, `src/lib/taskAge.test.ts`, `src/lib/review.ts`, `src/lib/review.test.ts`, `src/components/ReviewPrompt.tsx`, `src/components/ReviewSheet.tsx`, `src/components/ReviewSheet.test.tsx`, `src/components/BusyStrip.test.tsx`.
  - Changed: `src/components/BusyStrip.tsx`, `src/components/TaskRow.tsx`, `src/components/TaskRow.test.tsx`, `src/components/TodayPanel.tsx`, `src/components/TodayPanel.test.tsx`, `src/components/gamify/DailyHero.tsx`, `src/components/gamify/DailyHero.test.tsx`, `src/screens/Dashboard.tsx`, `src/screens/Dashboard.test.tsx`.
  - Plus any test file D7 lets you fix for the age label.
  - Anything else: stop and report before committing.
- **Subject:** `Chunk 74: Task age, weekly review, shorter Dashboard top (UX audit #10, #11)`.
- **Gates before the push**, on a clean `npm ci`: `tsc -b` clean; `eslint .` 0 problems; `vitest run` all green; `TZ=UTC npx vitest run` all green; `npm run build` green.
- **Base figures** at `1584920` (orchestrator, cloud container, Node 22, clean clone, placeholder `.env.local` with the real `VITE_CALDAV_PROXY_URL`):
  - `vitest run` **1026 / 1026** in **92** files, in `America/New_York` and in `UTC`.
  - Eager JS **1,044,878 B**.
  - Run your own base on the Mac **in both zones** this time and report it with your after.
- **Eager JS limit: +6 kB.** `ReviewSheet` is lazy; if you are over, say what else you made lazy.
- **After the push:** deploy run id and result; live `version.json` read cache-busted.

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

Expect `1584920`. If `main` is anywhere else, stop and report.

```bash
rm -rf node_modules
npm ci
npx vitest run
TZ=UTC npx vitest run
npm run build
python3 -c "import re,os;h=open('dist/index.html').read();f=set(re.findall(r'(?:src|href)=\"/dashboard/(assets/[^\"]+\.js)\"',h));print(len(f),sum(os.path.getsize('dist/'+x) for x in f))"
```

Record the base. Implement D1–D6, write the D7 tests, run red-first. Then:

```bash
npx tsc -b
npx eslint .
npx vitest run
TZ=UTC npx vitest run
npm run build
python3 -c "import re,os;h=open('dist/index.html').read();f=set(re.findall(r'(?:src|href)=\"/dashboard/(assets/[^\"]+\.js)\"',h));print(len(f),sum(os.path.getsize('dist/'+x) for x in f))"
git diff --stat 1584920 -- package.json package-lock.json
git add src/lib/taskAge.ts src/lib/taskAge.test.ts src/lib/review.ts src/lib/review.test.ts src/components/ReviewPrompt.tsx src/components/ReviewSheet.tsx src/components/ReviewSheet.test.tsx src/components/BusyStrip.tsx src/components/BusyStrip.test.tsx src/components/TaskRow.tsx src/components/TaskRow.test.tsx src/components/TodayPanel.tsx src/components/TodayPanel.test.tsx src/components/gamify/DailyHero.tsx src/components/gamify/DailyHero.test.tsx src/screens/Dashboard.tsx src/screens/Dashboard.test.tsx
git status --short
git commit
git push origin main
```

- Add any test file you fixed under D7 to the `git add` line.
- `git status --short` after `git add` must show only the D8 files staged.
- The commit body lists D1–D5 in one line each and ends with the `Co-Authored-By` trailer per `CLAUDE.md`.

**Stop after the push and report.** Do not write docs. Do not run the smoke.

### 2. Gate + smoke (orchestrator, not you)

**Gate:** clean clone at your SHA in the cloud container. It runs:
- the scope diff against `1584920`;
- `tsc -b`, `eslint .`, and `vitest run` in three zones;
- the build and eager JS;
- the deployed CSS hash match;
- chunk-74 markers in the deployed JS: `hup:lastReview`, `older than 90 days`, `Busy times unavailable`;
- the live `version.json`.

**Smoke:** deployed app in Sergio's Chrome via the Claude in Chrome extension, tab in the foreground.
- **Allowed writes:** two throwaway tasks, `Smoke-74a` and `Smoke-74b`, created through capture. Their `created_at` is back-dated through PostgREST (401 and 400 days), both are removed at the end, and no other task is touched.
- **Storage:** `localStorage['hup:lastReview']` is read before and restored after.

Steps:
1. **Age chips:** the Dashboard rows show week labels (Sergio's tasks are 96–142 days old, so 13w–20w). After back-dating, the two smoke rows show `1y`.
2. **Above the fold**, at the base window (1456 × 853, `stacked`), with the review prompt dismissed:
   - the hero is one line;
   - there is no standalone busy strip;
   - the busy text sits in the Today header;
   - the first task row's top is **at least 150 px higher than the base 1465**.
3. **Review prompt:** shows with the right count. Review →
   - `Smoke-74b` is first: `Delete`;
   - `Smoke-74a` next: `Add to Today`;
   - Escape.
4. **After the close:**
   - one `Task deleted` toast with Undo;
   - `Smoke-74b` is gone from Supabase after 8 s;
   - `Smoke-74a` is in the Today panel;
   - the prompt is hidden and `hup:lastReview` is set;
   - none of Sergio's own tasks changed (`updated_at` read before and after).
5. **Cleanup:** remove `Smoke-74a` from Today and delete it (⋯ → Delete). Restore `hup:lastReview`.
6. **382 px frame:** no sideways scroll on the Dashboard with age chips showing; the compact hero wraps cleanly.
7. **Console:** clean.

### 3. Docs (`[skip ci]`, after the orchestrator's gate and smoke pass)

**`ARCHITECTURE.md` §13.** Append:

> Ageing and the top of the Dashboard (chunk 74): open rows 28 days or older show their age (`4w`, `1y`; `lib/taskAge`, calendar days in the Settings time zone; hidden on completed rows). Once a week (per device, `localStorage['hup:lastReview']`) the Dashboard offers a review of open, unplanned tasks 90 days or older (`lib/review`): Keep, Add to Today, or Delete, one at a time; deletes run when the sheet closes, through the chunk-72 Undo. With nothing planned the hero is one line (greeting, chips, What's next?); the busy times sit in the Today header (`BusyInline`), and the standalone strip remains only on first run and with Today off. Today no longer draws a hint box under an empty header.

**`ARCHITECTURE.md` §7.** After the `auth_failed` banner sentence, append:

> Since chunk 74 the Dashboard shows today's busy times as a line in the Today header; the standalone strip is used only on first run and when the Today list is off. The reconnect banner is unchanged.

**`PROGRESS.md`:**
- **Row 74 ☑:**
  - the step-1 SHA;
  - gates in both runner zones, Mac base in both zones;
  - red-first counts;
  - test count and file count;
  - eager JS before / after;
  - deploy run and live `version.json`;
  - the orchestrator's gate and smoke result, including the first-row measurement;
  - test files fixed for the age label;
  - deviations, numbered.
- **Decisions log:** D1–D5 (2026-10-13, chunk 74), one row each. D2's row states that the review date is per device by choice (no schema change), and that deletes wait for the sheet to close so Undo stays clickable.
- **Last-updated paragraph:** per the chunk-54 convention. The chunk-73 paragraph moves to Update history, relabelled `Prior update:` (prefix only).

Commit this prompt as `prompts/chunk-74-age-and-fold.md` in the same commit, copied from the file, not retyped. If row 74 must name the docs SHA, record it in an immediate `[skip ci]` follow-up (chunk-54 convention).

---

## Out of scope

- A synced review date or any schema change; snoozing a single task; swipe gestures in the review.
- Contrast (#14), landmarks and row tab stops (#16), the tab set (#17), Settings (#18), smaller items (#19).
- Sizing suggestions against free time; merging the Recovered card into the review.
- The `SetReminderPopover` (6) failure under `TZ=Asia/Tokyo` (pre-existing, chunk 73 known gap).

## Report back

- **Step 1:**
  - commit SHA and `git diff --stat 1584920 <SHA>`;
  - gates (`tsc -b`, `eslint .`, test count and file count in both runner zones, build), with the Mac base in both zones;
  - red-first counts, with the non-guard tests named;
  - eager JS before / after / delta, and what is lazy;
  - the empty `package.json` diff;
  - deploy run id and result;
  - live `version.json`.
- Existing test files fixed for the age label, listed.
- Anything you built that departs from D1–D7, and why.
- Every deviation, numbered.
