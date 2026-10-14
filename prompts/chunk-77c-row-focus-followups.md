# Claude Code prompt — Chunk 77c: synchronous row tab stop; sheets return focus to ⋯

You are Claude Code in `/Users/sergiorios/Documents/To-Do Dashboard` (`smrios07mdb/dashboard`). Base: `c93f34a` — the revert of the first 77c attempt `25992a3` (code = `47fe0a0`, deployed). Authority: `ARCHITECTURE.md` → `prompts/README.md` → `prompts/chunk-77a-menu-pickers.md` → `prompts/chunk-77b-menu-pointer-handoff.md` → this prompt. Chunk 77 D1–D6, 77a D1–D6 and 77b D1–D6 still hold unless overridden here.

App code only: no SQL, no migration, no proxy, no new dependency.

## Problems (from the 77b smoke, live `47fe0a0`)

1. **Fast Home → Tab stays in the row.** On a task row, Home then Tab within ~300 ms moves focus to the row's previous tab stop instead of the next row. With ≥300 ms between keys it is correct. Suspected cause: `src/components/TaskRow.tsx` `nav()` sets the stop in `onFocus: () => startTransition(() => setNavKey(key))` (row 77 deviation 1). The transition has not committed when Tab is pressed, so the old member still has `tabIndex` 0.
2. **Sheets drop focus.** ⋯ → `Block time` or ⋯ → `Add a note` / `Notes`, then Escape (or the close button): focus lands on `body`. The sheet's Radix `Dialog` tries to return focus to the element focused when it opened, which is the menu item that has since unmounted.

## History

The first attempt, `25992a3`, shipped D1 + D2 and was reverted in `c93f34a`. Its smoke found that ⋯ → Add a note by keyboard left focus on ⋯ behind the open notes sheet: the sheet mounted at +2 ms with nothing inside it focused, and at +151 ms the closing menu's `onCloseAutoFocus` sent focus to ⋯. The deferred tab-stop update D1 removed had been masking that. This redo adds D1a.

## Decisions (locked)

- **D1 — Synchronous tab stop.** When a row control gets focus, its `tabIndex` becomes 0 and the row's other members become −1 before the next key event can be handled. A Home then Tab with no delay must leave the row.
  - **Confirm the cause first.** Read `TaskRow.tsx` `nav()` and confirm the deferred update is what leaves the stale stop. If the cause is something else, stop and report before writing a fix.
  - The `startTransition` was added (row 77 deviation 1) so focus returning to ⋯ as its menu closes would not force-flush that close alongside a picker the item just opened. Since 77a and 77b, a hand-off no longer returns focus to ⋯. Whatever you choose (a plain `setNavKey`, `flushSync`, or a direct DOM `tabIndex` write alongside the deferred state), every 77a and 77b test must stay green unchanged. Update the code comment to match.
  - Chunk 77's other rules are unchanged: default stop on `complete`, fallback when the active control leaves, no wrap, no modifiers, keys bubble.
- **D1a — Sheet items hand off, and their sheet opens after the menu has closed** (replaces the first D1a, 2026-10-14). `Block time`, `Add a note` and `Notes` set the 77a hand-off flag, and their sheet opens only once the menu has fully closed (from the menu's `onCloseAutoFocus`). The ~150 ms delay (the menu's exit animation) is accepted.
  - **Confirmed cause:** the menu's focus trap stays active through its close animation. A sheet that mounts inside that window loses its initial focus to the trap, which pulls focus back to the menu item. When the menu finishes closing, it either returns focus to ⋯ behind the sheet (no flag: the live `25992a3` failure), or, with the flag alone, focus falls to `body` (jsdom: the mouse path failed with the flag alone).
  - **Accepted deviation:** the three chunk-71 `TaskSide.test.tsx` notes cases wait for the `openTaskNotes` call with `waitFor`, since it now fires after the menu closes.
  - **Before deploying:** on the live app at `c93f34a`, check ⋯ → Add a note by mouse and record whether focus is lost. This records the base behaviour; it does not block.
- **D2 — Sheets return focus to ⋯.** Closing the `Block time` sheet or the notes sheet *that was opened from a row's ⋯* returns focus to that row's ⋯ trigger, so the row's tab stop follows.
  - Use the 77a D3 rule: act only if focus is on `body` or `null` when the sheet has closed. Never steal focus the user has already moved.
  - Other notes-sheet openers (`Planner`, `ListNotesSection`, anything else calling `openTaskNotes`) behave exactly as at `47fe0a0`.
  - Touch only what this needs. Likely files are `TaskMenu.tsx`, `BlockTimeSheet.tsx`, and the notes sheet's owner (`components/notebook/NotesProvider.tsx` / `notesContext.ts`). List every file you touch, with a reason.
  - An optional trailing parameter on `openTaskNotes` (for example a return-focus element or callback) is allowed, as long as existing callers (`Planner`, `ListNotesSection`) compile and behave unchanged without passing it. Stop and report only if an existing caller has to change.
- **D3 — Tests, red-first against `c93f34a`.** In `TaskRow.test.tsx`, new `describe('TaskRow — row focus follow-ups (chunk 77c)')`:
  1. **Fast Home → Tab.** On a two-row render, focus row 1's ⋯ and press ←, so the stop moves off `complete`. Press Home, then Tab immediately with no `settle()` or `waitFor` between. Focus is in row 2. Drive Tab with `@testing-library/user-event`, since jsdom has no native Tab.
  2. **Block time close → ⋯.** Open from ⋯, `settle()`, Escape, `settle()`. Focus is on `Actions for "Atlas launch"`, with `tabIndex` 0.
  3. **Notes sheet close → ⋯.** The same, for `Add a note`. If the notes sheet only renders inside `NotesProvider`, render the row inside the real provider for this case and say how.
  4. **Guard:** a click elsewhere before the sheet closes keeps focus there.
  5. **Sheets keep focus while the menu closes.** ⋯ → `Add a note` and ⋯ → `Block time`, each by keyboard and by mouse: focus is inside the sheet after `settle()`, and still there after the menu's close fires.
  - **Accepted deviation:** four existing assertions (77a (10) and three chunk-71 cases in `TaskSide.test.tsx`) expect the new third argument to `openTaskNotes`; case (3) lives in `NotesProvider.test.tsx`, where the real provider's mocks are.
  - All 77a, 77b and 77c tests must pass.
  - Red-first: restore the touched sources from `c93f34a`, run the file, then restore them. Cases 1–3 must fail at the base and 4 must pass. Report fail/pass counts, and `git status --short` afterwards.
  - If case 1 can't reproduce the stale stop in jsdom (for example, because `act` flushes the transition), say so. Show what you tried, and rely on the live smoke for the proof.
- **D4 — Budget.** Eager JS delta ≤ **+200 B** over `47fe0a0`'s build (1,055,437 B on the Mac). This replaces +150 B. If over, stop and report the measured number and what you tried. No dependency changes.
- **D5 — Gates, deploy, smoke.** Same as 77b. See Steps and Smoke below.

## Steps

1. `git fetch && git checkout main && git pull --ff-only && git status --short`. Expect `1e176a2` and a clean tree, apart from this prompt untracked.
2. D1 cause check; D2 read of `BlockTimeSheet` and the notes-sheet owner. Report both in the final report.
3. Write the D3 tests and run red-first.
4. Implement D1 and D2.
5. Gates (Mac, clean): `npm ci && npx tsc -b && npx vitest run && TZ=UTC npx vitest run && npx eslint . && npm run build`. Measure eager JS the same way as 77a/77b (the `dist/index.html` script + modulepreload sum).
6. Commit and push to `main`, alone, with no `[skip ci]`:
   ```
   fix(task-row): synchronous row tab stop; sheets return focus to ⋯ (chunk 77c)

   Co-Authored-By: Claude <noreply@anthropic.com>
   ```
   The body states the confirmed cause and D1/D2 in one line each.
7. Wait for the deploy run, then confirm live `https://smrios07mdb.github.io/dashboard/version.json?cb=<ts>` shows the new SHA.

## Smoke — Sergio's Chrome via Claude in Chrome, live app

Confirm with Sergio before starting (one run owner) and foreground the tab. Use throwaway tasks `Smoke-77c-*`, delete them at the end, and confirm the DB count is 0 and no notes are left. Don't touch subcategory names. Install a `focusin` + dialog-mutation log first.

- **Fast Home → Tab:** on a row, ← to move the stop, then Home and Tab sent back to back in one batch with no wait. Focus is in the next row. Repeat 3 times. Also check Shift+Tab back into the row lands on `complete`.
- **Block time and notes sheet:** open each by keyboard and by mouse — focus is inside the sheet, and typing reaches the note. Close each by Escape and by the close button — focus returns to that row's ⋯.
- **Other notes opener unchanged:** create the fixture note first, then open it from a non-menu entry point (a list's notes section or Planner), close it, and record where focus goes. It must match `47fe0a0`.
- **77b re-run:** all hand-off items by mouse on a no-chip row and a chip row (incl. Edit reminder and Edit due date). Move the mouse across the picker and back. Each picker stays open ≥2 s, with focus inside.
- **77a spot checks:** keyboard Set priority… stays open; pick → new chip focused; plain menu Escape → ⋯; one tab stop per row (paced).
- Console clean across a fresh reload.

No case is skipped. On any failure, stop and report before any docs commit. If a live regression is found, revert right away, then report.

## Docs — if everything passes

One `[skip ci]` commit: `PROGRESS.md` row 77c ☐ → ☑ with the shape of row 77b, recording the revert (`25992a3` → `c93f34a`), the redo and its SHA, D1a, the accepted deviation and the budget change; the decisions log (D1 cause + mechanism, D1a, D2 mechanism), Last-updated per convention, known gaps (remove the Home→Tab and sheet-focus gaps), `ARCHITECTURE.md` §13 one sentence, and this prompt. `version.json` untouched; confirm no deploy fired.

## Out of scope

- `TodayPanel`, Recovered card, Planner tray rows.
- Focus return for `Move to` and `Delete`.
- Anything in the pickers' contents, or the menu's items and order.

## Report

Confirmed D1 cause (file + line), D2 mechanism, files changed + stat, red-first counts, gate table, eager JS base/head/delta, deploy run + live `version.json`, smoke per case with what you saw, final `git status --short`. On any failure, stop and report at that point.
