# Chunk 60: Drop `tasks.notes`

**Runs on:** Claude Code, in `~/Documents/To-Do Dashboard` on Sergio's Mac (repo `smrios07mdb/dashboard`). SQL runs on Supabase project `dctfspcbkqvvyptddtif` through the Supabase MCP `execute_sql` tool. If you have no Supabase MCP, stop and report.

**Bases:**
- App `smrios07mdb/dashboard` @ `6db827e` (docs). Last code commit `0fa7f0c` (59a), which is what's live.
- Proxy untouched. It never reads `tasks.notes` (confirmed in chunk 59).

**Authority:** `ARCHITECTURE.md` → `prompts/README.md` → this prompt. Read `CLAUDE.md`, `prompts/chunk-59-notebook-task-side.md` and `supabase/migrations/17_copy_task_notes.sql` first. Chunk 59's D1–D9 still hold.

---

## Why no app deploy

The client already stopped naming the column in chunk 59, and that was verified at `6db827e`:

- `taskToRow` (`src/db/mappers.ts`) is a field whitelist with no `notes`. So a pre-59 outbox payload that still carries `notes` replays without it (`outbox.ts` runs every payload back through `taskToRow`).
- `import.ts` `upsertContent` deletes `notes` from every task row before the upsert, and `legacyTaskNotes` turns legacy values into notes. Both must **stay**, because pre-60 export files keep carrying the field forever.
- `export.ts` uses `select('*')`, so exports simply stop carrying the field once it is dropped.
- The Edge Function `notify-due-reminders` selects `id, user_id, title, subcategory_id`; `claim_due_reminders` returns `(id, title)`.

So this chunk is a migration, one stale comment, one test and docs. Nothing that changes `dist/`.

**Accepted risk:** a client still running a pre-59 build would get a 400 on task inserts and edits after the drop, because its `taskToRow` emitted `notes`. Its service worker updates on the next launch. Writes that failed in between sit in Settings → Sync issues, and **Retry** replays them through the new `taskToRow` and succeeds. Only a `notes` edit made on such a client after the step-2 copy would be lost. Chunk 59 measured 0 legacy notes in the DB, so this is accepted. No operator step is required for it.

---

## Locked decisions

### D1 Migration 18: copy, verify and drop in one transaction

Create `supabase/migrations/18_drop_tasks_notes.sql`. Use a header in the migration-15/17 style that records:

- why it re-runs migration 17's insert (it catches a write from a stale pre-59 client);
- why the copy and the drop share one transaction and a table lock (no write can land between them);
- that `drop column` uses no `cascade` (a dependency should fail loudly);
- that migration 17 must **never** be re-run after this one, because it names a column that no longer exists. Migration 17 itself is **not edited**; historical migrations never are.

The body, verbatim:

```sql
do $$
declare
  gap integer;
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'tasks' and column_name = 'notes'
  ) then
    raise notice 'migration 18: tasks.notes already dropped, nothing to do';
    return;
  end if;

  -- No task write can land between the copy and the drop.
  lock table public.tasks in share row exclusive mode;

  -- Migration 17's insert, unchanged.
  insert into public.notes (user_id, title, body, task_id, created_at, updated_at)
  select t.user_id, '', t.notes, t.id, t.created_at, t.updated_at
  from public.tasks t
  where t.notes is not null
    and btrim(t.notes) <> ''
    and not exists (
      select 1 from public.notes n
      where n.task_id = t.id and btrim(n.body) = btrim(t.notes)
    );

  select count(*) into gap
  from public.tasks t
  where t.notes is not null
    and btrim(t.notes) <> ''
    and not exists (
      select 1 from public.notes n
      where n.task_id = t.id and btrim(n.body) = btrim(t.notes)
    );
  if gap <> 0 then
    raise exception 'migration 18: % task notes not copied; tasks.notes not dropped', gap;
  end if;

  alter table public.tasks drop column notes;
end
$$;
```

- **Idempotent:** a second run hits the early `return`.
- **All-or-nothing:** if the gap check raises, the copy rolls back with it and the column stays.
- **No RLS, publication or replica-identity changes.** `tasks` keeps `replica identity full`.

### D2 No Dexie version bump

Cached task rows that still carry a `notes` property stay ignored, as since chunk 59. The cache rebuilds on read.

### D3 One stale comment

`src/db/mappers.ts`, the `toCachedSettings` doc comment says exports "already carry task notes in plaintext by design". That is no longer true after the drop. Change the parenthetical so it no longer claims exports carry task notes. Keep the reasoning about the Apple ID: it is identifying but not secret, so it is retained in exports. **Comment only**; no code in `src/` changes.

### D4 One import test

In `src/lib/import.test.ts`, inside the existing `legacy tasks.notes → notes (chunk 59, D3)` describe block, add one test. A post-60 export (task rows carrying **no** `notes` key, plus a `notes` array) imports in both modes with:

- zero synthesized notes;
- `repo.data.noteBodiesForTasks` **not called** (the `legacy.length === 0` early return);
- the file's own notes upserted after `tasks`.

Prove it red first: temporarily remove the early return, watch the test fail, then restore it. Report the failure line.

### D5 Commit routing

D1's file, D3 and D4 go in **one commit** with `[skip ci]`. None of them changes `dist/`.

- Prove that with Vite's content hashes:
  1. `npm run build` at `6db827e`, then `ls dist/assets > /tmp/assets-before.txt`.
  2. Make the edits, run `npm run build` again, then `ls dist/assets > /tmp/assets-after.txt`.
  3. `diff /tmp/assets-before.txt /tmp/assets-after.txt` must be **empty**.
- If the diff is not empty, stop and report. Do not push.
- `version.json` stays `0fa7f0c`. That is correct per `CLAUDE.md` §"When a push takes `[skip ci]`", not drift.

---

## Sequence

Gate each step before the next.

### 1. Repo change (D1, D3, D4, D5)

Run these on a clean install, with `.env.local` holding all four `VITE_*` keys and `VITE_CALDAV_PROXY_URL=https://dashboard-caldav-proxy.vercel.app`. `plannerCalendarMirror.counts.test.ts` hard-codes that origin.

```bash
cd ~/Documents/To-Do\ Dashboard
git fetch origin && git status && git log --oneline -1   # expect clean tree at 6db827e
rm -rf node_modules && npm ci
npm run build && ls dist/assets > /tmp/assets-before.txt
# … make the D1/D3/D4 edits …
npx tsc -b
npx eslint .                                              # 0 problems
npx vitest run                                            # 783 / 783 (baseline 782, +1 from D4)
npm run build && ls dist/assets > /tmp/assets-after.txt
diff /tmp/assets-before.txt /tmp/assets-after.txt         # must be empty
git diff --stat 0fa7f0c -- package.json package-lock.json # must be empty
grep -rnE "tasks\.notes|\bt\.notes|row\.notes|value\.notes|input\.notes" src --include=*.ts --include=*.tsx
```

The last grep should hit only `src/lib/import.ts` (legacy-file handling) and comments or test descriptions. List every hit.

Commit and push alone, using a message whose subject ends `[skip ci]`. Record the SHA and the git blob SHA of the migration file:

```bash
git rev-parse HEAD:supabase/migrations/18_drop_tasks_notes.sql
```

### 2. Pre-drop checks (MCP `execute_sql`, read-only)

Report every result verbatim.

1. **Counts:**

   ```sql
   select
     (select count(*) from public.tasks where notes is not null)                     as tasks_notes_not_null,
     (select count(*) from public.tasks where notes is not null and btrim(notes) <> '') as tasks_notes_nonblank,
     (select count(*) from public.notes)                                              as notes_total,
     (select count(*) from public.notes where task_id is not null)                    as notes_on_tasks;
   ```

2. **Dependencies on the column.** Expect **0 rows**. Any row means stop and report; do not drop.

   ```sql
   select d.classid::regclass as dep_class, d.objid, d.deptype
   from pg_depend d
   join pg_attribute a on a.attrelid = d.refobjid and a.attnum = d.refobjsubid
   where d.refobjid = 'public.tasks'::regclass and a.attname = 'notes';
   ```

3. **Function bodies.** `pg_depend` does not track these. Expect only `notes_memo_task_delete` and `notes_memo_subcategory_delete`, which name the `notes` **table**, not the column. Read and quote the matched line of any other hit, and stop if it names `tasks.notes` or `new.notes` / `old.notes` in a `tasks` trigger.

   ```sql
   select n.nspname, p.proname
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prosrc ~* 'notes';
   ```

4. **Column present:**

   ```sql
   select column_name, data_type from information_schema.columns
   where table_schema = 'public' and table_name = 'tasks' and column_name = 'notes';
   ```

   Expect one row, `text`.

### 3. Apply migration 18 (D1)

- Apply the **committed** file's exact contents via MCP `execute_sql`. Paste it from `git show HEAD:supabase/migrations/18_drop_tasks_notes.sql`, not from the editor buffer.
- If the call fails with a transient error (chunk 58 saw `Invalid or expired requestState`), re-run the whole file. It is idempotent and atomic.

**After applying:**

```sql
select column_name from information_schema.columns
where table_schema = 'public' and table_name = 'tasks' order by ordinal_position;
```

`notes` must be absent. Report the full column list.

```sql
select count(*) as notes_total from public.notes;
```

This must equal step 2's `notes_total` plus the non-blank count that had no matching note. Expected unchanged, since chunk 59 measured 0 legacy notes.

```sql
select relreplident from pg_class where oid = 'public.tasks'::regclass;
```

Must be `f`.

**Re-run the file once more.** Expect the `already dropped` notice and an unchanged `notes_total`.

### 4. Smoke

The orchestrator runs this on the deployed app in the operator's Chrome. **Not you.** Stop after step 3 and report.

The orchestrator covers: task create / title edit / complete / uncomplete / delete with no 400 on any `tasks` request; the task notes sheet and Notebook unchanged; an export whose `tasks` rows carry no `notes` key; that same file Merge-imported with no duplicate notes; and a copy of it with `"notes": "Smoke-60 legacy"` added to one task row, Merge-imported, producing exactly one note on that task and no 400. Smoke rows are deleted afterwards.

### 5. Docs (`[skip ci]`, after the orchestrator's smoke passes)

**`ARCHITECTURE.md`**

- §4 schema: remove the `notes text, -- DEPRECATED …` line from `tasks`.
- §4 "Notes (chunk 58)" paragraph: its closing `tasks.notes` sentences become one past-tense sentence. The column was copied in chunk 59 and dropped in chunk 60.
- §4 "`tasks.notes` is deprecated (chunk 59)" paragraph: collapse to a short historical note covering migration 17 (copy), migration 18 (re-copy + drop in one transaction), and that 17 must not be re-run.
- §10 "Legacy task notes in export/import": export no longer carries the field. Import still strips `notes` from task rows and converts legacy values, because pre-60 files carry it indefinitely.

**`PROGRESS.md`**

- Row 60 ☑ with the step-1 SHA, the step-2 / step-3 results, the test count, and deviations numbered.
- D1–D5 in the Decisions log.
- Last-updated paragraph per the chunk-54 convention. The current chunk-59 paragraph moves to Update history, relabelled `Prior update:` (prefix only).

Commit this prompt as `prompts/chunk-60-drop-tasks-notes.md` in the same commit.

---

## Out of scope

- Removing import's legacy-notes conversion or its `notes` strip. Both are permanent for old files.
- `EXPORT_VERSION` (stays `1`).
- `01_tables.sql` and `17_copy_task_notes.sql`: never edited.
- `hupomnemata_handoff/` and `design/` mentions of the old dialog (Claude Design's lane).
- A Dexie bump to scrub cached `notes` properties (D2).
- Any proxy change.

## Report back

- **Step 1:** commit SHA; the migration file's blob SHA; test count; the D4 red-first failure line; the empty `dist/assets` diff; the empty `package.json` diff; the grep output.
- **Step 2:** all four query results verbatim.
- **Step 3:** the post-apply column list, `notes_total`, `relreplident`, and the idempotent re-run's notice.
- Every deviation, numbered.
