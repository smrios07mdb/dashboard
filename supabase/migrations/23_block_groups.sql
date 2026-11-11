-- Chunk 99 (ARCHITECTURE.md §4/§16) — block groups: site-blocking rules.
--
-- A group is a name, a list of domains and its triggers: block during a
-- focus phase and/or on a schedule (days of the week, `schedule_from` to
-- `schedule_to` in the Mac's own clock; `to <= from` runs past midnight and
-- belongs to its start day; `from = to` is 24 hours). `enabled` switches a
-- group off without deleting it. The dashboard edits the rows; the menu bar
-- app reads them and enforces them on the Mac by redirecting the active tab
-- of a supported browser. Nothing here stores a URL.
--
-- Domains are normalized by the client (`src/lib/blockRules.ts`): lowercase,
-- no scheme, path, port or leading `www.`. The check below is a coarse
-- character guard only (the space is the `array_to_string` separator); the
-- full rule is the client's and the shell's (`blocker.rs` `valid_domain`).
-- At most 50 domains per group; at most 20 groups is a client rule.
--
-- `schedule_days` uses JS `getDay()` numbering (0 = Sunday).
--
-- RLS: own rows only. Realtime publication + replica identity full per the
-- ARCH §4 rule for every user-scoped table (chunk-5 Bug A).
-- Applied via MCP `execute_sql` (chunk-64/89/98 precedent). Idempotent.

create table if not exists public.block_groups (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 40),
  domains text[] not null default '{}'
    check (cardinality(domains) <= 50
       and array_to_string(domains, ' ') ~ '^[a-z0-9. -]*$'),
  enabled boolean not null default true,
  block_in_focus boolean not null default true,
  block_on_schedule boolean not null default false,
  schedule_days smallint[] not null default '{1,2,3,4,5}'
    check (schedule_days <@ array[0,1,2,3,4,5,6]::smallint[]),
  schedule_from time not null default '09:00',
  schedule_to time not null default '17:00',
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists block_groups_user_idx
  on public.block_groups (user_id, sort_order);

drop trigger if exists block_groups_set_updated_at on public.block_groups;
create trigger block_groups_set_updated_at
  before update on public.block_groups
  for each row execute function public.set_updated_at();

alter table public.block_groups enable row level security;

drop policy if exists block_groups_select_own on public.block_groups;
drop policy if exists block_groups_insert_own on public.block_groups;
drop policy if exists block_groups_update_own on public.block_groups;
drop policy if exists block_groups_delete_own on public.block_groups;

create policy block_groups_select_own on public.block_groups
  for select using (auth.uid() = user_id);
create policy block_groups_insert_own on public.block_groups
  for insert with check (auth.uid() = user_id);
create policy block_groups_update_own on public.block_groups
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy block_groups_delete_own on public.block_groups
  for delete using (auth.uid() = user_id);

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'block_groups'
  ) then
    alter publication supabase_realtime add table public.block_groups;
  end if;
end $$;
alter table public.block_groups replica identity full;
