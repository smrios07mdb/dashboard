-- Chunk 89 (ARCHITECTURE.md §4, §10 "General sorting") — routing proposals for
-- tasks sitting in a General list.
--
-- A Claude scheduled task reads open General tasks through the proxy
-- (`GET /api/route/inbox`) and writes proposals through it
-- (`POST /api/route/propose`, service role). Nothing moves until the user
-- reviews the proposals in the app's Sort General sheet and taps Approve,
-- which calls `apply_routing` below with the user's own session.
--
-- RLS: own rows for select / update; no insert or delete policy — inserts are
-- the proxy's (service role), deletes happen only by cascade. The table joins
-- the realtime publication with `replica identity full` (prompts/README
-- locked-subsystem rule), so the chip count refreshes live.
--
-- Applied via MCP `execute_sql` (chunk-33/35/37/62 precedent). Idempotent.

create table if not exists public.routing_proposals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  run_id uuid not null,
  task_id uuid not null references public.tasks(id) on delete cascade,
  from_subcategory_id uuid not null references public.subcategories(id) on delete cascade,
  to_subcategory_id uuid null references public.subcategories(id) on delete set null,
  new_list_name text null check (new_list_name is null or char_length(btrim(new_list_name)) between 1 and 40),
  new_list_category_id uuid null references public.categories(id) on delete cascade,
  reason text not null check (char_length(reason) between 1 and 280),
  status text not null default 'pending' check (status in ('pending','approved','kept','stale')),
  final_subcategory_id uuid null references public.subcategories(id) on delete set null,
  created_at timestamptz not null default now(),
  decided_at timestamptz null,
  check (not (to_subcategory_id is not null and new_list_name is not null)),
  check ((new_list_name is null) = (new_list_category_id is null))
);

create unique index if not exists routing_proposals_one_pending
  on public.routing_proposals (task_id) where status = 'pending';
create index if not exists routing_proposals_user_status
  on public.routing_proposals (user_id, status);

alter table public.routing_proposals enable row level security;

drop policy if exists routing_proposals_select_own on public.routing_proposals;
create policy routing_proposals_select_own on public.routing_proposals
  for select using (auth.uid() = user_id);
drop policy if exists routing_proposals_update_own on public.routing_proposals;
create policy routing_proposals_update_own on public.routing_proposals
  for update using (auth.uid() = user_id);
-- inserts: service role only (proxy).

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'routing_proposals'
  ) then
    alter publication supabase_realtime add table public.routing_proposals;
  end if;
end $$;
alter table public.routing_proposals replica identity full;

-- Approve = one call, one transaction (D7). security INVOKER: every read and
-- write runs under the caller's RLS. Any validation failure raises, so nothing
-- applies.
--
-- p = { new_lists: [{ key, name, category_id }],
--       items: [{ proposal_id, to: { subcategory_id } | { new_list_key } | null }] }
-- Returns { moved, kept, stale, created_lists }.
create or replace function public.apply_routing(p jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  nl jsonb;
  item jsonb;
  dest jsonb;
  keymap jsonb := '{}'::jsonb;
  nl_key text;
  nl_name text;
  nl_cat uuid;
  new_id uuid;
  pid uuid;
  prop public.routing_proposals%rowtype;
  t public.tasks%rowtype;
  target uuid;
  n_moved int := 0;
  n_kept int := 0;
  n_stale int := 0;
  n_created int := 0;
begin
  if uid is null then
    raise exception 'apply_routing: not authenticated' using errcode = '42501';
  end if;
  if p is null or jsonb_typeof(p) <> 'object' then
    raise exception 'apply_routing: payload must be an object' using errcode = '22023';
  end if;
  if jsonb_typeof(coalesce(p->'items', 'null'::jsonb)) <> 'array' then
    raise exception 'apply_routing: items must be an array' using errcode = '22023';
  end if;
  if p ? 'new_lists' and jsonb_typeof(p->'new_lists') not in ('array', 'null') then
    raise exception 'apply_routing: new_lists must be an array' using errcode = '22023';
  end if;

  -- 1. New lists, appended to the end of their category.
  for nl in select value from jsonb_array_elements(coalesce(nullif(p->'new_lists', 'null'::jsonb), '[]'::jsonb)) loop
    nl_key := nl->>'key';
    nl_name := btrim(coalesce(nl->>'name', ''));
    if nl_key is null or nl_key = '' or keymap ? nl_key then
      raise exception 'apply_routing: bad or duplicate new list key' using errcode = '22023';
    end if;
    if char_length(nl_name) not between 1 and 40 or lower(nl_name) = 'general' then
      raise exception 'apply_routing: bad new list name' using errcode = '22023';
    end if;
    begin
      nl_cat := (nl->>'category_id')::uuid;
    exception when others then
      raise exception 'apply_routing: bad category id' using errcode = '22023';
    end;
    if not exists (select 1 from public.categories c where c.id = nl_cat and c.user_id = uid) then
      raise exception 'apply_routing: unknown category' using errcode = '22023';
    end if;
    if exists (
      select 1 from public.subcategories s
      where s.user_id = uid and s.category_id = nl_cat and s.archived_at is null
        and lower(btrim(s.name)) = lower(nl_name)
    ) then
      raise exception 'apply_routing: a list with that name already exists' using errcode = '23505';
    end if;
    insert into public.subcategories (user_id, category_id, name, sort_order)
    values (
      uid, nl_cat, nl_name,
      coalesce((select max(s.sort_order) + 1 from public.subcategories s
                where s.user_id = uid and s.category_id = nl_cat), 0)
    )
    returning id into new_id;
    keymap := keymap || jsonb_build_object(nl_key, new_id);
    n_created := n_created + 1;
  end loop;

  -- 2 + 3. Each proposal: move (if the task is still open in its General
  -- list), keep, or stale.
  for item in select value from jsonb_array_elements(p->'items') loop
    begin
      pid := (item->>'proposal_id')::uuid;
    exception when others then
      raise exception 'apply_routing: bad proposal id' using errcode = '22023';
    end;
    select * into prop from public.routing_proposals r
      where r.id = pid and r.user_id = uid and r.status = 'pending'
      for update;
    if not found then
      raise exception 'apply_routing: proposal % is not pending', pid using errcode = '22023';
    end if;

    dest := item->'to';
    if dest is null or jsonb_typeof(dest) = 'null' then
      target := null;
    elsif jsonb_typeof(dest) = 'object' and dest ? 'subcategory_id' then
      begin
        target := (dest->>'subcategory_id')::uuid;
      exception when others then
        raise exception 'apply_routing: bad target id' using errcode = '22023';
      end;
      if not exists (
        select 1 from public.subcategories s
        where s.id = target and s.user_id = uid and s.archived_at is null
      ) then
        raise exception 'apply_routing: unknown target list' using errcode = '22023';
      end if;
    elsif jsonb_typeof(dest) = 'object' and dest ? 'new_list_key' then
      if not keymap ? (dest->>'new_list_key') then
        raise exception 'apply_routing: unknown new list key' using errcode = '22023';
      end if;
      target := (keymap->>(dest->>'new_list_key'))::uuid;
    else
      raise exception 'apply_routing: bad destination' using errcode = '22023';
    end if;

    select * into t from public.tasks x
      where x.id = prop.task_id and x.user_id = uid
      for update;

    if not found or t.completed_at is not null or t.subcategory_id <> prop.from_subcategory_id then
      update public.routing_proposals
        set status = 'stale', final_subcategory_id = t.subcategory_id, decided_at = now()
        where id = prop.id;
      n_stale := n_stale + 1;
    elsif target is null or target = prop.from_subcategory_id then
      update public.routing_proposals
        set status = 'kept', final_subcategory_id = prop.from_subcategory_id, decided_at = now()
        where id = prop.id;
      n_kept := n_kept + 1;
    else
      update public.tasks set subcategory_id = target where id = t.id;
      update public.routing_proposals
        set status = 'approved', final_subcategory_id = target, decided_at = now()
        where id = prop.id;
      n_moved := n_moved + 1;
    end if;
  end loop;

  -- D8: any other pending proposal whose task has left its General list or
  -- been completed is stale (hidden from the sheet already; not counted).
  update public.routing_proposals r
    set status = 'stale', final_subcategory_id = x.subcategory_id, decided_at = now()
    from public.tasks x
    where r.user_id = uid and r.status = 'pending' and x.id = r.task_id
      and (x.completed_at is not null or x.subcategory_id <> r.from_subcategory_id);

  return jsonb_build_object(
    'moved', n_moved, 'kept', n_kept, 'stale', n_stale, 'created_lists', n_created
  );
end;
$$;

revoke all on function public.apply_routing(jsonb) from public, anon;
grant execute on function public.apply_routing(jsonb) to authenticated;

notify pgrst, 'reload schema';
