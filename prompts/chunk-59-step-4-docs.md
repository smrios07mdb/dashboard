# Chunk 59 step 4: docs (covers 59 + 59a)

**Runs on:** Claude Code, in `~/Documents/To-Do Dashboard` on Sergio's Mac (repo `smrios07mdb/dashboard`), same thread as chunks 59 and 59a.

**Base:** `0fa7f0c` (live, verified). Docs only: one commit, message ends with `[skip ci]`. No `src/`, no tests, no migrations. `version.json` stays at `0fa7f0c`.

**Authority:** `ARCHITECTURE.md` → `prompts/README.md` → `prompts/chunk-59-notebook-task-side.md` step 4 → this prompt.

## Orchestrator verification (record as given)

- **Gate, independent, at `0fa7f0c`** (fresh clone, clean `npm ci`, Node 22): `tsc -b` clean; `eslint .` 0 problems; `vitest run` **782 / 782**; `npm run build` green; `Notebook.test.tsx` + `NoteEditor.test.tsx` unchanged since `485dc15` and green (26 tests); `package.json` / `package-lock.json` unchanged since `24870f2`; D1 grep returns only `src/lib/import.ts:283`, `:293`, `:300`.
- **Eager JS:** 1,024,152 B on the orchestrator's build (placeholder env values), 1,024,438 B on Sergio's Mac — both under the +10 kB limit against 1,019,866 B.
- **Gate note:** `plannerCalendarMirror.counts.test.ts` hard-codes `https://dashboard-caldav-proxy.vercel.app`; with any other `VITE_CALDAV_PROXY_URL` its 3 tests fail. Not a chunk-59 regression — record it as a test-hygiene item.
- **Smoke 1 at `7df9346`:** failed F1 (0 notes opened the empty list, not a draft) and F3 (subcategory header wrapped its ⋯ to a second row when the note count showed). Reported F2 (sheet stayed open after deleting the last note).
- **Smoke 2 at `0fa7f0c`, Sergio's Chrome, deployed app:** F1 pass (draft editor, caret in body, nothing saved when closed empty); F2 pass (sheet `data-state=closed`, glyph gone, `Note deleted.`; reproduced twice); F3 pass (all six header cells on one row at 1224px, ⋯ on the title line). No console errors. Test notes deleted.
- **F2 root cause:** a smoke false positive. The Chrome tab was hidden, so Radix's sheet exit animation never finished and the closed sheet stayed in the DOM. 59a's "was last" capture and self-close guard are kept as hardening.
- **Exercised in smoke 1 and passing:** `Add a note` / `Notes · N` menu labels, row glyph + count updating without refetch, sheet list newest-first with excerpts and back chevron, editor ⋯ menu (no header trash), detach toast, delete confirm copy, header count, drill-down `NOTES · N` rows, `New note here` → pre-attached draft with URL replaced, D9 links and excerpts, Block time checkbox + copy.
- **Not exercised live (unit tests only):** D7 planner preview + block glyph and D8 event description (both need a Calendar write), the `Note moved.` path, touch layout, migration 17 against real rows (0 legacy notes in the DB).

## Edits

1. **`ARCHITECTURE.md`** — exactly chunk 59 step 4's three items:
   - §4: `tasks.notes` deprecated (unread and unwritten by the app since chunk 59; dropped in chunk 60) + migration 17.
   - §10 export/import: legacy task notes become notes on import.
   - §13: extend the Notebook block with the task row, task sheet, subcategory section, planner preview, Block time source and `NotesProvider`. Add one line: the sheet takes `userId` from `NotesProvider` and is not rendered until it exists (59a F1).
2. **`PROGRESS.md`**
   - Row 59 ☑: code `7df9346` + `0fa7f0c` (59a), docs SHA once known (follow-up per the chunk-54 convention), tests 718 → 774 → 782, eager JS, migration 17 counts (0 / 0 / 0 / 0, idempotent re-run 0), chunk 59 deviations 1–11 and 59a deviations 1–4, plus the smoke summary above.
   - Row 60 scope gains: "re-run migration 17's insert immediately before the drop; import must strip `notes` from task rows (already true since 59)".
3. **Decisions log** — D1–D9 from the chunk 59 prompt, plus:
   - **59a-F1:** the task sheet gets `userId` from `NotesProvider`, never from its own `useSession()`.
   - **59a-F2:** the sheet closes on "was last" captured before the write, and also closes itself when it has nothing to show.
   - **59a-F3:** subcategory header trailing controls are `shrink-0`; the name truncates.
   Then the last-updated paragraph.
4. **Prompts**
   - Commit `prompts/chunk-59-notebook-task-side.md`, the prompt as pasted at chunk 59 start.
   - Commit `prompts/chunk-59a-sheet-draft-fix.md`, the prompt as pasted at 59a start.
   - Commit this file as `prompts/chunk-59-step-4-docs.md`.
5. **Test-hygiene item** — add it to PROGRESS's open items (not fixed here): `plannerCalendarMirror.counts.test.ts` should derive the proxy host from `import.meta.env.VITE_CALDAV_PROXY_URL` instead of the literal.

## Gates

- `git diff --stat 0fa7f0c HEAD` lists only `ARCHITECTURE.md`, `PROGRESS.md`, the decisions-log file and the three `prompts/` files.
- Commit message ends with `[skip ci]`. Push.
- No deploy run fires; live `version.json` still shows `0fa7f0c` (cache-busted read).

## Report back

1. Docs SHA.
2. The `git diff --stat` output.
3. Confirmation that no deploy fired, plus the live `version.json`.
4. Every deviation, numbered.
