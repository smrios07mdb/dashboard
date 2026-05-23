# Supabase

Schema, RLS policies, signup trigger, and the schema test live here. We use **hosted Supabase** (not local) as the source of truth; this directory is the CLI-controlled definition of that hosted database.

See [`../ARCHITECTURE.md`](../ARCHITECTURE.md) §4 (Data model) and §5 (Auth) for the canonical reference.

## One-time project setup

1. **Create the project** in the [Supabase dashboard](https://supabase.com/dashboard) (not the CLI — we want the hosted instance).
   - Pick a name (e.g. `dashboard`) and the region nearest you.
   - Wait for provisioning to finish.

2. **Grab three values** from Settings → API:
   | Value | Goes to |
   |---|---|
   | Project URL | `dashboard/.env.local` as `VITE_SUPABASE_URL` **and** a GitHub Actions secret of the same name. |
   | `anon` (public) key | `dashboard/.env.local` as `VITE_SUPABASE_ANON_KEY` **and** the matching GH Actions secret. |
   | `service_role` (secret) key | **Password manager only.** Never commit. Later added to the CalDAV proxy's Vercel env vars (chunk 12). |

3. **Link this folder to the hosted project** so `supabase db push` knows where to apply migrations:
   ```sh
   npx supabase login                      # browser opens; one-time
   npx supabase link --project-ref <ref>   # <ref> is the slug from Settings → General → Reference ID
   ```

4. **Apply the migrations:**
   ```sh
   npx supabase db push
   ```
   This applies `migrations/00_extensions.sql` through `04_signup_trigger.sql` in order. Re-running is safe — every migration is idempotent.

5. **Configure auth redirect URLs** in the Supabase dashboard → Authentication → URL Configuration. Add **both**, or magic links break in one environment:
   - `http://localhost:5173/dashboard/`
   - `https://<github-user>.github.io/dashboard/` *(your deployed GitHub Pages URL; the trailing slash matters)*
   - If you set up a custom domain for the app, add that one too.

6. **Add a test user** to verify the signup trigger:
   - Authentication → Users → "Add user" → enter an email → check "Auto Confirm User".
   - Then in Table editor, open `categories` — there should be two rows for that user (`Work`, `Personal`).
   - Open `settings` — there should be exactly one row keyed to that user.

## Schema test

The Vitest-based schema test verifies the signup trigger seeds correctly **and** that RLS hides one user's data from another.

```sh
cp supabase/.env.test.example supabase/.env.test   # fill in URL + both keys
npm run test:supabase
```

The test creates two throwaway users via the admin client, asserts seeding, then signs in as user B and confirms they cannot read user A's rows. Users are deleted in `afterAll`. The test is safe to run against the production project, but it does briefly create real auth rows — run sparingly.

> **Note on env vars:** ARCHITECTURE only declares `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` as needed for tests, but RLS verification requires a non-service-role client (service_role *bypasses* RLS). The test therefore also reads `SUPABASE_ANON_KEY`. It's a public value — same one shipped to the browser via `VITE_SUPABASE_ANON_KEY`.

## File map

```
config.toml                      Local supabase stack config (only matters for `supabase start`).
README.md                        This file.
.env.test.example                Template for schema test env. Copy to .env.test (gitignored).
migrations/
  00_extensions.sql              pgcrypto for gen_random_uuid().
  01_tables.sql                  All seven tables, exactly as ARCHITECTURE §4 specifies.
  02_updated_at_trigger.sql      set_updated_at() function + tasks_set_updated_at trigger.
  03_rls.sql                     RLS enabled on every table; 4 owner-only policies each.
  04_signup_trigger.sql          handle_new_user() seeds categories + settings on auth.users insert.
tests/
  vitest.config.ts               Separate vitest config (node env, .env.test loader).
  schema.test.ts                 Seeding + RLS assertions.
```

## When you change the schema later

1. Edit or add a SQL file under `migrations/`.
2. `npx supabase db push` — applies the new files.
3. `npm run test:supabase` — verifies nothing regressed.
4. Commit the new migration file. Migrations are append-only — never edit an applied migration; write a new one that alters it.

## Migration naming
This project uses numeric prefixes (`00_extensions.sql`, `01_tables.sql`, …) rather than the Supabase CLI's default timestamp format (`20260521210000_…`). Both sort lexicographically, so `supabase db push` handles either.

**Do not run `supabase migration new <name>`** — it injects a timestamp prefix and breaks the convention. Create new migration files by hand:

    supabase/migrations/05_<descriptive_name>.sql

Increment the numeric prefix from the highest existing one. Chunk 14 already calls for an `05_claim_due_reminders.sql`; chunk 14's own prompt should be followed verbatim.
