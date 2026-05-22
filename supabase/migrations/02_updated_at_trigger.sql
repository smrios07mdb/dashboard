-- Keep tasks.updated_at fresh on every UPDATE.
-- The architecture only specifies updated_at on tasks; routine_items has its own
-- created_at and no updated_at column, so no trigger is needed there.

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists tasks_set_updated_at on public.tasks;

create trigger tasks_set_updated_at
  before update on public.tasks
  for each row execute function public.set_updated_at();
