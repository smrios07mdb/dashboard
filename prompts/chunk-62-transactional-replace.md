# Chunk 62: Replace-import runs in one server-side transaction

**Runs on:** Claude Code, in `~/Documents/To-Do Dashboard` on Sergio's Mac (repo `smrios07mdb/dashboard`). One migration (applied by you via Supabase MCP `execute_sql` on `dctfspcbkqvvyptddtif`), app code, no proxy change.

**Bases:**
- App `smrios07mdb/dashboard` @ `50b50ec` (docs). Last code commit `61d65e7` (chunk 61), which is what's live.
- Proxy untouched.
- Latest migration on disk: `18_drop_tasks_notes.sql`.

**Authority:** `ARCHITECTURE.md` → `prompts/README.md` → this prompt. Read `CLAUDE.md`, `src/lib/import.ts`, `src/lib/import.test.ts`, `src/lib/export.ts`, `repo.data` in `src/db/repo.ts` (≈ line 1365 on), `onConfirmImport` in `src/screens/Settings.tsx` (≈ line 1355), `supabase/migrations/06_claim_due_reminders.sql` (the one RPC precedent) and ARCHITECTURE §4 "Notes" / "Export/import (chunk 50)" and §10 "Settings in export/import" / "Legacy task notes in export/import" first.

**Scope:** PROGRESS Revisions → Day-7 backlog item **3** (transactional Replace via Postgres RPC). Merge is **not** in scope.

---

## The defect, as committed at `50b50ec`

`replaceAll` in `src/lib/import.ts` runs seven `repo.data.bulkDeleteAllForUser` calls (notes → scheduled_blocks → tasks → routine_logs → subcategories → routine_items → push_subscriptions), then `upsertContent`, which issues up to two live reads (`existingIds`, `noteBodiesForTasks`) and seven `bulkUpsert` calls. Every call is its own PostgREST request and its own transaction. Anything that fails after the first delete — a dropped connection, an FK the file does not satisfy, an RLS rejection, a NOT NULL column missing from a row — leaves the account partly wiped. `validateImport` (R4) only checks shape and string ids; the comment above its row gate already defers "full FK / NOT NULL integrity" to this revision. Settings' failure toast says it outright: *"Replace failed partway — some data may not have imported."*

Baseline reproduced by the orchestrator at `50b50ec` (fresh clone, Node 22, clean `npm ci`, placeholder env except the real `VITE_CALDAV_PROXY_URL`): `src/lib/import.test.ts` **40 / 40**, full suite **800 / 800** (72 files, per row 61), build green, eager JS **1,024,683 B** on the orchestrator's build.

The migration below was proven by the orchestrator on a throwaway local Postgres 16 with migrations 01–03, 08–10, 12–16 and 18 applied, a stub `auth.uid()` and `authenticated` / `anon` roles: a file whose task names a subcategory not in the file → `23503`, every table's counts and the settings row unchanged; a subcategory row carrying another user's `user_id` → RLS `42501`, unchanged; `anon` → `permission denied for function import_replace`; a good file → all six tables replaced, the other user's rows untouched, `timezone` imported, `caldav_app_password_encrypted` and `caldav_status` left at their live values, an unknown settings key and a legacy `tasks.notes` key ignored, no detach memo written, `tasks.updated_at` kept as the file had it; applying the file twice is a no-op.

---

## Locked decisions

### D1 Migration 19: `public.import_replace(p jsonb)` — one call, one transaction

Create `supabase/migrations/19_import_replace.sql` with exactly this content:

```sql
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
```

- **Security invoker** is the point, not an oversight — do not switch it to `security definer`. RLS stays the only thing that decides whose rows the function may touch.
- `revoke … from public, anon` is required on Supabase: default privileges grant `execute` on new `public` functions to `anon` as well as `authenticated`, so revoking from `public` alone leaves `anon` able to call it.
- `notify pgrst, 'reload schema'` makes the RPC visible to PostgREST without waiting for a cache refresh.

### D2 `repo.data.importReplace` (new)

In `dataRepo` in `src/db/repo.ts`, after `bulkDeleteAllForUser`:

```ts
/**
 * Replace-import in one server-side transaction (chunk 62, migration 19).
 * Either every table is replaced or nothing changed. Online-only, like the
 * rest of `repo.data`; throws on any error.
 */
async importReplace(payload: Record<string, unknown>): Promise<void> {
  const { error } = await supabase.rpc('import_replace', { p: payload })
  throwIfClientError(error as SupabaseError | null)
},
```

`bulkDeleteAllForUser` stays: "Wipe my data" (`DeveloperSection`) and anything else that calls it are not touched. Grep its callers and report them.

### D3 `src/lib/import.ts`: Replace builds the payload in memory, then makes one call

- New exported pure function `buildReplacePayload(payload: ExportPayload): Record<string, unknown>` — no network, no Dexie. It returns `{ subcategories, tasks, scheduled_blocks, notes, routine_items, routine_logs, settings }` with exactly the transformations Replace applies today:
  - `tasks`: each row without `notes` (chunk 59 D3).
  - `scheduled_blocks`: each row with `calendar_uid: null` (chunk 50 D16).
  - `notes`: the file's notes with links resolved against **the file only** — a `task_id` / `subcategory_id` not among the file's own task / subcategory ids becomes `null`, `detached_label` / `detached_at` as the file has them — followed by the legacy-`tasks.notes` notes, deduped against the file's notes only. This is not a behaviour change: today these two steps run *after* the teardown, so the live reads (`existingIds`, `noteBodiesForTasks`) can only ever find rows the file itself just wrote. Replace now makes **no** live read.
  - `routine_items`, `routine_logs`: as in the file.
  - `settings`: the file's settings minus `CREDENTIAL_SETTINGS_KEYS` and `IMPORT_STRIPPED_SETTINGS_KEYS` (the client strip stays; the server strip in D1 is defence in depth), or `null` when the file has none.
  - Never mutates the caller's object.
- Factor the note-linking and legacy-note synthesis so Replace (file-only, synchronous) and Merge (file + live reads, as today) share one implementation. **Merge's network calls, their order and their arguments are unchanged.** Every existing `merge` test passes **unmodified**.
- `replaceAll(payload, userId)` becomes: `await repo.data.importReplace(buildReplacePayload(payload))`, then — only after it resolves — `await db.outbox.clear()` and `await wipeLocalCache()`. If the RPC throws, the error propagates and **neither** runs: the account is as it was, so the queued outbox and the cache are still valid. Keep the `userId` parameter (callers pass it; the server uses `auth.uid()`); prefix it `_userId` if lint asks.
- Update the comment above the row-level gate in `validateImport`: FK / NOT NULL integrity is no longer deferred — a file that violates them fails inside the RPC and changes nothing. Update the file's header comment (R4) to say Replace is atomic.

### D4 Settings: the Replace failure toast tells the truth

In `onConfirmImport`, the Replace branch of the error toast becomes:

> `Replace failed — nothing was changed.`

The Merge branch (`Could not import — retry`), the success toasts and `console.error('Import failed', e)` stay as they are.

### D5 What does not change

- Merge (`mergeAll`, `upsertContent`'s Merge path, its live reads, conflict keys `id` / `task_id` / `user_id`). Merge is non-destructive; making it transactional is not this chunk.
- `validateImport`, `previewCounts`, `EXPORT_VERSION` (stays `1`), the export, `ImportValidationError` and the R4 gate (a bad file still throws before any network call).
- Categories are never deleted or written. Replace still deletes `push_subscriptions` (unchanged; the success toast already says so).
- `DeveloperSection` "Wipe my data", "Wipe local cache", the outbox, Dexie (no version bump), realtime, RLS policies.
- No new dependency; `package.json` / `package-lock.json` unchanged. No proxy change.

### D6 Tests

In `src/lib/import.test.ts` add `importReplace: vi.fn<(payload: Record<string, unknown>) => Promise<void>>(() => Promise.resolve())` to the hoisted mocks and to the `repo.data` mock. Then:

1. **Replace makes one call.** `importData(validPayload(), 'replace', 'u1')` calls `importReplace` exactly once and calls `bulkDeleteAllForUser`, `bulkUpsert`, `existingIds` and `noteBodiesForTasks` **zero** times; `outboxClear` and `wipeLocalCacheMock` once each, both after `importReplace` (`invocationCallOrder`).
2. **A failed Replace changes nothing locally.** `importReplace` rejecting → `importData` rejects with that error; `outboxClear` and `wipeLocalCacheMock` **not** called.
3. **R4 still holds.** A bad file (`version: 99`) in Replace → `ImportValidationError`; `importReplace` not called.
4. **The payload.** From one `buildReplacePayload` call: task rows carry no `notes` key; every block's `calendar_uid` is `null`; a note whose `task_id` / `subcategory_id` is not in the file has it `null` while one that is in the file keeps it; a legacy `tasks.notes` value becomes one untitled note on its task with the task's timestamps, and none when the file already has a note with that task and trimmed body; `settings` carries none of the seven stripped keys and keeps `timezone`; the input object is unchanged (deep-equal to a `structuredClone` taken before).
5. **The migration's denylist matches `export.ts`.** Import `supabase/migrations/19_import_replace.sql` with Vite's `?raw` suffix and assert every key in `CREDENTIAL_SETTINGS_KEYS` and `IMPORT_STRIPPED_SETTINGS_KEYS` appears as `'<key>'` inside the `s := (p->'settings') - array[ … ]` block. `?raw` is already typed by `vite/client` (`src/vite-env.d.ts`, `tsconfig.app.json` `types`); the orchestrator confirmed the import resolves and passes under `vitest run` and `tsc -b`. Add no declaration.

Existing Replace-mode tests (`replace mode`, the Replace halves of the chunk-16 / chunk-56 settings tests, chunk 50's Replace + round-trip, chunk 58's Replace notes test, chunk 59's legacy-notes tests where they run Replace): rewrite **only** what they read — from `bulkDeleteAllForUser` / `bulkUpsert` calls to the payload passed to `importReplace` — keeping each test's assertion about the data. Delete an assertion only where it is about the old request sequence (e.g. "every delete precedes every upsert"); list each one you delete. Every `merge` test and every `validateImport` / `previewCounts` test passes unmodified.

In `src/screens/Settings.test.tsx`, one test: with `@/lib/import`'s `importData` mocked to reject, a confirmed Replace shows `Replace failed — nothing was changed.` (mock only that module; follow the file's existing `vi.mock` pattern).

**Red-first:** run tests 1, 2 and the Settings test against `50b50ec`'s `src/lib/import.ts`, `src/db/repo.ts` and `src/screens/Settings.tsx` (keep the new tests) and report the failing lines.

### D7 Order and commit routing

- **Migration first, then the app.** The live app at `61d65e7` never calls `import_replace`, so the function can exist before the client that uses it; the reverse order would break Replace for the time between push and apply.
- **One code commit**, pushed **alone**, **no `[skip ci]`** (`dist/` changes): the migration file, `src/db/repo.ts`, `src/lib/import.ts`, `src/lib/import.test.ts`, `src/screens/Settings.tsx`, `src/screens/Settings.test.tsx`. Subject: `Chunk 62: Replace-import in one transaction via import_replace RPC (Day-7 #3)`.
- Gates before the push, on a clean `npm ci`: `tsc -b` clean; `eslint .` 0 problems; `vitest run` all green (800 + the new tests — exact test and file count); `npm run build` green.
- Eager JS before (at `50b50ec`) and after, on your machine. Limit **+10 kB**.
- After the push: deploy run id and result; live `version.json` read cache-busted.

---

## Sequence

### 1. Migration 19 (Supabase MCP `execute_sql`, project `dctfspcbkqvvyptddtif`)

```bash
cd ~/Documents/To-Do\ Dashboard
git fetch origin
git checkout main
git pull --ff-only origin main
git log -1 --oneline
```

Expect `50b50ec`. If `main` is anywhere else, stop and report.

Write `supabase/migrations/19_import_replace.sql` with the D1 content verbatim. Send the file's contents through `execute_sql`. A transient `Invalid or expired requestState` has happened before (chunks 58, 60) — re-send; the file is idempotent. Then run each and report the rows:

```sql
select p.proname, p.prosecdef, p.proconfig, pg_get_function_identity_arguments(p.oid) as args
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'import_replace';
```

Expect one row: `prosecdef = false`, `proconfig = {search_path=""}`, `args = p jsonb`.

```sql
select has_function_privilege('anon', 'public.import_replace(jsonb)', 'execute') as anon_exec,
       has_function_privilege('authenticated', 'public.import_replace(jsonb)', 'execute') as auth_exec;
```

Expect `false`, `true`.

```sql
select column_name from information_schema.columns
where table_schema = 'public' and table_name = 'settings' order by ordinal_position;
```

Report the list (it is the set the denylist is checked against). If it contains a secret-shaped column that is not in the denylist, stop and report before step 2.

Do **not** call `import_replace` against the live database. The live proof is the orchestrator's smoke.

### 2. Code (D2–D7)

```bash
rm -rf node_modules
npm ci
npm run build
python3 -c "import re,os;h=open('dist/index.html').read();f=set(re.findall(r'(?:src|href)=\"/dashboard/(assets/[^\"]+\.js)\"',h));print(len(f),sum(os.path.getsize('dist/'+x) for x in f))"
```

Record that eager-JS figure as the base. Make the D2–D4 edits and the D6 tests. Then:

```bash
npx tsc -b
npx eslint .
npx vitest run
npm run build
python3 -c "import re,os;h=open('dist/index.html').read();f=set(re.findall(r'(?:src|href)=\"/dashboard/(assets/[^\"]+\.js)\"',h));print(len(f),sum(os.path.getsize('dist/'+x) for x in f))"
git diff --stat 50b50ec -- package.json package-lock.json
grep -rn "bulkDeleteAllForUser" src --include=*.ts --include=*.tsx
git add supabase/migrations/19_import_replace.sql src/db/repo.ts src/lib/import.ts src/lib/import.test.ts src/screens/Settings.tsx src/screens/Settings.test.tsx
git status --short
git commit
git push origin main
```

The commit body lists D1–D5 in one line each and ends with the `Co-Authored-By` trailer per `CLAUDE.md`. `git status --short` must show nothing else staged; anything unexpected, stop and report.

**Stop after the push and report.** Do not start step 4.

### 3. Smoke

The orchestrator runs this on the deployed app in Sergio's Chrome. **Not you.**

It covers: a full export downloaded first as the restore point, with live per-table counts read by REST; a **failing** Replace — that export plus one task whose `subcategory_id` is in neither the file nor the DB — shows `Replace failed — nothing was changed.`, logs `Import failed` with code `23503` (not a 413 or a network error, so the full-size payload reached Postgres), and leaves every table's count, the settings row (`caldav_status`, `ai_status`, `planner_writeout`, `timezone`), the push subscription and the outbox exactly as they were; `anon` calling `POST /rest/v1/rpc/import_replace` is refused; console otherwise clean. A successful Replace on the real account is **not** run by default: it deletes the iPhone push subscription and re-mirrors every planner block to Apple Calendar (chunk 50 D16). The success path is covered by the D6 tests and the orchestrator's local-Postgres proof; the operator may opt in to a live round-trip separately.

### 4. Docs (`[skip ci]`, after the orchestrator's smoke passes)

**`ARCHITECTURE.md`**

- §10 "Settings in export/import": add that on Replace the strip is applied twice — by the client and, as defence in depth, by `import_replace`'s own denylist — and that a test pins the two lists together.
- §10, new paragraph **Replace is one transaction (chunk 62).** Replace builds the whole payload in memory (no live reads) and sends it to `public.import_replace(jsonb)` (migration 19), which deletes and reinserts the six content tables and overlays settings in one PostgREST call: all of it lands or none of it does. `security invoker`, so RLS decides whose rows it touches and a foreign `user_id` rolls the import back. The outbox is cleared and the cache wiped only after it succeeds. Merge stays a sequence of upserts (non-destructive).
- §4 "Export/import (chunk 50)" and "Notes (chunk 58)": where they describe Replace's delete/insert order, say it now happens inside `import_replace`; the order is unchanged.
- §14 risk table: the "clearing site data" row is unchanged; if a Replace-specific risk row exists, update it; do not invent one.

**`PROGRESS.md`**

- Row 62 ☑: migration-apply evidence (the three query results), the step-2 SHA, gates, red-first lines, test count and file count, eager JS before/after, deploy run, live `version.json`, the `bulkDeleteAllForUser` callers, the smoke result, deviations numbered.
- Day-7 backlog: item 3 → ☑ with `(done: chunk 62, <SHA> — Replace runs in import_replace (migration 19); Merge unchanged.)`; the status line becomes **6 done, 1 moot, 4 open** with the chunk-62 date.
- Decisions log: D1–D5 (2026-10-13, chunk 62), one row each.
- Last-updated paragraph per the chunk-54 convention; the current chunk-61 paragraph moves to Update history, relabelled `Prior update:` (prefix only).

Commit this prompt as `prompts/chunk-62-transactional-replace.md` in the same commit. A commit cannot carry its own SHA: if row 62 must name the docs SHA, record it in an immediate `[skip ci]` follow-up (chunk-54 convention).

---

## Out of scope

- Merge atomicity.
- Day-7 items 4, 9, 10, 11.
- "Wipe my data" through an RPC.
- Changing what Replace deletes (`push_subscriptions` stays in the teardown) or what export writes.
- A Settings UI change beyond the D4 toast string.
- Running `import_replace` against the live database from your session.

## Report back

- **Step 1:** the three query results; any `execute_sql` retries.
- **Step 2:** commit SHA; `git diff --stat 50b50ec <SHA>`; gates (`tsc -b`, `eslint .`, test count and file count, build); red-first failing lines for D6 tests 1, 2 and the Settings test; every existing assertion deleted from `import.test.ts`, by test name; the `bulkDeleteAllForUser` grep; eager JS before / after / delta; the empty `package.json` diff; deploy run id and result; live `version.json`.
- Every deviation, numbered.
