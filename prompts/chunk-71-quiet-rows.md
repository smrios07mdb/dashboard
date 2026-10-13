# Chunk 71: Quiet task rows (UX audit #6, #8, #15)

**Runs on:** Claude Code, in `~/Documents/To-Do Dashboard` on Sergio's Mac (repo `smrios07mdb/dashboard`). You write the code and the tests. App code only: no SQL, no migration, no proxy, no new dependency.

**Bases:**
- App `smrios07mdb/dashboard` @ `5d2d1a2` (docs). Last code commit `364077b` (chunk 70), which is what's live.
- Proxy untouched.

**Authority:** `ARCHITECTURE.md` → `prompts/README.md` → this prompt. Read first: `CLAUDE.md`, `prompts/README.md`, `src/components/TaskRow.tsx`, `src/components/TaskMenu.tsx`, `src/components/SetDuePopover.tsx` (+ test), `src/components/SetReminderPopover.tsx` (+ test), `src/components/PriorityPicker.tsx` (menu-only anchor pattern), `src/components/ui/checkbox.tsx` (the `::before` hit-area pattern), `src/components/SubcategorySection.tsx`, `src/components/CategoryColumn.tsx`, `src/screens/Dashboard.tsx` (where `timeZone` is resolved), `src/screens/CategoryView.tsx`, `src/screens/SubcategoryView.tsx`, `src/lib/clock.ts` (`dateKeyIn`), `src/lib/userTimezone.ts`, `src/lib/today.ts` (day-frame rules), `src/components/notebook/TaskSide.test.tsx`, and ARCHITECTURE §13 (UI interaction rules, the chunk-59 "Task row" note-column bullet).

**Scope:** UX audit 2026-10-13 (`ux-audit-2026-10-13.md` in the Claude project), findings 6, 8 and 15 for the task row. Undo (#13) is chunk 72. Nothing else from the audit.

---

## The problem, as committed at `5d2d1a2`

- **#6** A due date can be set from ⋯ → Set due date…, but `TaskRow` never shows it; a reminder shows only as a tinted bell with no time.
- **#8** Every row always renders: checkbox, grip, title, a reserved note cell (24 px; 44 px on touch), minutes, sun, bell, trash, ⋯. The title truncates to one line. Trash, reminder and notes are duplicated in ⋯.
- **#15** The grip is 14 px wide with no extended hit area; the minutes button has no minimum height.

---

## Locked decisions (Sergio, 2026-10-13)

### D1 The row shows only what you read or use daily

Columns, left to right:

| Column | Shown when |
|---|---|
| selection checkbox | `selectable` (unchanged) |
| completion checkbox | always |
| grip | `canDrag` (unchanged) |
| title | always |
| priority chip / picker anchor | unchanged rule |
| **when chip** (D2) or a zero-size picker anchor (D3) | see D2/D3 |
| minutes | always |
| sun (Today toggle) | `onToggleToday` given (unchanged) |
| ⋯ | always |

- **Removed from the row:** the bell button, the trash button (`DeleteConfirm` + `Trash2` import leave `TaskRow`), and the note column (button and empty reserved cell, both `data-testid`s). Bell, notes and delete live only in ⋯ (they already do; `TaskMenu` items unchanged).
- This reverses the chunk-59 "note column always reserved" rule. Notes stay reachable through ⋯ → `Notes` / `Add a note`, the subcategory header count, the drill-down `NOTES · N` section and the Notebook.
- **Title wraps to two lines:** replace `truncate` with `line-clamp-2 whitespace-normal break-words`; keep `title={task.title}`. Row stays `items-center`.
- Rewrite `TaskRow`'s header comment: drop the "Standalone trash button is kept…" and chunk-59 note-column paragraphs; describe the chunk-71 columns. Update `TaskMenu`'s header comment where it says the reminder popover is anchored on the bell.

### D2 One "when" chip, after the priority chip

New pure module `src/lib/whenLabel.ts`, no React:

```ts
export type WhenTone = 'late' | 'today' | 'soon' | 'later'
export type WhenLabel = { text: string; tone: WhenTone; long: string }
export function dueLabel(dueAt: string, timeZone: string, now?: Date): WhenLabel
export function reminderLabel(remindAt: string, timeZone: string, now?: Date): WhenLabel
```

Day math uses calendar days in `timeZone` via `dateKeyIn` (same frame as `lib/today.ts`). `n` = whole days from today's key to the target's key.

**`dueLabel`** (a due date is a calendar day; its time of day never matters):

| `n` | `text` | `tone` |
|---|---|---|
| < 0 | `<-n>d late` (e.g. `2d late`) | `late` |
| 0 | `Today` | `today` |
| 1 | `Tomorrow` | `soon` |
| 2–6 | weekday, `Intl` `{ weekday: 'short' }` in `timeZone` (e.g. `Fri`) | `soon` |
| ≥ 7 | `{ month: 'short', day: 'numeric' }` (e.g. `Oct 24`), adding `year: 'numeric'` when the year differs from today's year in `timeZone` | `later` |

**`reminderLabel`:** instant ≤ `now` → `Overdue`, tone `late`. Otherwise `<day> <time>`: day is `Today` / `Tomorrow` / weekday (2–6) / `Oct 24` (≥ 7, year rule as above); time is `Intl` `{ hour: 'numeric', minute: '2-digit' }` in `timeZone` (e.g. `Today 3:00 PM`). Tone `today` for today, `soon` for 1–6, `later` beyond.

**`long`** (for `aria-label`): the full date, `Intl` `{ weekday: 'long', month: 'long', day: 'numeric' }` in `timeZone` (+ year rule; + `, <time>` for reminders), e.g. `Friday, October 16`.

**Chip in `TaskRow`:**
- Not rendered on completed rows.
- `task.dueAt` set → due chip (text only). Else `task.remindAt` set → reminder chip (bell glyph `size-3` + text). Neither → no chip. A due date always wins; one chip per row.
- A `<button type="button">`: `font-mono text-[11px] tabular-nums`, `rounded-sm px-1.5`, `min-h-6` on pointer; on touch add the checkbox's `::before` extension to `size-11` (visual size unchanged, ≥ 44 pt hit). Tone colours: `late` → `text-destructive`; `today` → `text-[var(--accent-ink)]`; `soon` / `later` → `text-ink-2`. Hover `bg-bg-alt`; focus ring as the other row buttons.
- `aria-label`: `Due <long> — edit due date` or `Reminder <long> — edit reminder`. `title`: same without the suffix.
- Clicking the due chip opens `SetDuePopover`; clicking the reminder chip opens `SetReminderPopover`.

### D3 Popover anchors

- `SetReminderPopover.trigger` becomes optional. With a trigger: `PopoverTrigger asChild` (today's behaviour). Without one: a zero-size `PopoverAnchor` span, exactly like `SetDuePopover` today.
- `SetDuePopover` gains an optional `trigger` with the same two modes.
- In `TaskRow`:
  - Due chip shown → it is `SetDuePopover`'s trigger. Reminder chip shown → it is `SetReminderPopover`'s trigger.
  - A popover with no chip of its own (e.g. ⋯ → Set reminder… on a row whose chip is a due chip, or any picker on a row with no chip) renders anchor-only in its own `auto` grid slot **only while open** — today's `dueOpen` pattern, now for both.
- Open state stays in `TaskRow` (`dueOpen`, `reminderOpen`); `TaskMenu` props unchanged.

### D4 Pointer targets (#15)

- Grip: keep the 14 px column and visual; add the checkbox's centred `::before` extension to `size-6` (pointer only — the grip doesn't render on touch). `relative` on the button.
- Minutes button: `min-h-6`.
- Checkbox (already 24 px via `::before`), priority chip, sun and ⋯ unchanged.

### D5 Time zone reaches the row

- `TaskRow` gets an optional `timeZone?: string` prop; when absent it uses `browserTimezone()`.
- Dashboard passes its resolved `timeZone` through `CategoryColumn` → `SortableSubSection` → `SubcategorySection` → `TaskRow` (both open and completed-bucket rows).
- `CategoryView` and `SubcategoryView` resolve it once with `loadUserTimezone()` in an effect (state initialised to `browserTimezone()`), and pass it to their rows. No change to `lib/userTimezone.ts`.

### D6 What does not change

- `TaskMenu` items and their order, `DeleteConfirm`, `PriorityPicker`, `PriorityChip`, `MoveToPicker`, `BlockTimeSheet`, `TodayPanel` (its rows are not `TaskRow`), `lib/today.ts`, `state/todayPlan.ts`, `src/db/*`, `NotesProvider`, the subcategory-header note count, `iosFocusZoom` rules.
- Drag (grip listeners only), inline title / minutes editing, completion celebration, P1 left edge, selection mode.
- `package.json` / `package-lock.json`.

### D7 Tests (you write them)

**`src/lib/whenLabel.test.ts`** (new), `now` pinned, zone `America/New_York` unless stated:
1. `dueLabel` covers −2 (`2d late`/late), 0 (`Today`), 1 (`Tomorrow`), 3 (weekday), 10 (`Mon D`), and a date next calendar year (year shown).
2. Day boundary: `now` = `2026-10-13T03:30:00Z` (Oct 12, 23:30 in New York), `dueAt` = 00:00 Oct 13 New York → `Tomorrow`; the same pair in `UTC` → `Today`.
3. `reminderLabel`: past → `Overdue`/late; later today → `Today 3:00 PM`; in 2 days → `<weekday> 9:00 AM`.
4. `long` for one due and one reminder case.

**`src/components/TaskRow.test.tsx`** (new):
1. Open task, no due/reminder, `onToggleToday` given → buttons present: completion checkbox, title, `Edit minutes`, Today toggle, `Actions for "<title>"`. Absent: `Set reminder` / `Edit reminder`, `Delete task "<title>"`, any `note-indicator` / `note-indicator-empty` test id, any chip.
2. `dueAt` two days late → chip `2d late` with `text-destructive`; clicking it opens the due dialog (assert the date input shows).
3. Reminder only, later today → chip with bell and `Today <time>`; clicking opens the reminder dialog.
4. Both set → only the due chip.
5. Completed task with a due date → no chip.
6. ⋯ → Set reminder… on a row with a due chip opens the reminder popover (anchor-only path), and ⋯ → Delete still shows the confirm.
7. Title button has `line-clamp-2` and not `truncate`; grip has the `before:size-6` extension; minutes button has `min-h-6`.
8. Touch (`useIsTouchDevice` mocked true): chip carries `before:size-11`; no grip.

**`src/components/notebook/TaskSide.test.tsx`**: the `task row note indicator (D6)` block asserts the chunk-59 column. Replace it with: no note indicator in any note-count state; ⋯ reads `Add a note` / `Notes` + relative time / `Notes` + count, each opening the sheet. One-line comment naming chunk 71. Keep every other test in the file as is.

Any other existing lookup that breaks only because a row control moved or the title class changed: change only that lookup, with a one-line comment naming chunk 71. List them.

**Red-first:** with everything written, restore the source files from `5d2d1a2` (delete `whenLabel.ts` for the run) and run only the new/changed test files:

```bash
mkdir -p "$TMPDIR/c71"
for f in src/components/TaskRow.tsx src/components/TaskMenu.tsx src/components/SetDuePopover.tsx src/components/SetReminderPopover.tsx src/components/SubcategorySection.tsx src/components/CategoryColumn.tsx src/screens/Dashboard.tsx src/screens/CategoryView.tsx src/screens/SubcategoryView.tsx; do mkdir -p "$TMPDIR/c71/$(dirname $f)"; cp "$f" "$TMPDIR/c71/$f"; git show 5d2d1a2:$f > "$f"; done
mkdir -p "$TMPDIR/c71/src/lib"; mv src/lib/whenLabel.ts "$TMPDIR/c71/src/lib/whenLabel.ts"
npx vitest run src/lib/whenLabel.test.ts src/components/TaskRow.test.tsx src/components/notebook/TaskSide.test.tsx
for f in src/components/TaskRow.tsx src/components/TaskMenu.tsx src/components/SetDuePopover.tsx src/components/SetReminderPopover.tsx src/components/SubcategorySection.tsx src/components/CategoryColumn.tsx src/screens/Dashboard.tsx src/screens/CategoryView.tsx src/screens/SubcategoryView.tsx src/lib/whenLabel.ts; do cp "$TMPDIR/c71/$f" "$f"; done
git status --short
```

Adjust both file lists to what you actually changed and created, and add any other test file you changed to the `vitest run` line. Report pass/fail counts per test file, and name every new test that passes against the old code (say so; don't count them as guards). The final `git status --short` must match your change set exactly.

### D8 Commit routing

- **One code commit**, pushed **alone**, **no `[skip ci]`**. Expected files: `src/lib/whenLabel.ts`, `src/lib/whenLabel.test.ts`, `src/components/TaskRow.tsx`, `src/components/TaskRow.test.tsx`, `src/components/TaskMenu.tsx` (comment only), `src/components/SetDuePopover.tsx`, `src/components/SetReminderPopover.tsx`, `src/components/SubcategorySection.tsx`, `src/components/CategoryColumn.tsx`, `src/screens/Dashboard.tsx`, `src/screens/CategoryView.tsx`, `src/screens/SubcategoryView.tsx`, `src/components/notebook/TaskSide.test.tsx`, plus any test file whose lookups D7 lets you change. Anything else: stop and report before committing.
- Subject: `Chunk 71: Quiet task rows (UX audit #6, #8, #15)`.
- Gates before the push, on a clean `npm ci`: `tsc -b` clean; `eslint .` 0 problems; `vitest run` all green; `TZ=UTC npx vitest run` all green; `npm run build` green.
- Base figures at `5d2d1a2` (orchestrator, cloud container, Node 22, clean clone, placeholder `.env.local`): `vitest run` **919 / 919** in **83** files, both zones; eager JS **1,039,476 B**. Report your own base on the Mac and your after.
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

Expect `5d2d1a2`. If `main` is anywhere else, stop and report.

```bash
rm -rf node_modules
npm ci
npx vitest run
npm run build
python3 -c "import re,os;h=open('dist/index.html').read();f=set(re.findall(r'(?:src|href)=\"/dashboard/(assets/[^\"]+\.js)\"',h));print(len(f),sum(os.path.getsize('dist/'+x) for x in f))"
```

Record the base. Implement D1–D5, write the D7 tests, run red-first. Then:

```bash
npx tsc -b
npx eslint .
npx vitest run
TZ=UTC npx vitest run
npm run build
python3 -c "import re,os;h=open('dist/index.html').read();f=set(re.findall(r'(?:src|href)=\"/dashboard/(assets/[^\"]+\.js)\"',h));print(len(f),sum(os.path.getsize('dist/'+x) for x in f))"
git diff --stat 5d2d1a2 -- package.json package-lock.json
git add src/lib/whenLabel.ts src/lib/whenLabel.test.ts src/components/TaskRow.tsx src/components/TaskRow.test.tsx src/components/TaskMenu.tsx src/components/SetDuePopover.tsx src/components/SetReminderPopover.tsx src/components/SubcategorySection.tsx src/components/CategoryColumn.tsx src/screens/Dashboard.tsx src/screens/CategoryView.tsx src/screens/SubcategoryView.tsx src/components/notebook/TaskSide.test.tsx
git status --short
git commit
git push origin main
```

Add any other test file you changed under D7 to the `git add` line. `git status --short` after `git add` must show only the D8 files staged. The commit body lists D1–D5 in one line each and ends with the `Co-Authored-By` trailer per `CLAUDE.md`.

**Stop after the push and report.** Do not write docs. Do not run the smoke.

### 2. Gate + smoke (orchestrator, not you)

Gate: clean clone at your SHA in the cloud container — scope diff against `5d2d1a2`, `tsc -b`, `eslint .`, `vitest run` in both zones, build, eager JS, deployed CSS hash match, chunk-71 markers in the deployed JS, live `version.json`.

Smoke: deployed app in Sergio's Chrome via the Claude in Chrome extension, **read-only** (nothing created, edited, moved, completed or deleted):
- Dashboard rows: checkbox, grip, title, minutes, sun, ⋯ only — no bell, no trash, no note cell.
- Long titles wrap to two lines instead of truncating.
- ⋯ still lists Move to, Set priority…, Set due date…, Set reminder…, Block time, Notes / Add a note, Delete (opened and closed with Escape, nothing chosen).
- Category and Subcategory drill-downs show the same row.
- Any task carrying a due date or reminder shows its chip (the audit found none; if still none, the chip is covered by tests only).
- Console clean.

### 3. Docs (`[skip ci]`, after the orchestrator's gate and smoke pass)

**`ARCHITECTURE.md` §13**
- Replace the chunk-59 bullet's "Task row: a note column is always reserved…" sentence(s) with: "Task row (chunk 71): checkbox, grip (pointer), title (up to two lines), priority chip, one when-chip, minutes, Today sun and ⋯. Bell, notes and delete live only in ⋯; the row keeps no note column. The when-chip shows the due date (`2d late` / `Today` / `Tomorrow` / weekday / `Oct 24`) or, when there is none, the reminder (`Today 3:00 PM`, `Overdue`), in the Settings time zone, and opens the matching picker; completed rows have none." Keep the rest of that bullet (the ⋯ `Notes` / `Add a note` wording) intact.
- Append: "Row targets (chunk 71): the grip and the minutes button reach 24 px on pointer; the when-chip reaches 44 pt on touch."

**`PROGRESS.md`**
- Row 71 ☑: the step-1 SHA, gates (both runner zones), red-first counts, test count and file count, eager JS before/after, deploy run, live `version.json`, the orchestrator's gate and smoke result, changed lookups, deviations numbered.
- Decisions log: D1–D5 (2026-10-13, chunk 71), one row each. D1's row states that it reverses the chunk-59 reserved note column.
- Last-updated paragraph per the chunk-54 convention; the chunk-70 paragraph moves to Update history, relabelled `Prior update:` (prefix only).

Commit this prompt as `prompts/chunk-71-quiet-rows.md` in the same commit. If row 71 must name the docs SHA, record it in an immediate `[skip ci]` follow-up (chunk-54 convention).

---

## Out of scope

- Undo for delete and complete; soft-delete (#13 → chunk 72).
- Hover-reveal or swipe actions; row as a single tab stop (#16).
- Row age (#10), capture and search (#7), contrast tokens (#14).
- Today panel rows, Planner tray cards, Notebook.

## Report back

- **Step 1:** commit SHA; `git diff --stat 5d2d1a2 <SHA>`; gates (`tsc -b`, `eslint .`, test count and file count in both runner zones, build); red-first counts and the non-guard tests named; eager JS before / after / delta; the empty `package.json` diff; deploy run id and result; live `version.json`.
- Existing test lookups you changed, listed.
- Anything you built that departs from D1–D7, and why.
- Every deviation, numbered.
