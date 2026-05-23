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
