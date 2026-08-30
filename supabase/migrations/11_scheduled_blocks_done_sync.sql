-- Chunk 37 revisions (ARCHITECTURE.md §4) — `tasks.completed_at` is the single
-- source of truth for "done"; `scheduled_blocks.done` becomes a server-
-- maintained mirror the client never reads or writes.
--
-- Why: chunk 37 had both surfaces write their own column and the planner
-- render `block.done OR task.completed_at`, so an uncheck on the Dashboard
-- (which only clears `completed_at`) could never clear a true `block.done`
-- (smoke check 5). Any second writer — bulk complete, import, AI triage —
-- would have had to learn about blocks. One authoritative column + a
-- trigger keeps the mirror right no matter who writes.
--
-- (a) backfill the mirror, (b) keep it in step on every completion change,
-- (c) stamp it on insert so a block for an already-done task is born done.
--
-- Applied out-of-band to the dev project via raw SQL (MCP `execute_sql`,
-- chunk-33/35/37 precedent). Idempotent: safe to re-run.

update public.scheduled_blocks b
set done = (t.completed_at is not null)
from public.tasks t
where t.id = b.task_id
  and b.done is distinct from (t.completed_at is not null);

create or replace function public.sync_scheduled_block_done()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.scheduled_blocks
  set done = (new.completed_at is not null)
  where task_id = new.id
    and done is distinct from (new.completed_at is not null);
  return new;
end;
$$;

drop trigger if exists tasks_sync_scheduled_block_done on public.tasks;
create trigger tasks_sync_scheduled_block_done
  after update of completed_at on public.tasks
  for each row execute function public.sync_scheduled_block_done();

create or replace function public.scheduled_block_done_from_task()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.done := exists (
    select 1 from public.tasks t
    where t.id = new.task_id and t.completed_at is not null
  );
  return new;
end;
$$;

drop trigger if exists scheduled_blocks_done_from_task on public.scheduled_blocks;
create trigger scheduled_blocks_done_from_task
  before insert on public.scheduled_blocks
  for each row execute function public.scheduled_block_done_from_task();
