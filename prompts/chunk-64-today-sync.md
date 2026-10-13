# Chunk 64: The Today plan syncs across devices (Day-7 #10)

**Runs on:** Claude Code, in `~/Documents/To-Do Dashboard` on Sergio's Mac (repo `smrios07mdb/dashboard`). One migration (applied by you via Supabase MCP `execute_sql` on `dctfspcbkqvvyptddtif`) and app code. No proxy change.

**Bases:**
- App `smrios07mdb/dashboard` @ `3d454d2` (docs). Last code commit `edbdd26` (chunk 63), which is what's live.
- Proxy untouched.
- Latest migration on disk: `19_import_replace.sql`.

**Authority:** `ARCHITECTURE.md` → `prompts/README.md` → this prompt. Before writing anything, read:
- `CLAUDE.md`.
- `src/state/todayPlan.ts` and `src/state/todayPlan.test.ts`.
- `src/lib/today.ts`.
- `useDashboardData` and the `useTodayPlan` call in `src/screens/Dashboard.tsx` (≈ lines 63 and 177).
- The `notes` touchpoints, which are the template this chunk copies: `src/db/types.ts` (`TABLES`), `src/db/mappers.ts`, `src/db/dexie.ts` (v6), `src/db/outbox.ts` (`SPECS`, incl. `routine_logs`' `upsertOnConflict`), `src/db/realtime.ts`, `repo.notes` and `applyServerEcho` in `src/db/repo.ts`, `src/db/localCache.ts`.
- `supabase/migrations/16_notes.sql`.
- ARCHITECTURE §4 and §13 wherever they describe the Today plan or `hup:todayPlan`.

**Scope:** PROGRESS Revisions → Day-7 backlog item **10** (Today membership DB persistence). The operator's call, 2026-10-13: **cross-device Today matters — make it a synced field.** Item 11 (`dueAt` / `settings.timezone` for "due today") is **not** in scope.

**Locked subsystem:** `src/db/realtime.ts` is listed in `prompts/README.md`. This chunk is authorized to make the **additive** registration only: one `makeHandler` entry and one `.on()` for `today_marks`, the chunk-37 D11 / chunk-58 precedent. Nothing else in that file changes.

---

## What exists at `3d454d2`

`useTodayPlan(tasks)` resolves membership as (auto signals ∪ pinned) − removed. The user's pins and removals live only in this browser's `localStorage['hup:todayPlan']` as `{ date, pinned[], removed[] }`, day-scoped to the browser-local calendar day (chunks 43, 44, 46). A plan made on the laptop is invisible on the phone. ARCH and the hook's own header call this client-local view state by design; that design is what changes here.

Baseline (orchestrator, `edbdd26` = `3d454d2` code, fresh clone, Node 22, clean `npm ci`): `vitest run` **813 / 813** (73 files), build green, eager JS **1,025,704 B**.

The migration below was proven by the orchestrator on a throwaway local Postgres 16 (migrations 01–03, 08–10, 12–16, 18, 19 applied, stub `auth.uid()`, `authenticated` role):
- Applied twice: a no-op.
- A mark on the caller's own task inserts.
- The same id upserted again flips `kind` in place, still one row.
- A mark on another user's task is refused by RLS, and so is a forged `user_id`.
- `kind = 'maybe'` violates the check constraint.
- Deleting the task cascades its mark away.
- The table is in `supabase_realtime` with `relreplident = 'f'`.

---

## Locked decisions

### D1 Migration 20: `today_marks`, one row per task

Create `supabase/migrations/20_today_marks.sql` with exactly this content:

```sql
-- Chunk 64 (Day-7 #10, ARCHITECTURE.md §4/§13) — the Today plan syncs.
--
-- Until now the user's manual Today deltas (the sun toggle's pins and
-- removals) lived per device in localStorage (`hup:todayPlan`, chunk 43), so a
-- plan made on the laptop was invisible on the phone. `today_marks` holds them
-- server-side instead.
--
-- One row per task, at most: `id` IS the task's id (primary key and FK to
-- `tasks`, `on delete cascade`). Every device therefore computes the same key
-- for the same task, a toggle is a plain upsert on `id`, and two devices
-- toggling the same task can never create two rows. `day` is the local
-- calendar day the mark was made for; a mark whose `day` is not today is
-- simply ignored by the client, and the next toggle overwrites it — no
-- cleanup job, and the table never holds more rows than the user has tasks.
-- `kind` is the user's intent for that day: 'pin' (in Today) or 'remove'
-- (out of Today, even when auto-signalled).
--
-- RLS: own rows only. FK checks bypass RLS, so insert/update `with check`
-- also asserts the task belongs to the caller (the scheduled_blocks / notes
-- rule). Realtime publication + replica identity full per the ARCH §4 rule
-- for every user-scoped table (chunk-5 Bug A). Applied via MCP `execute_sql`
-- (chunk-33/35/37 precedent). Idempotent.

create table if not exists public.today_marks (
  id uuid primary key references public.tasks(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  day date not null,
  kind text not null check (kind in ('pin', 'remove')),
  updated_at timestamptz not null default now()
);

create index if not exists today_marks_user_day_idx
  on public.today_marks (user_id, day);

drop trigger if exists today_marks_set_updated_at on public.today_marks;
create trigger today_marks_set_updated_at
  before update on public.today_marks
  for each row execute function public.set_updated_at();

alter table public.today_marks enable row level security;

drop policy if exists today_marks_select_own on public.today_marks;
drop policy if exists today_marks_insert_own on public.today_marks;
drop policy if exists today_marks_update_own on public.today_marks;
drop policy if exists today_marks_delete_own on public.today_marks;

create policy today_marks_select_own on public.today_marks
  for select using (auth.uid() = user_id);
create policy today_marks_insert_own on public.today_marks
  for insert with check (
    auth.uid() = user_id
    and exists (
      select 1 from public.tasks t
      where t.id = today_marks.id and t.user_id = auth.uid()
    )
  );
create policy today_marks_update_own on public.today_marks
  for update using (auth.uid() = user_id) with check (
    auth.uid() = user_id
    and exists (
      select 1 from public.tasks t
      where t.id = today_marks.id and t.user_id = auth.uid()
    )
  );
create policy today_marks_delete_own on public.today_marks
  for delete using (auth.uid() = user_id);

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'today_marks'
  ) then
    alter publication supabase_realtime add table public.today_marks;
  end if;
end $$;
alter table public.today_marks replica identity full;
```

- **`id` is the task's id.** Every device computes the same key for the same task, so a toggle is an upsert on `id` and concurrent toggles from two devices converge on one row, last write wins. There is no separate `task_id` column.
- **`day` is the browser-local calendar day** the mark was made for: the same `dayKey` frame `todayPlan.ts` uses now. A mark whose `day` is not today is ignored, and the next toggle of that task overwrites it. No cleanup job.
- **No `created_at`.** A mark has no history worth keeping; `updated_at` (maintained by `set_updated_at`) is what D3's newer-observation rule compares.

### D2 Data layer: the `notes` shape at every touchpoint

- **`src/db/types.ts`:** `export type TodayMark = { id: string; userId: string; day: string; kind: 'pin' | 'remove'; updatedAt: string }`, and `todayMarks: 'today_marks'` in `TABLES`.
- **`src/db/mappers.ts`:** `TodayMarkRow`, `todayMarkFromRow`, `todayMarkToRow`, in the `notes` style. `toRow` emits only the keys present.
- **`src/db/dexie.ts`:** **v7**, adding only `today_marks: '&id, day'`, with a comment in the v6 comment's style. No `.upgrade()`.
- **`src/db/outbox.ts` `SPECS`:** a `today_marks` entry with key `id` throughout and **`upsertOnConflict: 'id'`**, so an offline toggle replays as an upsert. The `routine_logs` precedent.
- **`src/db/repo.ts`:**
  - `repo.todayMarks.list(): Promise<TodayMark[]>`. Every mark the user owns. The online path is clear-then-`bulkPut` into Dexie (the `notes.listAll` shape); the fallback reads Dexie.
  - `repo.todayMarks.set(input: { taskId: string; userId: string; day: string; kind: 'pin' | 'remove' }): Promise<TodayMark>`, through `writeRow` with `op: 'insert'`:
    - The optimistic row is `{ id: taskId, userId, day, kind, updatedAt: now }`.
    - `cacheApply` puts it in Dexie.
    - `online` is `supabase.from('today_marks').upsert(todayMarkToRow(row), { onConflict: 'id' }).select().single()`.
  - An `applyServerEcho` case for `TABLES.todayMarks`.
  - No `delete` method: nothing deletes a mark except the task cascade.
- **`src/db/realtime.ts`:** the additive registration only (see "Locked subsystem" above). The handler `put`s the row in Dexie and deletes it on `DELETE`. `makeHandler` already schedules the dashboard refresh.
- **`src/db/localCache.ts`:** `db.today_marks` joins the transaction and the clears. The sign-out cleanup goes through `wipeLocalCache`, so it follows with no further edit; confirm that and report it.
- **Export / import:** `today_marks` is **not** exported. It is a day-scoped plan, not data worth restoring, and `EXPORT_TABLES` stays as it is. Replace needs no change: `import_replace` deletes the account's tasks, and the FK cascade clears their marks inside the same transaction. Merge is untouched.

### D3 `useTodayPlan`: marks replace localStorage

New signature:

```ts
export function useTodayPlan(
  tasks: Task[],
  marks: TodayMark[] | null,
  writeMark: (taskId: string, kind: 'pin' | 'remove', day: string) => Promise<unknown>,
): TodayPlan
```

`marks === null` means "not loaded yet".

1. **Deltas come from marks.** Today's deltas are the marks whose `day === dayRef.current` and whose `id` is a task in `tasks`: `pin` → pinned, `remove` → removed. Everything else about membership stays as it is:
   - `autoTodayIds`;
   - `reconcileTodayMembership` on task-id identity change (completed tasks linger);
   - `applyTodayDeltas`;
   - the lazy `rollIfNewDay` with no timer.
2. **A marks change applies.** When the deltas derived from `marks` change content (a toggle on another device, arriving through realtime → dashboard refresh), membership becomes `applyTodayDeltas(cur, deltas)`. This is the same operation a local toggle performs, so local and remote toggles cannot disagree.
3. **Newer observation wins.** The hook keeps `localWrites: Map<taskId, { kind, at }>` for this session's own toggles (`at` = the ISO time it wrote).
   - Where a task has both a local write and a today-dated mark, the one with the later timestamp decides (`at` vs the mark's `updatedAt`).
   - So a refresh carrying a mark from before a rapid second toggle cannot flip the row back, while a genuinely later toggle on another device still wins.
   - Compare as instants (`Date.parse`), never as strings (chunk 48 D13).
4. **A toggle writes.** `toggleToday` updates membership exactly as now and records `localWrites`, then calls `void writeMark(id, want ? 'pin' : 'remove', dayRef.current)`.
   - On rejection (a 4xx; offline is not a rejection, `writeRow` queues it): `toast.error('Could not save Today plan — retry')`, and the local state stays.
   - No localStorage write.
5. **Rollover.** Unchanged in mechanism. After a roll, yesterday-dated marks no longer match `dayRef`, so the deltas are empty without any write. No write happens on a roll.
6. **Pruning** is gone: a deleted task's mark is cascaded away server-side, and marks for ids not in `tasks` are ignored. The "still loading" guard becomes `marks === null` or `tasks.length === 0`: membership is the auto seed alone until both are loaded, and then applies the deltas once.
7. **One-time move off localStorage.** On the first render where `marks !== null` and `tasks.length > 0`, read `hup:todayPlan` with the existing `readTodayDeltas` (which already discards and removes a stale-dated entry).
   - For each pinned or removed id that is in `tasks` and has **no** today-dated mark, call `writeMark` with that kind and today's `dayRef`.
   - Then `localStorage.removeItem('hup:todayPlan')` inside a try/catch.
   - It runs at most once per mount (a ref). A server mark already present for today wins over the device's stored entry.
   - `writeTodayDeltas` is deleted. Keep `readTodayDeltas` only for this move, and say so in its comment.
8. Rewrite the file header: membership is now server-synced through `today_marks`, and `hup:todayPlan` is read once and removed.

**`src/screens/Dashboard.tsx`:**
- `useDashboardData` adds `repo.todayMarks.list()` to its `Promise.all` and exposes `todayMarks: TodayMark[] | null` (`null` until the first load completes).
- The screen passes `writeMark = (taskId, kind, day) => repo.todayMarks.set({ taskId, userId: userId!, day, kind })`, guarded so it is never called without a `userId`.
- No other screen change. `TodayPanel`, the sun toggle and `lib/today.ts` are untouched.

### D4 What does not change

- The day frame stays browser-local (`dayKey`). Moving Today onto `settings.timezone` is Day-7 #11.
- `lib/today.ts`, `TodayPanel`, row sun toggles, the `todayList` layout preference (stays per device in localStorage: it is a display setting, not the plan).
- `import_replace`, export, Merge, RLS on every other table, Planner, Notebook.
- No new dependency; `package.json` / `package-lock.json` unchanged.

### D5 Tests

**`src/state/todayPlan.test.ts`:**
- Rewrite only the assertions that read or write `localStorage['hup:todayPlan']` so they drive `marks` / `writeMark` instead. Keep every behaviour the file pins today:
  - a pin survives a remount (given the same marks);
  - a removal of an auto-signalled task survives;
  - a yesterday-dated mark is ignored;
  - a mark for a task that no longer exists is ignored;
  - a newly auto-signalled task still appears;
  - nothing is applied while `marks === null`;
  - the chunk-44 rollover tests (a toggle after local midnight stamps the new day; a same-day advance keeps the marks).
- Add:
  1. **A toggle writes a mark.** Pin and un-pin call `writeMark(id, 'pin' | 'remove', <today>)` once each, and membership changes immediately.
  2. **A remote mark applies.** Rerender with a new today-dated `pin` mark for a task not in the plan: the task joins without any local toggle. Rerender with a `remove` mark: it leaves.
  3. **Newer observation wins.** Toggle locally (pin) and then rerender with an older-`updatedAt` `remove` mark for the same task: the task stays in. Rerender with a newer `remove` mark: it leaves.
  4. **localStorage is moved once.**
     - A today-dated `hup:todayPlan` entry with one pin and one removal, with `marks = []`, produces exactly two `writeMark` calls and the key is gone.
     - With a today-dated server mark already present for one of those ids, only the other is written.
     - A second rerender writes nothing more.
  5. **A failed write toasts and keeps the plan.** `writeMark` rejecting with an error carrying `status: 409` → `toast.error('Could not save Today plan — retry')`, and membership is unchanged.

**Data layer:**
- Mapper round-trip for `TodayMark`.
- `repo.todayMarks.set` online: the upsert is called with `onConflict: 'id'` and `id === taskId`.
- `repo.todayMarks.set` offline: an outbox row with `op: 'insert'`, table `today_marks`, and the replay goes through `.upsert(…, { onConflict: 'id' })`.
- `repo.todayMarks.list` online replaces the Dexie mirror.
- Dexie **v7** opens with a `today_marks` store (follow the outbox file's existing Dexie-version test).
- `wipeLocalCache` clears `today_marks`.

**`src/screens/Dashboard.test.tsx`:** mock `repo.todayMarks` (`list` → `[]`, `set` → resolve) so the existing tests keep passing. Touch no existing assertion.

**Red-first:** run D5 tests 1–5 against `3d454d2`'s `src/state/todayPlan.ts` (keep the new tests) and report the failing lines.

### D6 Order and commit routing

- **Migration first, then the app.** The live client at `edbdd26` never touches `today_marks`.
- **One code commit**, pushed **alone**, **no `[skip ci]`**: the migration file plus the source and test files above. Subject: `Chunk 64: Today plan syncs across devices via today_marks (Day-7 #10)`.
- Gates on a clean `npm ci`: `tsc -b` clean; `eslint .` 0 problems; `vitest run` all green (exact test and file count); `npm run build` green.
- Eager JS before (at `3d454d2`) and after, on your machine. Limit **+10 kB**.
- After the push: deploy run id and result; live `version.json` read cache-busted.

---

## Sequence

### 1. Migration 20 (Supabase MCP `execute_sql`, project `dctfspcbkqvvyptddtif`)

```bash
cd ~/Documents/To-Do\ Dashboard
git fetch origin
git checkout main
git pull --ff-only origin main
git log -1 --oneline
```

Expect `3d454d2`. If `main` is anywhere else, stop and report.

Write `supabase/migrations/20_today_marks.sql` with the D1 content verbatim and send its contents through `execute_sql`. Re-send on a transient `Invalid or expired requestState`; the file is idempotent. Then run each query and report the rows:

```sql
select column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_schema = 'public' and table_name = 'today_marks'
order by ordinal_position;
```

Expect `id uuid NO`, `user_id uuid NO`, `day date NO`, `kind text NO`, `updated_at timestamp with time zone NO now()`.

```sql
select polname from pg_policy where polrelid = 'public.today_marks'::regclass order by polname;
select tgname from pg_trigger where tgrelid = 'public.today_marks'::regclass and not tgisinternal;
select count(*) from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'today_marks';
select relreplident from pg_class where oid = 'public.today_marks'::regclass;
select confdeltype from pg_constraint where conrelid = 'public.today_marks'::regclass and contype = 'f' and confrelid = 'public.tasks'::regclass;
```

Expect:
- the four `today_marks_*_own` policies;
- `today_marks_set_updated_at`;
- `1`;
- `f`;
- `c` (cascade).

Do **not** insert into the table from your session.

### 2. Code (D2–D6)

```bash
rm -rf node_modules
npm ci
npm run build
python3 -c "import re,os;h=open('dist/index.html').read();f=set(re.findall(r'(?:src|href)=\"/dashboard/(assets/[^\"]+\.js)\"',h));print(len(f),sum(os.path.getsize('dist/'+x) for x in f))"
```

Record that eager-JS figure as the base. Make the D2–D3 edits and the D5 tests. Then:

```bash
npx tsc -b
npx eslint .
npx vitest run
npm run build
python3 -c "import re,os;h=open('dist/index.html').read();f=set(re.findall(r'(?:src|href)=\"/dashboard/(assets/[^\"]+\.js)\"',h));print(len(f),sum(os.path.getsize('dist/'+x) for x in f))"
git diff --stat 3d454d2 -- package.json package-lock.json
grep -rn "hup:todayPlan\|writeTodayDeltas" src
git status --short
```

- The grep should show `hup:todayPlan` only in `todayPlan.ts` (the one-time move) and its tests, and `writeTodayDeltas` nowhere.
- Stage the migration and every changed source and test file **by name** (no `git add -A`).
- `git status --short` must show nothing else, then:

```bash
git commit
git push origin main
```

The commit body lists D1–D4 in one line each and ends with the `Co-Authored-By` trailer per `CLAUDE.md`.

**Stop after the push and report.** Do not start step 4.

### 3. Smoke

The orchestrator runs this on the deployed app in Sergio's Chrome, through the Claude in Chrome extension. **Not you.**

It covers:
- **A pin is stored on the server:** a throwaway `Smoke-64` task created through the UI is pinned with its sun toggle, and a `today_marks` row (`id` = the task id, today's `day`, `kind 'pin'`) appears by REST.
- **The plan survives a wiped cache:** a reload with `hup:todayPlan` absent and the Dexie cache wiped (Settings → Wipe local cache) keeps it pinned.
- **A second tab follows:** a second tab of the app on the same account picks up an un-pin made in the first tab without a reload.
- **Deleting the task removes its mark:** the cascade leaves 0 rows for it.
- **Console clean.**

Optional, operator: open the app on the iPhone and see the same Today plan.

### 4. Docs (`[skip ci]`, after the orchestrator's smoke passes)

**`ARCHITECTURE.md`:**
- §4: a **Today marks (chunk 64)** paragraph covering:
  - the table;
  - `id` = task id and the upsert;
  - day-scoping by the browser-local day;
  - newer observation wins;
  - the cascade;
  - not exported, and Replace clears marks through the cascade.
- §13: everywhere the Today plan is called client-local or `hup:todayPlan`-backed now says it is synced through `today_marks`, and `hup:todayPlan` is read once and removed.

**`PROGRESS.md`:**
- Row 64 ☑, with:
  - the three migration query results;
  - the step-2 SHA, gates, red-first lines, test and file count;
  - eager JS before/after, deploy run, live `version.json`;
  - the smoke result;
  - deviations, numbered.
- Day-7 backlog: item 10 → ☑ with `(done: chunk 64, <SHA> — today_marks, one row per task, synced; hup:todayPlan moved once and removed.)`. The status line becomes **8 done, 1 moot, 2 open** with the chunk-64 date.
  - Item 11 stays open.
  - Add one line to item 11 noting that the day frame of `today_marks.day` moves with it.
- Decisions log: D1–D4 (2026-10-13, chunk 64), one row each.
- Last-updated paragraph per the chunk-54 convention; the current chunk-63 paragraph moves to Update history, relabelled `Prior update:` (prefix only).

Commit this prompt as `prompts/chunk-64-today-sync.md` in the same commit. If row 64 must name the docs SHA, record it in an immediate `[skip ci]` follow-up (chunk-54 convention).

---

## Out of scope

- Day-7 item 11 (`dueAt` / `settings.timezone`) and item 9.
- A history of past days' plans.
- Syncing the `todayList` layout preference.
- Any Planner, Notebook or Insights change.
- Writing to `today_marks` from your session against the live database.

## Report back

- **Step 1:** the five query results; any `execute_sql` retries.
- **Step 2:**
  - commit SHA; `git diff --stat 3d454d2 <SHA>`;
  - gates (`tsc -b`, `eslint .`, test count and file count, build);
  - red-first failing lines for D5 tests 1–5;
  - every existing `todayPlan.test.ts` assertion you rewrote, by test name, with one line on what it now asserts;
  - the `hup:todayPlan` grep;
  - confirmation that sign-out cleanup reaches `today_marks` through `wipeLocalCache`;
  - eager JS before / after / delta; the empty `package.json` diff;
  - deploy run id and result; live `version.json`.
- Every deviation, numbered.
