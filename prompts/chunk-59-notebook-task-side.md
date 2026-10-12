# Chunk 59: Notebook — task side, planner preview, `tasks.notes` copy

**Runs on:** Claude Code, in `~/Documents/To-Do Dashboard` on Sergio's Mac (repo `smrios07mdb/dashboard`).

**Bases:**
- App `smrios07mdb/dashboard` @ `485dc15` (docs). Last code commit `24870f2`, which is what's live.
- Proxy untouched. AI triage never reads notes (`grep -rn notes api` in the proxy is empty); Settings' "never your notes" line stays true and stays as is.

**Authority:** `ARCHITECTURE.md` → `prompts/README.md` → this prompt → `hupomnemata_handoff/notebook/README.md` §4–§5 + `DESIGN_NOTES.md` (visual spec). Read `CLAUDE.md` and `prompts/chunk-58-notebook-tab.md` first; chunk 58's D1–D8 still hold.

**Design reference:** `hupomnemata_handoff/notebook/`, prototype `EntitySide.jsx`.
- Build README §4 (task row, task sheet, subcategory header count, subcategory drill-down Notes section) and §5 (planner block preview + block glyph).
- Where the handoff and this prompt disagree, this prompt wins. Overrides are marked **Override**.

**Operator decisions (2026-10-12), unchanged:** many notes per task; notes on completed tasks are hidden only in the Notebook list; v1 editor is the chunk-58 textarea; `tasks.notes` moves into `notes` here and the column is dropped in **chunk 60**.

---

## Locked decisions

### D1 Client stops using `tasks.notes`

- Remove `notes` from `Task` (`types.ts`), `TaskRow` (`mappers.ts`), `taskFromRow` / `taskToRow`, `repo.tasks.create`'s input and the optimistic task literals (`Dashboard.tsx`, `CategoryView.tsx`, `SubcategoryView.tsx`, `sample-data.ts`, and any test fixture that sets it).
- The DB column stays until chunk 60. Inserts simply omit it (it is nullable, no default needed). Cached Dexie task rows may still carry a `notes` property; it is ignored. **No Dexie version bump.**
- Delete `EditNotesDialog.tsx` and its imports. Remove the whole `onEditNotes` / `onEditTaskNotes` prop chain (`TaskMenu` → `TaskRow` → `SubcategorySection` → `CategoryColumn` → `Dashboard` / `CategoryView`, and `SubcategoryView`).
- Gate: `grep -rnE "EditNotesDialog|onEditNotes|onEditTaskNotes|task\.notes|\bt\.notes|row\.notes|value\.notes|input\.notes|notes: null" src --include=*.ts --include=*.tsx` returns nothing, except D3's import code reading the **incoming file's** task `notes` (list those lines). Report the command's output.

### D2 Migration 17: copy `tasks.notes` into `notes`

`supabase/migrations/17_copy_task_notes.sql`, migration-10-style header. Applied via MCP `execute_sql` **after** the step-1 deploy is live (see Sequence). Idempotent.

```sql
insert into public.notes (user_id, title, body, task_id, created_at, updated_at)
select t.user_id, '', t.notes, t.id, t.created_at, t.updated_at
from public.tasks t
where t.notes is not null
  and btrim(t.notes) <> ''
  and not exists (
    select 1 from public.notes n
    where n.task_id = t.id and btrim(n.body) = btrim(t.notes)
  );
```

- `title` is empty (the list shows the first line); `created_at` / `updated_at` carry the task's, so copied notes don't all jump to the top of RECENT.
- The `not exists` clause is the idempotency guard and the dedupe rule (same task + same trimmed body). Re-running inserts nothing.
- `tasks.notes` is **not** cleared or altered. Chunk 60 re-runs this exact statement immediately before dropping the column, which catches any write from a stale pre-59 client.
- Header records: why it runs after the deploy (an edit through the old `EditNotesDialog` between copy and deploy would otherwise be lost), and that chunk 60 re-runs it.

### D3 Import converts legacy task notes

`src/lib/import.ts`, both modes:
- Task rows are written **without** `notes` (strip the key before upsert/insert). Merge leaves any existing column value alone; Replace leaves it null.
- For each incoming task row with a non-blank `notes` string, synthesize a note `{ id: crypto.randomUUID(), user_id, title: '', body: notes, task_id, subcategory_id: null, pinned: false, detached_label: null, detached_at: null, created_at: task.created_at, updated_at: task.updated_at }` **unless** a note with the same `task_id` and the same trimmed body already exists in the file's `notes` or live (`repo.data` read, as chunk 58's dangling-link check does). Synthesized notes go through the same insert path and ordering as file notes (after `tasks`).
- Export is unchanged: `select('*')` still carries `tasks.notes` until chunk 60.
- Test: a pre-58 file (tasks with `notes`, no `notes` key) imports into notes; re-importing a 59 export (which has both) creates no duplicates.

### D4 Shared note writer

Extract the Notebook screen's draft/create/update/delete path (`draftsRef`, `createdRef`, `chainRef`, `write`, `save`, the attach/detach/delete handlers, the `Could not save — retry` toast) into `src/components/notebook/useNoteWriter.ts`.
- The Notebook screen uses it; behavior is unchanged. **`Notebook.test.tsx` and `NoteEditor.test.tsx` pass with no edits** — that is the refactor's gate. If an edit is unavoidable, stop and report.
- The task sheet (D6) uses the same hook. Same rules: a new note is an unsaved draft until title or body is non-whitespace; emptying an existing note does not delete it.

### D5 `NotesProvider`

`src/components/notebook/NotesProvider.tsx`, mounted once inside `ProtectedLayout`.
- Holds every note: `repo.notes.listAll()` on mount and on `dashboardRefreshKey`, like the screens' own loads.
- `useNoteWriter` reports each successful create/update/delete to the provider so counts update without waiting for a realtime echo (offline included).
- Exposes, via hooks:
  - `useTaskNotes(taskId)` → that task's notes, `updatedAt` desc;
  - `useListNotes(subcategoryId, taskIds)` → notes on the list **and** on those tasks, `updatedAt` desc (handoff pushback 5);
  - `openTaskNotes(taskId, noteId?)`.
- Renders the task sheet (D6). The sheet's module is **lazy** (`lazy(() => import(...))`) so `NoteEditor` / `AttachPicker` / `noteMarkdown` stay out of the eager bundle; the provider itself is small.
- Replaces the deleted prop chain: `TaskRow` reads its count from `useTaskNotes` and calls `openTaskNotes`. No new drilling.

### D6 Task side (handoff §4)

- **Row indicator:** a dedicated grid column after the priority slot and before minutes, always reserved (`24px`; `44px` wide on touch) so rows never shift. When the task has notes: the 14px note glyph in `--ink-3` (new glyph in `icons.tsx`, app stroke style), plus a Plex Mono count when there are 2+. Empty cell otherwise. It is a button: `aria-label` `Notes for "{title}"` (or `{n} notes for "{title}"`), opens the sheet.
- **⋯ menu:** `Edit notes` becomes **`Notes`** (right side: the latest note's `noteRel` when there is one note, the `.num` count when 2+) or **`Add a note`** when none. Opens the sheet.
- **Sheet:** the app `Sheet` — right on pointer at 480px, bottom on touch at 88vh. Title: category dot + task title.
  - 0 notes ("Add a note"): an unsaved draft attached to the task, in the editor.
  - 1 note: that note's editor directly.
  - 2+: a list (first line · `noteRel` · two-line excerpt, newest first), then `New note` and `Open in Notebook`. Tapping a row shows its editor with a back chevron in the sheet title.
  - Completed tasks' notes always show here.
  - The embedded `NoteEditor` keeps its header (save-state, pin, attach, unlink). Add an optional `menu` to `NoteEditor` — a ⋯ `DropdownMenu` holding **Open in Notebook** (→ `/notebook/:id`, closes the sheet), **New note on this task**, **Delete note** (the existing `DeleteConfirm` copy). When `menu` is given, the standalone header trash is not rendered. The Notebook screen does not pass `menu`, so it is unchanged.
  - Attaching the note elsewhere from the sheet: write it, toast **`Note moved.`**, return to the sheet's list (or close the sheet when that was the task's last note). Unlink: toast **`Detached from {task}. It is now a freeform note.`** and the same return rule.
- **Subcategory header (dashboard card + CategoryView):** when `useListNotes` is non-empty, `glyph + count` in `--ink-3` beside the open-count figure. Not a button.
- **Subcategory drill-down (`SubcategoryView`):** after the task list, `.label NOTES · N`, a `New note here` ghost button, then a card of rows: first line · `noteRel` · `On this list` or glyph + task title. Task-note rows open the sheet at that note; list-note rows go to `/notebook/:id`. Empty: `No notes on this list yet.`
- **`New note here`:** navigates to `/notebook?attach=subcategory:<id>`. The Notebook screen reads that param once, opens a new unsaved draft pre-attached to that subcategory (`subcategoryId` set on the draft), and replaces the URL with `/notebook/<draftId>`. Nothing is written until the draft is non-empty. An unknown or archived id ignores the param.

### D7 Planner (handoff §5)

- **Block action sheet:** when the block's task has notes, a `--surface-2` card between the description and the actions: `.label NOTE` (or `NOTES · N`) · `updated {noteRel}` (or `latest {noteRel}`) · `Open →`; then the newest note's first line (13/600) and a three-line clamped excerpt in `--ink-2`. Read-only. `Open →` closes the block sheet and calls `openTaskNotes(taskId, newestNoteId)`. New optional prop on `BlockActionSheet`; the planner passes it from `useTaskNotes`.
- **Block glyph:** the 14px note glyph after the title in `TaskBlock`, only when the block is not `tight` (≥40px). No layout change at <40px.

### D8 Block time reads the notes table

`BlockTimeSheet`:
- The `Include notes in calendar event` checkbox shows when the task has at least one non-blank note (from `useTaskNotes`).
- The event description, when included, is every note on the task, newest first, each as `title\n\nbody` (or `body` when untitled), joined with `\n\n`. Raw Markdown is fine.
- Copy unchanged, including the PRIV-03 comment and the `(and notes, if included above)` sentence.

### D9 Excerpt and link fix (from chunk 58's smoke)

`stripNoteMarkdown` (`src/lib/notes.ts`) and the renderer's `INLINE` pattern (`src/lib/noteMarkdown.tsx`) share one link pattern that allows one level of balanced parentheses in the URL, e.g. `\[([^\]]+)\]\(((?:[^()\s]|\([^()\s]*\))+)\)`. Export it once from `notes.ts` (or a tiny shared module) and use it in both.
- `[x](https://en.wikipedia.org/wiki/Foo_(bar))` renders as one link with the full URL, and its excerpt is `x`.
- `[bad](javascript:alert(1))` still renders as text (scheme check unchanged), and its excerpt is `bad`.

---

## Tests

Vitest, alongside the existing suites. Existing tests that referenced `task.notes` / `EditNotesDialog` are updated or removed; list each in the report.

1. **D1:** a `taskToRow` with no `notes` produces no `notes` key; `taskFromRow` ignores a row's `notes`.
2. **D3 import:** pre-58 file → one note per non-blank task note (title `''`, task's timestamps); blank/whitespace notes skipped; re-import of a file that already holds the copied note → no duplicate; a live note with the same body → no duplicate; task rows written without `notes` in both modes.
3. **D4:** `Notebook.test.tsx` and `NoteEditor.test.tsx` unmodified and green.
4. **D5 provider:** counts update after a writer create/delete with no refetch; `useListNotes` includes list and task notes.
5. **D6 row:** glyph absent with 0 notes, glyph without count at 1, glyph + count at 2; the column is present in both cases (grid template unchanged by note count); clicking opens the sheet; menu label `Notes` vs `Add a note`.
6. **D6 sheet:** 0 → draft editor, nothing written while empty; 1 → editor; 2+ → list then editor with back; completed task's notes shown; `menu` items work; moving a note away toasts `Note moved.`; the header trash is absent when `menu` is passed.
7. **D6 drill-down:** section lists list + task notes with the right row labels and targets; empty copy; `New note here` → `/notebook?attach=subcategory:<id>` and the Notebook opens a pre-attached unsaved draft, replacing the URL; an archived/unknown id is ignored.
8. **D7:** block sheet card renders `NOTE` / `NOTES · N` and `Open →` calls `openTaskNotes`; no card without notes; block glyph at ≥40px only.
9. **D8:** checkbox hidden with no notes; description concatenation order and format.
10. **D9:** the two link cases above, for both renderer and excerpt.

---

## Sequence

Gate each step before the next.

1. **App code (D1, D3–D9).**
   - Gates on a clean `npm ci` with `.env.local` holding all four `VITE_*` keys:
     - `tsc -b`; `eslint .` 0 problems; `vitest run` all green — report the count against **718**; `npm run build`;
     - `git diff --stat 485dc15 -- package.json package-lock.json` is **empty**;
     - the D1 grep, with its output.
   - Bundle: total **eagerly loaded** JS (scripts + `modulepreload` in `dist/index.html`) must not grow by more than **10 kB** raw against `24870f2`'s build (1,019,866 B). Report before/after and the lazy chunks that changed.
   - Commit the code **alone** (with `supabase/migrations/17_copy_task_notes.sql` included but not yet applied) and push. Deploy run green; live `version.json` equals the SHA (cache-busted read).
2. **Migration 17 (D2)**, only after step 1 is live:
   - Before: `select count(*) from tasks where notes is not null and btrim(notes) <> ''` and `select count(*) from notes`.
   - Apply via MCP `execute_sql`. After: `select count(*) from notes`, and `select count(*) from tasks t where t.notes is not null and btrim(t.notes) <> '' and not exists (select 1 from notes n where n.task_id = t.id and btrim(n.body) = btrim(t.notes))` → **0**.
   - Re-run the file once more; `notes` count unchanged (idempotency).
3. **Smoke** by the orchestrator on the deployed app in the operator's Chrome. Not you. Stop after step 2 and report.
4. **Docs (`[skip ci]`, after the orchestrator's smoke passes):**
   - `ARCHITECTURE.md`: §4 — `tasks.notes` deprecated (unread and unwritten by the app since chunk 59; dropped in chunk 60) + migration 17; §10 export/import — legacy task notes become notes on import; §13 — extend the Notebook block with the task row, task sheet, subcategory section, planner preview, Block time source and `NotesProvider`.
   - `PROGRESS.md`: row 59 ☑ with SHAs, counts and deviations; row 60's scope gains "re-run migration 17's insert immediately before the drop; import must strip `notes` from task rows (already true since 59)".
   - D1–D9 in the Decisions log; last-updated paragraph per the chunk-54 convention.
   - Commit this prompt as `prompts/chunk-59-notebook-task-side.md` in the same commit.

## Out of scope

- Dropping `tasks.notes` (chunk 60).
- TodayPanel rows (no notes UI there), Move to… on touch, attachment-chip-as-filter, a rich editor, AI over notes.
- Any proxy change.

## Report back

- Step 1: app SHA, deploy run id, live `version.json`; test count; the D1 grep output; eager JS before/after and changed lazy chunks; the empty `package.json` diff; tests updated or removed because of D1.
- Step 2: the before/after counts, the zero-gap query, the idempotent re-run.
- Every deviation, numbered.
