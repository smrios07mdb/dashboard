-- Chunk 62 (Day-7 #3, ARCHITECTURE.md §10/§14) — Replace-import in one
-- server-side transaction.
--
-- Before this, Settings → Data → Replace ran seven client-side DELETEs and then
-- seven upserts, each its own PostgREST request. Any failure after the first
-- DELETE (a network drop, an FK the file does not satisfy, an RLS rejection)
-- left the account partly wiped. `import_replace` does the same teardown and
-- reinsert inside one function call, so PostgREST runs it in one transaction:
-- it either all lands or none of it does.
--
-- security INVOKER, deliberately (unlike `claim_due_reminders`): every DELETE
-- and INSERT below runs under the caller's RLS, so the function can never
-- touch another user's rows and a file carrying someone else's `user_id` fails
-- the insert policy and rolls the whole import back. `search_path = ''` with
-- every relation schema-qualified.
--
-- The client prepares the rows (strips `tasks.notes`, nulls
-- `scheduled_blocks.calendar_uid`, links notes, synthesizes legacy notes,
-- strips settings keys); this function trusts that shape and only re-strips the
-- settings keys it must never write. Keys a table does not have are ignored by
-- `jsonb_populate_recordset`; a column missing from a row is NULL (as with the
-- old supabase-js upsert), so a NOT NULL column absent from the file fails the
-- import — and now rolls it back.
--
-- Categories are never touched (stable infra seeded by the signup trigger).
-- Notes are deleted first so migration 16's detach-memo triggers have nothing
-- to stamp. No RLS / publication / replica-identity change. Applied via MCP
-- `execute_sql` (chunk-33/35/37 precedent). Idempotent.

create or replace function public.import_replace(p jsonb)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  s jsonb;
  sets text;
begin
  if uid is null then
    raise exception 'import_replace: not authenticated' using errcode = '42501';
  end if;
  if p is null or jsonb_typeof(p) <> 'object' then
    raise exception 'import_replace: payload must be an object' using errcode = '22023';
  end if;

  -- Teardown, children first.
  delete from public.notes              where user_id = uid;
  delete from public.scheduled_blocks   where user_id = uid;
  delete from public.tasks              where user_id = uid;
  delete from public.routine_logs       where user_id = uid;
  delete from public.subcategories      where user_id = uid;
  delete from public.routine_items      where user_id = uid;
  delete from public.push_subscriptions where user_id = uid;

  -- Reinsert, parents first.
  insert into public.subcategories
    select * from jsonb_populate_recordset(null::public.subcategories,    coalesce(p->'subcategories',    '[]'::jsonb));
  insert into public.tasks
    select * from jsonb_populate_recordset(null::public.tasks,            coalesce(p->'tasks',            '[]'::jsonb));
  insert into public.scheduled_blocks
    select * from jsonb_populate_recordset(null::public.scheduled_blocks, coalesce(p->'scheduled_blocks', '[]'::jsonb));
  insert into public.notes
    select * from jsonb_populate_recordset(null::public.notes,            coalesce(p->'notes',            '[]'::jsonb));
  insert into public.routine_items
    select * from jsonb_populate_recordset(null::public.routine_items,    coalesce(p->'routine_items',    '[]'::jsonb));
  insert into public.routine_logs
    select * from jsonb_populate_recordset(null::public.routine_logs,     coalesce(p->'routine_logs',     '[]'::jsonb));

  -- Settings: write only the keys the file carries, minus a denylist —
  -- credentials (export.ts CREDENTIAL_SETTINGS_KEYS) and server-held state
  -- (IMPORT_STRIPPED_SETTINGS_KEYS). A key the file omits keeps its live value,
  -- as the old `on conflict (user_id) do update` did; a key the table does not
  -- have is ignored. Denylist, not allowlist (ARCH §10), so a new settings
  -- column imports without editing this function.
  if jsonb_typeof(p->'settings') = 'object' then
    s := (p->'settings') - array[
      'user_id',
      'caldav_app_password_encrypted', 'ai_api_key_encrypted', 'outlook_ics_url_encrypted',
      'ai_api_key', 'ai_status', 'caldav_status', 'outlook_status'
    ];
    select string_agg(format('%I = r.%I', a.attname, a.attname), ', ')
      into sets
      from pg_catalog.pg_attribute a
     where a.attrelid = 'public.settings'::pg_catalog.regclass
       and a.attnum > 0 and not a.attisdropped
       and s ? a.attname;
    insert into public.settings (user_id) values (uid) on conflict (user_id) do nothing;
    if sets is not null then
      execute format(
        'update public.settings t set %s from pg_catalog.jsonb_populate_record(null::public.settings, $1) r where t.user_id = $2',
        sets
      ) using s, uid;
    end if;
  end if;
end;
$$;

revoke all on function public.import_replace(jsonb) from public, anon;
grant execute on function public.import_replace(jsonb) to authenticated;

notify pgrst, 'reload schema';
