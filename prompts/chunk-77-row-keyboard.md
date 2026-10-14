# Chunk 77: One tab stop per task row (UX audit #16, second half)

**Runs on:** Claude Code, in `~/Documents/To-Do Dashboard` on Sergio's Mac (repo `smrios07mdb/dashboard`). You write the code and the tests. App code only: no SQL, no migration, no proxy, no new dependency.

**Bases:**
- App `smrios07mdb/dashboard` @ `edcad10` (chunks 76 + 76a docs, `[skip ci]`). Last code commit `2032405` (chunk 76a), which is what's live and gate-verified. `edcad10` is docs-only on top of that code.
- Proxy untouched.

**Authority:** `ARCHITECTURE.md` → `prompts/README.md` → this prompt. Read first:
- `CLAUDE.md`, `prompts/README.md`.
- `src/components/TaskRow.tsx` (the row, `TitleField`, `MinutesField`) and `src/components/TaskRow.test.tsx`.
- `src/components/TaskMenu.tsx` (the `⋯` trigger).
- `src/components/PriorityChip.tsx`, `src/components/PriorityPicker.tsx`, `src/components/SetDuePopover.tsx`, `src/components/SetReminderPopover.tsx` (the chips are Radix `asChild` triggers; anchor-only spans when there is no chip).
- `src/components/ui/checkbox.tsx`.
- `src/components/HorizonControl.tsx` (the roving-tabindex pattern, and chunk 76a's lesson on `stopPropagation`).
- `src/components/capture/useCaptureShortcuts.ts` (the `window` listener for `N`, `/`, `⌘K` / `^K`).
- Where `TaskRow` renders: `src/components/SubcategorySection.tsx` (Dashboard columns and CategoryView) and `src/screens/SubcategoryView.tsx` (`selectable`, `dragEnabled={false}`).

**Scope:** the second half of UX audit finding 16 — each task row is one tab stop, and the arrow keys move between that row's controls. Nothing else.

---

## The problem, as committed at `edcad10`

Every control in a `TaskRow` is its own tab stop. An open row on the Dashboard carries, left to right:
- the completion checkbox;
- the grip — a `useDraggable` handle whose spread `attributes` include `tabIndex: 0`, although no `DndContext` in the app registers a `KeyboardSensor` (CategoryColumn, CategoryView: `PointerSensor` + `TouchSensor` only), so a keyboard user can focus it and do nothing with it;
- the title button;
- the priority chip and the when chip, when shown;
- the minutes button;
- the Today sun (Dashboard only);
- the `⋯` trigger.

That is 6–8 tab stops per row. Chunk 75 measured 225 tab stops on the Dashboard (226 with the skip link). The audit's fix: one tab stop per row, arrow keys between its controls.

---

## Locked decisions (orchestrator, 2026-10-14)

### D1 The row's controls, in order: `src/components/TaskRow.tsx`

The row's navigable controls ("members"), in DOM order, each marked with a `data-row-nav` attribute whose value is its key:

| Key | Control | Present when |
|---|---|---|
| `select` | selection checkbox | `selectable` |
| `complete` | completion checkbox | always |
| `title` | title button (not the edit input) | always, while not editing |
| `priority` | priority chip | `chipPriority !== null` |
| `when` | the when chip (due or reminder) | `when` is shown |
| `minutes` | minutes button (not the edit input) | always, while not editing |
| `today` | Today sun | `onToggleToday` |
| `menu` | `⋯` trigger | always |

- **Not members:** the grip; the anchor-only `<span>`s of the three pickers; the age `<span>`; anything inside a popover or menu (those are portaled).
- **The grip** keeps `{...attributes}` and `{...listeners}` and gets `tabIndex={-1}` **after** the attributes spread, so it leaves the tab order. Pointer drag is unchanged. Keyboard moves stay on `⋯` → Move to.

### D2 Roving tabindex: `src/components/TaskRow.tsx`

- Type `RowNavKey = 'select' | 'complete' | 'title' | 'priority' | 'when' | 'minutes' | 'today' | 'menu'`.
- `const [navKey, setNavKey] = useState<RowNavKey>('complete')`.
- Build `present: RowNavKey[]` in render from the same conditions as D1's table. `const activeNav = present.includes(navKey) ? navKey : 'complete'`. So if the remembered control leaves the row (the priority is cleared, the row completes and its chip goes), the completion checkbox is the tab stop again. Never store `activeNav` back into state during render.
- A helper `nav(key)` returns `{ 'data-row-nav': key, tabIndex: activeNav === key ? 0 : -1, onFocus: () => setNavKey(key) }`. Spread it onto every member:
  - both `Checkbox`es (Radix `Root` forwards `tabIndex`, `onFocus` and `data-*`);
  - the `whenChip` button;
  - the `PriorityChip` passed as the picker trigger (its rest spread forwards them);
  - the sun button;
  - `TitleField` and `MinutesField` gain a `navProps` prop, spread onto their **button** only, never the input;
  - `TaskMenu` gains the prop in D3.
- `onFocus` means a click, or focus returning from a popover, moves the row's tab stop to that control. A later Tab out and Shift+Tab back lands there.
- **Exactly one member** in a rendered row has `tabIndex` 0. While the title or minutes is being edited, its input is tabbable natively and is not a member; that is accepted.

### D3 `TaskMenu` takes the trigger props: `src/components/TaskMenu.tsx`

- New optional prop `triggerProps?: { 'data-row-nav'?: string; tabIndex?: number; onFocus?: React.FocusEventHandler<HTMLButtonElement> }`.
- Spread it onto the trigger `<button>` **before** `type`, `aria-label` and `className`, so nothing in it can override them.
- Without the prop the trigger renders exactly as at `edcad10`. Nothing else in `TaskMenu` changes.

### D4 Arrow keys: one `onKeyDown` on the row `div`

```ts
const ROW_NAV_KEYS = new Set(['ArrowLeft', 'ArrowRight', 'Home', 'End'])
```

At module scope. In the row's `onKeyDown`:
1. Return if `e.defaultPrevented`, if `!ROW_NAV_KEYS.has(e.key)`, or if any of `e.metaKey`, `e.ctrlKey`, `e.altKey`, `e.shiftKey` is held.
2. `const target = e.target as HTMLElement`. Return unless `e.currentTarget.contains(target)` **and** `target.hasAttribute('data-row-nav')`.
   - The DOM-contains check matters: React bubbles synthetic events through portals, so a keydown inside a picker's `PopoverContent` (the date input, the priority options) reaches this handler. It must do nothing there.
   - The attribute check keeps the arrows inside the title and minutes inputs moving the caret.
3. `const items = Array.from(e.currentTarget.querySelectorAll<HTMLElement>('[data-row-nav]'))`. Find `target`'s index. `ArrowRight` → next, `ArrowLeft` → previous, **no wrap** (stay at the ends); `Home` → first, `End` → last.
4. If the index changes: `e.preventDefault()` and `items[next].focus()`. The focus fires `onFocus`, which moves the tab stop (D2).
5. **Never call `stopPropagation`** (chunk 76a). Every key, including the four above, keeps bubbling to `window`.

`ArrowUp` / `ArrowDown` are not handled. `ArrowDown` on the `⋯` trigger still opens the menu (Radix).

### D5 The row is a named group: `src/components/TaskRow.tsx`

The row `div` gets `role="group"` and `aria-label={task.title}`. Nothing else about its markup, classes or style changes.

### D6 Focus returns after an inline edit: `TitleField`, `MinutesField`

- Each field keeps a `buttonRef` and a `refocus` ref.
- **Enter** that commits (or is a no-op because the value is unchanged), and **Escape**, set `refocus.current = true` before leaving edit mode.
- An effect on `editing`: when it turns false and `refocus.current` is true, focus the button and reset the ref.
- A **blur** commit (clicking elsewhere) does not refocus.
- Enter on invalid input stays a no-op in the input, as today.

### D7 What does not change

- Every behaviour of every control: what a click, Enter or Space does; the pickers; the menu items; the cheer; the linger; drag by pointer; the touch hit areas.
- `SubcategorySection.tsx`, `SubcategoryView.tsx`, `CategoryColumn.tsx`, `CategoryView.tsx`, `Dashboard.tsx`: no change. The DnD sensors: no change; no `KeyboardSensor`.
- Other row-like lists: `TodayPanel`, the Recovered card, the Planner tray, `SubcategoryHeader`, the routines lists.
- `HorizonControl`, `TaskSortControl`, `useCaptureShortcuts`.
- `package.json` / `package-lock.json`.
- Chunk 75 rules: `src/lib/contrast.test.ts` and `src/lib/fontFloor.test.ts` stay green unchanged.

### D8 Tests (you write them): `src/components/TaskRow.test.tsx`

New `describe('TaskRow — one tab stop per row (chunk 77)')`. Use `@testing-library/user-event` (`userEvent.setup()`; it is already used in `ProtectedLayout.test.tsx`). Add a `twoRows()` helper beside `row()` that renders two `TaskRow`s (`t1` "Atlas launch", `t2` "Beacon review") in the same providers.

1. **One stop.** A plain row (`row()`): exactly one element inside the row has `tabIndex >= 0` (`[...row.querySelectorAll('*')].filter((el) => (el as HTMLElement).tabIndex >= 0)`), and it is the `Mark task complete` checkbox. The grip has `tabIndex` -1. Repeat with `{ priority: 2, dueAt: TWO_DAYS_LATE }`: still exactly one.
2. **Tab moves row to row.** `twoRows()`; from `document.body`, `user.tab()` focuses row 1's completion checkbox; the next `user.tab()` focuses row 2's completion checkbox.
3. **Arrows walk the row.** `row({ priority: 2, dueAt: TWO_DAYS_LATE })`. From the completion checkbox, `ArrowRight` focuses in turn: title, priority chip, when chip, minutes, sun, `⋯`. `ArrowRight` on `⋯` stays on `⋯`. `Home` → completion checkbox; `End` → `⋯`; `ArrowLeft` → sun. `ArrowLeft` on the completion checkbox stays.
4. **The row remembers.** `twoRows()`; arrow row 1 to `Edit minutes`. Its `tabIndex` is 0 and the completion checkbox's is -1. `user.tab()` goes to row 2's checkbox; `user.tab({ shift: true })` comes back to row 1's `Edit minutes`.
5. **Focus by click moves the stop.** Click the sun (`user.click`): the sun's `tabIndex` is 0, the completion checkbox's is -1.
6. **Selectable row.** `row({}, { selectable: true, dragEnabled: false })`: the stop is the completion checkbox, not the selection checkbox; `ArrowLeft` from it focuses `Select task`; `Home` from `⋯` focuses `Select task`.
7. **Arrows in the inputs edit text.** Click the title to edit; in `Task title`, `ArrowRight` and `Home` leave `document.activeElement` on the input. Same for `Estimate minutes`.
8. **Focus returns after edit.** Title: click → type → `Enter` → `document.activeElement` is the `Atlas launch` button (by role; mock `onEditTitle` keeps the title, so the name is unchanged). Again with `Escape`. Minutes: the same two, landing on `Edit minutes`. A blur commit (`fireEvent.blur` on the input) does not focus the button.
9. **Fallback when the stop disappears.** `row({ priority: 2 })`; arrow to the priority chip; `rerender` with `priority: null`. The completion checkbox has `tabIndex` 0 and it is the only member at 0.
10. **Keys still bubble.** A native `window` `keydown` listener sees `ArrowRight` dispatched on the focused completion checkbox, and sees `{ key: 'k', metaKey: true }` and `n` dispatched on the focused title button (`el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, ... }))`; remove the listener in `finally`). This guards chunk 76a's lesson.
11. **Modifiers do nothing.** `ArrowRight` with each of `metaKey`, `ctrlKey`, `altKey`, `shiftKey` on the completion checkbox leaves focus there.
12. **Portaled keys do nothing.** Open the due picker from the when chip (`row({ dueAt: TWO_DAYS_LATE })`); focus the `Due date` input inside the dialog; `ArrowRight` / `End` leave focus on that input.
13. **Named group.** `screen.getByRole('group', { name: 'Atlas launch' })` exists and contains the completion checkbox.

**`TaskMenu` without `triggerProps`:** if `src/components/TaskMenu.test.tsx` exists, add one case: rendered alone, the trigger has no `data-row-nav` and its `tabIndex` is 0. If the file does not exist, do not create it; say so in the report.

**Existing tests:** none should need changing. The chunk-74 case "is not a button and adds no tab stop" counts elements with a `tabindex` attribute; it compares two rows rendered the same way, so it should still pass. If any existing test anywhere fails (a test that tabs through a row, a `getAllByRole('button')` count), change only its expected value, and list the file and case.

**Red-first:** with everything written, restore the base for the two sources and run the file:

```bash
mkdir -p "$TMPDIR/c77"
cp src/components/TaskRow.tsx "$TMPDIR/c77/TaskRow.after.tsx"
cp src/components/TaskMenu.tsx "$TMPDIR/c77/TaskMenu.after.tsx"
git show edcad10:src/components/TaskRow.tsx > src/components/TaskRow.tsx
git show edcad10:src/components/TaskMenu.tsx > src/components/TaskMenu.tsx
npx vitest run src/components/TaskRow.test.tsx
cp "$TMPDIR/c77/TaskRow.after.tsx" src/components/TaskRow.tsx
cp "$TMPDIR/c77/TaskMenu.after.tsx" src/components/TaskMenu.tsx
git status --short
```

- Must fail against the base: 1, 2, 3, 4, 5, 6, 8, 9, 13.
- Expected to pass against the base (regression guards, not red-first guards): 7, 10, 11, 12. Name them.
- All existing cases in the file pass against the base.
- Report counts. The final `git status --short` must match your change set exactly.

### D9 Commit routing

- **One code commit**, pushed **alone**, **no `[skip ci]`**.
- **Expected files:** `src/components/TaskRow.tsx`, `src/components/TaskMenu.tsx`, `src/components/TaskRow.test.tsx`, plus a `TaskMenu` test file if D8 adds one, plus any existing test changed under D8. Anything else: stop and report before committing.
- **Subject:** `Chunk 77: One tab stop per task row`.
- **Gates before the push**, on a clean `npm ci`:
  - `tsc -b` clean;
  - `eslint .` 0 problems;
  - `vitest run` all green;
  - `TZ=UTC npx vitest run` all green;
  - `npm run build` green.
- **Base figures** at `2032405` (code identical to `edcad10`; orchestrator, cloud container, Node 22.22.0, clean clone):
  - `vitest run` **1145 / 1145** in **102** files, in `America/New_York` and in `UTC`.
  - Eager JS **1,052,455 B** (7 files, container); your Mac after for chunk 76a was **1,053,466 B**.
  - Run your own base on the Mac in both zones and report it with your after.
- **Eager JS limit: +1,500 B.** `TaskRow` is in the eager bundle.
- **After the push:** deploy run id and result; live `version.json`, read cache-busted.

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

Expect `edcad10`. If `main` is anywhere else, stop and report.

```bash
rm -rf node_modules
npm ci
npx vitest run
TZ=UTC npx vitest run
npm run build
python3 -c "import re,os;h=open('dist/index.html').read();f=set(re.findall(r'(?:src|href)=\"/dashboard/(assets/[^\"]+\.js)\"',h));print(len(f),sum(os.path.getsize('dist/'+x) for x in f))"
```

Record the base. Implement D1–D6, write the D8 tests, run red-first. Then:

```bash
npx tsc -b
npx eslint .
npx vitest run
TZ=UTC npx vitest run
npm run build
python3 -c "import re,os;h=open('dist/index.html').read();f=set(re.findall(r'(?:src|href)=\"/dashboard/(assets/[^\"]+\.js)\"',h));print(len(f),sum(os.path.getsize('dist/'+x) for x in f))"
git diff --stat edcad10 -- package.json package-lock.json
git add src/components/TaskRow.tsx src/components/TaskMenu.tsx src/components/TaskRow.test.tsx
git status --short
git diff --cached --stat
git commit
git push origin main
```

- Add a `TaskMenu` test file and any existing test changed under D8 to the `git add` line.
- `git status --short` after `git add` must show only the D9 files staged. `prompts/chunk-77-row-keyboard.md` may show as untracked; leave it.
- The commit body:
  - states D1–D6 in one line each;
  - names UX audit #16 (second half);
  - ends with the `Co-Authored-By` trailer per `CLAUDE.md`.

**Stop after the push and report.** Do not write docs. Do not run the smoke.

### 2. Gate + smoke (orchestrator, not you)

**Gate:** a clean clone at your SHA in the cloud container:
- the scope diff against `edcad10`;
- `tsc -b`, `eslint .`, and `vitest run` in three zones;
- red-first reproduced;
- the build and eager JS;
- the deployed JS contains `data-row-nav`;
- the live `version.json`.

**Smoke:** the deployed app in Sergio's Chrome, via the Claude in Chrome extension, tab in the foreground. Read-only: no completion, no save, no task writes. `localStorage['hupo.taskHorizon']` read before and restored after.
1. **Tab stops on the Dashboard at 1224 px:** count before (live `2032405`, taken before the push) and after. Expect a drop of roughly 5–7 per visible row.
2. **Tab into the first row:** focus is on its completion checkbox (screenshot of the focus ring). Tab again: the next row's checkbox.
3. **Arrows:** `ArrowRight` walks title → (chips) → minutes → sun → `⋯`; `End` and `Home` jump; nothing wraps. Each step's `document.activeElement` recorded.
4. **Remember:** arrow to minutes, Tab out, Shift+Tab back: focus is on minutes.
5. **Edit and return:** Enter on the title opens the input; Escape returns focus to the title button; nothing saved.
6. **Menu:** arrow to `⋯`, Enter opens the menu; Escape closes it and focus is back on `⋯`.
7. **Global shortcuts from a row control:** `⌘K` opens `New task`; `/` opens `Search`; each closed with Escape, nothing saved.
8. **Subcategory view:** the selection checkbox is reachable by `ArrowLeft` / `Home`; the stop is the completion checkbox.
9. **Console:** clean across a fresh reload.

### 3. Docs (`[skip ci]`, after the orchestrator's gate and smoke pass)

**Commit this prompt** as `prompts/chunk-77-row-keyboard.md`, copied from the file, not retyped.

**`ARCHITECTURE.md` §13.** Directly after the chunk-75 landmark bullet (`Every signed-in screen has one <main id="main">…`), add:

> - Task rows (chunk 77): each task row is one tab stop, a `role="group"` named by the task title. Tab enters it on the completion checkbox, or on the control last used in that row; ← / → move between its controls (selection checkbox, completion, title, priority chip, when chip, minutes, Today sun, ⋯), Home / End go to the first / last, nothing wraps. The grip is out of the tab order (pointer drag only; keyboard moves use ⋯ → Move to). Enter or Escape in the inline title or minutes edit returns focus to its button. Row keys are never stopped from bubbling, so global shortcuts work from any row control.

**`PROGRESS.md`:**
- **Row 77 ☑**, directly after row 76a:
  - the step-1 SHA;
  - gates in both runner zones, with the Mac base in both zones;
  - red-first counts, with the non-guard cases named;
  - test count and file count;
  - eager JS before / after;
  - deploy run and live `version.json`;
  - the orchestrator's gate and smoke result, including Dashboard tab stops before / after;
  - existing tests changed under D8;
  - deviations, numbered.
- **Decisions log:** D1–D6 (2026-10-14, chunk 77), one row each.
- **Last-updated paragraph:** per the chunk-54 convention. The chunks 76 and 76a paragraph moves to Update history, relabelled `Prior update:` (prefix only).
- **Known gaps:** remove "per-row keyboard structure (audit #16, second half)". Add: `TodayPanel`, Recovered card and Planner tray rows keep one tab stop per control. Carry the rest.

If row 77 must name the docs SHA, record it in an immediate `[skip ci]` follow-up (chunk-54 convention).

---

## Out of scope

- `ArrowUp` / `ArrowDown` between rows; a grid role; type-ahead.
- A dnd-kit `KeyboardSensor` or any keyboard drag.
- Row-level shortcuts (e.g. `x` to complete, `e` to edit).
- `TodayPanel`, the Recovered card, the Planner tray, subcategory headers, routines.
- The rest of the audit: #12, the rest of #17, the rest of #18, #19.
- Carried gaps: `SetReminderPopover` (6) under `TZ=Asia/Tokyo`; delete-then-sign-out (chunk 72); dead hero branches (chunk 74 deviation 5); the AI `Start` link to a filtered-out task (chunk 76 deviation 5); `⌘` / `Ctrl` + Enter on a horizon segment also drills.

## Report back

- **Step 1:**
  - commit SHA and `git diff --stat edcad10 <SHA>`;
  - gates (`tsc -b`, `eslint .`, test count and file count in both runner zones, build), with the Mac base in both zones;
  - red-first counts, with 7, 10, 11 and 12 named as the expected passes;
  - eager JS before / after / delta;
  - the empty `package.json` diff;
  - deploy run id and result;
  - live `version.json`.
- Whether a `TaskMenu` test file exists and what D8 added there.
- Every existing test changed under D8: file and case.
- Anything you built that departs from D1–D8, and why.
- Every deviation, numbered.
