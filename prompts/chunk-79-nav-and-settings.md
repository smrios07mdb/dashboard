# Claude Code prompt — Chunk 79: four tabs, Settings in the account menu, Settings fits a phone

You are Claude Code in `/Users/sergiorios/Documents/To-Do Dashboard` (`smrios07mdb/dashboard`). Base: `5887bae` (code = `ac52156`, deployed). Authority: `ARCHITECTURE.md` → `prompts/README.md` → this prompt.

App code only: no SQL, no migration, no proxy, no new dependency (`lucide-react` already ships every icon named below).

## Why (UX audit 2026-10-13, the rest of #17 and #18)

Measured on the live app at `ac52156`:

- **Navigation.** Five tabs remain after chunk 78. Settings is a tab, though the account menu is the usual home for it. The first tab says `Dashboard` at ≥640 px and `Tasks` on phones. Three icons misread: a tag for Tasks, a filter funnel for Insights, a person for Settings.
- **Settings at 384 px** (same-origin frame): the document is **460 px** wide.
  - The `Sign out` button runs to 460 px; Calendars buttons, the Notifications status and `Enable notifications` run to 387–430 px.
  - Cause: `SettingsRow` is a fixed two-column grid, `gridTemplateColumns: 'minmax(180px, 220px) 1fr'` with `gap-7`, at every width, so the control column gets about 130 px.
- **Section kickers** read `01, Display, 02, 03, 04, 05, 07`. Render order is Account (01), Display, Calendars (02), AI assist (03), Notifications (04), Data (05), then Developer (`06`, dev only) and About (`07`), so `06` is missing in production.
- **The email shows three times** near the top: the account trigger (≥640 px), the `label` under the Settings `h1`, and the Account → Email row.

Sergio's decision (2026-10-14): the first tab is **Tasks** everywhere.

## Decisions (locked)

- **D1 — Label.** In `src/components/Tabs.tsx`, the `/` tab is `Tasks` in both navs (`label` and `mobileLabel`). Update the header comment that says the bottom bar says "Tasks" per the design file.
- **D2 — Four tabs.** `TABS` becomes Tasks · Planner · Insights · Notebook.
  - The `settings` route, and every existing link to `/settings` (`SyncIndicator`, `ReconnectBanner`, `CalendarPicker`, `BlockTimeSheet`, `WhatsNextSheet`), are unchanged.
  - On `/settings`, `activeId` returns `''`, as on drill-down routes, so no tab is current. Confirm this with a test rather than changing `activeId`.
- **D3 — Settings in the account menu.** In `src/components/AccountMenu.tsx`, add a `Settings` item between the email row and the separator: gear icon, `onSelect={() => navigate('/settings')}`, the same classes as `Sign out`.
  - The menu then reads: Signed in as · email · Settings · separator · Sign out.
  - Phones reach Settings through the round initial trigger (already 44 px). No other entry point is added.
- **D4 — Icons.** Add to `src/components/icons.tsx`, in the style of the existing exports:
  - `ListChecks` (`Lucide.ListChecks`) for the Tasks tab;
  - `ChartColumn` (`Lucide.ChartColumn`) for the Insights tab;
  - `Gear` (`Lucide.Settings`), named `Gear` so it can't collide with the `Settings` screen import. `AccountMenu` imports `lucide-react` directly today; switch its icons to `@/components/icons` or keep the direct import, your call, but use the gear glyph either way.
  - Planner keeps `Calendar` and Notebook keeps `BookOpen`.
  - Remove imports that become unused (`Tag`, `Filter`, `User` in `Tabs.tsx`). Leave the exports in `icons.tsx` alone.
- **D5 — Settings rows stack on phones.** In `SettingsRow` (`src/screens/Settings.tsx`):
  - Below `sm`, one column: title and hint above the control, `gap-2`.
  - From `sm` up, today's two columns, written as a Tailwind arbitrary class (`sm:grid-cols-[minmax(180px,220px)_minmax(0,1fr)] sm:gap-7`) in place of the inline `style`.
  - The control cell gets `min-w-0`.
  - In `AccountSection`, the email + `Sign out` line wraps (`flex-wrap`), and the email span gets `min-w-0 break-all`, so a long address can't push the button out.
  - Nothing at ≥640 px may change visually. Check one row's computed layout at 1224 px in the smoke.
- **D6 — Kickers in order.** Main sections are numbered in render order: Account `01`, Display `02`, Calendars `03`, AI assist `04`, Notifications `05`, Data `06`. Developer and About take word kickers, `Developer` and `About`, like Sync issues already does (`Sync`). Edit only the `kicker` props in `Settings.tsx`, `DeveloperSection.tsx` and `About.tsx`.
- **D7 — Email once on the Settings page.** Remove the `<span className="label">{user?.email}</span>` under the Settings `h1`. If `user` is then unused in `Settings()`, remove it too. The Account → Email row is the page's one copy; the header trigger is the shell's.
- **D8 — Tests, red-first against `5887bae`.**
  1. `Tabs.test.tsx`:
     - four tabs per nav, in the order Tasks · Planner · Insights · Notebook;
     - `Tasks` in both navs and no `Dashboard`;
     - no `Settings` tab;
     - at `/settings`, no tab has `aria-current="page"`;
     - the bottom tabs' icons are `lucide-list-checks`, `lucide-calendar`, `lucide-chart-column`, `lucide-book-open` (assert on the svg class). Use whatever class names lucide `^1.16` actually renders, and say if one differs.
     - Update the existing order and count cases; these are accepted edits.
  2. `AccountMenu.test.tsx`: the menu shows a `Settings` item between the email and `Sign out`, and selecting it navigates to `/settings`.
  3. `Settings.test.tsx`:
     - the section kickers, in DOM order, are `01, 02, 03, 04, 05, 06, Developer, About` (vitest runs with `DEV`, so Developer renders);
     - the signed-in email appears exactly once on the page;
     - a `SettingsRow` has no inline `grid-template-columns` and carries the `sm:grid-cols-` class.
  - **Red-first:** restore the touched sources from `5887bae`, run the three files, then restore. Report fail/pass counts and `git status --short` afterwards. Every new case must fail at base.
- **D9 — Budget.** Eager JS delta ≤ **+600 B** over the Mac build of `5887bae`. The cloud reference is 1,051,642 B, 7 files. If over, stop and report the measured number and what you tried.
- **D10 — Docs scope** (Step 3 only, after the gate and smoke):
  - `ARCHITECTURE.md`:
    - the Notebook line listing tabs becomes four primary tabs, Tasks · Planner · Insights · Notebook, with Settings in the account menu;
    - §13: one line on Settings rows stacking below `sm`.
  - `PROGRESS.md` row 79, the decisions log (D1, D2/D3, D6), Last-updated and known gaps, per convention.
  - Commit this prompt to `prompts/`.

## Steps

1. `git fetch && git checkout main && git pull --ff-only && git status --short`. Expect `5887bae` and a clean tree, apart from this prompt untracked.
2. Base eager JS on the Mac: `npm ci && npm run build`, then sum the `dist/index.html` script + modulepreload files, the same way as chunk 78.
3. Write the D8 tests and run red-first.
4. Implement D1–D7.
5. Gates (Mac, clean): `npm ci && npx tsc -b && npx eslint . && npx vitest run && TZ=UTC npx vitest run && npm run build`. Measure eager JS.
6. Commit and push to `main`, alone, with no `[skip ci]`:
   ```
   feat(nav): four tabs, Settings in the account menu; Settings fits a phone (chunk 79)

   Co-Authored-By: Claude <noreply@anthropic.com>
   ```
   The body gives D2/D3, D5 and D6 in one line each.
7. Wait for the deploy run, then confirm live `https://smrios07mdb.github.io/dashboard/version.json?cb=<ts>` shows the new SHA. If the run fails only on a GitHub-side 5xx while pushing to `gh-pages`, one `gh run rerun --failed` is allowed (chunk 78 rule). Anything else, stop.
8. **Stop.** Report back. The orchestrator runs the gate and the smoke; docs (D10) come after as a separate `[skip ci]` commit.

## Smoke (run by the orchestrator, for reference)

On the live app in Sergio's Chrome, read-only:
- **Tabs:** at 1224 px and in a 384 px same-origin frame, four tabs read Tasks · Planner · Insights · Notebook, with the new icons on the bottom bar.
- **Account menu:** Settings → `/settings`, with no tab current there. Keyboard-open the menu, arrow to Settings, Enter.
- **Settings at 384 px and 360 px:** `scrollWidth` equals the frame width, and no element's right edge passes it. The Today-list control stays on one line. Kickers read `01`–`06` then `About`. The email appears once on the page.
- **Settings at 1224 px:** rows are still two columns, with the title column 180–220 px.
- Console clean across a fresh reload.

## Out of scope

- #19 (greeting name, completed-row growth, archived-row purge, default-estimate totals, Notebook's double `New note`).
- Moving or renaming any Settings section, or anything inside the Calendars, AI, Notifications or Data rows beyond D5's stacking.
- The `Primitives.tsx` DEV gallery.

## Report

Files changed + stat, the lucide class names asserted, red-first counts, the gate table (NY and UTC test counts and files), eager JS base/head/delta on the Mac, deploy run + live `version.json`, any deviations with a reason each, and the final `git status --short`. On any failure, stop and report at that point.
