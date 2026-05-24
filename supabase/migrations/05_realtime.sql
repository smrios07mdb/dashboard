-- Realtime publication + replica identity for all user-scoped tables.
--
-- Without this migration, Supabase's realtime service never broadcasts
-- postgres_changes events for these tables, so the chunk-5
-- src/db/realtime.ts subscriptions sit idle forever and chunk-7's
-- cross-device "changes appear within a few seconds" acceptance
-- criterion fails. Manual refresh works because that path goes through
-- repo.list() which hits the REST API directly, not realtime.
--
-- REPLICA IDENTITY FULL is required so DELETE events include every
-- column (not just the primary key). Our realtime subscriptions filter
-- on user_id=eq.<userId>; without FULL, the DELETE old row only
-- carries the PK, so Supabase realtime's RLS check can't determine
-- ownership and drops the event.
--
-- This was a chunk-5 oversight that didn't surface until chunk-7
-- exercised the cross-device path end-to-end — see Bug A in the
-- PROGRESS.md Revisions log.

alter publication supabase_realtime add table public.categories;
alter publication supabase_realtime add table public.subcategories;
alter publication supabase_realtime add table public.tasks;
alter publication supabase_realtime add table public.routine_items;
alter publication supabase_realtime add table public.routine_logs;
alter publication supabase_realtime add table public.settings;
alter publication supabase_realtime add table public.push_subscriptions;

alter table public.categories replica identity full;
alter table public.subcategories replica identity full;
alter table public.tasks replica identity full;
alter table public.routine_items replica identity full;
alter table public.routine_logs replica identity full;
alter table public.settings replica identity full;
alter table public.push_subscriptions replica identity full;
