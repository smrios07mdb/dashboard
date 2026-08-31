# Repo guidelines for Claude Code

## Canonical references
- `ARCHITECTURE.md` is the single source of truth for stack, data model, sync, security, and UI rules. Read it before starting work on any chunk.
- If a chunk prompt and `ARCHITECTURE.md` disagree, stop and surface the conflict. Do not silently pick one.

## Progress tracking

Claude Code updates `PROGRESS.md` directly as part of each chunk — no Cowork handoff. (Policy changed 2026-07-30; before that, PROGRESS.md edits were owned by a separate Cowork pass.)

After completing any chunk:
1. Flip the row's status in `PROGRESS.md` from ☐ to ☑.
2. Add the short commit SHA to the "PR / Commit" column.
3. Add a one-line summary in "Review notes" of anything that deviated from the prompt.
4. If a non-trivial decision was made that isn't already in `ARCHITECTURE.md`, add a row to "Decisions log" with today's date.
5. Update the "Last updated" date at the top of `PROGRESS.md`.
6. Commit `PROGRESS.md` as part of the same chunk commit, or as an immediate follow-up.

## Definition of done
A chunk is done when:
- All acceptance criteria in the chunk prompt pass.
- `npm run build` and `npm test` are both green.
- The deploy workflow runs green on the push — unless the push carries `[skip ci]` (see below).
- `PROGRESS.md` reflects completion per the rules above.

### When a push takes `[skip ci]` (chunk 45)

Whether the deploy workflow has to run is decided by one question: did anything
affecting the built artifact change? `deploy.yml` runs `npm ci` + `npm run build`
only — **no lint, no tests** — so lint and test configuration never reach the
deployed artifact. All gates are run locally by the implementing agent, not by CI.

- A push gets `[skip ci]` when nothing affecting the built artifact changed —
  docs, `PROGRESS.md`, `verification/`, `.gitignore`, lint config, refs.
- Otherwise no `[skip ci]`, and the deploy workflow must run green.
- Consequence: `version.json` tracks the last commit that changed shipped code,
  and will lag `main` after any docs-only run. That is correct, not drift.

## Routine doc edits
`PROGRESS.md` updates, decision log entries, and README additions are handled by Claude Code directly, in the same pass as the chunk's code work — committed with the chunk or as an immediate follow-up. (Until 2026-07-30 these were Cowork's lane; that handoff is retired.)

## Smoke harness notes (Chrome MCP via Cowork)

Three test-harness facts surfaced during chunk-8 smokes that future smoke passes need to know. None of these reflect implementation issues — they're limitations of the Chrome MCP browser harness that Cowork drives.

**@dnd-kit drag activation.** `@dnd-kit`'s default `PointerSensor` uses a 5px-distance activation constraint. Chrome MCP's `left_click_drag` fires a single instantaneous jump that doesn't accumulate pointer-movement events, so the sensor never activates and the drag is dropped silently. Workaround: synthesize the pointer sequence in JS — `pointerdown` → multiple `pointermove` events with ≥5px cumulative travel (chunk-8 used 20 moves) → `pointerup`. Mirrors the pattern `@dnd-kit`'s own unit tests use. Any future smoke that exercises drag interactions (chunk 9 cross-category drag, any future reorder UI) should use this synthesized-pointer pattern, not `left_click_drag`.

**`(hover: none)` mobile-branch testing.** Chrome MCP does not expose DevTools' device emulation toggle, so the standard "switch to iPhone profile in DevTools" approach isn't available. Workaround: patch `window.matchMedia('(hover: none)')` to return `{ matches: true, … }` from the page console, then force a remount of any component that reads it at mount (chunk-8 uses `useIsTouchDevice` which evaluates once at mount). The cleanest remount path is SPA route navigation (`Insights → Dashboard` via a programmatic `link.click()`) — that unmounts and remounts the screen and any hooks within. Reload alone won't work because the `matchMedia` patch is in-page state lost on reload.

**Screenshot persistence.** Chrome MCP returns screenshots inline in the conversation only — it does not write them to disk regardless of `save_to_disk: true` flags or `/tmp/*.png` path hints in smoke specs. Future smoke specs should reference "inline screenshots in the Cowork transcript" rather than promising filesystem paths.

**Isolated-world JavaScript.** Chrome MCP's `execute_javascript` runs in an isolated world: the DOM is shared with the page, JS globals are not. Anything that must patch or observe page-world JS — `navigator.onLine`, a `console.error` wrapper for a "console clean" check, the `matchMedia` patch in the `(hover: none)` paragraph above — has to be injected via a `<script>` element appended to the document and report back through the DOM (e.g. write results into a `data-*` attribute or a hidden element the harness then reads). A patch applied directly from `execute_javascript` looks successful but never reaches the app's code.

**Synthesized pointer drags need a separate `pointerup` call.** The planner's native pointer-drag hook (chunk 37) activates after ≥5px of accumulated `pointermove` travel and commits on `pointerup`. Dispatching the `pointerdown` + `pointermove`s in one `execute_javascript` call and the `pointerup` in a second call is what works; putting the `pointerup` in the same synchronous batch as the moves drops the drop.

**Both breakpoint branches are always mounted.** The Planner (chunk 36 decision) renders its desktop (`hidden sm:flex`) and mobile (`sm:hidden`) branches at every width and hides one with CSS. `display:none` elements still fire programmatic `.click()`, so an unscoped selector like `button:has-text("Schedule")` can land on the hidden branch and produce a confusing result (chunk-37 smoke check 11 opened the desktop sheet from the "mobile" test). Scope selectors with `[data-branch="desktop"]` / `[data-branch="mobile"]`.

**Busy fixtures.** Create test calendar events through the app's own `createEvent` (`POST /api/calendar/events` on the proxy), not in Calendar.app. Locally created Calendar.app events may never reach iCloud's CalDAV server (observed 40+ minutes with no propagation), so a fixture made that way never shows up as busy.

**Mobile branch via a same-origin iframe.** A 570px-wide same-origin `<iframe>` gives a real media-query layout (564px inner), authenticates from the shared origin's `localStorage`, and its document is scriptable from the parent, including page-world `<script>` injection into the iframe's own document. `window.open` with a size hint is popup-blocked without a user gesture and Chrome MCP exposes no `resize_window`; use the iframe.

**`.focus()` scrolls the page and silently breaks the next synthesized drag.** After focusing a tray card the page can sit at `scrollY ≈ 1900` with the grid off-screen; the drag then starts (ghost + floating card) but never produces `[data-testid="drop-slot"]`. Assert `window.scrollY === 0` and re-read `getBoundingClientRect()` immediately before dispatching pointer coordinates.

**The drop preview lands one tick late.** `[data-testid="drop-slot"]` is `null` inside the same script that dispatched the `pointermove`s and present on the next call. Don't read that as a failed drag.

**Dashboard row selection.** To reach a task's checkbox, walk up from the title leaf to the **nearest** ancestor holding exactly one `button[aria-label^="Mark task"]`. Walking a fixed number of levels can escape the row and toggle a sibling task (the chunk-37 re-run completed and reverted a real task this way).

**Busy fixtures leave an iCloud event behind.** `createEvent` has no delete counterpart until chunk 39; every smoke that follows the busy-fixture rule must end with the operator deleting the event in Calendar.app. Record the uid in the results file.

**Hover action rows land one tick late.** A `TaskBlock`'s hover action row (`→`/`✓`/`×`) is not in the DOM in the same `execute_javascript` call that dispatched the hover; dispatch the hover in one call and read/click the row in the next.

**`execute_javascript` does not await promises.** A script that `fetch`es or awaits a repo call returns before the promise settles. Route results through hidden sink nodes the next call reads — and keep **two** sinks (one for PostgREST responses, one for the toast observer), since a single node gets overwritten mid-check.

**The Supabase access token expires ~10 min in.** Don't cache it at the start of a smoke; read it from `localStorage['sb-<ref>-auth-token']` per request.

**A future week exercises Fill-my-week off-schedule only.** With `todayIdx < 0` the button passes `fillable` and packing starts Monday 09:00, so a future-week run covers the packing/tray/Place-all paths but **not** the today-relative cursor (`ceil15(now+10)`); that branch needs a Mon–Thu run on the current week.

**`proposal-block` is `aria-hidden`.** It has no accessible name; assert on `innerText` and geometry (`getBoundingClientRect()`), not on `getByRole`.

**The device shell has no GitHub credentials.** Cowork commits smoke results locally; the operator pushes.

**Remount-dependent navigations must be split into separate `execute_javascript` calls.** Same-tick double navigation (two `.click()`s in one call) never remounts the screen — React Router settles once. One navigation per call.

**The tray card is the schedule button.** `button[aria-label="<title> — schedule"]` is the drag target itself — `pointerdown` on it starts the drag; there is no card wrapper above it to walk up to.

**Scope sheet queries with `[data-state="open"]`.** A bare `[role="dialog"]` matches the lingering sync-pill popover first (it stays in the DOM `data-state="closed"`, and both coexist).

**Feedback-guided dropping.** Aim the pointer near the slot, read `[data-testid="drop-slot"]` on the next call (one tick late as documented), nudge ±13px per 15-min step (52px/hour), then `pointerup` in its own call.

**Resizes render no `drop-slot` preview.** The block's own aria-label/height update live during the drag — assert those; `resize-strip` is the handle.

**One-shot failure shims must wrap the logger-wrapped fetch** and restore to it (so the netlog keeps recording afterwards), stamping a DOM attribute with method+timestamp for the report.

**Isolated-world fetches don't pollute the page-world request log.** Keep harness reads (PostgREST/proxy probes) in the isolated world; secrets travel via DOM attributes, never the transcript.

**The outbox is readable from the isolated world** via IndexedDB (`dashboard-cache` / `outbox`) — no page-world injection needed.

**Computer-use app grants can expire mid-run** — re-requesting costs an operator approval; batch Calendar.app assertions where possible.

**One run owner, prefixed fixtures (chunk 43).** Exactly one agent session runs a smoke/spot spec against the dev DB + iCloud calendar at a time — confirm with the operator before starting. Every fixture title carries a per-run prefix (`Smoke-<runId>-P1a`), and cleanup deletes only `title=like.Smoke-<runId>-*`, never bare `Smoke*` — on 2026-08-31 two concurrent sessions corrupted each other's state within minutes, and an unscoped cleanup would have cascaded the other session's blocks and calendar events mid-test.

**The deployed build ships a CSP that blocks page-world script injection** (`script-src 'self'`, added chunk 17), so the chunk-38/39 page-world harness notes above do NOT transfer to prod runs. Prod gets isolated-world observation only: a `PerformanceObserver` netlog on resource entries (URL + `responseStatus` + completion order, **no HTTP method** — bracket assertions with marked windows and corroborate via DB/proxy state), a `MutationObserver` for toasts, and `window.onerror`/`unhandledrejection` instead of a page `console.error` counter. Decision (chunk 43): **no build-time test hook** — the 2026-08-31 run completed every assertion under these constraints, and a prod-shipped hook would weaken the CSP posture chunk 17 established; revisit only if a future prod assertion is actually blocked.

**`execute_javascript` needs an IIFE (chunk 46).** `Control Chrome` evaluates the snippet at top level, so a top-level `return` is a **syntax error**, not an early exit. It surfaces as the bare string `missing value` — the same symptom the existing note attributes to a thrown exception or a dead connection, so an otherwise-correct script reads as a harness fault. Wrap every snippet in `(() => { … })()`.

**The prod toast region has no toast markers (chunk 46).** It is a `section[aria-live="polite"]` whose injected children carry no `role`, no `data-sonner-toast` and no `toast` class, so a `MutationObserver` predicate that tests the *added node* for any of those captures nothing on prod. Observe the section itself and read every added element's `innerText`.

**`performance.getEntriesByType('resource')` survives the mount (chunk 46).** The buffer still holds the whole mount after a reload, so mount-time `/busy` and `/events` counts can be read after the fact — no race to install a `PerformanceObserver` before the app boots. This removes the main reason prod runs were awkward to instrument; keep the `PerformanceObserver` only for windows you mark *during* a run.

## Branch policy (chunk 43)

Work happens on `main` with short-lived per-chunk branches merged (ff where possible) and deleted after landing. The `redesign` branch is retired — it was promoted to `main` in chunk 42 and deleted in chunk 43; do not recreate it.

**Testing whether a branch has landed (chunk-44 Task 3a finding).** `git merge-base --is-ancestor <tip> main` is correct for merge- and fast-forward-landed branches, but it **can never pass for a squash-merged branch**: the squash commit is a fresh commit on `main` with no link to the branch's commits, so ancestry is absent by construction, not because work is unmerged. For a squash merge the test is **tree identity against a commit reachable from `main`** — the branch tip's tree equals the tree of some commit in `git rev-list main`, which proves `main` once held the branch's complete file state byte-for-byte:

```
for c in $(git rev-list origin/main); do \
  [ "$(git rev-parse $c^{tree})" = "$(git rev-parse origin/<branch>^{tree})" ] \
  && echo "$c"; done
```

Deletion stays reversible either way: GitHub retains `refs/pull/<N>/head` permanently, so a deleted branch tip remains addressable (`git fetch origin refs/pull/<N>/head`).

## Chunk prompt corrections

`prompts/README.md` is an overlay doc capturing the cross-chunk substitutions, path corrections, and conventions that apply to every chunk prompt in this repo. Read it before starting any chunk. Authority order: `ARCHITECTURE.md` → `prompts/README.md` → the individual chunk prompt → the chunk-specific brief (if any).

Chunks 1–8 layered these corrections via per-chunk briefs; chunks 10–16 should reference `prompts/README.md` directly instead of re-inlining them.
