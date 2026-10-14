# Chunk 76a: The horizon control lets global shortcuts through

**Runs on:** Claude Code, in `~/Documents/To-Do Dashboard` on Sergio's Mac (repo `smrios07mdb/dashboard`). You write the code and the test. App code only: no SQL, no migration, no proxy, no new dependency.

**Bases:**
- App `smrios07mdb/dashboard` @ `1c62619` (chunk 76 code, live, gate-verified). Chunk 76's docs are **not** written yet; they are written once, after this chunk, covering rows 76 and 76a (step 3).
- Proxy untouched.

**Authority:** `ARCHITECTURE.md` → `prompts/README.md` → `prompts/chunk-76-horizon.md` (not yet committed; Sergio has the file) → this prompt. Chunk 76's D1–D7 stand; this prompt amends its D2 only. Read first:
- `CLAUDE.md`, `prompts/README.md`.
- `src/components/HorizonControl.tsx` and `src/components/HorizonControl.test.tsx`.
- `src/components/capture/useCaptureShortcuts.ts` (the `window` keydown listener for `N`, `/`, `⌘K` / `^K`, chunk 73).
- `src/components/CategoryColumn.tsx` ~L213 (the header's Enter / Space drill).

**Scope:** one bug from the chunk-76 smoke. Nothing else.

---

## The problem, as committed at `1c62619`

Chunk 76 deviation 2: `HorizonControl`'s `onKeyDown` calls `e.stopPropagation()` on **every** key. React's `stopPropagation` stops the native event too, so it never bubbles from the React root to `window`. `useCaptureShortcuts` listens on `window`, so while a horizon segment has focus, `⌘K` / `^K`, `N` and `/` do nothing.

Orchestrator smoke, live `1c62619`, Sergio's Chrome, 2026-10-14. A `window` keydown spy, with `keydown` `{ key: 'k', metaKey: true }` dispatched on:
- the checked horizon segment: the spy saw **0** events and no dialog opened;
- the `Sort` button next to it: the spy saw **1** event and `New task` opened.

ARCH §13 (chunk 73) says `⌘K` opens capture from anywhere. The deviation's purpose was right: Enter or Space on a segment must not reach the column header's drill. It was built too broad.

---

## Locked decisions (orchestrator, 2026-10-14)

### D1 Stop only the keys the control handles: `src/components/HorizonControl.tsx`

In `onKeyDown`, call `e.stopPropagation()` only for these keys:
- `Enter` and `' '` (Space), so they don't reach the header drill;
- `ArrowLeft`, `ArrowRight`, `ArrowUp`, `ArrowDown`, `Home` and `End`, which the control consumes.

Every other key bubbles untouched. That includes letters, `/`, `Tab`, `Escape`, and any key held with a modifier.

- Keep one `const` set of stopped keys at module scope (`STOPPED_KEYS`).
- Update the comment above it to say what is stopped and why.
- Click, double-click and the arrow / Home / End behaviour don't change.

### D2 What does not change

- Everything else in chunk 76 (D1–D7, deviations 1, 3, 4, and known gap 5).
- `useCaptureShortcuts.ts`, `CategoryColumn.tsx` and `TaskSortControl.tsx`.
- `package.json` / `package-lock.json`.

### D3 Tests (you write them): `src/components/HorizonControl.test.tsx`

Extend it with:
- **16.** Inside a parent `<div onKeyDown={spy}>`, `fireEvent.keyDown` on a segment with `N`, `/`, `{ key: 'k', metaKey: true }` and `{ key: 'k', ctrlKey: true }`. Each reaches `spy`.
- **17.** A native `window` `keydown` listener sees `{ key: 'k', metaKey: true }` dispatched on a focused segment. Use `seg.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true, bubbles: true }))`, and remove the listener in `finally`. This is the case that reproduces the live bug.
- **18.** `Enter`, `' '`, `ArrowRight` and `Home` on a segment still don't reach the parent `spy`. This restates the existing "keeps clicks and keys from reaching a parent" case for the full stopped set.

**Existing tests:** none should need changing. If one does, change only its expected value and list it.

**Red-first:** with the test written, restore the base for the source and run the file:

```bash
cp src/components/HorizonControl.tsx "$TMPDIR/HorizonControl.after.tsx"
git show 1c62619:src/components/HorizonControl.tsx > src/components/HorizonControl.tsx
npx vitest run src/components/HorizonControl.test.tsx
cp "$TMPDIR/HorizonControl.after.tsx" src/components/HorizonControl.tsx
git status --short
```

- Cases 16 and 17 must fail against the base.
- Case 18 passes against the base; name it as the expected pass.
- Report counts.
- The final `git status --short` must show only the two files.

### D4 Commit routing

- **One code commit**, pushed **alone**, **no `[skip ci]`**.
- **Expected files:** `src/components/HorizonControl.tsx` and `src/components/HorizonControl.test.tsx`. Anything else: stop and report before committing.
- **Subject:** `Chunk 76a: Horizon control lets global shortcuts through`.
- **Gates before the push**, on a clean `npm ci`:
  - `tsc -b` clean;
  - `eslint .` 0 problems;
  - `vitest run` all green;
  - `TZ=UTC npx vitest run` all green;
  - `npm run build` green.
- **Base figures** at `1c62619` (orchestrator, cloud container, Node 22, clean clone):
  - `vitest run` **1142 / 1142** in **102** files, in `America/New_York` and in `UTC`.
  - Eager JS **1,052,315 B** (7 files, container); your Mac after for chunk 76 was 1,053,326 B.
  - Run your own base on the Mac in both zones.
- **Eager JS limit: +200 B.**
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

Expect `1c62619`. If `main` is anywhere else, stop and report.

```bash
rm -rf node_modules
npm ci
npx vitest run
TZ=UTC npx vitest run
npm run build
python3 -c "import re,os;h=open('dist/index.html').read();f=set(re.findall(r'(?:src|href)=\"/dashboard/(assets/[^\"]+\.js)\"',h));print(len(f),sum(os.path.getsize('dist/'+x) for x in f))"
```

Record the base. Implement D1, write the D3 tests, run red-first. Then:

```bash
npx tsc -b
npx eslint .
npx vitest run
TZ=UTC npx vitest run
npm run build
python3 -c "import re,os;h=open('dist/index.html').read();f=set(re.findall(r'(?:src|href)=\"/dashboard/(assets/[^\"]+\.js)\"',h));print(len(f),sum(os.path.getsize('dist/'+x) for x in f))"
git diff --stat 1c62619 -- package.json package-lock.json
git add src/components/HorizonControl.tsx src/components/HorizonControl.test.tsx
git status --short
git commit
git push origin main
```

- `git status --short` after `git add` must show only those two files staged. `prompts/chunk-76-horizon.md` and `prompts/chunk-76a-horizon-shortcuts.md` may show as untracked; leave them.
- The commit body:
  - states D1 in one line;
  - names chunk 76 deviation 2 as the cause;
  - ends with the `Co-Authored-By` trailer per `CLAUDE.md`.

**Stop after the push and report.** Do not write docs. Do not run the smoke.

### 2. Gate + smoke (orchestrator, not you)

**Gate:** a clean clone at your SHA in the cloud container:
- the scope diff against `1c62619`;
- `tsc -b`, `eslint .`, and `vitest run` in three zones;
- red-first reproduced;
- the build and eager JS;
- the live `version.json`.

**Smoke:** the deployed app in Sergio's Chrome, via the Claude in Chrome extension. Read-only.
- Focus a horizon segment on the Dashboard and dispatch `⌘K`: the `window` spy sees it and `New task` opens. Close it with Escape; nothing is saved.
- Enter on a segment does not drill.
- Arrows still move the selection.
- Console is clean.
- Restore `localStorage['hupo.taskHorizon']` to what it was before.

### 3. Docs (`[skip ci]`, after the orchestrator's gate and smoke pass): covers chunks 76 and 76a

**Commit both prompts**, copied from the files, not retyped:
- `prompts/chunk-76-horizon.md`
- `prompts/chunk-76a-horizon-shortcuts.md`

**`ARCHITECTURE.md`:**
- **§13:** append chunk 76's horizon paragraph, word for word from `chunk-76-horizon.md` step 3. Then add one sentence to the end of it: `The control stops only Enter, Space, the arrows, Home and End from bubbling, so global shortcuts work while it has focus (chunk 76a).`
- **§4:** append chunk 76's priority-note sentence, word for word.

**`PROGRESS.md`:**
- **Row 76 ☑**, directly after row 75a. It records:
  - step-1 SHA `1c62619`;
  - gates in both runner zones, with the Mac base in both zones;
  - red-first 4 failed / 9 passed across the two files, plus the two new files that can't load at the base;
  - 1142 tests in 102 files;
  - eager JS 1,050,542 → 1,053,326 B (+2,784);
  - deploy run 38538838935 and the live `version.json`;
  - the orchestrator's gate and smoke (figures below);
  - the test files fixed for the required prop;
  - ArrowLeft wraps;
  - deviations, numbered, with these rulings: 1, 3, 4 accepted; 2 accepted in intent, too broad, narrowed in 76a; 5 is a known gap.
- **Row 76a ☑**, directly after row 76, in the same shape, from the 76a step-1 report and the orchestrator's gate and smoke.
- **Decisions log:** one row each for chunk 76 D1–D4 (2026-10-13) and chunk 76a D1 (2026-10-14). The 76 D1 row states that the horizon is derived from priority and dates by choice, with no column, and that the 14-day window is a module constant.
- **Last-updated paragraph:** per the chunk-54 convention, covering 76 and 76a. The chunks 75 and 75a paragraph moves to Update history, relabelled `Prior update:` (prefix only).
- **Known gaps:**
  - An AI `Start` link (`?task=`) to a task the filter hides doesn't scroll to it or flash it (76 deviation 5).
  - The near branch was not exercised on live data. All 28 open tasks are unprioritised and undated, so `Near` correctly showed 0 everywhere. The near rules are covered by the unit tests only.

**Orchestrator gate and smoke for chunk 76** (for row 76):
- **Gate, PASS at `1c62619`**, run in the cloud container on Node 22.22.0 from a clean clone and a clean `npm ci`:
  - Scope: `git diff --stat 57e1c8f 1c62619` shows 14 files, +712 / −20, exactly the D7 list. `package.json` and `package-lock.json` are untouched. The source was read against D1–D4: exact apart from deviations 1–4.
  - `tsc -b` is clean and `eslint .` reports 0 problems.
  - `vitest run`: 1142 / 1142 in 102 files in `America/New_York` and in `UTC`. Under `TZ=Asia/Tokyo` it is 1141 / 1142; the one failure is the carried `SetReminderPopover` (6).
  - Red-first reproduced exactly: 4 failed / 9 passed.
  - Eager JS (container): 1,049,531 → 1,052,315 B, +2,784 B, the same delta as the Mac.
  - Deploy: gh-pages commit `2bec5a2` for `1c62619`, pages run 38538912591 green. The deployed `index-hupNw8N6.js` contains `hupo.taskHorizon`, `Nothing near term.` and `Nothing long term.`.
  - Live `version.json`: `{"sha":"1c62619","builtAt":"2026-10-14T08:58:02.371Z"}`.
- **Smoke**, run in Sergio's Chrome on the live app, 1168 px window, read-only. `hupo.taskHorizon` was unset before and is unset again after.
  - **Dashboard:** two controls, `All` checked with tab index 0 on it only. Pills read 15 and 8 open, unchanged.
  - **`Near`** switches both columns:
    - pills read 0 and 0, totals 0m;
    - every list with open rows reads `Nothing near term.`;
    - the all-done lists keep `All done. N completed.`
  - **`Long`:** 23 rows. With `Near`'s 0 rows that makes 23, with no overlap and no loss.
  - **The data, checked through Supabase REST:** 28 open tasks, all with `priority` null and no due or reminder date. Settings time zone is `America/New_York`.
  - **Work category view:** `Long` persisted across a full load. Header `8 open · 4h`; under `Near` it is `0 open · 0m`, with three `Nothing near term.` and the two all-done lines.
  - **Work / General:**
    - `Long` shows 2 open.
    - `Near` shows `0 open · 0m` and `Nothing near term.` (deviation 1 confirmed live).
    - `Show 6 done` under `Near` reveals 6 completed rows.
  - **Keyboard:** ArrowRight moves `Long` to `All` and focus follows; ArrowLeft goes back. Checked by dispatched events, because the tab was backgrounded.
  - **Contrast and size:** every segment is 11 px. Unchecked segments are 5.03:1 and the checked one is 13.58:1.
  - **382 px frame:** Dashboard `scrollWidth` 367. Both controls end inside their header, with no overflow.
  - **Console:** clean across a fresh reload.
  - **Finding:** `⌘K` from a focused segment never reached `window` (fixed in 76a).

If row 76a must name the docs SHA, record it in an immediate `[skip ci]` follow-up (chunk-54 convention).

---

## Out of scope

- Known gap 5 (highlighting a filtered-out task).
- Any other keyboard handling in the app.

## Report back

- **Step 1:**
  - commit SHA and `git diff --stat 1c62619 <SHA>`;
  - gates (`tsc -b`, `eslint .`, test count and file count in both runner zones, build), with the Mac base in both zones;
  - red-first counts, with case 18 named as the expected pass;
  - eager JS before / after / delta;
  - the empty `package.json` diff;
  - deploy run id and result;
  - live `version.json`.
- Anything you built that departs from D1–D3, and why.
- Every deviation, numbered.
