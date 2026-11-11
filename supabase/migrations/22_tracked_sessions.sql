-- Chunk 98 (ARCHITECTURE.md §4/§12/§16) — saved focus and breathing sessions.
--
-- The menu bar app runs focus phases (the pomodoro) and breathing sessions,
-- and until now kept nothing: Insights could only report *estimated* time
-- from completed tasks. `tracked_sessions` holds what was actually measured.
--
-- One table, two kinds. Every focus phase and every breathing session that
-- ran for at least 60 s of active time is one row; breaks are not saved.
-- `active_seconds` excludes pauses, so it can be smaller than the span from
-- `started_at` to `ended_at` and never larger (the `+ 1` absorbs rounding).
--
-- `id` is set by the client and derived from (user, kind, start) — see
-- `src/lib/trackedSessions.ts` — so the same session written twice (a lost
-- acknowledgement, two drains, an outbox replay) is an upsert onto one row.
-- `unique (user_id, kind, started_at)` states the same rule in the database.
--
-- `task_id` has NO foreign key, on purpose: the write can arrive after the
-- task was deleted (the shell keeps a session until the web view has written
-- it, possibly much later), and a foreign key would then fail the insert.
-- `task_title` keeps the task's name as it was; Insights joins to live tasks
-- client-side. Breathing never has a task.
--
-- RLS: own rows only. Update exists only because an upsert needs it; nothing
-- edits a session. Realtime publication + replica identity full per the
-- ARCH §4 rule for every user-scoped table, though no client subscribes.
-- Applied via MCP `execute_sql` (chunk-64/89 precedent). Idempotent.

create table if not exists public.tracked_sessions (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('focus','meditation')),
  started_at timestamptz not null,
  ended_at timestamptz not null,
  planned_seconds int not null check (planned_seconds between 1 and 86400),
  active_seconds int not null check (active_seconds between 60 and 86400),
  outcome text not null,
  task_id uuid null,
  task_title text null check (char_length(task_title) <= 200),
  created_at timestamptz not null default now(),
  check (ended_at >= started_at),
  check (active_seconds <= extract(epoch from (ended_at - started_at)) + 1),
  check ((kind = 'focus' and outcome in ('completed','skipped','stopped'))
      or (kind = 'meditation' and outcome in ('completed','ended'))),
  check (kind = 'focus' or (task_id is null and task_title is null)),
  unique (user_id, kind, started_at)
);

create index if not exists tracked_sessions_user_started_idx
  on public.tracked_sessions (user_id, started_at);

alter table public.tracked_sessions enable row level security;

drop policy if exists tracked_sessions_select_own on public.tracked_sessions;
drop policy if exists tracked_sessions_insert_own on public.tracked_sessions;
drop policy if exists tracked_sessions_update_own on public.tracked_sessions;
drop policy if exists tracked_sessions_delete_own on public.tracked_sessions;

create policy tracked_sessions_select_own on public.tracked_sessions
  for select using (auth.uid() = user_id);
create policy tracked_sessions_insert_own on public.tracked_sessions
  for insert with check (auth.uid() = user_id);
create policy tracked_sessions_update_own on public.tracked_sessions
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy tracked_sessions_delete_own on public.tracked_sessions
  for delete using (auth.uid() = user_id);

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'tracked_sessions'
  ) then
    alter publication supabase_realtime add table public.tracked_sessions;
  end if;
end $$;
alter table public.tracked_sessions replica identity full;
