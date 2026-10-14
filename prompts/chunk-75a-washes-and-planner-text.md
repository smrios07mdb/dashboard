# Chunk 75a: Readable text on washes and in the planner (UX audit #14, follow-up)

**Runs on:** Claude Code, in `~/Documents/To-Do Dashboard` on Sergio's Mac (repo `smrios07mdb/dashboard`). You write the code and the tests. App code only: no SQL, no migration, no proxy, no new dependency.

**Bases:**
- App `smrios07mdb/dashboard` @ `28db8f5` (chunk 75 code, live, gate-verified). Chunk 75 docs are **not** written yet; they are written once, after this chunk, covering rows 75 and 75a (Step 3).
- Proxy untouched.

**Authority:** `ARCHITECTURE.md` → `prompts/README.md` → `prompts/chunk-75-readable-and-landmarks.md` (not yet committed; Sergio has the file) → this prompt. Chunk 75's D1–D7 stand; this prompt adds to them. Read first:
- `CLAUDE.md`, `prompts/README.md`.
- `src/index.css` (`:root` ink scale, `--busy-*` tokens, the chunk-75 `-ink` block).
- `src/lib/contrast.test.ts` (you extend it), `src/lib/calendarColors.ts` (`CALENDAR_PALETTE`).
- `src/components/planner/BusyBlock.tsx`, `src/components/RoutineDotGrid.tsx`, `src/components/planner/PlannerTray.tsx`, `src/components/planner/WindowRail.tsx`, `src/screens/Insights.tsx` (the trend chip, ~L311–337).
- `src/components/planner/PlannerTray.test.tsx`, `src/screens/Insights.test.tsx`.

**Scope:** the contrast failures the chunk-75 smoke found outside the Dashboard. Nothing else.

---

## The problem, as committed at `28db8f5`

Orchestrator smoke on the live app (`28db8f5`), Sergio's Chrome, 1224 px window, 2026-10-13. Same measurement script as chunk 75 (visible text, background resolved through ancestors, opacity included). Disabled controls are excluded (WCAG exempts them).

| Screen | Failing text | Cause |
|---|---|---|
| Dashboard, Settings, Notebook | 0 | — |
| Routines | 28 | weekday letters, `text-ink-4` (`#c7c2d0`), 1.74:1 — `RoutineDotGrid.tsx` L158 |
| Planner | `23` group count, 1.58:1 | `text-ink-4` — `PlannerTray.tsx` L231 |
| Planner | `· 2 HIDDEN`, 1.58:1 | `text-ink-4` — `WindowRail.tsx` L41 |
| Planner | busy-block titles 3.99–4.38:1; `ICLOUD` / `OUTLOOK` tag 2.88–3.07:1 | `var(--ink-3)` on the 16% calendar-colour wash; tag at `opacity: 0.8` — `BusyBlock.tsx` L118, L126 |
| Insights (90 d) | `vs first half`, 4.27:1 | `text-ink-3` on `--work-soft` — `Insights.tsx` L336 |

Chunk 75's D6 kept `--ink-4` and its D1/D2 checked `--ink-3` only on flat surfaces, not on tinted washes. That is the orchestrator's miss; this chunk closes it.

---

## Locked decisions (orchestrator + Sergio, 2026-10-13)

### D1 `--ink-4` text becomes `--ink-3`

- `RoutineDotGrid.tsx` L158: the weekday letter `<span>` `text-ink-4` → `text-ink-3`.
- `PlannerTray.tsx` L231: the group count `<span>` `text-ink-4` → `text-ink-3`.
- `WindowRail.tsx` L41: the `· N HIDDEN` `<span>` `text-ink-4` → `text-ink-3`.
- `--ink-4` itself is unchanged (chunk 75 D6 stands). Icons coloured `text-ink-4` (`ChevronRight` in `PlannerTray` L312 and `AttachPicker`) stay: they are icons, not text. `TokenCheck.tsx` stays (it documents the token).
- Grep `src/**/*.tsx` (not tests) for any other `text-ink-4` or `var(--ink-4)` on **text** (an element whose own content is text, not an icon, fill or dot). Convert each to ink-3 and **list every one beyond these three** in the report.

### D2 The Insights trend chip's suffix uses `--ink-2`

- `Insights.tsx` L336: `<span className="font-medium text-ink-3">vs first half</span>` → `text-ink-2`.
- Measured: `--ink-2` is 4.79:1 on `--work-soft` over `--bg` (positive branch) and above 5 on `--bg-alt` (negative branch). The chip's background, border and number colour are unchanged.

### D3 Busy-block text uses a new `--busy-ink` (Sergio's call: darken, keep the stale fade)

**Token.** In `src/index.css` `:root`, directly after `--busy-outlook-hatch`:

```css
/* Text on busy blocks (chunk 75a): >= 4.5:1 on a 16% wash of any calendar
   colour, black included, over --bg or --surface, with or without the
   Outlook hatch. Measured worst case 5.26:1 (black calendar, --bg, hatch). */
--busy-ink: color-mix(in srgb, var(--ink-2) 75%, black);
```

**`BusyBlock.tsx`:**
- The title `<span>` (L118): `style={{ color: 'var(--ink-3)' }}` → `style={{ color: 'var(--busy-ink)' }}`.
- The source tag `<span className="label …">` (L126): `style={{ fontSize: 8.5, letterSpacing: '.14em', opacity: 0.8 }}` → `style={{ fontSize: 8.5, letterSpacing: '.14em', color: 'var(--busy-ink)' }}`. The `opacity` goes; the colour overrides `.label`'s `--ink-3`. The calendar dot is unchanged.
- `clipMarkStyle` (L33): `color: 'var(--ink-3)'` → `color: 'var(--busy-ink)'`.
- **Unchanged:** the stale Outlook `opacity: isStale ? 0.55 : 1` on the button (the one accepted exception: the fade is the stale cue), every size (chunk 75 D3 exemption stands), the tint, ring, hatch and dot, and the file's header comment except one added line: `Text is --busy-ink (chunk 75a); the stale 55% fade is the one accepted contrast exception.`
- Do not touch the other six time-grid files.

### D4 What does not change

- Chunk 75 D1–D7, `--ink-2`, `--ink-3`, `--ink-4`, `--busy-*` (except the new `--busy-ink`).
- `What's next?`, the 31 px category heading, the filled pills on the Primitives dev screen.
- Settings at 382 px (460 px wide from the email + Sign out row) is pre-existing audit #18, not this chunk.
- `package.json` / `package-lock.json`.

### D5 Tests (you write them)

**`src/lib/contrast.test.ts`** — new `describe('contrast on washes (chunk 75a)')`. Reuse the file's helpers. Add a resolver for `color-mix(in srgb, var(--X) P%, black)` where `--X` is itself a hex token (it already resolves this shape; reuse it). Parse `--busy-outlook-hatch` (`rgba(r, g, b, a)`) from `:root` and composite it over the wash.
- 9. `--busy-ink` is defined and ≥ 4.5:1 against a 16% wash (`P% colour over base`) of every colour in `CALENDAR_PALETTE` plus `#000000`, over each of `--bg` and `--surface`, with and without the Outlook hatch composited on top. One `it.each` row per colour; failure message names colour, base and hatch.
- 10. `--ink-2` is ≥ 4.5:1 on the emerald `--work-soft` composited over `--bg`.
- 11. `--ink-3` is ≥ 4.5:1 on `--bg` and on `--surface` (the D1 replacements; restates chunk 75 case 1 for these two bases explicitly).

**`src/components/planner/BusyBlock.test.tsx`** (new). Render `BusyBlock` with a block tall enough to show title and tag (`pos.height ≥ 46`), once with `block.color: '#1badf8'`, `source: 'icloud'`, and once `source: 'outlook'`, `stale: true`, `staleTime: '09:15'`.
- 12. The title and the source tag each have `style.color` `var(--busy-ink)`, and the tag has no `opacity` in its style.
- 13. The stale Outlook button keeps `opacity: 0.55`; the non-stale one has `opacity: 1`.

**`src/components/RoutineDotGrid.test.tsx`** (new) and **`PlannerTray.test.tsx`** (one case), **`WindowRail`**: test it where it is rendered today (find its existing test via `DayTimeline.test.tsx` / `WeekGrid.test.tsx`; if none renders it collapsed with a hidden count, add `src/components/planner/WindowRail.test.tsx`).
- 14. The weekday letter, the tray group count and the `· N HIDDEN` span each carry `text-ink-3` and not `text-ink-4`.

**`Insights.test.tsx`** (one assertion inside the existing case (b)):
- 15. The `vs first half` span carries `text-ink-2`.

**Existing tests** that assert `text-ink-4`, `var(--ink-3)` or `opacity: 0.8` on anything you changed: update the expected value only, and list each file and case.

**Red-first:** with everything written, restore the base for the non-test sources and run the new and changed test files:

```bash
mkdir -p "$TMPDIR/c75a"
git diff --name-only 28db8f5 -- src | grep -vE '\.test\.tsx?$' > "$TMPDIR/c75a/files.txt"
tar -cf "$TMPDIR/c75a/after.tar" -T "$TMPDIR/c75a/files.txt"
while read -r f; do git show "28db8f5:$f" > "$f" 2>/dev/null || true; done < "$TMPDIR/c75a/files.txt"
npx vitest run src/lib/contrast.test.ts src/components/planner/BusyBlock.test.tsx src/components/RoutineDotGrid.test.tsx src/components/planner/PlannerTray.test.tsx src/screens/Insights.test.tsx $(ls src/components/planner/WindowRail.test.tsx 2>/dev/null)
tar -xf "$TMPDIR/c75a/after.tar"
git status --short
```

- Report pass/fail counts per file. Cases 9, 10, 12, 13, 14 and 15 must fail against the base. Case 11 passes against the base (it restates chunk 75); name it as the expected pass. Name any other that passes.
- The final `git status --short` must match your change set exactly.

### D6 Commit routing

- **One code commit**, pushed **alone**, **no `[skip ci]`**.
- **Expected files:** `src/index.css`; `src/components/planner/BusyBlock.tsx`, `src/components/RoutineDotGrid.tsx`, `src/components/planner/PlannerTray.tsx`, `src/components/planner/WindowRail.tsx`, `src/screens/Insights.tsx`; any extra D1 sites; the D5 test files. Anything outside `src/`: stop and report before committing.
- **Subject:** `Chunk 75a: Readable text on washes and in the planner`.
- **Gates before the push**, on a clean `npm ci`: `tsc -b` clean; `eslint .` 0 problems; `vitest run` all green; `TZ=UTC npx vitest run` all green; `npm run build` green.
- **Base figures** at `28db8f5` (orchestrator, cloud container, Node 22, clean clone): `vitest run` **1099 / 1099** in **98** files, in `America/New_York` and in `UTC`. Your Mac after for chunk 75 was eager JS **1,050,542 B** (7 files); run your own base on the Mac in both zones and report it with your after.
- **Eager JS limit: +400 B.**
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

Expect `28db8f5`. If `main` is anywhere else, stop and report.

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
git diff --stat 28db8f5 -- package.json package-lock.json
git add -A src
git status --short
git diff --cached --stat
git commit
git push origin main
```

- `git status --short` after `git add` must show only files under `src/`, all staged.
- The commit body states D1–D3 in one line each, names UX audit #14 (follow-up to chunk 75), and ends with the `Co-Authored-By` trailer per `CLAUDE.md`.

**Stop after the push and report.** Do not write docs. Do not run the smoke.

### 2. Gate + smoke (orchestrator, not you)

**Gate:** clean clone at your SHA in the cloud container: scope diff against `28db8f5`; `tsc -b`, `eslint .`, `vitest run` in three zones; red-first reproduced; build and eager JS delta; deployed CSS contains `--busy-ink`; live `version.json`.

**Smoke:** deployed app in Sergio's Chrome via the Claude in Chrome extension, **tab in the foreground** (Sergio clicks it to the front). Read-only. Same script as chunk 75.
1. Routines, Planner, Insights (90 d), Dashboard, Settings, Notebook: 0 failing text, excluding disabled controls, `What's next?` and stale Outlook blocks. Under 11 px only inside the seven exempt time-grid components.
2. The chunk-75 keyboard check that the backgrounded tab blocked: reload, press Tab once, the skip link shows at the top left (screenshot); Enter focuses `main#main`, URL has no hash.
3. Planner screenshot with busy blocks, for Sergio's eye on the darker block text.
4. Console clean across a fresh reload.

### 3. Docs (`[skip ci]`, after the orchestrator's gate and smoke pass) — covers chunks 75 and 75a

**Commit both prompts** — `prompts/chunk-75-readable-and-landmarks.md` and `prompts/chunk-75a-washes-and-planner-text.md` — copied from the files, not retyped.

**`ARCHITECTURE.md` §13.** Directly after the iOS focus-zoom bullet, add:

> - Small text meets WCAG AA (chunks 75, 75a). `--ink-3` is `#6b6676` (≥4.5:1 on every surface); `--ink-4` is never used for text. Text in a category or jewel colour uses its `-ink` variant (`--work-ink`, `--personal-ink`, `--jewel-*-ink`; `catInk()`); fills, borders and dots keep the base colour. Text on a tinted wash uses `--ink-2` or darker. Busy-block text uses `--busy-ink` (≥4.5:1 on any 16% calendar wash); the stale Outlook 55% fade is the one accepted exception. No text is under 11 px (`.label` included) outside the planner time grid's seven fixed-size components. `src/lib/contrast.test.ts` and `src/lib/fontFloor.test.ts` guard this.
> - Every signed-in screen has one `<main id="main">` (in `ProtectedLayout`) and a `Skip to main content` link as its first focusable element (chunk 75).

**`PROGRESS.md`:**
- **Row 75 ☑**, directly after row 74a: step-1 SHA `28db8f5`; gates in both runner zones, Mac base in both zones; red-first 19 failed / 12 passed; 1099 tests in 98 files; eager JS 1,049,864 → 1,050,542 B (+678); deploy run 38486507011 and live `version.json`; orchestrator gate (all reproduced) and smoke (Dashboard 104 → 0 failing, 18 → 0 under 11 px, one `main`, 226 tab stops; Routines, Planner, Insights failures carried into 75a); extra D2 site (TaskRow `+XP` floater, inline mix); existing tests updated (CategoryColumn `renderColumn` helper); deviations, numbered, from the step-1 report.
- **Row 75a ☑**, directly after row 75, in the same shape, from the 75a step-1 report and the orchestrator's gate and smoke.
- **Decisions log:** chunk 75 D1–D5 and chunk 75a D1–D3 (2026-10-13), one row each.
- **Last-updated paragraph:** per the chunk-54 convention, covering 75 and 75a. The chunk-74a paragraph moves to Update history, relabelled `Prior update:` (prefix only).
- **Known gaps:** per-row keyboard structure (#16, next chunk); the planner time grid's sub-11 px text; `What's next?` white on the spark gradient's light end; stale Outlook busy blocks at 55%; filled work / personal pills (`ui/pill.tsx`) on the Primitives dev screen; Settings at 382 px wider than the frame (email + Sign out row, audit #18).

If row 75a must name the docs SHA, record it in an immediate `[skip ci]` follow-up (chunk-54 convention).

---

## Out of scope

- One tab stop per task row with arrow-key movement (#16, second half).
- `--ink-4` the token, `--ink-2`, `--ink-3`, the type scale.
- Settings phone stacking (#18), and the rest of the audit (#12, #17, #19).
- Carried gaps: `SetReminderPopover` (6) under `TZ=Asia/Tokyo`; delete-then-sign-out (chunk 72); dead branches in the full hero (chunk 74 deviation 5).

## Report back

- **Step 1:** commit SHA and `git diff --stat 28db8f5 <SHA>`; gates (`tsc -b`, `eslint .`, test count and file count in both runner zones, build), with the Mac base in both zones; red-first counts per file, with any case that passed named; eager JS before / after / delta; the empty `package.json` diff; deploy run id and result; live `version.json`.
- Every D1 site you converted beyond the three named.
- Every existing test you updated under D5: file and case.
- Anything you built that departs from D1–D5, and why.
- Every deviation, numbered.
