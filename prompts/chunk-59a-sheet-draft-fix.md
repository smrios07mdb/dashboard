# Chunk 59a: task notes sheet — smoke fixes before step 4

**Runs on:** Claude Code, in `~/Documents/To-Do Dashboard` on Sergio's Mac (repo `smrios07mdb/dashboard`).

**Base:** `7df9346` (live; chunk 59 step 1). Migration 17 already applied — do not re-run it here.

**Authority:** `ARCHITECTURE.md` → `prompts/README.md` → `claude/chunk-59-notebook-task-side.md` (D1–D9 hold) → this prompt.

**Why:** the orchestrator's smoke on the deployed app (2026-10-12, Sergio's Chrome, 1224px viewport, pointer) failed one locked behavior and found two defects. Everything else passed. Step 4 (docs) is held until this ships and re-smokes.

---

## F1 — 0 notes does not open a draft (D6 violation, blocker)

**Observed:** task with no notes → ⋯ → `Add a note` (and the row cell) opens the sheet on the empty list: title + a lone `New note` button. D6 requires an unsaved draft attached to the task, in the editor.

**Cause:** `TaskNotesSheet` decides its view in a lazy `useState` initializer that needs `userId`. `useSession()` is per-instance and starts `user: null` until `supabase.auth.getSession()` resolves, so on the sheet's first render `userId` is always null and the initializer falls through to `{ viewId: null, draft: null }`. Tests pass only because `useSession` is mocked synchronously.

**Fix:**
- Make the 0-note draft independent of the first render. Either:
  - (preferred) give the sheet a `userId` that is already known — `NotesProvider` is inside `ProtectedLayout`, which only renders with a session; pass it in (prop or context) instead of calling `useSession()` in the sheet; **or**
  - keep `useSession()` and open the draft in an effect once `userId` is non-null, guarded by a ref so it runs once per opening, only when `noteId` is null and the task has 0 notes.
- Use the same `userId` source for `newNote()`.
- Keep D4's rule: nothing is written while the draft is empty.

**Test:** in `notebook/TaskSide.test.tsx`, a case where the session resolves **after** the first render (mock `useSession` to return `user: null` then the user, or mock `getSession` as a deferred promise) → opening a 0-note task shows the draft editor (title/body inputs present, no `New note` list button) and no write happens.

## F2 — sheet stays open after deleting the task's last note

**Observed:** task with 1 note → editor ⋯ → `Delete note` → confirm. Toast `Note deleted.`, row glyph disappears, but the sheet stays open on the empty list (`New note` only).

**Expected:** same return rule as move/unlink — deleting the task's last note closes the sheet; deleting one of several returns to the list.

**Fix:** find why `removeNote` → `left(note)` does not reach `onClose()` (check what `remove()` from `useNoteWriter` resolves to after the confirm dialog, and whether `left`'s `taskNotes` closure is stale after the provider's delete report). Decide "was last" from the task's notes **before** the write, not after.

**Test:** delete the only note → sheet closes; delete one of two → list shows the remaining note.

## F3 — subcategory header wraps when the note count shows

**Observed:** dashboard, Work → General card at 1224px viewport: with `glyph + count` present, the header's ⋯ button drops to a second line. Headers without a count fit on one line.

**Fix:** keep the header on one row: the name truncates (`min-w-0 truncate`), the count, open-count, minutes, chevron and ⋯ are `shrink-0`. No change to the count's design (D6).

**Test:** not a jsdom layout check — assert the class contract (name element truncates; trailing controls `shrink-0`) in the existing header test, and include a before/after screenshot of the Work card at 1224px from the dev server in the report.

---

## Gates

On a clean `npm ci`:
- `tsc -b`; `eslint .` 0 problems; `vitest run` all green — report the count against **774**; `npm run build`.
- `Notebook.test.tsx` and `NoteEditor.test.tsx` unmodified and green.
- `git diff --stat 7df9346 -- package.json package-lock.json` empty.
- Eager JS (scripts + `modulepreload` in `dist/index.html`) **measured after the final edit**, against 1,019,866 B (limit +10 kB). Also re-measure `7df9346` on this machine and report both.

Commit code alone, push, deploy run green, live `version.json` equals the SHA (cache-busted read).

## Report back

1. SHA, deploy run id, live `version.json`.
2. Test count; the new tests by name.
3. F1, F2, F3: what changed and the root cause found for F2.
4. Eager JS for `7df9346` and the new SHA, both measured after the final edit.
5. Complete text of chunk 59's deviations 10 and 11 — both were cut off in the last report.
6. Every deviation from this prompt, numbered.

Stop after the push. The orchestrator re-smokes; step 4 docs (chunk 59 + this fix) follow that.
