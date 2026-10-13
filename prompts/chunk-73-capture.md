# Chunk 73: Quick capture and task search (UX audit #7)

**Runs on:** Claude Code, in `~/Documents/To-Do Dashboard` on Sergio's Mac (repo `smrios07mdb/dashboard`). You write the code and the tests. App code only: no SQL, no migration, no proxy, no new dependency.

**Bases:**
- App `smrios07mdb/dashboard` @ `d3f6f22` (docs). Last code commit `4de0390` (chunk 72), which is what's live.
- Proxy untouched.

**Authority:** `ARCHITECTURE.md` → `prompts/README.md` → this prompt. Read first: `CLAUDE.md`, `prompts/README.md`, `src/db/repo.ts` (`categoriesRepo.list`, `subcategoriesRepo.list`, `tasksRepo.create`, `tasksRepo.listIncomplete`), `src/db/types.ts`, `src/components/ProtectedLayout.tsx`, `src/components/AppShell.tsx`, `src/components/Tabs.tsx`, `src/components/AddTaskInline.tsx`, `src/components/SetDuePopover.tsx` (`fromDueInputValue`, the due-date contract), `src/lib/userTimezone.ts` (`loadUserTimezone`), `src/lib/clock.ts` (`dateKeyIn`), `src/lib/notes.ts` (`isNoteEditorPath`), `src/lib/taskUndo.ts`, `src/state/uiStore.ts`, `src/screens/Dashboard.tsx` (`onCreateTask`, the `dashboardRefreshKey` effect), `src/components/ui/dialog.tsx`, `src/components/MarginEditor.tsx` (window key-listener idiom), `src/lib/iosFocusZoom.test.ts`, `src/App.tsx` (routes, the sonner `Toaster`).

**Scope:** UX audit 2026-10-13 (`ux-audit-2026-10-13.md` in the Claude project), finding 7. Nothing else from the audit.

---

## The problem, as committed at `d3f6f22`

- **No global capture.** The only way to add a task is to scroll to a subcategory and open its inline `+ New task` (`AddTaskInline`): title and minutes, nothing else.
- **No signal at capture.** Priority and due date are reachable only from ⋯ on the row after the task exists. None of Sergio's 28 open tasks has either, so Today, sort-by-priority and the due chip (chunk 71) have nothing to work with.
- **No shortcut.** The only window key listeners are the planner drag, the margin editor and the busy popover.
- **No task search.** Search exists only in the Notebook.

---

## Locked decisions (orchestrator, 2026-10-13)

### D1 No Inbox list; capture defaults to the last-used destination

- No new subcategory is created, no schema change. Every captured task goes into an existing live subcategory.
- **Destination resolution**, first match wins:
  1. A `#list` token in the text (D2). A subcategory token decides outright. A category-only token (`#work`, `#personal`) narrows steps 2–4 to that category: the remembered destination if it is in that category, else its live `General`, else its first live subcategory by `sortOrder`.
  2. The remembered destination: `localStorage['hup:captureDest']` (a subcategory id), if it is still a live (non-archived) subcategory. Every read/write in `try/catch`.
  3. The first live subcategory named `General` (case-insensitive) in Personal, then in Work.
  4. The first live subcategory of Personal by `sortOrder`, then of Work.
  5. None: the dialog says `Add a list first` and Add is disabled.
- The remembered destination is written **only after a successful create**, to the subcategory the task went into (whether it came from a tag, the picker or the default).

### D2 Inline grammar: `src/lib/captureParse.ts` (new)

Pure TypeScript, no React, no I/O, no clock read. `now` and `timeZone` are always passed in.

```ts
export type CaptureTokenKind = 'priority' | 'estimate' | 'due' | 'list'

export type CaptureToken = {
  index: number          // word index in the input (split on whitespace)
  text: string           // the word as typed
  kind: CaptureTokenKind
  label: string          // chip text: 'P1', '15m', '1h 30m', 'Today', 'Tomorrow', 'Fri Oct 16', 'Work › Deals', 'Work'
}

export type CaptureParse = {
  title: string                    // unrecognised words, single-spaced, trimmed
  priority: 1 | 2 | 3 | null
  estimateMinutes: number | null
  dueDay: string | null            // 'YYYY-MM-DD', a calendar day in timeZone
  subcategoryId: string | null     // from a #list token
  categoryId: string | null        // from #work / #personal, or the matched subcategory's category
  tokens: CaptureToken[]           // recognised, in input order
  unknownTags: string[]            // '#foo' words that matched nothing (kept in the title)
}

export function parseCapture(
  input: string,
  ctx: {
    now: Date
    timeZone: string
    categories: Category[]
    subcategories: Subcategory[]   // live only; the caller filters archivedAt
    ignore?: ReadonlySet<number>   // word indices the user un-parsed (D3 chip ×)
  },
): CaptureParse
```

Rules:
- **Words:** split on whitespace. A word is recognised only as a whole word, case-insensitive. Indices in `ignore` are never recognised and stay in the title.
- **One per kind:** the first recognised word of each kind wins; a later word of the same kind is not recognised and stays in the title.
- **Priority:** `p1`, `p2`, `p3`.
- **Estimate:** `15m`, `15min`, `2h`, `1.5h`, `1h30m`. Integer minutes after rounding; must be 1–1440 or the word is not recognised. Label: `15m`, `2h`, `1h 30m`.
- **Due:**
  - `today`, `tod` → today; `tomorrow`, `tmr`, `tmrw` → today + 1.
  - Weekdays `mon tue tues wed thu thur thurs fri sat sun` and the full names → the next date with that weekday **after** today (so `fri` typed on a Friday means next Friday; `today` is the word for today).
  - `M/D` (`10/24`, `1/5`) → that date this year if it is today or later, else next year. An impossible date (`2/30`) is not recognised.
  - "Today" is `dateKeyIn(ctx.now, ctx.timeZone)`. All day arithmetic runs on that `YYYY-MM-DD` key via `Date.UTC`, never on local `Date` methods, so the result is the same in every runner time zone.
  - Label: `Today`, `Tomorrow`, else `EEE MMM d` of the day (`Fri Oct 16`).
- **List:** a word `#slug` where slug is letters, digits, `_` or `-` (Unicode letters allowed). Compare by `norm(s) = s.toLowerCase()` with everything but letters and digits removed.
  - `norm(slug)` equal to `work` or `personal` → that category (`categoryId`, no `subcategoryId`). Label: the category name.
  - Else the first live subcategory whose `norm(name)` equals it, searching categories in `ctx.categories` order and subcategories by `sortOrder`. If a category token appears anywhere in the input, only that category is searched. Sets `subcategoryId` and `categoryId`. Label: `Work › Deals`.
  - No match → `unknownTags`, and the word stays in the title.
  - Only one list token counts: a category token plus a subcategory token in that category are both recognised (the subcategory decides); any other list word stays in the title.
- **Title:** the remaining words joined with one space and trimmed.

### D3 The capture dialog: `src/components/capture/QuickCapture.tsx` (new)

- Radix `Dialog` from `@/components/ui/dialog`. Content anchored near the top on `sm`+ (about 15 % from the top, `max-w-lg`), full width at the top on phones, so the on-screen keyboard never covers it. Heading `New task` (`.label` style); `DialogDescription` sr-only: `Type a task. Add p1, 15m, tomorrow or #list to set them.`
- **Input:** one text input, `aria-label="Task"`, placeholder `Call Bob tomorrow p1 15m #work`, `text-base sm:text-[14px]` (the iOS focus-zoom guard must stay green). Autofocused on open.
- **On open:** load `repo.categories.list()`, `repo.subcategories.list()` (keep `archivedAt === null`) and `loadUserTimezone()` in parallel. Until all three resolve the input is enabled but Add is disabled. A load failure shows `Could not load your lists — retry.` with a Retry button.
- **Preview row** (under the input, re-parsed on every change with `now = new Date()`):
  - The **destination chip**: `Personal › General`, from D1 (a `#list` token's result replaces it). It is a button that reveals a native `<select aria-label="List">` of live subcategories grouped by category (`<optgroup>`), `text-base sm:text-[13px]`. Choosing a list removes any list token's effect (adds its index to `ignore`) and sets the destination for this capture.
  - One chip per recognised token except list (P1, 15m, Today…), each with a × button `aria-label="Keep “<text>” in the title"` that adds the token's index to `ignore`.
  - For each unknown tag: one muted line `No list “#foo” — kept in the title.`
- **Submit:** Enter or the Add button. Disabled while the parsed title is empty, while loading, or while submitting.
  - `repo.tasks.create({ userId, subcategoryId, title, estimateMinutes: estimateMinutes ?? 30, dueAt: dueDay ? fromDueInputValue(dueDay, timeZone) : null, remindAt: null, priority, completedAt: null })`. `30` is `AddTaskInline`'s `DEFAULT_MINUTES`: export it from there (with the `eslint-disable-next-line react-refresh/only-export-components` comment `SetDuePopover` uses for its exports) and import it, rather than a second literal.
  - Success: `toast('Task added — <Category> › <Sub>')`, write `hup:captureDest`, call `useUIStore.getState().forceDashboardRefresh()`, clear the input and the `ignore` set, keep the dialog open with focus in the input (the `AddTaskInline` pattern).
  - Failure: `toast.error('Could not save — retry')` (the Dashboard's `SAVE_ERROR` text), input kept.
- **Escape** closes (Radix default). Closing resets the input and `ignore`.
- A `Search tasks` text button in the dialog footer switches to the search dialog (D4) carrying the current input as the query.
- `userId` comes from `useSession()`. No user → the dialog does not open.

### D4 Task search: `src/lib/taskSearch.ts` and `src/components/capture/TaskSearch.tsx` (new)

```ts
export type TaskSearchHit = { task: Task; subName: string; catName: string }

/** Open tasks matching every whitespace-separated term of `query`. */
export function searchTasks(
  query: string,
  data: { categories: Category[]; subcategories: Subcategory[]; tasks: Task[] },
  limit = 20,
): TaskSearchHit[]
```

- Pure. Case-insensitive substring match of each term against `title + ' ' + subName`. Skips completed tasks and tasks whose subcategory is missing or archived. Blank query → `[]`.
- Order: titles that start with the first term first, then everything else; within each group oldest `createdAt` first. Cut to `limit`.
- **Dialog:** same placement as D3. Heading `Search`; input `aria-label="Search tasks"`, `type="search"`, `text-base sm:text-[14px]`. On open, load categories, subcategories and `repo.tasks.listIncomplete()` (pending deletes are already filtered there, chunk 72).
- **Results:** a `role="listbox"` of up to 20 `role="option"` rows: the title (two lines max) and `Work › Deals` muted below. ↑/↓ move the active option (`aria-activedescendant` on the input), Enter or a click opens it: close the dialog and `navigate('/subcategory/<id>')`.
- Empty query: `Type to search open tasks.` No match: `No open task matches “<query>”.` plus a button `Add “<query>” as a task` that switches to the capture dialog with the query as its text.
- No search over completed tasks, notes or subcategory names alone.

### D5 Entry points

- **State:** `uiStore` gains `capture: { mode: 'add' | 'search'; text: string } | null`, `openCapture(mode, text = '')` and `closeCapture()`. `ProtectedLayout` renders `<QuickCapture />` and `<TaskSearch />`, each open when `capture?.mode` matches.
- **Keyboard** (`src/components/capture/useCaptureShortcuts.ts`, a hook called once in `ProtectedLayout`; one `keydown` listener on `window`, removed on unmount):
  - `n` or `N` → `openCapture('add')`; `/` → `openCapture('search')`. Ignored when any of: `e.defaultPrevented`, `e.isComposing`, a `ctrl`/`meta`/`alt` modifier, `e.repeat`, the target is an `input`, `textarea`, `select` or `isContentEditable`, a dialog or menu is already open (`document.querySelector('[role="dialog"], [role="alertdialog"], [role="menu"]')`), or the route is the Notebook editor (`isNoteEditorPath`). `preventDefault` when it fires.
  - `⌘K` / `Ctrl+K` → `openCapture('add')` from anywhere, inputs included, except when a capture or search dialog is already open; `preventDefault`.
- **Desktop button:** in the header, before `SyncIndicator` (pass it through `headerEnd` in `ProtectedLayout`): `hidden sm:inline-flex`, `+ New task` with a `<kbd>N</kbd>` hint, opens `add`.
- **Phone button:** a floating round + button, `sm:hidden`, `aria-label="New task"`, 56 px, fixed at right 16 px and bottom `calc(3.5rem + env(safe-area-inset-bottom) + 16px)` so it sits above the bottom tab bar. Not rendered on the Notebook editor route or while a capture dialog is open.
- Search on a phone is reached from the capture dialog's `Search tasks` button. No search tab or header search.

### D6 What does not change

- `AddTaskInline`, `TaskRow`, `TaskMenu`, `SetDuePopover`, `PriorityPicker` and every per-row flow. Capture is an extra path, not a replacement.
- `src/db/*` (no new repo method), `lib/today.ts`, `lib/todaySuggest.ts`, `lib/taskUndo.ts`, `state/todayPlan.ts`, `Planner.tsx`, `Notebook` and its search.
- `Tabs.tsx` and the tab set.
- `package.json` / `package-lock.json`.

### D7 Tests (you write them)

**`src/lib/captureParse.test.ts`** (new). `now = new Date('2026-10-13T16:00:00Z')` (Tuesday in New York), `timeZone = 'America/New_York'`, fixtures in repo order — categories Personal then Work (`categoriesRepo.list` sorts by name); Personal {General, Errands}, Work {General, Deals, Hiring Plan}:
1. `Call Bob tomorrow p1 15m #work` → title `Call Bob`, priority 1, 15, dueDay `2026-10-14`, categoryId Work, subcategoryId null, 4 tokens in order.
2. `fri` → `2026-10-16`; `tue` → `2026-10-20` (next Tuesday, not today); `today` → `2026-10-13`.
3. `10/24` → `2026-10-24`; `1/5` → `2027-01-05`; `10/13` → `2026-10-13`; `2/30` not recognised, stays in title.
4. `2h` → 120; `1.5h` → 90; `1h30m` → 90; `0m` and `25h` not recognised.
5. `#deals` → Deals; `#hiring-plan` and `#HiringPlan` → Hiring Plan.
6. `#general` alone → Personal › General (Personal is first in `categories` order); `#work #general` → Work › General.
7. `#foo` → `unknownTags: ['#foo']`, title keeps `#foo`.
8. `p1 p2` → priority 1, title `p2`.
9. `ignore: {index of 'tomorrow'}` → dueDay null, title keeps `tomorrow`.
10. Day boundary: `now = 2026-10-14T03:30:00Z` (still Oct 13 in New York) → `today` is `2026-10-13`; with `timeZone = 'UTC'` it is `2026-10-14`.
11. Only list tokens and spaces → title `''`.

**`src/lib/taskSearch.test.ts`** (new): multi-term AND match; subcategory name matches; completed and archived-subcategory tasks excluded; prefix-first then oldest ordering; limit; blank query `[]`.

**`src/components/capture/QuickCapture.test.tsx`** (new), `repo`, `loadUserTimezone` (`'America/New_York'`), `useSession` and `sonner` mocked, system time fixed:
1. Typing `Call Bob tomorrow p1 15m #work` and pressing Enter calls `repo.tasks.create` once with title `Call Bob`, priority 1, estimate 15, `dueAt` `2026-10-14T04:00:00.000Z`, `subcategoryId` = Work › General; `toast` reads `Task added — Work › General`; `forceDashboardRefresh` called; input cleared and focused.
2. Chips: P1, 15m, Tomorrow shown; × on Tomorrow → the create has `dueAt: null` and title `Call Bob tomorrow`.
3. No tag, no stored destination → Personal › General. Stored `hup:captureDest` of a live sub → that sub; of an archived sub → falls back.
4. After a successful create into Deals, `localStorage['hup:captureDest']` is Deals' id. A failed create leaves it unchanged and shows `toast.error`.
5. Add disabled for an empty title and for `#work 15m` alone.
6. `#foo` shows `No list “#foo” — kept in the title.`
7. Choosing a list in the `List` select overrides a `#list` token.
8. No live subcategories → `Add a list first`, Add disabled.

**`src/components/capture/TaskSearch.test.tsx`** (new): results listbox for a query; ↓ + Enter navigates to `/subcategory/<id>` (MemoryRouter) and closes; no-match button switches `uiStore.capture` to `{ mode: 'add', text: query }`.

**`src/components/capture/useCaptureShortcuts.test.tsx`** (new): `n` opens add; `/` opens search; `n` typed in an input does nothing; `n` with `meta` does nothing; `n` while `role="dialog"` is in the DOM does nothing; `Ctrl+K` inside an input opens add; on a Notebook editor path `n` does nothing.

**`src/components/ProtectedLayout.test.tsx`** (new; `Protected`, `NotesProvider`, `useSession` and `repo` mocked as needed): the header `New task` button and the floating `New task` button both render and each opens the capture dialog; on a Notebook editor path the floating button is absent.

`src/lib/iosFocusZoom.test.ts` must stay green with the new inputs and select (no edit to it).

Any existing lookup that breaks only because a second `New task` name now exists on the page (the inline `+ New task` buttons): narrow only that lookup (e.g. `within(section)`), with a one-line comment naming chunk 73. List them.

**Red-first:** the new modules don't exist at `d3f6f22`, so their test files fail to load there by construction; report that as one line. The behavioural red-first is the entry points: with everything written, restore `src/components/ProtectedLayout.tsx` and `src/state/uiStore.ts` from `d3f6f22` and run only `useCaptureShortcuts.test.tsx` and the entry-point test:

```bash
mkdir -p "$TMPDIR/c73/src/components" "$TMPDIR/c73/src/state"
cp src/components/ProtectedLayout.tsx "$TMPDIR/c73/src/components/ProtectedLayout.tsx"
cp src/state/uiStore.ts "$TMPDIR/c73/src/state/uiStore.ts"
git show d3f6f22:src/components/ProtectedLayout.tsx > src/components/ProtectedLayout.tsx
git show d3f6f22:src/state/uiStore.ts > src/state/uiStore.ts
npx vitest run src/components/capture/useCaptureShortcuts.test.tsx src/components/ProtectedLayout.test.tsx
cp "$TMPDIR/c73/src/components/ProtectedLayout.tsx" src/components/ProtectedLayout.tsx
cp "$TMPDIR/c73/src/state/uiStore.ts" src/state/uiStore.ts
git status --short
```

Report pass/fail counts per file and name any new test that passes against the old code (say so; don't count it as a guard). The final `git status --short` must match your change set exactly.

### D8 Commit routing

- **One code commit**, pushed **alone**, **no `[skip ci]`**. Expected files: `src/lib/captureParse.ts`, `src/lib/captureParse.test.ts`, `src/lib/taskSearch.ts`, `src/lib/taskSearch.test.ts`, `src/components/capture/QuickCapture.tsx`, `src/components/capture/QuickCapture.test.tsx`, `src/components/capture/TaskSearch.tsx`, `src/components/capture/TaskSearch.test.tsx`, `src/components/capture/useCaptureShortcuts.ts`, `src/components/capture/useCaptureShortcuts.test.tsx`, `src/components/ProtectedLayout.tsx`, `src/state/uiStore.ts`, `src/components/AddTaskInline.tsx` (only to export the default-minutes constant), `src/components/ProtectedLayout.test.tsx`, plus any test file whose lookups D7 lets you narrow. Anything else: stop and report before committing.
- Subject: `Chunk 73: Quick capture and task search (UX audit #7)`.
- Gates before the push, on a clean `npm ci`: `tsc -b` clean; `eslint .` 0 problems; `vitest run` all green; `TZ=UTC npx vitest run` all green; `npm run build` green.
- Base figures at `d3f6f22` (orchestrator, cloud container, Node 22, clean clone, placeholder `.env.local` with the real `VITE_CALDAV_PROXY_URL` — the chunk-50 mirror-count tests need it): `vitest run` **957 / 957** in **86** files in `America/New_York` and `UTC`; eager JS **1,043,151 B**. Report your own base on the Mac and your after.
- Eager JS limit: **+8 kB**.
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

Expect `d3f6f22`. If `main` is anywhere else, stop and report.

```bash
rm -rf node_modules
npm ci
npx vitest run
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
git diff --stat d3f6f22 -- package.json package-lock.json
git add src/lib/captureParse.ts src/lib/captureParse.test.ts src/lib/taskSearch.ts src/lib/taskSearch.test.ts src/components/capture/QuickCapture.tsx src/components/capture/QuickCapture.test.tsx src/components/capture/TaskSearch.tsx src/components/capture/TaskSearch.test.tsx src/components/capture/useCaptureShortcuts.ts src/components/capture/useCaptureShortcuts.test.tsx src/components/ProtectedLayout.tsx src/state/uiStore.ts src/components/AddTaskInline.tsx src/components/ProtectedLayout.test.tsx
git status --short
git commit
git push origin main
```

Add any test file you narrowed under D7 to the `git add` line. `git status --short` after `git add` must show only the D8 files staged. The commit body lists D1–D5 in one line each and ends with the `Co-Authored-By` trailer per `CLAUDE.md`.

**Stop after the push and report.** Do not write docs. Do not run the smoke.

### 2. Gate + smoke (orchestrator, not you)

Gate: clean clone at your SHA in the cloud container — scope diff against `d3f6f22`, `tsc -b`, `eslint .`, `vitest run` in three zones, build, eager JS, deployed CSS hash match, chunk-73 markers in the deployed JS (`hup:captureDest`, `Search tasks`, `Add a list first`), live `version.json`.

Smoke: deployed app in Sergio's Chrome via the Claude in Chrome extension, tab in the foreground. Writes are limited to **one throwaway task** created through capture and removed at the end; no other task is touched. `localStorage['hup:captureDest']` is read before and restored after.
- Press `n` on the Dashboard → the dialog opens with focus in the input. Type `Smoke-73 tomorrow p2 15m #personal` → chips Tomorrow, P2, 15m; destination Personal › General (or Personal's fallback per D1).
- Enter → `Task added — Personal › …` toast; the dialog stays open and empty. Supabase `tasks` row for `Smoke-73`: priority 2, estimate 15, `due_at` 00:00 tomorrow in `America/New_York`, the expected `subcategory_id`. The row shows on the Dashboard with the `Tomorrow` chip without a reload.
- Escape. Press `/`, type `smoke-73` → one result `Personal › …`; Enter → lands on that subcategory.
- `⌘K` from inside a focused input elsewhere (Settings) → the capture dialog opens; Escape.
- 386 px frame: the floating + shows above the tab bar and opens the dialog; no sideways scroll; the header has no `New task` text button.
- ⋯ → Delete on `Smoke-73`, no Undo; after 8 s the Supabase row is gone. Restore `hup:captureDest`.
- Console clean.

### 3. Docs (`[skip ci]`, after the orchestrator's gate and smoke pass)

**`ARCHITECTURE.md` §13**
- Append: "Capture (chunk 73): `N` or `⌘K` (or `+ New task` in the header, the floating + on phones) opens one capture field. `lib/captureParse` reads `p1–p3`, an estimate (`15m`, `1h30m`), a due day (`today`, `tomorrow`, a weekday — always the next one after today — or `M/D`) in the Settings time zone, and `#work` / `#personal` / `#<list>`; each recognised word shows as a chip whose × keeps the word in the title. With no list token the task goes to the last list captured into (`localStorage['hup:captureDest']`), else General in Personal, then Work. `/` searches open tasks by title and list (`lib/taskSearch`) and opens the hit's list. No Inbox list; the inline `+ New task` is unchanged."

**`PROGRESS.md`**
- Row 73 ☑: the step-1 SHA, gates (both runner zones), red-first counts, test count and file count, eager JS before/after, deploy run, live `version.json`, the orchestrator's gate and smoke result, narrowed lookups, deviations numbered.
- Decisions log: D1–D5 (2026-10-13, chunk 73), one row each. D1's row states that the last-used list was chosen over a new Inbox list.
- Last-updated paragraph per the chunk-54 convention; the chunk-72 paragraph moves to Update history, relabelled `Prior update:` (prefix only).

Commit this prompt as `prompts/chunk-73-capture.md` in the same commit. If row 73 must name the docs SHA, record it in an immediate `[skip ci]` follow-up (chunk-54 convention).

---

## Out of scope

- An Inbox list, or any new subcategory created by capture.
- Reminder times (`3pm`), month names (`Oct 24`), relative phrases (`next week`, `in 3 days`), recurrence.
- AI parsing of the capture text.
- Search over completed tasks, notes or subcategory names alone; highlighting the hit inside the subcategory view.
- Row age (#10), above-the-fold (#11), contrast (#14), landmarks and row tab stops (#16), the tab set (#17).
- The delete-then-sign-out gap left by chunk 72.

## Report back

- **Step 1:** commit SHA; `git diff --stat d3f6f22 <SHA>`; gates (`tsc -b`, `eslint .`, test count and file count in both runner zones, build); red-first counts and the non-guard tests named; eager JS before / after / delta; the empty `package.json` diff; deploy run id and result; live `version.json`.
- Existing test lookups you narrowed, listed.
- Anything you built that departs from D1–D7, and why.
- Every deviation, numbered.
