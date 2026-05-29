-- Chunk 14 (ARCHITECTURE.md §9) — client-side race-safe reminder claim.
--
-- The in-app fallback (src/lib/inAppReminders.ts) calls this RPC every 60s
-- while a tab is open. It is a CONDITIONAL UPDATE that flips `notified`
-- false -> true and RETURNS only the rows it actually claimed, so it is
-- mutually exclusive with the notify-due-reminders Edge Function's per-row
-- claim: whoever wins a row is the one that notifies it. Exactly-once.
--
-- security definer + auth.uid() scoping: the body runs with the owner's
-- rights but only ever touches the CALLING user's rows. search_path is pinned
-- so the definer-rights body can't be hijacked via a mutable search_path.
--
-- Numbered 06 because 05 is already 05_realtime.sql. The chunk-14 prompt's
-- "05_claim_due_reminders.sql" predates that migration; see the chunk-14 brief
-- (resolution 8). Migrations are append-only — never edit an applied one.

create or replace function public.claim_due_reminders()
returns table (id uuid, title text)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
    update public.tasks t
      set notified = true
    where t.user_id = auth.uid()
      and t.remind_at < now()
      and t.notified = false
      and t.completed_at is null
    returning t.id, t.title;
end;
$$;

revoke all on function public.claim_due_reminders() from public;
grant execute on function public.claim_due_reminders() to authenticated;
