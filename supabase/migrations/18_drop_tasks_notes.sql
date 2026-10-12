-- 18_drop_tasks_notes.sql
-- ---------------------------------------------------------------------------
-- Chunk 60 (D1): drop `tasks.notes`.
--
-- Since chunk 59 the app neither reads nor writes `tasks.notes`; a task's
-- notes live in the `notes` table (migration 16) and migration 17 copied the
-- column's values there. This re-copies, verifies and drops, in one
-- transaction.
--
--   * It re-runs migration 17's insert first. That catches a write from a
--     stale pre-59 client (an installed PWA that had not updated yet) made
--     after migration 17 ran. The `not exists` dedupe rule — same task + same
--     trimmed body — makes the re-run insert nothing for values already copied.
--   * The copy and the drop share one transaction (the `do` block) and a
--     `share row exclusive` lock on `tasks`, so no task write can land between
--     them and be lost with the column.
--   * All-or-nothing: if any non-blank `tasks.notes` value still has no
--     matching note after the copy, the block raises, the copy rolls back with
--     it and the column stays.
--   * `drop column` has no `cascade`: anything depending on the column should
--     make this fail loudly rather than be dropped along with it.
--   * Idempotent: a second run finds no column and returns at the notice.
--
-- NEVER re-run migration 17 after this one — it names `tasks.notes`, which no
-- longer exists. (Migration 17 is left as written; historical migrations are
-- not edited.)
--
-- No RLS / publication / replica-identity changes; `tasks` keeps
-- `replica identity full`. Applied via MCP `execute_sql` (migrations in this
-- repo are applied as raw SQL, not `db push`).
-- ---------------------------------------------------------------------------

do $$
declare
  gap integer;
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'tasks' and column_name = 'notes'
  ) then
    raise notice 'migration 18: tasks.notes already dropped, nothing to do';
    return;
  end if;

  -- No task write can land between the copy and the drop.
  lock table public.tasks in share row exclusive mode;

  -- Migration 17's insert, unchanged.
  insert into public.notes (user_id, title, body, task_id, created_at, updated_at)
  select t.user_id, '', t.notes, t.id, t.created_at, t.updated_at
  from public.tasks t
  where t.notes is not null
    and btrim(t.notes) <> ''
    and not exists (
      select 1 from public.notes n
      where n.task_id = t.id and btrim(n.body) = btrim(t.notes)
    );

  select count(*) into gap
  from public.tasks t
  where t.notes is not null
    and btrim(t.notes) <> ''
    and not exists (
      select 1 from public.notes n
      where n.task_id = t.id and btrim(n.body) = btrim(t.notes)
    );
  if gap <> 0 then
    raise exception 'migration 18: % task notes not copied; tasks.notes not dropped', gap;
  end if;

  alter table public.tasks drop column notes;
end
$$;
