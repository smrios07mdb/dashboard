-- Row-Level Security: every table is owner-only. auth.uid() returns the
-- current user's UUID from the JWT; for service_role calls RLS is bypassed.
-- See ARCHITECTURE §4 ("RLS policies").

alter table public.categories         enable row level security;
alter table public.subcategories      enable row level security;
alter table public.tasks              enable row level security;
alter table public.routine_items      enable row level security;
alter table public.routine_logs       enable row level security;
alter table public.settings           enable row level security;
alter table public.push_subscriptions enable row level security;

-- categories
drop policy if exists categories_select_own on public.categories;
drop policy if exists categories_insert_own on public.categories;
drop policy if exists categories_update_own on public.categories;
drop policy if exists categories_delete_own on public.categories;

create policy categories_select_own on public.categories
  for select using (auth.uid() = user_id);
create policy categories_insert_own on public.categories
  for insert with check (auth.uid() = user_id);
create policy categories_update_own on public.categories
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy categories_delete_own on public.categories
  for delete using (auth.uid() = user_id);

-- subcategories
drop policy if exists subcategories_select_own on public.subcategories;
drop policy if exists subcategories_insert_own on public.subcategories;
drop policy if exists subcategories_update_own on public.subcategories;
drop policy if exists subcategories_delete_own on public.subcategories;

create policy subcategories_select_own on public.subcategories
  for select using (auth.uid() = user_id);
create policy subcategories_insert_own on public.subcategories
  for insert with check (auth.uid() = user_id);
create policy subcategories_update_own on public.subcategories
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy subcategories_delete_own on public.subcategories
  for delete using (auth.uid() = user_id);

-- tasks
drop policy if exists tasks_select_own on public.tasks;
drop policy if exists tasks_insert_own on public.tasks;
drop policy if exists tasks_update_own on public.tasks;
drop policy if exists tasks_delete_own on public.tasks;

create policy tasks_select_own on public.tasks
  for select using (auth.uid() = user_id);
create policy tasks_insert_own on public.tasks
  for insert with check (auth.uid() = user_id);
create policy tasks_update_own on public.tasks
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy tasks_delete_own on public.tasks
  for delete using (auth.uid() = user_id);

-- routine_items
drop policy if exists routine_items_select_own on public.routine_items;
drop policy if exists routine_items_insert_own on public.routine_items;
drop policy if exists routine_items_update_own on public.routine_items;
drop policy if exists routine_items_delete_own on public.routine_items;

create policy routine_items_select_own on public.routine_items
  for select using (auth.uid() = user_id);
create policy routine_items_insert_own on public.routine_items
  for insert with check (auth.uid() = user_id);
create policy routine_items_update_own on public.routine_items
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy routine_items_delete_own on public.routine_items
  for delete using (auth.uid() = user_id);

-- routine_logs
drop policy if exists routine_logs_select_own on public.routine_logs;
drop policy if exists routine_logs_insert_own on public.routine_logs;
drop policy if exists routine_logs_update_own on public.routine_logs;
drop policy if exists routine_logs_delete_own on public.routine_logs;

create policy routine_logs_select_own on public.routine_logs
  for select using (auth.uid() = user_id);
create policy routine_logs_insert_own on public.routine_logs
  for insert with check (auth.uid() = user_id);
create policy routine_logs_update_own on public.routine_logs
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy routine_logs_delete_own on public.routine_logs
  for delete using (auth.uid() = user_id);

-- settings (user_id is the primary key)
drop policy if exists settings_select_own on public.settings;
drop policy if exists settings_insert_own on public.settings;
drop policy if exists settings_update_own on public.settings;
drop policy if exists settings_delete_own on public.settings;

create policy settings_select_own on public.settings
  for select using (auth.uid() = user_id);
create policy settings_insert_own on public.settings
  for insert with check (auth.uid() = user_id);
create policy settings_update_own on public.settings
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy settings_delete_own on public.settings
  for delete using (auth.uid() = user_id);

-- push_subscriptions
drop policy if exists push_subscriptions_select_own on public.push_subscriptions;
drop policy if exists push_subscriptions_insert_own on public.push_subscriptions;
drop policy if exists push_subscriptions_update_own on public.push_subscriptions;
drop policy if exists push_subscriptions_delete_own on public.push_subscriptions;

create policy push_subscriptions_select_own on public.push_subscriptions
  for select using (auth.uid() = user_id);
create policy push_subscriptions_insert_own on public.push_subscriptions
  for insert with check (auth.uid() = user_id);
create policy push_subscriptions_update_own on public.push_subscriptions
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy push_subscriptions_delete_own on public.push_subscriptions
  for delete using (auth.uid() = user_id);
