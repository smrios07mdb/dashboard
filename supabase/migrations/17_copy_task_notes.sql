-- 17_copy_task_notes.sql
-- ---------------------------------------------------------------------------
-- Chunk 59 (D2): copy `tasks.notes` into `public.notes`.
--
-- Since chunk 59 the app neither reads nor writes `tasks.notes`: a task's
-- notes live in the `notes` table (migration 16), many per task. This copies
-- every non-blank `tasks.notes` value into one untitled note attached to its
-- task.
--
--   * `title` is '' — the Notebook list shows the body's first line.
--   * `created_at` / `updated_at` carry the task's own, so the copied notes do
--     not all jump to the top of RECENT. (`set_updated_at` is a BEFORE UPDATE
--     trigger; it does not touch an insert.)
--   * The `not exists` clause is both the idempotency guard and the dedupe
--     rule: same task + same trimmed body. Re-running inserts nothing.
--   * `tasks.notes` is NOT cleared or altered here. The column is dropped in
--     chunk 60.
--
-- ORDER MATTERS — apply this only AFTER the chunk-59 app build is live. The
-- old build edits `tasks.notes` through `EditNotesDialog`; an edit made there
-- between this copy and the deploy would exist only in the column and be lost
-- when chunk 60 drops it. Running after the deploy closes that window for
-- every up-to-date client.
--
-- Chunk 60 re-runs this exact statement immediately before dropping the
-- column, which catches any write from a stale pre-59 client (an installed
-- PWA that has not updated yet). The dedupe rule makes that re-run safe.
--
-- Applied via MCP `execute_sql` (migrations in this repo are applied as raw
-- SQL, not `db push`).
-- ---------------------------------------------------------------------------

insert into public.notes (user_id, title, body, task_id, created_at, updated_at)
select t.user_id, '', t.notes, t.id, t.created_at, t.updated_at
from public.tasks t
where t.notes is not null
  and btrim(t.notes) <> ''
  and not exists (
    select 1 from public.notes n
    where n.task_id = t.id and btrim(n.body) = btrim(t.notes)
  );
