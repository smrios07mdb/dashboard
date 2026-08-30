-- Chunk 39 (ARCHITECTURE.md §4, §7) — Apple Calendar write-out for planner
-- blocks + the migration pass chunk-37 revisions deferred.
--
-- (a) `scheduled_blocks.done` and its migration-11 triggers go. Done has one
--     source of truth (`tasks.completed_at`) and the client never read the
--     mirror; keeping it was one more writer to reason about.
-- (b) `scheduled_blocks.calendar_uid` — the iCloud VEVENT uid this block is
--     mirrored to (`hupo-block-…`). null = not written (yet): offline
--     placements, a failed write, or the toggle turned on after the block
--     existed — the planner's per-week reconcile backfills these.
-- (c) `settings.planner_writeout` — the opt-in. Default off.
--
-- No RLS / publication / replica-identity changes: both tables are already
-- covered (migrations 03/05/10). Applied out-of-band to the dev project via
-- raw SQL (MCP `execute_sql`, chunk-33/35/37 precedent). Idempotent.

-- (a) chunk-37 revisions deferred this: the mirror column and its triggers go.
drop trigger if exists tasks_sync_scheduled_block_done on public.tasks;
drop trigger if exists scheduled_blocks_done_from_task on public.scheduled_blocks;
drop function if exists public.sync_scheduled_block_done();
drop function if exists public.scheduled_block_done_from_task();
alter table public.scheduled_blocks drop column if exists done;
-- (b) the iCloud mirror handle. null = not written (yet).
alter table public.scheduled_blocks add column if not exists calendar_uid text;
-- (c) opt-in.
alter table public.settings add column if not exists planner_writeout boolean not null default false;
