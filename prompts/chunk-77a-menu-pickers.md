# Chunk 77a: Pickers opened from ⋯ stay open

**Runs on:** Claude Code, in `~/Documents/To-Do Dashboard` on Sergio's Mac (repo `smrios07mdb/dashboard`). You write the code and the tests. App code only: no SQL, no migration, no proxy, no new dependency.

**Bases:**
- App `smrios07mdb/dashboard` @ `6897e09` (chunk 77 docs, `[skip ci]`). Last code commit `c92f647` (chunk 77), which is what's live and gate-verified. `6897e09` → `3c279df` → `c92f647` are docs-only on top of that code.
- Proxy untouched.

**Authority:** `ARCHITECTURE.md` → `prompts/README.md` → this prompt. Read first:
- `CLAUDE.md` (including the chunk-77 "Gate environment" note), `prompts/README.md`.
- `src/components/TaskMenu.tsx`, `src/components/TaskRow.tsx` and `src/components/TaskRow.test.tsx` (the chunk-71 `(6)` cases and the chunk-77 describe).
- `src/components/PriorityPicker.tsx`, `src/components/SetDuePopover.tsx`, `src/components/SetReminderPopover.tsx`.
- `src/components/ui/popover.tsx`, `src/components/ui/dropdown-menu.tsx` (both spread `...props` onto the Radix `Content`).
- `src/components/BlockTimeSheet.tsx` and the notes sheet `TaskMenu` opens (`openTaskNotes`), only to confirm they are modal dialogs.

**Scope:** finding F1 from the chunk-77 smoke. Nothing else.

---

## The problem, as committed at `c92f647` (and before chunk 77)

⋯ → `Set priority…`, `Set due date…` or `Set reminder…` opens the picker, and the picker closes itself straight away.

The order of events, instrumented on the live app (`c92f647`, Sergio's Chrome, 2026-10-14):
1. The menu item's `onSelect` closes the menu and opens the picker in the same update.
2. The picker mounts and takes focus (`Cancel`). Dialog added at +7,094 ms.
3. The menu's exit animation ends. Radix `DropdownMenu.Content`'s `onCloseAutoFocus` returns focus to the ⋯ trigger, at +8,280 ms.
4. ⋯ is outside the popover, so the popover's `DismissableLayer` treats it as focus outside and dismisses. Dialog removed at +8,281 ms.

A jsdom probe (open ⋯ with Enter, click the item, wait 500 ms, count open dialogs) gives **0** for all three items at both `edcad10` and `c92f647`. So it predates chunk 77; it has been there since the anchor-only pickers of chunk 71, and for priority since chunk 33.

- The chunk-71 tests `(6) ⋯ → Edit reminder … anchor-only` and `(6) ⋯ → Set reminder… / Set due date…` pass only because they assert before focus returns to ⋯.
- **Effect:** on any row, priority, due date and reminder cannot be set from ⋯. Every open task today has no chip, so ⋯ is the only way in from a row. Capture's inline parse still works.
- `Block time` and `Add a note` / `Notes` open modal sheets. A modal Radix dialog ignores focus outside, so they are not affected. D5 guards that.

---

## Locked decisions (orchestrator, 2026-10-14)

### D1 The menu keeps focus when it hands off to a picker: `src/components/TaskMenu.tsx`

- `const handingOff = useRef(false)`.
- In the `onSelect` of `Set priority…`, the due-date item and the reminder item, set `handingOff.current = true` **before** calling `onOpenPriority` / `onOpenDue` / `onOpenReminder`.
- `DropdownMenuContent` gets `onCloseAutoFocus={(e) => { if (handingOff.current) { e.preventDefault(); handingOff.current = false } }}`.
  - With the flag set, Radix does not move focus to ⋯, so the picker keeps it.
  - With the flag clear (Escape, a click outside, `Move to`, `Block time`, notes, `Delete`), nothing changes: focus returns to ⋯ as today.
- No other change to `TaskMenu`: same items, labels, order, icons, `triggerProps`.

### D2 Each picker takes an `onCloseAutoFocus`: `PriorityPicker.tsx`, `SetDuePopover.tsx`, `SetReminderPopover.tsx`

- New optional prop `onCloseAutoFocus?: (e: Event) => void`, passed straight to their `PopoverContent`.
- Without the prop, each picker renders and behaves exactly as at `c92f647`.

### D3 Where focus goes when a picker closes: `src/components/TaskRow.tsx`

The row passes `onCloseAutoFocus` to all three pickers. Its handler:
1. `e.preventDefault()`.
2. In a `requestAnimationFrame`, and **only if** `document.activeElement` is `document.body` or `null` (focus was lost because the picker unmounted; a click on another control leaves focus there, and it must not be stolen):
   - focus that picker's own chip in the row, if it is rendered now:
     - priority picker → `[data-row-nav="priority"]`;
     - due picker → `[data-row-nav="when"][data-when-kind="due"]`;
     - reminder picker → `[data-row-nav="when"][data-when-kind="reminder"]`;
   - otherwise focus the ⋯ trigger, `[data-row-nav="menu"]`.
3. The lookup runs on the row element, via a row ref combined with dnd-kit's `setNodeRef`: `ref={(el) => { setNodeRef(el); rowRef.current = el }}`.
4. The `whenChip` gets `data-when-kind={whenKind}`.

The focus fires the member's `onFocus`, so the row's tab stop follows (chunk 77 D2). Examples:
- ⋯ → `Set priority…` → P2 → the new P2 chip has focus.
- ⋯ → `Set reminder…` → Escape, on a row with no chip → ⋯ has focus.

### D4 What does not change

- `useCaptureShortcuts`, `HorizonControl`, `TaskSortControl`, every screen, `SubcategorySection`, `TodayPanel`.
- Chunk 77's roving tabindex, arrow keys, group role and inline-edit refocus, including deviation 1 (`startTransition` in `onFocus`).
- `BlockTimeSheet`, the notes sheet, `MoveToPicker`.
- The pickers' contents, Save / Clear / Cancel behaviour, and the zone handling.
- `ui/popover.tsx`, `ui/dropdown-menu.tsx`.
- `package.json` / `package-lock.json`.
- Chunk 75's `contrast.test.ts` and `fontFloor.test.ts` stay green unchanged.

### D5 Tests (you write them): `src/components/TaskRow.test.tsx`

New `describe('TaskRow — pickers opened from ⋯ (chunk 77a)')`, real timers (call `vi.useRealTimers()` at the top of each case: the file's `beforeEach` fakes `Date` only, which Radix doesn't need, but say so if you keep it). Add helpers:
- `openFromMenu(name: RegExp)`: `fireEvent.keyDown` Enter on the ⋯ trigger, `fireEvent.click` the menu item, then `await waitFor(() => expect(screen.queryByRole('menu')).toBeNull())`.
- `settle()`: `await act(() => new Promise((r) => setTimeout(r, 300)))`.

Cases:
1. **Priority stays open.** `row()`; `openFromMenu(/Set priority…/)`; `settle()`. The priority dialog is open (its `Priority` label is in the document; one open `[role=dialog]`), and `document.activeElement` is inside it.
2. **Due date stays open.** Same with `/Set due date…/`: the `Due date` input is present after `settle()`.
3. **Reminder stays open.** Same with `/Set reminder…/`: `Reminder date and time` is present after `settle()`.
4. **With a chip too.** `row({ priority: 2 })`; `openFromMenu(/Set priority…/)`; `settle()`: still open.
5. **Picking moves focus to the new chip.** `row()` with an `onSetPriority` mock; `openFromMenu(/Set priority…/)`; click `Soon`. `onSetPriority` is called with `('t1', 2)`. `rerender` the row with `priority: 2`, then `settle()`. Focus is on `Priority 2 — change priority`.
6. **Escape from a menu-opened picker returns to ⋯.** `row()`; `openFromMenu(/Set reminder…/)`; `settle()`; Escape on the focused element; `settle()`. Focus is on `Actions for "Atlas launch"`, the dialog is gone, and the ⋯ trigger has `tabIndex` 0.
7. **Escape from a chip-opened picker returns to the chip.** `row({ dueAt: TWO_DAYS_LATE })`; click the due chip; `settle()`; Escape; `settle()`. Focus is on the due chip.
8. **A click elsewhere is not overridden.** `row({ dueAt: TWO_DAYS_LATE })`; open the due picker from the chip; `user.click` the sun button; `settle()`. Focus is on the sun, not the chip or ⋯.
9. **Plain menu close still returns to ⋯.** Open the menu, press Escape in it, `settle()`. Focus is on ⋯.
10. **Modal sheets still open.** `openFromMenu(/Block time/)`, `settle()`: its dialog is present. `openFromMenu(/Add a note/)`: `openTaskNotes` is called with `'t1'`.

Strengthen the two chunk-71 `(6)` menu cases by adding `settle()` before their existing assertions. Change nothing else in them, and list them.

**Red-first:** with everything written, restore the five sources from the base and run the file:

```bash
mkdir -p "$TMPDIR/c77a"
for f in TaskMenu TaskRow PriorityPicker SetDuePopover SetReminderPopover; do
  cp "src/components/$f.tsx" "$TMPDIR/c77a/$f.after.tsx"
  git show "6897e09:src/components/$f.tsx" > "src/components/$f.tsx"
done
npx vitest run src/components/TaskRow.test.tsx
for f in TaskMenu TaskRow PriorityPicker SetDuePopover SetReminderPopover; do
  cp "$TMPDIR/c77a/$f.after.tsx" "src/components/$f.tsx"
done
git status --short
```

- Must fail against the base: 1, 2, 3, 4, 5, and the two strengthened `(6)` cases.
- Expected to pass against the base (regression guards): 6, 7, 8, 9, 10. Name them.
- If 6 fails against the base, say why.
- Report counts. The final `git status --short` must match your change set exactly.

### D6 Commit routing

- **One code commit**, pushed **alone**, **no `[skip ci]`**.
- **Expected files:** `src/components/TaskMenu.tsx`, `src/components/TaskRow.tsx`, `src/components/PriorityPicker.tsx`, `src/components/SetDuePopover.tsx`, `src/components/SetReminderPopover.tsx`, `src/components/TaskRow.test.tsx`. Anything else: stop and report before committing.
- **Subject:** `Chunk 77a: Pickers opened from the task menu stay open`.
- **Gates before the push**, on a clean `npm ci`:
  - `tsc -b` clean;
  - `eslint .` 0 problems;
  - `vitest run` all green;
  - `TZ=UTC npx vitest run` all green;
  - `npm run build` green.
- **Base figures** at `c92f647` (code identical to `6897e09`; orchestrator, cloud container, Node 22.22.0, clean clone):
  - `vitest run` **1158 / 1158** in **102** files, in `America/New_York` and in `UTC`.
  - Eager JS **1,053,704 B** (7 files, container); your Mac after for chunk 77 was **1,054,721 B**.
  - Run your own base on the Mac in both zones.
- **Eager JS limit: +600 B.**
- **After the push:** deploy run id and result; live `version.json`, read cache-busted.

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

Expect `6897e09`, `3c279df`, `c92f647`, top to bottom. If `main` is anywhere else, stop and report.

```bash
rm -rf node_modules
npm ci
npx vitest run
TZ=UTC npx vitest run
npm run build
python3 -c "import re,os;h=open('dist/index.html').read();f=set(re.findall(r'(?:src|href)=\"/dashboard/(assets/[^\"]+\.js)\"',h));print(len(f),sum(os.path.getsize('dist/'+x) for x in f))"
```

Record the base. Implement D1–D3, write the D5 tests, run red-first. Then:

```bash
npx tsc -b
npx eslint .
npx vitest run
TZ=UTC npx vitest run
npm run build
python3 -c "import re,os;h=open('dist/index.html').read();f=set(re.findall(r'(?:src|href)=\"/dashboard/(assets/[^\"]+\.js)\"',h));print(len(f),sum(os.path.getsize('dist/'+x) for x in f))"
git diff --stat 6897e09 -- package.json package-lock.json
git add src/components/TaskMenu.tsx src/components/TaskRow.tsx src/components/PriorityPicker.tsx src/components/SetDuePopover.tsx src/components/SetReminderPopover.tsx src/components/TaskRow.test.tsx
git status --short
git diff --cached --stat
git commit
git push origin main
```

- `git status --short` after `git add` must show only the D6 files staged. `prompts/chunk-77a-menu-pickers.md` may show as untracked; leave it.
- The commit body:
  - states D1–D3 in one line each;
  - names chunk-77 finding F1 and that it predates chunk 77;
  - ends with the `Co-Authored-By` trailer per `CLAUDE.md`.

**Stop after the push and report.** Do not write docs. Do not run the smoke.

### 2. Gate + smoke (orchestrator, not you)

**Gate:** a clean clone at your SHA in the cloud container:
- the scope diff against `6897e09`;
- `tsc -b`, `eslint .`, and `vitest run` in three zones;
- red-first reproduced;
- the build and eager JS;
- the live `version.json`.

**Smoke:** the deployed app in Sergio's Chrome, via the Claude in Chrome extension. Read-only: nothing saved. A `focusin` and dialog-mutation log is installed first, because the tab is backgrounded between calls.
1. ⋯ → `Set priority…`, ⋯ → `Set due date…`, ⋯ → `Set reminder…` on a row with no chip. Each picker is still open 2 s after the menu's exit, and focus is inside it. Each is closed with Escape, and focus lands on ⋯.
2. ⋯ → `Block time` opens its sheet; ⋯ → `Add a note` opens the notes sheet. Each closed with Escape, nothing saved.
3. ⋯ → Escape with nothing chosen: focus is on ⋯.
4. Chunk 77 checks still hold: one tab stop per row; the arrows walk the row.
5. Console clean across a fresh reload.

### 3. Docs (`[skip ci]`, after the orchestrator's gate and smoke pass)

**Commit this prompt** as `prompts/chunk-77a-menu-pickers.md`, copied from the file, not retyped.

**`ARCHITECTURE.md` §13.** Append one sentence to the end of the chunk-77 task-row bullet:

> A picker opened from ⋯ (priority, due date, reminder) keeps focus when the menu closes; when a picker closes, focus goes to its chip if the row shows one, else to ⋯, unless the user has already moved focus elsewhere (chunk 77a).

**`PROGRESS.md`:**
- **Row 77a ☑**, directly after row 77, in row 77's shape. Include:
  - the step-1 SHA;
  - gates in both runner zones, with the Mac base in both zones;
  - red-first counts, with the guard cases named;
  - test count and file count;
  - eager JS before / after;
  - deploy run and live `version.json`;
  - the orchestrator's gate and smoke;
  - the strengthened chunk-71 cases;
  - deviations, numbered.
- **Decisions log:** D1–D3 (2026-10-14, chunk 77a), one row each.
- **Last-updated paragraph:** per the chunk-54 convention. The chunk-77 paragraph moves to Update history, relabelled `Prior update:` (prefix only).
- **Known gaps:** remove F1. Carry the rest.

If row 77a must name the docs SHA, record it in an immediate `[skip ci]` follow-up (chunk-54 convention).

---

## Out of scope

- Any change to what the pickers contain, or to Save / Clear / Cancel.
- Focus return for `Block time`, the notes sheet and `Move to`.
- `TodayPanel`, the Recovered card, the Planner tray.
- The rest of the audit, and the carried gaps.

## Report back

- **Step 1:**
  - commit SHA and `git diff --stat 6897e09 <SHA>`;
  - gates (`tsc -b`, `eslint .`, test count and file count in both runner zones, build), with the Mac base in both zones;
  - red-first counts, with 6–10 named as the expected passes;
  - eager JS before / after / delta;
  - the empty `package.json` diff;
  - deploy run id and result;
  - live `version.json`.
- The two strengthened chunk-71 cases.
- Anything you built that departs from D1–D5, and why.
- Every deviation, numbered.
