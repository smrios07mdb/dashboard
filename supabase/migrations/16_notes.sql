-- Chunk 58 (ARCHITECTURE.md §4) — notes: the Notebook's one table.
--
-- A note has an optional title, a body, `pinned`, and zero or one
-- attachment: a task or a subcategory, never both (`num_nonnulls <= 1`).
-- Unattached = freeform. A task or a subcategory may hold many notes, so
-- neither link is unique.
--
-- Detach memo (D2). Deleting a task or a subcategory never deletes its
-- notes: the FK is `on delete set null`. Before the link clears, a
-- `BEFORE DELETE` trigger on `tasks` / `subcategories` stamps the note with
-- the name of what it was attached to (`detached_label`) and when
-- (`detached_at`). The memo is written here, never by the client, because
-- deletes also arrive by cascade, bulk delete, merge and import. The memo
-- update and the FK's set-null each pass through `set_updated_at`, so a
-- detach bumps `updated_at` — accepted: a detach is a change to the note.
-- Archiving a subcategory (`archived_at`) is not a delete and touches
-- nothing here.
--
-- The memo function is `security definer` with an empty search_path: it has
-- to write the memo whichever role issued the delete (a cascade from
-- `auth.users`, the service role, the row's owner) and must not be subject
-- to the caller's RLS. It only ever touches notes linked to the row being
-- deleted, and a trigger function cannot be called directly.
--
-- RLS: FK checks bypass RLS, so the insert/update `with check` also asserts
-- that a non-null `task_id` / `subcategory_id` belongs to the caller — that
-- is what stops a note being attached to someone else's row (migration-10
-- pattern, once per link).
--
-- Realtime publication + replica identity full live here per the ARCH §4
-- rule for every new user-scoped table (chunk-5 Bug A).
--
-- Applied out-of-band to the dev project via raw SQL (MCP `execute_sql`,
-- chunk-33/35/37 precedent — `db push` remains blocked by divergent remote
-- migration tracking). Idempotent: safe to re-run.

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

create index if not exists notes_user_updated_idx
  on public.notes (user_id, updated_at desc);
create index if not exists notes_task_idx
  on public.notes (task_id);
create index if not exists notes_subcategory_idx
  on public.notes (subcategory_id);

drop trigger if exists notes_set_updated_at on public.notes;
create trigger notes_set_updated_at
  before update on public.notes
  for each row execute function public.set_updated_at();

alter table public.notes enable row level security;

drop policy if exists notes_select_own on public.notes;
drop policy if exists notes_insert_own on public.notes;
drop policy if exists notes_update_own on public.notes;
drop policy if exists notes_delete_own on public.notes;

create policy notes_select_own on public.notes
  for select using (auth.uid() = user_id);
create policy notes_insert_own on public.notes
  for insert with check (
    auth.uid() = user_id
    and (
      task_id is null
      or exists (
        select 1 from public.tasks t
        where t.id = task_id and t.user_id = auth.uid()
      )
    )
    and (
      subcategory_id is null
      or exists (
        select 1 from public.subcategories s
        where s.id = subcategory_id and s.user_id = auth.uid()
      )
    )
  );
create policy notes_update_own on public.notes
  for update using (auth.uid() = user_id) with check (
    auth.uid() = user_id
    and (
      task_id is null
      or exists (
        select 1 from public.tasks t
        where t.id = task_id and t.user_id = auth.uid()
      )
    )
    and (
      subcategory_id is null
      or exists (
        select 1 from public.subcategories s
        where s.id = subcategory_id and s.user_id = auth.uid()
      )
    )
  );
create policy notes_delete_own on public.notes
  for delete using (auth.uid() = user_id);

-- D2: the detach memo.
create or replace function public.notes_memo_task_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.notes
     set detached_label = old.title, detached_at = now()
   where task_id = old.id;
  return old;
end;
$$;

create or replace function public.notes_memo_subcategory_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.notes
     set detached_label = old.name, detached_at = now()
   where subcategory_id = old.id;
  return old;
end;
$$;

drop trigger if exists tasks_notes_detach_memo on public.tasks;
create trigger tasks_notes_detach_memo
  before delete on public.tasks
  for each row execute function public.notes_memo_task_delete();

drop trigger if exists subcategories_notes_detach_memo on public.subcategories;
create trigger subcategories_notes_detach_memo
  before delete on public.subcategories
  for each row execute function public.notes_memo_subcategory_delete();

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'notes'
  ) then
    alter publication supabase_realtime add table public.notes;
  end if;
end $$;
alter table public.notes replica identity full;
