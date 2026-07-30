-- Chunk 33 (ARCHITECTURE.md §4) — priority value constraint.
--
-- `tasks.priority` shipped in 01_tables.sql as a bare nullable int. The
-- planner series (chunks 33+) gives it canonical semantics: 1 / 2 / 3
-- (P1 Urgent, P2 Soon, P3 Whenever) or null = no priority set. This check
-- pins the column to that domain.
--
-- No backfill: existing rows are null or already 1 from earlier manual
-- use; both pass the check as-is. Null is a meaningful state (renders no
-- chip, sorts after P3) — never coerce it to 3.

alter table public.tasks
  add constraint tasks_priority_check
  check (priority is null or priority in (1, 2, 3));
