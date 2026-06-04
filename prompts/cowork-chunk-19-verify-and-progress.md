# Cowork task — Chunk 19 verification + PROGRESS bookkeeping

**Repo:** dashboard
**PR:** `chunk-19-mobile` → `main` (Claude Code, branch commit `f6d95cf`)
**Run when:** the `chunk-19-mobile` PR has merged into `main` **and** the deploy workflow is green.
**Two parts:** (A) verify the mobile/touch/viewport behavior on the deployed build; (B) update `PROGRESS.md` once A passes. Do them in order — B only if every check in A passes.

---

## Part A — Behavioral verification (Chrome DevTools device mode + a real iPhone)

The chunk-19 logic is covered by unit tests (208/208), but pixel-level hit area, iOS zoom-on-focus, and notch/home-indicator clearance can only be confirmed on-device — that's why Claude Code deferred these. Do all seven.

1. **Breakpoint swap.** Device mode at <640px (e.g. iPhone 14): the **bottom nav is visible and fixed** at the bottom; the **top tabs are hidden**. Resize to ≥640px (e.g. iPad portrait 768px, or desktop): **top tabs visible, bottom nav hidden**. The same routes appear in both navs, and the active route shows `aria-current="page"`.
2. **Bottom-nav reachability + clearance.** At <640px: the bar is thumb-reachable, stays pinned while you scroll, and **clears the home indicator** (no overlap with the iOS home bar). Scroll to the end of a long list → the **last row is not hidden** behind the bar (scroll container has the bottom padding).
3. **≥44pt hit targets on touch.** In device-mode touch (or on the iPhone), inspect **bell, trash, ⋯ menu (task row *and* subcategory header), drill chevron, grip, and the row checkbox** → each reports a **≥44pt** hit area while the visual icon stays 16–24px. Adjacent destructive+benign controls **don't overlap** (review confirmed the math to 320px — re-confirm visually at iPhone SE width).
4. **Desktop density unchanged (regression guard).** Switch to a desktop / hover viewport → the same controls render at **24px visual size**, hover affordances intact, **no enlarged hit padding**.
5. **No iOS zoom on focus (real iPhone, deployed PWA).** Focus each inline input — **inline-edit a task title, the add-task inline field(s), and the dashboard input** — Safari must **not** auto-zoom or yank the viewport on focus.
6. **Notch / Dynamic Island clearance (real iPhone, PWA installed, `viewport-fit=cover`).** The **AppShell header** content clears the notch/Island. Then surface the **`InstallHint` top banner** (uninstalled / not-yet-dismissed state) and confirm **it also clears the notch** — it renders above the header and was the critical fix, so it must be checked explicitly.
7. **No regression.** Desktop **cross-subcategory drag** and full **keyboard navigation** still work.

If any step fails: **stop**, do not touch `PROGRESS.md`, and report which step + the observed behavior.

---

## Part B — PROGRESS.md update (only after Part A passes)

> **SHA rule.** The row references the chunk's commit **as it lands on `main`**, not the branch commit. Find it first:
> ```bash
> cd "/Users/sergiorios/Documents/To-Do Dashboard"
> git checkout main && git pull
> git log --oneline -8        # locate the chunk-19 commit on main
> ```
> Merge-commit or rebase → `f6d95cf` is on `main`, use `f6d95cf`. **Squash-merge → `main` has a new SHA, use that** in the row and commit message below.

1. In the Chunks table, flip row 19 to ☑ and set the SHA (replace `<on-main-sha>`):
   ```
   | 19 | Audit: mobile bottom-nav + touch/viewport polish | dashboard | ☑ | Claude Code | <on-main-sha> | — | Single Tabs component renders both navs via CSS breakpoint (sm:hidden / hidden sm:flex); bottom-nav labels the dashboard tab "Tasks" + icons Tag/Sun/Filter/User per the design reference; row checkbox hit-area also enlarged to ≥44pt on touch (§13 "all interactive elements"); safe-area top inset applied to the AppShell wrapper rather than the header alone, so the InstallHint top banner also clears the notch. |
   ```

2. **Decisions log — VERIFY, then apply the matching case.** The original draft said "no change" on the theory that chunk 19 only implements existing spec. That's true for **bottom-nav** and **≥44pt** (both written in `ARCHITECTURE.md` §13 and the `DESIGN_BRIEF` Responsive section), but **not** for the **16px-input / iOS-focus-zoom** rule or the **`viewport-fit=cover` + safe-area** rule — neither was in §13, the `DESIGN_BRIEF`, or the chunk-04 PWA prompt as of the last repo snapshot, and `index.html`'s viewport meta was `width=device-width, initial-scale=1.0` (no `viewport-fit=cover`). If those two are genuinely net-new, they're decisions and §13 should record them (per `CLAUDE.md` rule 4; this mirrors chunk 18, which logged two analogous rows).

   First check the **live** §13 on `main`:
   ```bash
   grep -n -i -E "viewport-fit|safe-area|16px|font-size" ARCHITECTURE.md
   ```
   - **If §13 already states the 16px-input and viewport-fit/safe-area rules** → they're existing spec → **no Decisions-log entry** (in-spec implementation; the in-spec deviations are captured in the row's Review-notes above). Skip to step 3.
   - **If §13 does NOT state them** (the snapshot state) → append these two rows to the Decisions log, and consider adding the same two rules to `ARCHITECTURE.md` §13 so the doc stays canonical:
     ```
     | 2026-05-31 | Inputs use ≥16px font-size on touch to suppress iOS Safari focus-zoom; visual sizing preserved via line-height/transform (inline-edit, add-task, dashboard inputs). |
     | 2026-05-31 | viewport-fit=cover + env(safe-area-inset-*) applied at the AppShell wrapper (not the header alone) so the InstallHint banner and header both clear the notch/Dynamic Island; bottom-nav padded for the home indicator. |
     ```

3. Set **Last updated** at the top of `PROGRESS.md` → **2026-05-31**.

4. Commit `PROGRESS.md` only (replace `<on-main-sha>`). Use the first message if you added Decisions-log rows, the second if you didn't:
   ```bash
   git add PROGRESS.md
   # with decisions-log rows:
   git commit -m "docs(progress): chunk 19 row + decisions log (<on-main-sha>) — mobile bottom-nav + touch/viewport polish verified on-device"
   # or, if §13 already covered 16px + safe-area:
   git commit -m "docs(progress): chunk 19 row (<on-main-sha>) — mobile bottom-nav + touch/viewport polish verified on-device"
   git push
   ```
   > If you also edited `ARCHITECTURE.md` §13 in the bullet above, commit that separately (`docs(architecture): record 16px-input + viewport-fit/safe-area UI rules in §13`) — keep the `PROGRESS.md` commit to `PROGRESS.md` only.

---

## Notes
- **No locked-subsystem edits** in this chunk (the service worker, CSP, sign-out/cache logic, and data/repo layer were explicitly off-limits) — so no Revisions-style note is needed.
- **Confirm the design-reference path before trusting the row note.** The draft cited `design/src/app.jsx`, but the design output is TypeScript (`DESIGN_BRIEF` → "top-level `App.tsx`", screens under `src/screens/`, and `index.html` loads `/src/main.tsx`). The file is almost certainly `design/App.tsx` (capital A, `.tsx`) — verify the exact path/casing, and if it differs from the row note's "per the design reference," nothing needs editing since the committed note no longer hard-codes a filename.
- **The "Tasks" bottom-nav label** is per the design reference. If Sergio decided to keep "Dashboard" (or change the Tag/Sun/Filter/User icons) before the PR, update the row's Review-notes to match what actually shipped; otherwise leave it.
- If Part A step 6 can't surface the `InstallHint` banner on the test device (already dismissed/installed), clear the PWA/app data or use a fresh profile so the banner renders (it persists dismissal in `localStorage` under `install-hint-dismissed`), then re-check notch clearance.
