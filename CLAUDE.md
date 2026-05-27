# Repo guidelines for Claude Code

## Canonical references
- `ARCHITECTURE.md` is the single source of truth for stack, data model, sync, security, and UI rules. Read it before starting work on any chunk.
- If a chunk prompt and `ARCHITECTURE.md` disagree, stop and surface the conflict. Do not silently pick one.

## Progress tracking
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
`PROGRESS.md` updates, decision log entries, and README additions are handled by Cowork — not Claude Code, not by hand. After a chunk's code work lands, hand Cowork a task spec covering the doc changes; it applies the edits and prepares the commit.
Claude Code's responsibility ends at the code changes (and any tests / migrations that ship with them). If a chunk asks Claude Code to write or modify `PROGRESS.md`, treat that as a Cowork task instead.

## Smoke harness notes (Chrome MCP via Cowork)

Three test-harness facts surfaced during chunk-8 smokes that future smoke passes need to know. None of these reflect implementation issues — they're limitations of the Chrome MCP browser harness that Cowork drives.

**@dnd-kit drag activation.** `@dnd-kit`'s default `PointerSensor` uses a 5px-distance activation constraint. Chrome MCP's `left_click_drag` fires a single instantaneous jump that doesn't accumulate pointer-movement events, so the sensor never activates and the drag is dropped silently. Workaround: synthesize the pointer sequence in JS — `pointerdown` → multiple `pointermove` events with ≥5px cumulative travel (chunk-8 used 20 moves) → `pointerup`. Mirrors the pattern `@dnd-kit`'s own unit tests use. Any future smoke that exercises drag interactions (chunk 9 cross-category drag, any future reorder UI) should use this synthesized-pointer pattern, not `left_click_drag`.

**`(hover: none)` mobile-branch testing.** Chrome MCP does not expose DevTools' device emulation toggle, so the standard "switch to iPhone profile in DevTools" approach isn't available. Workaround: patch `window.matchMedia('(hover: none)')` to return `{ matches: true, … }` from the page console, then force a remount of any component that reads it at mount (chunk-8 uses `useIsTouchDevice` which evaluates once at mount). The cleanest remount path is SPA route navigation (`Insights → Dashboard` via a programmatic `link.click()`) — that unmounts and remounts the screen and any hooks within. Reload alone won't work because the `matchMedia` patch is in-page state lost on reload.

**Screenshot persistence.** Chrome MCP returns screenshots inline in the conversation only — it does not write them to disk regardless of `save_to_disk: true` flags or `/tmp/*.png` path hints in smoke specs. Future smoke specs should reference "inline screenshots in the Cowork transcript" rather than promising filesystem paths.

## Chunk prompt corrections

`prompts/README.md` is an overlay doc capturing the cross-chunk substitutions, path corrections, and conventions that apply to every chunk prompt in this repo. Read it before starting any chunk. Authority order: `ARCHITECTURE.md` → `prompts/README.md` → the individual chunk prompt → the chunk-specific brief (if any).

Chunks 1–8 layered these corrections via per-chunk briefs; chunks 10–16 should reference `prompts/README.md` directly instead of re-inlining them.
