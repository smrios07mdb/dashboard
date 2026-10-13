# Chunk 67: Today suggests a plan when it is short (UX audit #9)

**Runs on:** Claude Code, in `~/Documents/To-Do Dashboard` on Sergio's Mac (repo `smrios07mdb/dashboard`). You write the code and the tests. App code only: no SQL, no migration, no proxy, no new dependency.

**Bases:**
- App `smrios07mdb/dashboard` @ `e5e0700` (docs). Last code commit `d1e8be0` (chunk 66), which is what's live.
- Proxy untouched.

**Authority:** `ARCHITECTURE.md` → `prompts/README.md` → this prompt. Read first: `CLAUDE.md`, `src/lib/today.ts`, `src/state/todayPlan.ts`, `src/components/TodayPanel.tsx`, `src/lib/taskSort.ts`, `src/lib/cat.ts`, `src/components/ui/icon-button.tsx`, `src/screens/Dashboard.tsx` (the two `TodayPanel` mounts), `src/screens/Dashboard.test.tsx`, and ARCHITECTURE §13 "Dashboard Today panel".

**Scope:** UX audit 2026-10-13 (`claude/ux-audit-2026-10-13.md` in the Claude project), finding 9 only.

---

## The problem, as committed at `e5e0700`

- Today fills only from Overdue, Due today, Priority 1 or a manual pin (`lib/today.ts`).
- Sergio's 23 visible open tasks carry no priority, due date or reminder, so the panel shows "Nothing planned yet." and a dashed box: "Tap the ☀ on any task to plan your day."
- Planning the day therefore needs data entry first. Nothing has been pinned to Today, ever (`today_marks` is empty).

The change: while the plan is short, the panel offers open tasks that can be pinned with one tap.

---

## Locked decisions

### D1 A pure picker: `src/lib/todaySuggest.ts`

- New module. No React, no I/O, no clock, no time zone argument.
- Exports:
  - `TODAY_PLAN_TARGET = 3`.
  - `type TodaySuggestion = { task: Task; subName: string; catName: string }`.
  - `suggestToday(data, todaySet, skipped, limit): TodaySuggestion[]`, where `data` is `{ categories, subcategories, tasks }` (the shape `TodayPanel` already receives), `todaySet` and `skipped` are `ReadonlySet<string>`, and `limit` is a number.
- **Candidates:** tasks with `completedAt === null`, not in `todaySet`, not in `skipped`, and whose `subcategoryId` is in `data.subcategories`. A task under an unknown subcategory is never suggested.
- **Order within a category:** priority 1 → 2 → 3 → null (null ranks after 3; never coerce null to 3, per `taskSort.ts`), then soonest `dueAt` (null or unparseable last), then oldest `createdAt` (unparseable last), then `id` ascending.
- **Variety:** group candidates by category and sort each group. Order the groups by their best candidate. Take one from each group in turn until `limit` is reached or all groups are exhausted. Three suggestions are never three Work tasks while Personal has open work.
- `limit <= 0` returns `[]`.

### D2 When suggestions show

- Layouts: `stacked` and `rail` only. Never in `banner`. `off` still renders nothing.
- Count offered = `TODAY_PLAN_TARGET − all.length`, where `all` is the panel's existing `resolveToday(...)` result (open **and** done members). Done tasks count, so a plan that reached three never asks for more.
- Placement:
  - Plan has no visible rows and there is at least one suggestion: the suggestions **replace** the dashed "Tap the ☀…" box, followed by one line: "Or tap the ☀ on any task." (same inline `Sun` icon as today).
  - Plan has visible rows and room: suggestions render **below** the list and the resize handle.
  - No suggestions available: the existing empty box and copy are unchanged, byte for byte.
- The header line ("Nothing planned yet." / "N to do · …") is unchanged.

### D3 The suggestion block

- A `<section aria-label="Suggested for today">` with a `label`-class heading "Suggested" and a `<ul>` of rows.
- Each row (`<li>`): title (one line, ellipsis, `title` attribute = full title), a category-colour dot (`catColor(catName)`) + subcategory name, the estimate (`fmtMin`), an **Add** button, and a **Skip** icon button.
- Row style: dashed 1px `--line-strong` border, `--radius`. Secondary text uses `--ink-2`, not `--ink-3` (audit finding 14: `--ink-3` fails AA).
- **Add:** visible text "Add" with the `Plus` icon from `@/components/icons`; `aria-label` = ``Add "<title>" to today's plan``. It must **not** be ``Add "<title>" to Today``: that is the row sun toggle's name (`TaskRow.tsx`) and the two would collide on one page. Calls `onToggleToday(task.id, true)`.
- **Skip:** `IconBtn` with `X`, `label` = ``Skip "<title>" for now``. Adds the id to a `useState<Set<string>>` inside `TodayPanel`. Session-local on purpose: nothing is written, and the skip lasts until the panel remounts. The next candidate takes the slot.
- **Add all N:** a text button in the heading row, shown only when two or more suggestions are visible. Text ``Add all <N>``. Calls `onToggleToday(id, true)` once per visible suggestion, in display order.
- Touch (`mobile` prop true): Add and Add all get `minHeight: 44`; Skip is `size={44}`. Pointer: 28 / 28 / 24.
- No new prop on `TodayPanel`. No change to `Dashboard.tsx`, `useTodayPlan`, `lib/today.ts`, the repo, Dexie, the outbox or realtime. A pin made here is an ordinary `today_marks` pin and syncs like any other (chunk 64).

### D4 What does not change

- `banner` and `off` layouts; `TodayRow`, `TodayChip`, the linger, the resize handle and its persistence.
- Today membership rules (chunk 66), the day frame, `today_marks`.
- The hero ring, Busy strip, "What's next?", Planner.
- `package.json` / `package-lock.json`.

### D5 Tests (you write them)

**`src/lib/todaySuggest.test.ts`** — fixed ISO timestamps, no clock:
1. `TODAY_PLAN_TARGET` is 3.
2. Order: priority, then soonest due, then oldest created.
3. Unparseable `dueAt` / `createdAt` sort as absent.
4. Full tie breaks by id.
5. Categories take turns: three older Work tasks + one newer Personal task, limit 3 → Work, Personal, Work.
6. One category only still fills the limit.
7. Rows carry `subName` and `catName`.
8. Completed, already-planned and skipped tasks are left out.
9. A task under an unknown subcategory is left out.
10. `limit` is respected; 0 and negative return `[]`.
11. No tasks returns `[]`.

**`src/components/TodayPanel.test.tsx`** (new file; the panel has no test today) — fixtures with no priority, due date or reminder, `timeZone="America/New_York"`:
1. Empty plan, `stacked`: three suggestions in D1 order; "Nothing planned yet." still shows.
2. Add calls `onToggleToday(id, true)` once.
3. Add all calls it for each suggestion, in order.
4. Skip swaps in the next candidate and calls nothing.
5. One planned task → two suggestions, "Add all 2", and the planned task is a plan row.
6. Two planned → one suggestion, no Add all.
7. Three planned → no `Suggested for today` region.
8. Three planned and all three completed → no region; "All done for today." shows.
9. No open tasks → no region; the existing empty hint shows.
10. `rail` offers suggestions; `banner` does not; `off` renders an empty container.
11. `mobile`: Add and Add all `minHeight` 44px; Skip 44 × 44.

**`src/screens/Dashboard.test.tsx`** — three existing tests look up a task title with `findByText` and will now find it twice (the row and the suggestion): "shows the normal dashboard…", "threads the chunk-33 sort + priority wiring…", "renders both the priority chip and the Today sun toggle…". Change only those lookups to `findAllByText` with a one-line comment naming chunk 67. The role query `/"t-both" (to|from) Today/` must keep matching exactly one button; D3's Add label guarantees that. No other existing test changes.

**Red-first:** with everything written:

```bash
cp src/components/TodayPanel.tsx /tmp/TodayPanel.new.tsx
git show e5e0700:src/components/TodayPanel.tsx > src/components/TodayPanel.tsx
npx vitest run src/components/TodayPanel.test.tsx
cp /tmp/TodayPanel.new.tsx src/components/TodayPanel.tsx
```

Report the counts. Tests 1–6, 10 and 11 must fail; 7–9 pass against the old panel because they assert an absence. Say so; don't count them as guards.

### D6 Commit routing

- **One code commit**, pushed **alone**, **no `[skip ci]`**: exactly five files — `src/lib/todaySuggest.ts`, `src/lib/todaySuggest.test.ts`, `src/components/TodayPanel.tsx`, `src/components/TodayPanel.test.tsx`, `src/screens/Dashboard.test.tsx`. Subject: `Chunk 67: Today suggests tasks while the plan is short (UX audit #9)`.
- Gates before the push, on a clean `npm ci`: `tsc -b` clean; `eslint .` 0 problems; `vitest run` all green; `TZ=UTC npx vitest run` all green; `npm run build` green.
- Base figures at `e5e0700` (orchestrator, fresh clone, Node 22, cloud container): `vitest run` **860 / 860** in **76** files; eager JS **1,031,971 B**. Expect **882** tests in **78** files after (11 + 11 new). Report your own before/after.
- Eager JS limit: **+6 kB**.
- After the push: deploy run id and result; live `version.json` read cache-busted.

---

## Sequence

### 1. Code

```bash
cd ~/Documents/To-Do\ Dashboard
git fetch origin
git checkout main
git pull --ff-only origin main
git log -1 --oneline
```

Expect `e5e0700`. If `main` is anywhere else, stop and report.

```bash
rm -rf node_modules
npm ci
npx vitest run
npm run build
python3 -c "import re,os;h=open('dist/index.html').read();f=set(re.findall(r'(?:src|href)=\"/dashboard/(assets/[^\"]+\.js)\"',h));print(len(f),sum(os.path.getsize('dist/'+x) for x in f))"
```

Record the test count and the eager-JS figure as the base. Then implement D1–D3 and write the D5 tests. Run red-first (D5). Then:

```bash
npx tsc -b
npx eslint .
npx vitest run
TZ=UTC npx vitest run
npm run build
python3 -c "import re,os;h=open('dist/index.html').read();f=set(re.findall(r'(?:src|href)=\"/dashboard/(assets/[^\"]+\.js)\"',h));print(len(f),sum(os.path.getsize('dist/'+x) for x in f))"
git diff --stat e5e0700 -- package.json package-lock.json
git add src/lib/todaySuggest.ts src/lib/todaySuggest.test.ts src/components/TodayPanel.tsx src/components/TodayPanel.test.tsx src/screens/Dashboard.test.tsx
git status --short
git commit
git push origin main
```

`git status --short` after `git add` must show only the five files staged; anything else, stop and report. The commit body lists D1–D3 in one line each and ends with the `Co-Authored-By` trailer per `CLAUDE.md`.

**Stop after the push and report.** Do not start step 3.

### 2. Smoke (not you)

The orchestrator runs this on the deployed app in Sergio's Chrome via the Claude in Chrome extension, with the tab in the foreground:
- Dashboard, `stacked`: Today shows "Suggested" with three rows, at least one from each category.
- Skip on one row: the next candidate appears; `today_marks` by REST is unchanged.
- Add on one throwaway `Smoke-67` task created through the UI: it becomes a plan row with **Pinned**; a `today_marks` row exists with `kind = pin` and `day` = today in `America/New_York`; two suggestions remain.
- Remove it from Today (×), delete the smoke task; `today_marks` holds no row for it.
- Settings → Today list → Rail: suggestions show. Banner: none. Restore the original setting.
- 386 px frame: no row wider than the panel.
- Console clean.

### 3. Docs (`[skip ci]`, after the orchestrator's smoke passes)

**`ARCHITECTURE.md`** §13 "Dashboard Today panel" — append: "While the plan holds fewer than three tasks (done ones count), the stacked and rail layouts suggest open tasks to pin: priority, then soonest due date, then oldest, taking turns between categories (`lib/todaySuggest`, chunk 67). Add writes an ordinary pin; Skip is session-local and writes nothing."

**`PROGRESS.md`**
- Row 67 ☑: the step-1 SHA, gates (both runner zones), red-first counts, test count and file count, eager JS before/after, deploy run, live `version.json`, the smoke result, deviations numbered.
- Decisions log: D1–D3 (2026-10-13, chunk 67), one row each.
- Last-updated paragraph per the chunk-54 convention; the current chunk-66 paragraph moves to Update history, relabelled `Prior update:` (prefix only).

Commit this prompt as `prompts/chunk-67-today-suggestions.md` in the same commit. A commit cannot carry its own SHA: if row 67 must name the docs SHA, record it in an immediate `[skip ci]` follow-up (chunk-54 convention).

---

## Out of scope

- Sizing suggestions against free time from the Busy strip.
- Task age on rows; a weekly review of old tasks (audit #10).
- Collapsing the hero / merging the Busy strip into Today (audit #11); the hero ring's "TODAY" label (audit #3).
- Persisting skips across reloads or devices.
- Suggestions in the `banner` layout.
- AI ranking. The picker is deterministic.

## Report back

- **Step 1:** commit SHA; `git diff --stat e5e0700 <SHA>`; gates (`tsc -b`, `eslint .`, test count and file count in both runner zones, build); red-first counts; eager JS before / after / delta; the empty `package.json` diff; deploy run id and result; live `version.json`.
- Anything you built that departs from D1–D5, and why.
- Every deviation, numbered.
