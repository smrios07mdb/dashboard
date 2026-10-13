# Chunk 74a: One click, one task in the review (chunk-74 known gap)

**Runs on:** Claude Code, in `~/Documents/To-Do Dashboard` on Sergio's Mac (repo `smrios07mdb/dashboard`). You write the code and the tests. App code only: no SQL, no migration, no proxy, no new dependency.

**Bases:**
- App `smrios07mdb/dashboard` @ `0e72fdc` (docs). Last code commit `dc4fb2d` (chunk 74), which is what's live.
- Proxy untouched.

**Authority:** `ARCHITECTURE.md` → `prompts/README.md` → this prompt. Read first:
- `CLAUDE.md`, `prompts/README.md`.
- `src/components/ReviewSheet.tsx` and `src/components/ReviewSheet.test.tsx`.
- `src/lib/review.ts`.
- `prompts/chunk-74-age-and-fold.md` (D2) and PROGRESS row 74 (the known gap).

**Scope:** the review double-activation gap recorded in row 74. Nothing else.

---

## The problem, as committed at `0e72fdc`

- In the chunk-74 smoke, Sergio clicked `Add to Today` once on card 2 (`Smoke-74a`). Card 3 (`Call Bob London`, his own task) was pinned to Today too. Its `today_marks` pin is timestamped 0.66 s before the sheet closed.
- `ReviewSheet` advances in place. Keep, Add to Today and Delete each act on the card on screen and then render the next card, so the same button sits under the pointer for the next task.
- Nothing stops a second activation from landing on the next card: a double-click, a trackpad tap plus press, a held Enter, or two quick clicks. Add to Today then writes for a task the user never saw, and Delete marks it.
- The same holds for `Done`, which renders in place after the last card.

---

## Locked decisions (orchestrator, 2026-10-13)

### D1 A settle window after every advance: `src/lib/review.ts`, `src/components/ReviewSheet.tsx`

**`lib/review.ts`:** add one constant beside the others:

```ts
/** After the review walk advances, its buttons ignore activations for this long (chunk 74a). */
export const REVIEW_SETTLE_MS = 400
```

**`ReviewSheet`:**
- Hold `settleUntil` in a `useRef<number>(0)`.
- Every advance (Keep, Add to Today, Delete) sets `settleUntil.current = Date.now() + REVIEW_SETTLE_MS`, in the same handler, before it returns.
- Each of the four buttons (Keep, Add to Today, Delete, Done) runs its action only through one guard:

  ```ts
  /** True when this activation should act (chunk 74a). */
  const ready = (e: React.MouseEvent) =>
    e.detail <= 1 && Date.now() >= settleUntil.current
  ```

  `onClick={(e) => { if (ready(e)) keep() }}`, and the same for the other three.
- **`e.detail > 1`** is ignored at any time. It is the second or later click of a multi-click, even one slower than the window.
- **Keyboard activation** has `detail === 0`. It acts once the window has passed, so a held Enter cannot run through the walk.
- **On each open** (the existing re-snapshot branch), reset `settleUntil.current = 0`, so the first activation on a fresh sheet acts immediately.
- Use `Date.now()`, not `performance.now()`, so `vi.setSystemTime` drives it in tests.
- **No visual change:** no disabled state, no new markup, no change to focus. The buttons look and behave the same apart from the swallowed activations.
- **Closing is not guarded:** Escape and the close button behave as before, and `onClose(deleteIds)` is still called exactly once per close.

### D2 What does not change

- D2 of chunk 74 otherwise: the snapshot, the progress line, the muted line, the end line, deletes waiting for the close, `onToggleToday(task.id, true)` written at once.
- `ReviewPrompt`, the Dashboard, `toggleToday`, `taskUndo`, `TaskRow`, `TodayPanel`, `DailyHero`, `BusyStrip`.
- `package.json` / `package-lock.json`.

### D3 Tests (you write them): `src/components/ReviewSheet.test.tsx`

**Clock.** Use `vi.useFakeTimers({ toFake: ['Date'] })` with `vi.setSystemTime(new Date('2026-10-13T16:00:00Z'))` in a `beforeEach`, and `vi.useRealTimers()` in an `afterEach`. Only `Date` is faked, so Radix's timers stay real.

**Existing cases.** The walk case presses buttons back to back, so after D1 its second press would be swallowed.
- Change the `press` helper to move the clock past the window before each click: `vi.setSystemTime(Date.now() + REVIEW_SETTLE_MS)`, then `fireEvent.click(...)`.
- Change nothing else in the four existing cases.

**New cases** (`describe('ReviewSheet — one click, one task (chunk 74a)')`), each with a fresh `setup()`. `tap(name, detail = 1)` clicks without moving the clock: `fireEvent.click(screen.getByRole('button', { name }), { detail })`.
1. **Two quick clicks on Add to Today:** call `tap('Add to Today')` twice. `onToggleToday` is called once, with `('a', true)`, and the progress line reads `2 of 3`.
2. **Double-click on Delete:** `tap('Delete')` then `tap('Delete', 2)`, then Escape. `onClose` is called once, with `['a']`.
3. **Double-click on Keep:** `tap('Keep')` then `tap('Keep', 2)`. The progress line reads `2 of 3`.
4. **After the window:** `tap('Add to Today')`, move the clock by `REVIEW_SETTLE_MS`, `tap('Add to Today')`. `onToggleToday` is called twice: `('a', true)`, then `('b', true)`.
5. **A late second click of a double-click:** `tap('Keep')`, move the clock by `REVIEW_SETTLE_MS * 2`, `tap('Keep', 2)`. The progress line still reads `2 of 3`.
6. **Done:** walk to the end with `press`, then immediately `tap('Done')`. `onClose` is not called. Move the clock by `REVIEW_SETTLE_MS`, `tap('Done')`: `onClose` is called once.
7. **A fresh open acts at once:**
   - `tap('Keep')`.
   - Rerender with `open={false}`, then `open` again (use `render`'s `rerender`; keep the same props otherwise).
   - Without moving the clock, `tap('Keep')`. The progress line reads `2 of 3` (a new walk, advanced once).

**Red-first:** with everything written, restore `src/components/ReviewSheet.tsx` from `0e72fdc` (keep the new `lib/review.ts` so the import resolves) and run the file:

```bash
mkdir -p "$TMPDIR/c74a/src/components"
cp src/components/ReviewSheet.tsx "$TMPDIR/c74a/src/components/ReviewSheet.tsx"
git show 0e72fdc:src/components/ReviewSheet.tsx > src/components/ReviewSheet.tsx
npx vitest run src/components/ReviewSheet.test.tsx
cp "$TMPDIR/c74a/src/components/ReviewSheet.tsx" src/components/ReviewSheet.tsx
git status --short
```

Report the pass/fail counts. Cases 1, 2, 3, 5 and 6 must fail against the old component; name any new case that passes there (expected: 4 and 7, which are not guards). The final `git status --short` must match your change set exactly.

### D4 Commit routing

- **One code commit**, pushed **alone**, **no `[skip ci]`**.
- **Expected files:** `src/lib/review.ts`, `src/components/ReviewSheet.tsx`, `src/components/ReviewSheet.test.tsx`. Anything else: stop and report before committing.
- **Subject:** `Chunk 74a: One click, one task in the review`.
- **Gates before the push**, on a clean `npm ci`: `tsc -b` clean; `eslint .` 0 problems; `vitest run` all green; `TZ=UTC npx vitest run` all green; `npm run build` green.
- **Base figures** at `0e72fdc` (code identical to `dc4fb2d`; orchestrator, cloud container, Node 22, clean clone, placeholder `.env.local` with the real `VITE_CALDAV_PROXY_URL`):
  - `vitest run` **1071 / 1071** in **96** files, in `America/New_York` and in `UTC`.
  - Eager JS **1,048,857 B** (7 files).
  - Run your own base on the Mac in both zones and report it with your after (your chunk-74 after was 1,049,864 B).
- **Eager JS limit: +200 B.** `ReviewSheet` stays lazy; only the constant in `lib/review.ts` lands in the eager bundle.
- **After the push:** deploy run id and result; live `version.json` read cache-busted.

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

Expect `0e72fdc`. If `main` is anywhere else, stop and report.

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
git diff --stat 0e72fdc -- package.json package-lock.json
git add src/lib/review.ts src/components/ReviewSheet.tsx src/components/ReviewSheet.test.tsx
git status --short
git commit
git push origin main
```

- `git status --short` after `git add` must show only the three D4 files staged.
- The commit body states D1 in one line, names the chunk-74 smoke finding it closes, and ends with the `Co-Authored-By` trailer per `CLAUDE.md`.

**Stop after the push and report.** Do not write docs. Do not run the smoke.

### 2. Gate + smoke (orchestrator, not you)

**Gate:** clean clone at your SHA in the cloud container:
- the scope diff against `0e72fdc`;
- `tsc -b`, `eslint .`, and `vitest run` in three zones;
- red-first reproduced;
- the build and eager JS;
- the deployed CSS hash match;
- `REVIEW_SETTLE_MS`'s value `400` in the deployed lazy `ReviewSheet-*.js` chunk, or in the eager bundle beside `hup:lastReview`;
- the live `version.json`.

**Smoke:** deployed app in Sergio's Chrome via the Claude in Chrome extension, tab in the foreground. **No task writes:** the walk uses Keep only, and closes with Escape and nothing marked. `localStorage['hup:lastReview']` is read before and restored after.
1. Clear `hup:lastReview` and reload; the prompt shows. Review → `1 of N`.
2. **Double-click** `Keep` (the extension's double-click): the line reads `2 of N`.
3. **Two scripted clicks in one tick** on `Keep` (`detail: 1` each, dispatched in one `javascript_tool` call): `3 of N`.
4. **One click** on `Keep` after a pause: `4 of N`.
5. Escape: no toast; the Today plan is unchanged (`today_marks` for today read before and after); no task row has an `updated_at` after the smoke started.
6. Restore `hup:lastReview`. Console clean.

### 3. Docs (`[skip ci]`, after the orchestrator's gate and smoke pass)

**`ARCHITECTURE.md` §13.** At the end of the chunk-74 bullet, append:

> Since chunk 74a the walk's buttons ignore a second click of a multi-click and any activation within 400 ms of an advance (`REVIEW_SETTLE_MS`), so one click acts on one task.

**`PROGRESS.md`:**
- **Row 74a ☑**, directly after row 74:
  - the step-1 SHA;
  - gates in both runner zones, Mac base in both zones;
  - red-first counts;
  - test count and file count;
  - eager JS before / after;
  - deploy run and live `version.json`;
  - the orchestrator's gate and smoke result;
  - deviations, numbered.
- **Row 74:** leave it as is.
- **Decisions log:** D1 (2026-10-13, chunk 74a), one row. It states the 400 ms window, the `detail > 1` rule, that keyboard activation is covered by the window, and that there is no visual change.
- **Last-updated paragraph:** per the chunk-54 convention. The chunk-74 paragraph moves to Update history, relabelled `Prior update:` (prefix only).

Commit this prompt as `prompts/chunk-74a-review-double-activation.md` in the same commit, copied from the file, not retyped. If row 74a must name the docs SHA, record it in an immediate `[skip ci]` follow-up (chunk-54 convention).

---

## Out of scope

- Any visual cue for the window (a disabled look, a fade between cards).
- Undo for Add to Today inside the review; changing the advance-in-place layout.
- Other chunk-74 known gaps: the `SetReminderPopover` (6) failure under `TZ=Asia/Tokyo`, and the delete-then-sign-out gap from chunk 72.
- The dead branches left in the full hero (chunk 74 deviation 5).

## Report back

- **Step 1:**
  - commit SHA and `git diff --stat 0e72fdc <SHA>`;
  - gates (`tsc -b`, `eslint .`, test count and file count in both runner zones, build), with the Mac base in both zones;
  - red-first counts, with the non-guard cases named;
  - eager JS before / after / delta;
  - the empty `package.json` diff;
  - deploy run id and result;
  - live `version.json`.
- Anything you built that departs from D1–D3, and why.
- Every deviation, numbered.
