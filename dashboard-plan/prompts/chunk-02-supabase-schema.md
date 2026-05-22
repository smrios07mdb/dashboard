# Chunk 2 — Supabase schema + RLS + signup trigger

**Goal:** Database with full schema, RLS on every table, and a signup trigger that seeds categories and settings.
**Dependencies:** Chunk 1.
**Effort:** ~3h.

> Reference `ARCHITECTURE.md` §4 (Data model) and §5 (Auth). Apply the schema **exactly as written there** — do not invent columns.

## What to build

Set up Supabase project structure inside the `dashboard` repo at `/supabase/`. Use the Supabase CLI.

### Migrations (in order)

Create migration files under `supabase/migrations/`. Each should be timestamped and idempotent where possible.

1. **`00_extensions.sql`** — `create extension if not exists pgcrypto;` (for `gen_random_uuid()`)

2. **`01_tables.sql`** — Create all tables exactly as in `ARCHITECTURE.md` §4:
   - `categories` (with check constraint `name in ('Work','Personal')`)
   - `subcategories`
   - `tasks` (must include `notified boolean not null default false`)
   - `routine_items`
   - `routine_logs` (with unique constraint on `(user_id, routine_item_id, date_key)`)
   - `settings` (PK is `user_id`, includes `caldav_*`, `timezone`, `caldav_status` with check constraint, `last_daily_reset`)
   - `push_subscriptions` (with unique constraint on `(user_id, endpoint)`)

3. **`02_updated_at_trigger.sql`** — Function `set_updated_at()` and trigger on `tasks` for `updated_at`.

4. **`03_rls.sql`** — Enable RLS on every table. For each table, four policies (select, insert, update, delete) keyed to `auth.uid() = user_id`. For `settings`, the same but on the PK.

5. **`04_signup_trigger.sql`** — Function `handle_new_user()` that runs `AFTER INSERT ON auth.users` and:
   ```sql
   INSERT INTO public.categories (user_id, name) VALUES (NEW.id, 'Work'), (NEW.id, 'Personal');
   INSERT INTO public.settings (user_id) VALUES (NEW.id);
   ```
   The function must be `SECURITY DEFINER` and explicitly set `search_path = public, pg_temp` to avoid RLS issues during seeding. Grant `usage` on schema and necessary permissions.

### Supabase config

- Configure `supabase/config.toml` for local dev with the right port.
- README at `supabase/README.md` covers:
  - How to create the Supabase project (via dashboard, not CLI — we use hosted)
  - How to link locally: `supabase link --project-ref <ref>`
  - How to apply migrations: `supabase db push`
  - Where each key goes:
    - **Anon key** → `dashboard/.env.local` as `VITE_SUPABASE_ANON_KEY` + GH Actions secret of same name
    - **Service role key** → password manager only; later added to Vercel env vars for the proxy
    - **Project URL** → `VITE_SUPABASE_URL` in both places
  - Required Supabase Auth → URL Configuration → Redirect URLs:
    - `http://localhost:5173/dashboard/`
    - `https://<your-github-username>.github.io/dashboard/` (or custom domain if used)
  - Both must be present or magic links break in one environment.

### Tests

Write a Vitest test file at `supabase/tests/schema.test.ts` (run separately from the React app tests) that:
- Uses the Supabase admin client (service role) to create a test user via `admin.createUser`
- Asserts that after creation, exactly two `categories` rows exist for that `user_id` ('Work' and 'Personal')
- Asserts that exactly one `settings` row exists for that `user_id`
- Asserts that a separate test user has zero rows in either table when querying as the first user (RLS check)
- Cleans up users after test

The test reads `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` from a `.env.test` file (gitignored).

## Files to create

```
supabase/config.toml
supabase/README.md
supabase/migrations/00_extensions.sql
supabase/migrations/01_tables.sql
supabase/migrations/02_updated_at_trigger.sql
supabase/migrations/03_rls.sql
supabase/migrations/04_signup_trigger.sql
supabase/tests/schema.test.ts
supabase/.env.test.example
```

## Acceptance criteria

- `supabase db push` against a fresh hosted project applies all migrations cleanly
- Creating a new auth user (via Supabase dashboard or admin client) results in exactly two categories and one settings row for that user
- Querying any table without a valid JWT returns rows = 0 (RLS works)
- The schema test passes

## Do NOT

- Touch the React app source code (no `src/` changes)
- Add columns not in `ARCHITECTURE.md` §4
- Use a per-table first-insert trigger (use the signup trigger on `auth.users`)

## How to test

1. Create a hosted Supabase project. Copy the URL, anon key, and service role key.
2. `supabase link --project-ref <ref>`
3. `supabase db push`
4. In the Supabase dashboard, Authentication → Users → Add user → confirm by email
5. Check the `categories` and `settings` tables — confirm seeded rows for that user
6. Add redirect URLs in Authentication → URL Configuration
7. Copy `.env.test.example` to `.env.test`, fill in values, `npm run test:supabase`
