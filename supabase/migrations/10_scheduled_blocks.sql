-- Chunk 37 (ARCHITECTURE.md §4) — scheduled_blocks: a task's planner slot.
--
-- One block per task (`unique (task_id)` encodes "tray = tasks with no
-- block" server-side); deleting a task cascades its block. `done` mirrors
-- task completion (the client writes both; rendering treats a block as done
-- when either says so). Instants are timestamptz; all grid math is
-- browser-local on the client.
--
-- RLS: FK checks bypass RLS, so the insert/update `with check` also asserts
-- the referenced task belongs to the caller — that is what stops a block
-- being attached to someone else's task id.
--
-- Realtime publication + replica identity full live here per the ARCH §4
-- rule for every new user-scoped table (chunk-5 Bug A).
--
-- Applied out-of-band to the dev project via raw SQL (MCP `execute_sql`,
-- chunk-33/35 precedent — `db push` remains blocked by divergent remote
-- migration tracking). Idempotent: safe to re-run.

create table if not exists public.scheduled_blocks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  task_id uuid not null unique references public.tasks(id) on delete cascade,
  start_at timestamptz not null,
  end_at timestamptz not null,
  done boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (end_at > start_at)
);

create index if not exists scheduled_blocks_user_start_idx
  on public.scheduled_blocks (user_id, start_at);

drop trigger if exists scheduled_blocks_set_updated_at on public.scheduled_blocks;
create trigger scheduled_blocks_set_updated_at
  before update on public.scheduled_blocks
  for each row execute function public.set_updated_at();

alter table public.scheduled_blocks enable row level security;

drop policy if exists scheduled_blocks_select_own on public.scheduled_blocks;
drop policy if exists scheduled_blocks_insert_own on public.scheduled_blocks;
drop policy if exists scheduled_blocks_update_own on public.scheduled_blocks;
drop policy if exists scheduled_blocks_delete_own on public.scheduled_blocks;

create policy scheduled_blocks_select_own on public.scheduled_blocks
  for select using (auth.uid() = user_id);
create policy scheduled_blocks_insert_own on public.scheduled_blocks
  for insert with check (
    auth.uid() = user_id
    and exists (
      select 1 from public.tasks t
      where t.id = task_id and t.user_id = auth.uid()
    )
  );
create policy scheduled_blocks_update_own on public.scheduled_blocks
  for update using (auth.uid() = user_id) with check (
    auth.uid() = user_id
    and exists (
      select 1 from public.tasks t
      where t.id = task_id and t.user_id = auth.uid()
    )
  );
create policy scheduled_blocks_delete_own on public.scheduled_blocks
  for delete using (auth.uid() = user_id);

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'scheduled_blocks'
  ) then
    alter publication supabase_realtime add table public.scheduled_blocks;
  end if;
end $$;
alter table public.scheduled_blocks replica identity full;
