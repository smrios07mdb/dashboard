# Chunk 75: Readable small text and a main landmark (UX audit #14, #16)

**Runs on:** Claude Code, in `~/Documents/To-Do Dashboard` on Sergio's Mac (repo `smrios07mdb/dashboard`). You write the code and the tests. App code only: no SQL, no migration, no proxy, no new dependency.

**Bases:**
- App `smrios07mdb/dashboard` @ `c5b3e90` (docs). Last code commit `845b77b` (chunk 74a), which is what's live.
- Proxy untouched.

**Authority:** `ARCHITECTURE.md` → `prompts/README.md` → this prompt. Read first:
- `CLAUDE.md`, `prompts/README.md`.
- `src/index.css` (`:root` tokens, `[data-catpalette='emerald']`, `.label`), `tailwind.config.ts` (the `ink-*` mapping), `src/lib/cat.ts`.
- `src/components/ProtectedLayout.tsx` and its test, `src/components/AppShell.tsx`, `src/components/Protected.tsx`, `src/screens/Planner.tsx` (the `<main>` at the desktop branch).
- `src/lib/iosFocusZoom.test.ts` — the source-scan pattern D3's guard copies.
- `ARCHITECTURE.md` §13 (the iOS focus-zoom bullet).

**Scope:** audit #14 (small text fails contrast) and the landmark half of #16 (`<main>`, skip link). Nothing else.

---

## The problem, as committed at `c5b3e90`

Measured on the live app (`845b77b`) in Sergio's Chrome on 2026-10-13, Dashboard at a 1224 px window. The counts are visible text elements, with the background resolved through ancestors and opacity included.

- **187 text elements; 104 fail AA:**
  - 97 are `--ink-3` (`#948f9e`, 2.85:1 on `--bg`, 3.14:1 on white).
  - 2 are emerald (`--work`) text: the Today subcategory chip and the `Pinned` tag (3.42:1).
  - 2 are amethyst: the `LVL 13` chip (4.46:1).
  - 2 are the white counts on the `N open` pills (3.67:1 / 3.77:1).
  - 1 is `What's next?`, which is white on a gradient the script reads as transparent. It is a false positive (≥5.2:1 at the gradient's centre) and is out of scope.
- **18 text elements under 11 px.** The `.label` primitive is 10 px, and inline overrides go down to 8 px.
- **No `<main>` landmark and no skip link.** There are 225 tab stops on the Dashboard.

The source has the same pattern on other screens:
- `text-ink-3` / `var(--ink-3)` is used about 165 times.
- Category and jewel colours are used as text on Insights, Routines, the streak chip and the planner.
- Sub-11 px sizes appear in 31 files.

---

## Locked decisions (orchestrator, 2026-10-13)

### D1 `--ink-3` is darkened to `#6b6676`: `src/index.css`

- In `:root`, `--ink-3: #948f9e` becomes **`--ink-3: #6b6676`**. Measured contrast: 5.54 on `--surface` (#fff), 5.16 on `--surface-2`, 5.07 on `--bg`, 4.64 on `--bg-alt`. The audit's suggested `#6f6a7a` fails on `--bg-alt` (4.38), where the streak chip sits, so it was not taken.
- Change nothing else in the ink scale. `--ink-2` stays `#635f6c`, so ink-2 and ink-3 now sit closer together (6.21 vs 5.54 on white). This is accepted; the smoke screenshots it for Sergio's eye.
- The aesthetic scaffold blocks (`meadow`, `blush`, `porcelain`, `data-mode='dark'`) are not touched. They are not wired anywhere.
- `src/screens/TokenCheck.tsx`: its caption `ink-3 — hints / captions #948f9e` shows the new hex.
- Decorative uses keep the token as they are (`text-ink-3/70` grip, `text-ink-3/60` breadcrumb separator, `decoration-ink-3`, `bg-ink-3`). There is no separate decoration token.

### D2 Coloured text uses an `-ink` variant: `src/index.css`, `src/lib/cat.ts`, call sites

**Tokens.** Add to `:root`, after the jewel palette and category base:

```css
/* Text-safe ("-ink") variants of the identity and jewel colours (chunk 75):
   >= 4.5:1 on white, on --bg and on the colour's own 10–15% wash. Fills,
   borders, bars and dots keep the base colour; text uses these. */
--work-ink:            color-mix(in srgb, var(--work) 70%, black);
--personal-ink:        color-mix(in srgb, var(--personal) 70%, black);
--jewel-amethyst-ink:  color-mix(in srgb, var(--jewel-amethyst) 70%, black);
--jewel-jade-ink:      color-mix(in srgb, var(--jewel-jade) 70%, black);
--jewel-coral-ink:     color-mix(in srgb, var(--jewel-coral) 70%, black);
--jewel-gold-ink:      color-mix(in srgb, var(--jewel-gold) 60%, black);
```

Gold needs 60%; 70% leaves it under 4.5.

**`lib/cat.ts`:** add

```ts
/** Category colour for text, as a CSS var: `--work-ink` / `--personal-ink` (chunk 75). */
export function catInk(name: string): string {
  return name === 'Work' ? 'var(--work-ink)' : 'var(--personal-ink)'
}
```

**The rule.** Any text under 24 px whose `color` is a category or jewel colour uses the `-ink` variant. Backgrounds, borders, bars, dots, icons beside text, box shadows, and the 31 px category column heading (large text, ≥3:1) keep the base colour. Known sites:
- **`TodayPanel.tsx`:** the subcategory chip text (`color: cat`, ~L127) and the `Pinned` tag (`color: cat`, ~L153). Use the ink variant of the same category; the chip's tint and border stay on `cat`.
- **`ui/pill.tsx`:** in the `SOFT` map, the `work` and `personal` text use `--work-ink` / `--personal-ink`.
- **`gamify/DailyHero.tsx`:** the `LVL` label and the level number use `--jewel-amethyst-ink`.
- **`StreakBadge.tsx`:** add an `ACCENT_INK` map (`morning` → gold-ink, `night` → amethyst-ink, `neutral` → `var(--ink)`) used for the number's text colour. The flame icon and the soft fill stay on `ACCENT`.
- **`RoutinePanel.tsx`:** text set in `accent` (~L153, ~L215) uses the routine's ink variant. Fills stay on `accent`.
- **`screens/Insights.tsx`:**
  - The trend chip's text (`color: 'var(--work)'` and the other branch's colour) uses the ink variant.
  - The stat card label (`color: c.accent, opacity: 0.85`) uses the ink variant of `c.accent`, and the opacity goes.
  - Give `statCards` an `ink` field beside `accent` rather than deriving it by string.
- **`planner/ProposalBlock.tsx`, `planner/DropSlot.tsx`:** text set in `catColor(...)` uses `catInk(...)`. DropSlot's `conflict` branch keeps `hsl(var(--destructive))` (already ≥4.5).

Grep for any other `color:` / `text-[var(--…)]` set to `--work`, `--personal`, `--jewel-*`, `catColor(…)` or a variable holding one of them, on text. Convert each and **list every one you add beyond the known sites** in the report.

**`N open` pill** (`CategoryColumn.tsx`): `background: accent` becomes `background: catInk(category.name)` with white text (6.6–6.7:1). The box shadow stays on `accent`.

### D3 An 11 px floor for text: `src/index.css`, call sites

- **`.label`:** `font-size: 10px` becomes **`11px`**. Letter-spacing, weight, case and colour are unchanged.
- **Call sites:** raise every Tailwind `text-[Npx]` and every inline `fontSize: N` under 11 to `11` (`text-[11px]` / `fontSize: 11`). Where the under-11 value only overrides `.label`, delete the override so the element inherits 11 px rather than restating it.
- This includes the bottom tab bar (`ui/nav-tabs.tsx`, 10 px → 11 px), `PriorityChip`, `TaskSortControl`, the dialog titles in `QuickCapture` / `TaskSearch` / `ReviewSheet`, the `N` `<kbd>` in `ProtectedLayout`, the Recharts tick `fontSize` in `Insights.tsx`, and the planner sheets, pickers and tray (`CalendarPicker`, `BusyPopover`, `ScheduleSheet`, `BlockActionSheet`, `PlannerTray`, `WindowRail`, `screens/Planner.tsx`).
- **Exempt — the planner time grid**, whose blocks and axis are sized in fixed pixels. These seven files keep their sizes: `src/components/planner/TaskBlock.tsx`, `BusyBlock.tsx`, `ProposalBlock.tsx`, `DropSlot.tsx`, `WeekGrid.tsx`, `DayTimeline.tsx`, `DayStrip.tsx`. D2 still applies to their colours.
- If raising a size makes text clip or wrap in a fixed box outside those seven files, stop and report. Do not add a new exemption on your own.
- No line-height, padding or layout changes beyond what keeps an existing box from clipping. Name any you make.

### D4 One `<main>` landmark: `src/components/ProtectedLayout.tsx`, `src/screens/Planner.tsx`

- In `ProtectedLayout`, the `<div className="pt-6">` wrapping `<Outlet />` becomes `<main id="main" tabIndex={-1} className="pt-6 focus:outline-none">`. `<Tabs />` stays outside it: it is the `Primary` nav.
- `Planner.tsx`: the desktop branch's `<main className="min-w-0 flex-1">` becomes a `<div>` with the same class, so the signed-in app has exactly one `main`.
- The `<main>` in `Protected.tsx` (loading), `Login.tsx` and `AuthCallback.tsx` stay. They render instead of the layout, never inside it.

### D5 A skip link: `src/components/ProtectedLayout.tsx`

- It is the first child inside `<NotesProvider>`, before `<AppShell>`, so it is the first focusable element on every signed-in screen (before the install hint and the header).
- Markup:

  ```tsx
  <a
    href="#main"
    onClick={(e) => {
      e.preventDefault()
      document.getElementById('main')?.focus()
    }}
    className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-[calc(env(safe-area-inset-top)+8px)] focus:z-[60] focus:rounded-md focus:bg-surface focus:px-3 focus:py-2 focus:text-[13px] focus:font-medium focus:text-ink focus:shadow-md focus:outline-none focus:ring-2 focus:ring-ring"
  >
    Skip to main content
  </a>
  ```

- `preventDefault` keeps `#main` out of the URL under `BrowserRouter`.
- No other change to focus order.

### D6 What does not change

- Per-row keyboard structure (one tab stop per task row, arrow keys between its controls; the other half of #16). That is the next chunk, not this one.
- `What's next?` (white on the spark gradient), the 31 px category heading colour, chart series colours (ARCH §12 bases), and every fill, border and dot in category or jewel colour.
- `--ink-2`, `--ink-4`, `--muted-foreground`, the shadcn HSL slots.
- `package.json` / `package-lock.json`.

### D7 Tests (you write them)

**`src/lib/contrast.test.ts`** (new). Read `../index.css?raw` as `shellMargins.test.ts` does. Write a small WCAG relative-luminance helper in the test file, plus a resolver for `color-mix(in srgb, var(--X) P%, black)` (multiply each sRGB channel by P/100). Take `--work` / `--personal` from the `[data-catpalette='emerald']` block and everything else from `:root`. Assert:
1. `--ink-3` is ≥ 4.5:1 against each of `--surface`, `--surface-2`, `--bg` and `--bg-alt`.
2. Each of the six D2 `-ink` tokens is ≥ 4.5:1 against `#ffffff`, `--bg`, and its base colour at 15% over white.
3. `#ffffff` is ≥ 4.5:1 on `--work-ink` and on `--personal-ink` (the `N open` pill).
4. `.label`'s `font-size` is `11px`, and no `font-size` in `index.css` is under 11 px.

**`src/lib/fontFloor.test.ts`** (new). This is a source scan in the `iosFocusZoom.test.ts` pattern (Vite raw glob over `/src/**/*.tsx`, excluding `*.test.tsx`). Assert that no file outside the seven D3 exempt files contains:
- a `text-[Npx]` with N < 11, with or without a variant prefix; or
- a numeric `fontSize: N` with N < 11.

On failure, report file and match. Also assert that each of the seven exempt paths exists, so a rename cannot silently widen the exemption.

**`ProtectedLayout.test.tsx`** (new `describe('ProtectedLayout — landmarks (chunk 75)')`, using the file's `renderAt`):
5. There is exactly one `main` landmark (`getAllByRole('main')` has length 1), and it contains the routed `screen` text.
6. The first `userEvent.tab()` from `document.body` focuses a link named `Skip to main content`.
7. Activating it moves focus to the `main` element (`id="main"`), and `window.location.hash` is still empty.

**`CategoryColumn.test.tsx`** (one case):
8. The `N open` pill's `style` has `background: var(--work-ink)` for Work and `var(--personal-ink)` for Personal.

**Existing tests** that assert an old size (`text-[10px]`, `fontSize: 10.5`, …), the old `ink-3` hex, or a base colour on text you moved to `-ink`: update the expected value only, and list each file and case in the report.

**Red-first:** with everything written, restore the base for the non-test sources and run the new and changed test files:

```bash
mkdir -p "$TMPDIR/c75"
git diff --name-only c5b3e90 -- src | grep -v '\.test\.ts' > "$TMPDIR/c75/files.txt"
tar -cf "$TMPDIR/c75/after.tar" -T "$TMPDIR/c75/files.txt"
while read -r f; do git show "c5b3e90:$f" > "$f" 2>/dev/null || true; done < "$TMPDIR/c75/files.txt"
npx vitest run src/lib/contrast.test.ts src/lib/fontFloor.test.ts src/components/ProtectedLayout.test.tsx src/components/CategoryColumn.test.tsx
tar -xf "$TMPDIR/c75/after.tar"
git status --short
```

- `src/lib/cat.ts` is restored too, so imports of `catInk` fail to resolve. Report that as the expected failure mode for files importing it, rather than working around it.
- Report pass/fail counts per file. Cases 1, 2, 3, 4, 5, 6, 7 and 8 and the font-floor scan must fail against the base. Name any that pass.
- The final `git status --short` must match your change set exactly.

### D8 Commit routing

- **One code commit**, pushed **alone**, **no `[skip ci]`**.
- **Expected files:**
  - `src/index.css`, `src/lib/cat.ts`;
  - `src/components/ProtectedLayout.tsx`, `src/screens/Planner.tsx`;
  - the D2 call sites;
  - the D3 call sites;
  - `src/screens/TokenCheck.tsx`;
  - the two new test files;
  - `ProtectedLayout.test.tsx`, `CategoryColumn.test.tsx`;
  - existing tests updated under D7.

  Anything outside `src/`: stop and report before committing.
- **Subject:** `Chunk 75: Readable small text and a main landmark`.
- **Gates before the push**, on a clean `npm ci`: `tsc -b` clean; `eslint .` 0 problems; `vitest run` all green; `TZ=UTC npx vitest run` all green; `npm run build` green.
- **Base figures** at `c5b3e90` (code identical to `845b77b`; orchestrator, cloud container, Node 22, clean clone):
  - `vitest run` **1078 / 1078** in **96** files, in `America/New_York` and in `UTC`.
  - Eager JS **1,049,582 B** (7 files).
  - Run your own base on the Mac in both zones and report it with your after (your 74a after was 1,049,864 B).
- **Eager JS limit: +1,000 B.**
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

Expect `c5b3e90`. If `main` is anywhere else, stop and report.

```bash
rm -rf node_modules
npm ci
npx vitest run
TZ=UTC npx vitest run
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
git diff --stat c5b3e90 -- package.json package-lock.json
git add -A src
git status --short
git diff --cached --stat
git commit
git push origin main
```

- `git status --short` after `git add` must show only files under `src/`, all staged.
- The commit body states D1–D5 in one line each, names UX audit #14 and #16 (landmarks), and ends with the `Co-Authored-By` trailer per `CLAUDE.md`.

**Stop after the push and report.** Do not write docs. Do not run the smoke.

### 2. Gate + smoke (orchestrator, not you)

**Gate:** clean clone at your SHA in the cloud container:
- the scope diff against `c5b3e90` (nothing outside `src/`);
- `tsc -b`, `eslint .`, and `vitest run` in three zones;
- red-first reproduced;
- the build and eager JS;
- the deployed CSS contains `--ink-3:#6b6676` and `--work-ink`, with `.label` at `font-size:11px`;
- the live `version.json`.

**Smoke:** deployed app in Sergio's Chrome via the Claude in Chrome extension, tab in the foreground. Read-only, with no task writes. The measurement script is the one used for the base figures above: visible text, background resolved through ancestors, opacity included, large text = ≥24 px or ≥18.66 px bold.
1. **Dashboard at 1224 px:** 0 failing text elements apart from `What's next?` (base 104); 0 under 11 px (base 18); exactly one `main`; tab stops reported (base 225, expect +1).
2. **Keyboard:** reload, press Tab once. The skip link shows at the top left (screenshot). Enter: `document.activeElement` is `main#main` and the URL has no hash.
3. **Other screens:**
   - Routines, Insights (90-day range), Settings and Notebook: 0 failing, 0 under 11 px.
   - Planner: 0 failing. Under 11 px only inside the seven exempt components.
4. **382 px same-origin frame** (Dashboard and Settings): `scrollWidth` ≤ 382, and no bottom-tab label is clipped (each label's `scrollWidth` ≤ `clientWidth`).
5. **Screenshots for Sergio:** Dashboard top (hero, Today, first rows), before (live `845b77b`, taken by the orchestrator on 2026-10-13 with the base figures) and after, to judge the ink-2 / ink-3 step.
6. Console clean, tracked across a fresh reload.

### 3. Docs (`[skip ci]`, after the orchestrator's gate and smoke pass)

**`ARCHITECTURE.md` §13.** Directly after the iOS focus-zoom bullet, add:

> - Small text meets WCAG AA (chunk 75). `--ink-3` is `#6b6676` (≥4.5:1 on every surface). Text in a category or jewel colour uses its `-ink` variant (`--work-ink`, `--personal-ink`, `--jewel-*-ink`; `catInk()`); fills, borders and dots keep the base colour. No text is under 11 px (`.label` included) outside the planner time grid's seven fixed-size components. `src/lib/contrast.test.ts` and `src/lib/fontFloor.test.ts` guard both.
> - Every signed-in screen has one `<main id="main">` (in `ProtectedLayout`) and a `Skip to main content` link as its first focusable element (chunk 75).

**`PROGRESS.md`:**
- **Row 75 ☑**, directly after row 74a:
  - the step-1 SHA;
  - gates in both runner zones, Mac base in both zones;
  - red-first counts;
  - test count and file count;
  - eager JS before / after;
  - deploy run and live `version.json`;
  - the orchestrator's gate and smoke result, including before / after failing counts per screen;
  - extra D2 sites found;
  - existing tests updated under D7;
  - deviations, numbered.
- **Decisions log:** D1–D5 (2026-10-13, chunk 75), one row each.
- **Last-updated paragraph:** per the chunk-54 convention. The chunk-74a paragraph moves to Update history, relabelled `Prior update:` (prefix only).
- **Known gaps:**
  - per-row keyboard structure (#16, next chunk);
  - the planner time grid's sub-11 px text;
  - `What's next?` white on the spark gradient's light end.

Commit this prompt as `prompts/chunk-75-readable-and-landmarks.md` in the same commit, copied from the file, not retyped. If row 75 must name the docs SHA, record it in an immediate `[skip ci]` follow-up (chunk-54 convention).

---

## Out of scope

- One tab stop per task row with arrow-key movement (#16, second half).
- Any change to `--ink-2` or the type scale beyond the floor.
- The rest of the audit: #12 (streak basis, Routines tab), the rest of #17 (tab icons and names, Settings in the account menu), the rest of #18 (Settings numbering, email repetition, phone stacking), #19.
- Carried gaps: `SetReminderPopover` (6) under `TZ=Asia/Tokyo`; delete-then-sign-out (chunk 72); dead branches in the full hero (chunk 74 deviation 5).

## Report back

- **Step 1:**
  - commit SHA and `git diff --stat c5b3e90 <SHA>`;
  - gates (`tsc -b`, `eslint .`, test count and file count in both runner zones, build), with the Mac base in both zones;
  - red-first counts per file, with any case that passed named;
  - eager JS before / after / delta;
  - the empty `package.json` diff;
  - deploy run id and result;
  - live `version.json`.
- Every D2 site you converted beyond the known list.
- Every existing test you updated under D7: file and case.
- Any layout change made to stop clipping under D3.
- Anything you built that departs from D1–D7, and why.
- Every deviation, numbered.
