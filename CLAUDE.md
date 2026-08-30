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
- The deploy workflow runs green on the push.
- `PROGRESS.md` reflects completion per the rules above.

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

## Chunk prompt corrections

`prompts/README.md` is an overlay doc capturing the cross-chunk substitutions, path corrections, and conventions that apply to every chunk prompt in this repo. Read it before starting any chunk. Authority order: `ARCHITECTURE.md` → `prompts/README.md` → the individual chunk prompt → the chunk-specific brief (if any).

Chunks 1–8 layered these corrections via per-chunk briefs; chunks 10–16 should reference `prompts/README.md` directly instead of re-inlining them.
