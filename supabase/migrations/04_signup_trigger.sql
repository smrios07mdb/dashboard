-- Signup trigger: when Supabase Auth inserts a new row into auth.users,
-- seed the two Work/Personal categories and the per-user settings row.
-- See ARCHITECTURE §4 ("Signup trigger") and §5 (Auth).
--
-- SECURITY DEFINER: function body runs as the function owner (postgres),
-- which bypasses RLS for the seed inserts. Without this, the supabase_auth_admin
-- role firing the trigger would be rejected by our row-level policies.
--
-- SET search_path = public, pg_temp: locks the search path so an attacker can't
-- shadow `categories` or `settings` with a malicious temp object.

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.categories (user_id, name)
  values (new.id, 'Work'), (new.id, 'Personal');

  insert into public.settings (user_id) values (new.id);

  return new;
end;
$$;

-- Auth signup fires as the supabase_auth_admin role; give it the privileges
-- needed to reach the (SECURITY DEFINER) function.
grant usage on schema public to supabase_auth_admin;
grant execute on function public.handle_new_user() to supabase_auth_admin;

drop trigger if exists on_auth_user_created on auth.users;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
