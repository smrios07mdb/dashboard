-- Chunk 64 (Day-7 #10, ARCHITECTURE.md §4/§13) — the Today plan syncs.
--
-- Until now the user's manual Today deltas (the sun toggle's pins and
-- removals) lived per device in localStorage (`hup:todayPlan`, chunk 43), so a
-- plan made on the laptop was invisible on the phone. `today_marks` holds them
-- server-side instead.
--
-- One row per task, at most: `id` IS the task's id (primary key and FK to
-- `tasks`, `on delete cascade`). Every device therefore computes the same key
-- for the same task, a toggle is a plain upsert on `id`, and two devices
-- toggling the same task can never create two rows. `day` is the local
-- calendar day the mark was made for; a mark whose `day` is not today is
-- simply ignored by the client, and the next toggle overwrites it — no
-- cleanup job, and the table never holds more rows than the user has tasks.
-- `kind` is the user's intent for that day: 'pin' (in Today) or 'remove'
-- (out of Today, even when auto-signalled).
--
-- RLS: own rows only. FK checks bypass RLS, so insert/update `with check`
-- also asserts the task belongs to the caller (the scheduled_blocks / notes
-- rule). Realtime publication + replica identity full per the ARCH §4 rule
-- for every user-scoped table (chunk-5 Bug A). Applied via MCP `execute_sql`
-- (chunk-33/35/37 precedent). Idempotent.

create table if not exists public.today_marks (
  id uuid primary key references public.tasks(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  day date not null,
  kind text not null check (kind in ('pin', 'remove')),
  updated_at timestamptz not null default now()
);

create index if not exists today_marks_user_day_idx
  on public.today_marks (user_id, day);

drop trigger if exists today_marks_set_updated_at on public.today_marks;
create trigger today_marks_set_updated_at
  before update on public.today_marks
  for each row execute function public.set_updated_at();

alter table public.today_marks enable row level security;

drop policy if exists today_marks_select_own on public.today_marks;
drop policy if exists today_marks_insert_own on public.today_marks;
drop policy if exists today_marks_update_own on public.today_marks;
drop policy if exists today_marks_delete_own on public.today_marks;

create policy today_marks_select_own on public.today_marks
  for select using (auth.uid() = user_id);
create policy today_marks_insert_own on public.today_marks
  for insert with check (
    auth.uid() = user_id
    and exists (
      select 1 from public.tasks t
      where t.id = today_marks.id and t.user_id = auth.uid()
    )
  );
create policy today_marks_update_own on public.today_marks
  for update using (auth.uid() = user_id) with check (
    auth.uid() = user_id
    and exists (
      select 1 from public.tasks t
      where t.id = today_marks.id and t.user_id = auth.uid()
    )
  );
create policy today_marks_delete_own on public.today_marks
  for delete using (auth.uid() = user_id);

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'today_marks'
  ) then
    alter publication supabase_realtime add table public.today_marks;
  end if;
end $$;
alter table public.today_marks replica identity full;
