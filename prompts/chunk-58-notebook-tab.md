# Chunk 58: Notebook tab (notes table, list, editor, attach picker)

**Bases:**
- App `smrios07mdb/dashboard` @ `da1c17c`. The last code commit is `089cc1b`, which is what's live.
- Proxy is untouched this chunk.

**Authority:** `ARCHITECTURE.md` → `prompts/README.md` → this prompt → `hupomnemata_handoff/notebook/README.md` (visual spec). Read `CLAUDE.md` first.

**Design reference:** `hupomnemata_handoff/notebook/`, landed in `da1c17c`.
- Recreate `README.md` §1–§3 and §6, plus the six-tab nav from `DESIGN_NOTES.md` §D6, with the app's own primitives.
- §4–§5 (task side, subcategory section, planner block) are **chunk 59**. Do not build them here.
- Where the handoff and this prompt disagree, this prompt wins. Every such override is listed under D7 and D8.

**Operator decisions (2026-10-12):**
- Title is optional.
- A task or a subcategory may hold many notes.
- Notes on completed tasks are hidden in the Notebook list by default.
- v1 editor is a textarea, not a rich editor.
- A detached note keeps a memo of what it was attached to.
- `tasks.notes` moves into this model in **chunk 59**, and the column is dropped in **chunk 60**.

---

## Locked decisions

### D1 Migration 16: `supabase/migrations/16_notes.sql`

Header comment in the migration-10 style. Apply it via MCP `execute_sql`. It must be idempotent.

```sql
create table if not exists public.notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null default '',
  body text not null default '',
  pinned boolean not null default false,
  task_id uuid null references public.tasks(id) on delete set null,
  subcategory_id uuid null references public.subcategories(id) on delete set null,
  detached_label text null,          -- name of what it was attached to, set when that is deleted
  detached_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (num_nonnulls(task_id, subcategory_id) <= 1)
);
```

- **Indexes:** `(user_id, updated_at desc)`, `(task_id)`, `(subcategory_id)`.
- **Triggers:** `set_updated_at` trigger, as for every table.
- **RLS:** four `*_own` policies.
  - Insert and update `with check` also assert that a non-null `task_id` or `subcategory_id` belongs to `auth.uid()`. Use the migration-10 `exists (…)` pattern for each. FK checks bypass RLS, and these checks are what stop a note being attached to someone else's row.
- **Realtime publication + `replica identity full`:** same `do $$` guard as migration 10. This is the ARCH §4 rule.

### D2 Detach memo, server-side

- Add two `BEFORE DELETE` triggers:
  - on `tasks`: `update public.notes set detached_label = old.title, detached_at = now() where task_id = old.id`;
  - on `subcategories`: the same with `old.name`.
- The FK's `on delete set null` then clears the link. Do the memo in the trigger, never in the client: deletes also arrive by cascade, bulk delete, merge and import.
- `set_updated_at` will bump `updated_at` on those rows. Accept it: a detach is a change to the note. Record it in the migration header.
- Archiving a subcategory (`archived_at`) is **not** a delete and changes nothing about its notes.

### D3 `tasks.notes` is not touched in this chunk

- No copy into `notes`, no change to `EditNotesDialog` / `TaskMenu` / `BlockTimeSheet`.
- Reason: if the copy ran now, edits made through the still-live dialog between 58 and 59 would diverge from the copied note. Chunk 59 does the copy and the task side together.
- Attaching a Notebook note to a task is allowed now. For one chunk, a task can have both an old dialog note and Notebook notes. That is expected; record it in PROGRESS.

### D4 Client data layer

Follow the `scheduled_blocks` shape at every touchpoint. Run `grep -rn "scheduled_blocks\|scheduledBlocks" src` for the list. Every touchpoint gets a `notes` counterpart:

- **Types and mapping:**
  - `types.ts`: `Note` type. Fields: `id, userId, title, body, pinned, taskId, subcategoryId, detachedLabel, detachedAt, createdAt, updatedAt`.
  - `types.ts`: add `TABLES.notes`.
  - `mappers.ts`: `noteFromRow` / `noteToRow`.
- **Dexie:** **v6**, new store only: `notes: '&id, taskId, subcategoryId, pinned, updatedAt'`, with the same comment style as v4.
- **Outbox registry and server echo:** an entry in the `outbox.ts` registry and a case in `applyServerEcho`.
- **`src/db/realtime.ts`:** one handler + one channel binding, the same shape as `scheduled_blocks`.
  - This is a **locked subsystem**; this prompt authorizes exactly that addition and nothing else in the file.
  - The 200 ms debounce is untouched.
- **Cache wipe:** `localCache.wipeLocalCache` clears `db.notes`.
- **`repo.notes`:**
  - `listAll()`: online mirrors into Dexie; the fallback reads Dexie.
  - `create(input)`: client `crypto.randomUUID()`, like blocks.
  - `update(id, changes)`: `title | body | pinned | taskId | subcategoryId | detachedLabel | detachedAt`.
  - `delete(id)`.
  - All go through `writeRow` and the offline path. No new sync mechanism.
- **Export/import:**
  - `notes` joins `EXPORT_TABLES` after `scheduled_blocks`. It is **optional on read**, so an absent key becomes `[]`, exactly as `scheduled_blocks` did in chunk 50, and `EXPORT_VERSION` stays `1`.
  - **Replace:** `notes` is deleted **first** in the teardown, so the D2 triggers don't run detach memos for a wipe, and it is re-inserted **after** `tasks`.
  - **Both modes:** any incoming note whose `task_id` / `subcategory_id` is not in the file's own rows **and** not live is written with that id `null`, and `detached_label` is left as the file has it. Test this.
- **Sample data and wipe:**
  - `sample-data.ts` → `loadSampleData` adds 4 notes: 1 pinned freeform, 1 on a subcategory, 1 on an open task, 1 on a completed task.
  - `wipeMyData` deletes `notes` first, so wipe doesn't spray detach memos.

### D5 Route and nav

- **Routes:** `notebook` and `notebook/:noteId` under `ProtectedLayout`, lazy-loaded like Planner (`const Notebook = lazy(() => import('@/screens/Notebook'))`).
  - Desktop and iPad: `:noteId` selects the note in the two-pane view.
  - Phone (<640): `:noteId` is the full-screen editor.
  - An unknown id falls back to `/notebook`.
- **Tabs:** sixth tab, order **Dashboard · Planner · Routines · Insights · Notebook · Settings**, label **Notebook** on both breakpoints, with an open-book icon in the app's stroke style. Update `Tabs.test.tsx` from 5+5 to 6+6.
- **Phone editor:** the bottom nav hides on `/notebook/:noteId` below 640px, and the shell's bottom-nav clearance goes with it. Only that route.

### D6 Notebook screen

Per handoff §1 and §6.

- **List:**
  - Header, search, **All · Freeform · Attached** segment.
  - `.label PINNED` group, then `.label RECENT`, each by `updatedAt` desc.
  - Row: title, or the first line in italic when untitled; two-line excerpt; mono relative time; attachment chip.
  - Search is client-side over the Dexie cache, case-insensitive, title + body. Highlight with `<mark>` per the handoff; build it from text nodes, never `innerHTML`.
- **Attachment chip:**
  - Category dot + subcategory name, or the task title with the `TASK` micro-label.
  - Archived subcategories still render normally.
  - When `detachedLabel` is set and both links are null: the hollow dashed chip with the name struck through.
- **Notes on completed tasks:** hidden by default, with a `+N ON COMPLETED TASKS` reveal row at the bottom.
  - The reveal is **session-scoped component state**. Read this as a correction to the handoff: the app has **no persisted hide-completed preference**. Completed tasks are hidden per section with a session reveal (`SubcategorySection`), and this matches that.
  - Freeform and subcategory notes are never hidden.
- **Empty states:** empty notebook, empty search, empty Attached filter, empty Freeform filter. Copy exactly as handoff §Copy.
- **New note:** opens an **unsaved draft**. Nothing is written until title or body is non-empty, and leaving an empty draft discards it. Emptying an existing note does not delete it.

### D7 Editor

Overrides the handoff's rich-editor recommendation.

- **Input:** the title is a borderless input. The body is a plain auto-growing `<textarea>` while focused, and rendered Markdown when not, which is exactly the prototype's source-on-focus / rendered-on-blur.
  - Tapping or clicking the rendered body focuses the textarea at the end.
  - 16px text on touch.
  - **No new npm dependency.** `package.json` and `package-lock.json` stay unchanged; step 2 verifies it.
- **Renderer** `src/lib/noteMarkdown.tsx` is a pure function from body string to React nodes. It never uses `dangerouslySetInnerHTML`. It supports exactly:
  - `# ` → h2-styled `.title` 22px, `## ` → 15/600;
  - `- ` lines → `<ul>`, blank-line paragraphs;
  - `[text](url)` and bare `https?://` URLs → links.
- **Links:** only `http:`, `https:` and `mailto:` become `<a target="_blank" rel="noopener noreferrer">`. Any other scheme renders as plain text. Test `javascript:` and `data:` explicitly.
- **Header row:** attachment control, save-state, pin, delete.
- **Footer:** `.label CREATED … · UPDATED …`, and the formatting hint while editing.
- **Detached strip:** above the title when `detachedLabel` is set and both links are null. Copy per handoff.
- **Autosave:**
  - Debounce 600 ms.
  - Flush immediately on blur, route change / unmount, and `visibilitychange → hidden`.
  - No Save button.
- **Save state:**
  - `Saved` / `Syncing` (pulse) / `Offline · saved on this device` / `Offline · N change(s) queued`.
  - Derived from `syncStore` + the outbox count for this note's id + a local pending-debounce flag. Reuse the `SyncIndicator` dot styles; don't fork them.

### D8 Attach picker and delete

- **Picker:** a stepped `Dialog`, not `MoveToPicker`'s dropdown cascade (rationale in DESIGN_NOTES).
  - Steps: Work/Personal → subcategories (**non-archived only**) → "Attach to this list" + that list's tasks. Completed tasks are struck and muted but still pickable. Show the `N NOTES` micro-label.
  - The breadcrumb title is tappable.
  - Footer `Detach` when attached.
  - Attaching sets exactly one of `taskId` / `subcategoryId`, nulls the other, and clears `detachedLabel` / `detachedAt`.
  - Toasts per handoff §Copy.
- **Header unlink:** detaches immediately and toasts.
- **Delete:** via `DeleteConfirm`. Copy per handoff, including the "**{name}** is not affected" line when attached. Hard delete.

---

## Tests

Vitest, alongside the existing suites:

1. **Mappers:** `noteFromRow` / `noteToRow` round-trip, nulls preserved.
2. **Dexie v6:** opens over a populated v5 DB with existing stores intact (the `upgradeToV5` test pattern).
3. **Repo:**
   - create / update / delete online path;
   - offline path enqueues one outbox row per op, and the outbox replay writes `notes`;
   - realtime handler puts and deletes in Dexie.
4. **Export/import:**
   - `notes` exported;
   - a file **without** `notes` still imports;
   - Replace deletes notes before tasks and inserts them after;
   - dangling `task_id` / `subcategory_id` written as `null`;
   - Merge upserts on `id`.
5. **`noteMarkdown`:**
   - every supported construct;
   - plain text passes through;
   - `javascript:` / `data:` links render as text;
   - no element carries `dangerouslySetInnerHTML`.
6. **Notebook screen:**
   - pinned-then-recent order;
   - search over title and body with highlight;
   - segment filtering;
   - completed-task notes hidden with a reveal count;
   - untitled rows show the first line;
   - all four empty states.
7. **Editor:**
   - draft not persisted while empty;
   - debounce writes once per burst (fake timers);
   - flush on blur and on unmount;
   - detached strip renders only when both links are null and `detachedLabel` is set.
8. **Picker:**
   - archived subcategories excluded;
   - completed tasks pickable;
   - attach sets one link and clears the detach memo;
   - Detach nulls both.
9. **Tabs:** 6 + 6, order as D5. Bottom nav absent on `/notebook/:id` under 640px only.

---

## Sequence

Gate each step before the next.

1. **Migration 16 (D1 + D2):**
   - Apply via MCP `execute_sql`. It is additive, so it is safe before the code ships.
   - Confirm all of the following and report them:
     - `information_schema.columns` for `notes`;
     - `pg_policies` (4 rows);
     - `pg_publication_tables` includes `notes`;
     - `relreplident = 'f'`;
     - the two triggers exist on `tasks` and `subcategories`.
   - **Prove D2 live:**
     1. Insert a throwaway subcategory and task prefixed `Smoke-58-`.
     2. Attach a note to the task, then delete the task.
     3. The note shows `task_id null`, `detached_label = 'Smoke-58-…'`, `detached_at` set.
     4. Clean up only `Smoke-58-*` rows.
2. **App code (D3–D8):**
   - Gates on a clean `npm ci`, with `.env.local` holding all four `VITE_*` keys (`VITE_CALDAV_PROXY_URL=https://dashboard-caldav-proxy.vercel.app`):
     - `tsc -b`;
     - `eslint .` with 0 problems;
     - `vitest run` all green; report the count against 600;
     - `npm run build`;
     - `git diff --stat da1c17c -- package.json package-lock.json` is **empty**.
   - Commit the code **alone** and push. The deploy run must be green, and the live `version.json` must equal the SHA (cache-busted read).
   - Report the new lazy chunk's size and confirm the main `index` chunk did not grow by more than 10 kB.
3. **Smoke** by the orchestrator, on the deployed app in the operator's Chrome. Not you. Stop after step 2 and report.
4. **Docs (`[skip ci]`, after the orchestrator's smoke passes):**
   - `ARCHITECTURE.md`:
     - §1: add Notebook.
     - §4: `notes` schema + the D2 trigger rule + "nine user-scoped tables" in the realtime paragraph.
     - §6: no change unless the sync model changed (it must not).
     - §13: a **Notebook** block covering D5–D8.
   - `CLAUDE.md` Lanes: Claude Design output lands under `hupomnemata_handoff/<feature>/` (planner and notebook precedent), not `design/`.
   - `PROGRESS.md`:
     - row 52 ☑ = the design pass (`da1c17c`);
     - new row 58 ☑ with SHAs and deviations;
     - new rows **59** "Notebook: task side + `tasks.notes` migration" ☐ and **60** "Drop `tasks.notes`" ☐;
     - D1–D8 in the Decisions log;
     - last-updated paragraph per the chunk-54 convention.
   - Commit the prompt itself as `prompts/chunk-58-notebook-tab.md` in this docs commit.

## Out of scope

- Task-row indicator, notes sheet, subcategory Notes section, planner block preview, Block time's notes source: chunk 59.
- Copying `tasks.notes`, retiring `EditNotesDialog`: chunk 59. Dropping the column: chunk 60.
- A rich editor, attachment-chip-as-filter, tags/folders, AI over notes.
- Any proxy change.

## Report back

- Step 1:
  - the five schema confirmations;
  - the D2 live-proof rows.
- Step 2:
  - app SHA, deploy run id, live `version.json`;
  - test count;
  - bundle sizes (lazy Notebook chunk, main `index` before/after);
  - the empty `package.json` diff.
- Every deviation.
