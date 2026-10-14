# Claude Code prompt — Chunk 77b: menu must not reclaim focus after a picker hand-off

You are Claude Code in `/Users/sergiorios/Documents/To-Do Dashboard` (`smrios07mdb/dashboard`). Base: `1304daa` (77a, deployed). Authority: `ARCHITECTURE.md` → `prompts/README.md` → `prompts/chunk-77a-menu-pickers.md` → this prompt. 77a's D1–D6 still hold unless overridden here.

## Problem (from 77a smoke)

Mouse click `⋯ → Edit reminder` on a reminder-chip row: the picker mounts and takes focus, ~2 ms later focus moves to the menu content div, the popover treats it as focus-outside and dismisses. Keyboard path stays open. Inferred cause: picker opens over the menu item under the pointer; the Radix menu item's pointer-leave handler focuses the menu content. Not the `onCloseAutoFocus` path 77a D1 fixed.

## Decisions (locked)

- **D1 — Confirm cause first.** Read `@radix-ui` menu item source in `node_modules` and confirm the pointer-leave → focus-content path. If the cause is something else, stop and report before writing a fix.
- **D2 — Fix location.** Fix in `TaskMenu.tsx` at the hand-off items: once a hand-off item is selected, the menu must not move focus on that item's pointer-leave (Radix composed handlers honor `e.preventDefault()`). Fallback only if D2 cannot work: the three pickers' `onFocusOutside` ignores targets inside the closing menu content. Neither works → stop and report.
- **D3 — Scope.** Applies to every hand-off item (Set priority / Set due date / Set reminder / Edit due date / Edit reminder), not just Edit reminder. Ordinary menu hover highlighting between items must be unchanged.
- **D4 — Tests.** Add to `TaskRow.test.tsx`: for each hand-off item, select via pointer, then fire `pointerLeave` (and `pointerMove` onto the picker) on the selected item; assert the picker stays open and focus stays inside it after `settle()`. Plus one guard: hovering item → item still moves highlight as before. Red-first against `1304daa`; report fail/pass counts.
- **D5 — Budget.** Eager JS delta ≤ +150 B vs `1304daa` (77a used +580 of its 600). Over → stop and report with the measured number and what you tried.
- **D6 — Files.** Expected: `TaskMenu.tsx`, `TaskRow.test.tsx`; picker files only if the D2 fallback is used. No dependency changes.

## Steps

1. Mac, repo: `git fetch && git checkout main && git pull --ff-only && git status --short` (only `?? prompts/chunk-77a-menu-pickers.md` and this prompt expected).
2. D1 investigation; report the confirmed path (file + function) in the final report.
3. Write D4 tests; run red-first on base sources.
4. Implement D2.
5. Gates (Mac, clean): `npm ci && npx tsc -b && npx vitest run && TZ=UTC npx vitest run && npx eslint . && npm run build`; measure eager JS (same method as 77a).
6. Commit and push to `main`:
   ```
   fix(task-menu): keep picker open after mouse hand-off (chunk 77b)

   Co-Authored-By: Claude <noreply@anthropic.com>
   ```
7. Wait for the deploy run; confirm live `https://smrios07mdb.github.io/dashboard/version.json?cb=<ts>` = new SHA.

## Smoke — Sergio's Chrome via Claude in Chrome (`--chrome`), live app

Foreground the tab first. Pace keystrokes (no bursts while the menu is opening). Throwaway tasks `Smoke-77b-*`, deleted at the end; confirm DB count 0. Do not touch subcategory names.

- **77b:** each hand-off item by **mouse**, on a row where the picker opens over the menu (reminder chip under ⋯) and on a no-chip row. After it opens, move the mouse across the picker and back over where the menu was. Picker stays open ≥2 s, focus inside.
- **77a re-run:** A1–A3, B (mouse + keyboard), C drag on/off, D3 example, one tab stop per row.
- **77a not yet run:** Block time / Add a note sheets, plain menu Escape, arrow-key walk, console clean across a fresh reload.

## Docs — only if all of the above pass

One commit covering 77a + 77b: `PROGRESS.md`, decisions log (77a deviations 1–5 accepted; 77b D1 confirmed cause + D2/fallback choice), routine docs. Commit `prompts/chunk-77a-menu-pickers.md` and this prompt.

```
docs(chunk): close 77a + 77b — menu pickers stay open, mouse hand-off fix [skip ci]

Co-Authored-By: Claude <noreply@anthropic.com>
```

`version.json` untouched. Push. Confirm no deploy run fired.

## Report

Confirmed cause, files changed + stat, red-first counts, gate table, eager JS base/head/delta, live `version.json`, smoke per case with what you saw, docs SHA, final `git status --short`. Any failure → stop and report at that point.
