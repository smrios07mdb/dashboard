# Chunk 68: No sideways scroll at phone width (UX audit #2, #17 scrollbar)

**Runs on:** Claude Code, in `~/Documents/To-Do Dashboard` on Sergio's Mac (repo `smrios07mdb/dashboard`). You write the code and the tests. App code only: no SQL, no migration, no proxy, no new dependency.

**Bases:**
- App `smrios07mdb/dashboard` @ `9342269` (docs). Last code commit `c6b6b0e` (chunk 67), which is what's live.
- Proxy untouched.

**Authority:** `ARCHITECTURE.md` → `prompts/README.md` → this prompt. Read first: `CLAUDE.md`, `src/components/AppShell.tsx`, `src/components/AccountMenu.tsx`, `src/components/SyncIndicator.tsx`, `src/components/CategoryColumn.tsx` (the `<header>`), `src/components/TaskSortControl.tsx`, `src/screens/Dashboard.tsx` (the column grid, `grid gap-6 sm:grid-cols-2`), `src/components/ui/nav-tabs.tsx` (`TopTabs`), `src/components/Tabs.tsx`, `src/components/Tabs.test.tsx`, `src/screens/Dashboard.test.tsx`, and ARCHITECTURE §13.

**Scope:** UX audit 2026-10-13 (`claude/ux-audit-2026-10-13.md` in the Claude project), finding 2, and the scrollbar bullet of finding 17. Nothing else from the audit.

---

## The problem, as committed at `9342269`

- At a 382–386 px viewport the document is wider than the window (audit: 447–467 px on Dashboard, Planner, Settings; chunk 67 smoke: Dashboard `scrollWidth` 502 at 382 px).
- Header: wordmark + Sync badge + `AccountMenu` trigger (full email, `max-w-[160px]`) need ~447 px.
- Dashboard: `CategoryColumn`'s header is a no-wrap grid, `[grid-template-columns:5px_1fr_auto_auto_auto_auto]`, with a 31 px serif name, the "N open" pill, the total, the sort control and the › button. Its min-content width (~451 px) stretches the single-column grid (`grid gap-6 sm:grid-cols-2` has no explicit column below `sm`, so the implicit column is `auto`-sized).
- Desktop: `TopTabs` (`overflow-x-auto` from `Tabs.tsx`) shows a scrollbar thumb on every page. The active underline sits at `-bottom-px`, one pixel outside the nav's box, which creates 1 px of vertical overflow.

---

## Locked decisions

### D1 Account trigger is an initial below `sm`

- In `AccountMenu.tsx`, the trigger shows the email at `≥ sm` exactly as today, and a single uppercase initial below `sm`.
- Initial = first character of `email` that is a letter or digit, uppercased; `?` if none.
- Below `sm`: a round 44 × 44 trigger (`rounded-full`, same border and background as today), the initial centred, no chevron.
- At `≥ sm`: unchanged (email span + chevron, `min-h-11`, `max-w-[220px]`).
- Do it with two spans and Tailwind breakpoints (`sm:hidden` / `hidden sm:inline-flex` or equivalent) inside the one trigger. No JS media query, no `useIsTouchDevice`.
- The trigger gets `aria-label` = ``Account: <email>`` at every width (today it relies on the visible email for its name). Keep `title={email}`.
- The menu content (Signed in as / email / Sign out) is unchanged.

### D2 Category header wraps instead of stretching

- Below `sm`, the header lays out on two lines:
  - Line one: accent bar, category name, "N open" pill.
  - Line two, right-aligned: total, sort control, › button.
- At `≥ sm`: visually unchanged from today when the column is wide enough to hold everything on one line. If it wraps at `≥ sm` in a narrow column, that's acceptable and better than overflow.
- The header must never be wider than its column at any width: give the name `min-w-0` + `truncate` (one line, ellipsis, `title` = full name), and give the header itself `min-w-0`.
- Implementation is yours (flex-wrap or grid-template-areas). Keep: `role="button"`, `tabIndex={0}`, the double-click and Enter/Space drill-down, the `Open <name>` button and its `stopPropagation`, the accent bar's colour and shadow, the pill styling, `TaskSortControl` props.
- No change to font sizes, colours or the pill's contrast (that is audit #14).

### D3 The column grid can't be stretched by its children

- In `Dashboard.tsx`, the category grid gets an explicit single column below `sm`: `grid-cols-[minmax(0,1fr)]`, keeping `sm:grid-cols-2` (Tailwind's `grid-cols-2` is already `minmax(0,1fr)`).
- If another wrapper between the grid and `CategoryColumn` has an intrinsic min width, give it `min-w-0` too. Change nothing else in `Dashboard.tsx`.

### D4 Top tab bar has no vertical overflow

- In `TopTabs`, the active underline moves from `-bottom-px` to `bottom-0`, so it sits inside the nav box. The nav's `border-b` stays.
- Keep `overflow-x-auto` on the nav in `Tabs.tsx` (narrow tablets still scroll the tab row horizontally); add `overflow-y-hidden` beside it.
- `BottomTabs` is unchanged.

### D5 What does not change

- `MarginEditor`, `shellMargins`, the `.shell` CSS variables and saved margins (audit #1 is a separate chunk).
- `SyncIndicator` / `SyncBadge`, the wordmark, `HupoMark`.
- Task rows (`TaskRow`), touch-mode button sizes (audit #8), the Today panel, the Planner and Settings screens' own layouts (audit #18).
- Bottom-tab labels and icons (rest of audit #17).
- `package.json` / `package-lock.json`.

### D6 Tests (you write them)

jsdom does not lay out, so these assert structure; the smoke measures real widths.

**`src/components/AccountMenu.test.tsx`** (new): mock `useSession` with `sm@example.com`.
1. Trigger has `aria-label` `Account: sm@example.com` and `title` `sm@example.com`.
2. Trigger contains a phone-only element with text `S` and a `≥ sm` element with the full email.
3. Email `_42x@y.z` → initial `4`; email with no letter or digit (`@@`) → `?`.
4. No email → renders nothing (today's behaviour).
5. Opening the menu still shows "Signed in as", the email and "Sign out".

**`src/components/CategoryColumn.test.tsx`** (new, or add to the nearest existing file if `CategoryColumn` is already rendered in a test you can reuse — say which):
1. The header and the name carry `min-w-0`; the name has `title` = category name.
2. Enter on the header calls `onDrillDown('category', id)`; clicking `Open <name>` calls it once and does not bubble a second call.
3. The total, sort control and › button are in the same line-two container (assert the shared parent), separate from the name and pill.

**`src/components/ui/nav-tabs.test.tsx`** (new) or `Tabs.test.tsx`:
1. The active underline has `bottom-0` and not `-bottom-px`.
2. The top nav in `Tabs` carries both `overflow-x-auto` and `overflow-y-hidden`.

**`src/screens/Dashboard.test.tsx`**: one assertion that the category grid has `grid-cols-[minmax(0,1fr)]` and `sm:grid-cols-2`. Any existing lookup that breaks because the account trigger now has an `aria-label`: change only that lookup, with a one-line comment naming chunk 68. List them.

**Red-first:** with everything written, restore the five source files from `9342269` and run only the new/changed test files:

```bash
mkdir -p "$TMPDIR/c68"
for f in src/components/AccountMenu.tsx src/components/CategoryColumn.tsx src/components/ui/nav-tabs.tsx src/components/Tabs.tsx src/screens/Dashboard.tsx; do mkdir -p "$TMPDIR/c68/$(dirname $f)"; cp "$f" "$TMPDIR/c68/$f"; git show 9342269:$f > "$f"; done
npx vitest run src/components/AccountMenu.test.tsx src/components/CategoryColumn.test.tsx src/components/ui/nav-tabs.test.tsx src/components/Tabs.test.tsx src/screens/Dashboard.test.tsx
for f in src/components/AccountMenu.tsx src/components/CategoryColumn.tsx src/components/ui/nav-tabs.tsx src/components/Tabs.tsx src/screens/Dashboard.tsx; do cp "$TMPDIR/c68/$f" "$f"; done
git diff --stat
```

Adjust the file list to what you actually changed and created. Report pass/fail counts per new test, and name every new test that passes against the old code (those assert things that were already true; say so, don't count them as guards). The final `git diff --stat` must match your change set exactly.

### D7 Commit routing

- **One code commit**, pushed **alone**, **no `[skip ci]`**. Files: only those D1–D4 and D6 touch. Expected: `AccountMenu.tsx`, `AccountMenu.test.tsx`, `CategoryColumn.tsx`, `CategoryColumn.test.tsx` (or the reused test file), `ui/nav-tabs.tsx`, `ui/nav-tabs.test.tsx` (or `Tabs.test.tsx`), `Tabs.tsx`, `Dashboard.tsx`, `Dashboard.test.tsx`. Anything else: stop and report before committing.
- Subject: `Chunk 68: No sideways scroll at phone width (UX audit #2, #17)`.
- Gates before the push, on a clean `npm ci`: `tsc -b` clean; `eslint .` 0 problems; `vitest run` all green; `TZ=UTC npx vitest run` all green; `npm run build` green.
- Base figures at `c6b6b0e` (Claude Code, Node 25.9.0, chunk 67 step 1): `vitest run` **882 / 882** in **78** files; eager JS **1,035,946 B**. Report your own base at `9342269` and your after.
- Eager JS limit: **+2 kB**.
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

Expect `9342269`. If `main` is anywhere else, stop and report.

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
git diff --stat 9342269 -- package.json package-lock.json
git add <the D7 files>
git status --short
git commit
git push origin main
```

`git status --short` after `git add` must show only the D7 files staged. The commit body lists D1–D4 in one line each and ends with the `Co-Authored-By` trailer per `CLAUDE.md`.

**Stop after the push and report.** Do not start step 3.

### 2. Smoke (not you)

The orchestrator runs this on the deployed app in Sergio's Chrome via the Claude in Chrome extension, tab in the foreground. Phone width is a same-origin iframe (Chrome on Sergio's Mac won't shrink below ~570 px).
- 382 px inner width: `document.documentElement.scrollWidth === innerWidth` on Dashboard, Planner, Settings, Routines, Insights, Notebook. Any screen still over: list the widest elements; Planner/Settings-internal causes are noted, not failed (audit #18).
- 382 px: header shows the initial, not the email; tapping it opens the menu with the email and Sign out.
- 382 px: both category headers on two lines, name + pill on line one; no header wider than its column.
- 1024 px and full width: email trigger and one-line category headers look as before (screenshot compare against `c6b6b0e` captures taken first).
- Full width: no scrollbar thumb on the top tab bar; nav `scrollHeight === clientHeight`; active underline visible.
- Console clean.

### 3. Docs (`[skip ci]`, after the orchestrator's smoke passes)

**`ARCHITECTURE.md`** §13 — append: "Phone width (chunk 68): below `sm` the account trigger is a 44 px initial (full email at `≥ sm`, `aria-label` 'Account: <email>'); category headers wrap to two lines (name + count, then total, sort, ›) and never exceed their column; the category grid uses `minmax(0,1fr)` columns. The top tab bar's active underline sits inside the nav (`bottom-0`), so the bar has no vertical overflow."

**`PROGRESS.md`**
- Row 68 ☑: the step-1 SHA, gates (both runner zones), red-first counts, test count and file count, eager JS before/after, deploy run, live `version.json`, the smoke result, deviations numbered.
- Decisions log: D1–D4 (2026-10-13, chunk 68), one row each.
- Last-updated paragraph per the chunk-54 convention; the chunk-67 paragraph moves to Update history, relabelled `Prior update:` (prefix only).

Commit this prompt as `prompts/chunk-68-phone-width.md` in the same commit. If row 68 must name the docs SHA, record it in an immediate `[skip ci]` follow-up (chunk-54 convention).

---

## Out of scope

- Audit #1 (saved margins crushing columns; max-content-width model). Next chunk.
- Task-row width in touch mode (audit #8), contrast (audit #14), Settings phone layout (audit #18), tab count/icons/labels (rest of #17).
- Any change to saved margins or `MarginEditor`.

## Report back

- **Step 1:** commit SHA; `git diff --stat 9342269 <SHA>`; gates (`tsc -b`, `eslint .`, test count and file count in both runner zones, build); red-first counts and the non-guard tests named; eager JS before / after / delta; the empty `package.json` diff; deploy run id and result; live `version.json`.
- Existing test lookups you changed, listed.
- Anything you built that departs from D1–D6, and why.
- Every deviation, numbered.
