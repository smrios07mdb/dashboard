-- Chunk 100: a daily time allowance per block group (ARCHITECTURE.md §4,
-- "Block groups"). `daily_limit_on` switches it; `daily_limit_minutes` is
-- the allowance, 1–1440 minutes a day, shared by the group's sites. The
-- menu bar app counts and enforces it on the Mac (§16, "Site blocking").
-- Idempotent.

alter table public.block_groups
  add column if not exists daily_limit_on boolean not null default false,
  add column if not exists daily_limit_minutes smallint not null default 30;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'block_groups_daily_limit_minutes_check') then
    alter table public.block_groups add constraint block_groups_daily_limit_minutes_check
      check (daily_limit_minutes between 1 and 1440);
  end if;
end $$;
