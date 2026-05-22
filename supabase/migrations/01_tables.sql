-- Schema: see ARCHITECTURE.md §4 (canonical). Columns must match exactly.
-- All user-owned rows reference auth.users(id) and cascade on user deletion.

create table if not exists public.categories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (name in ('Work', 'Personal'))
);

create table if not exists public.subcategories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  category_id uuid not null references public.categories(id) on delete cascade,
  name text not null,
  sort_order int not null default 0,
  archived_at timestamptz null
);

create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  subcategory_id uuid not null references public.subcategories(id) on delete restrict,
  title text not null,
  notes text,
  estimate_minutes int not null default 0,
  due_at timestamptz,
  remind_at timestamptz,
  notified boolean not null default false,
  priority int,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.routine_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  routine text not null check (routine in ('morning', 'night')),
  label text not null,
  sort_order int not null default 0,
  archived_at timestamptz null,
  created_at timestamptz not null default now()
);

create table if not exists public.routine_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  routine_item_id uuid not null references public.routine_items(id) on delete cascade,
  date_key date not null,
  completed boolean not null default true,
  unique (user_id, routine_item_id, date_key)
);

-- settings has user_id as primary key (no separate id column) per ARCHITECTURE §4.
create table if not exists public.settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  ai_api_key text,
  caldav_apple_id text,
  caldav_app_password_encrypted bytea,
  caldav_calendar_url text,
  caldav_status text not null default 'unconfigured'
    check (caldav_status in ('unconfigured', 'ok', 'auth_failed')),
  timezone text not null default 'America/New_York',
  last_daily_reset date
);

create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now(),
  unique (user_id, endpoint)
);
