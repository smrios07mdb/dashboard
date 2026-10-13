# Chunk 61: Insights and reminders follow `settings.timezone`

**Runs on:** Claude Code, in `~/Documents/To-Do Dashboard` on Sergio's Mac (repo `smrios07mdb/dashboard`). No SQL, no proxy, no migration.

**Bases:**
- App `smrios07mdb/dashboard` @ `265d1e8` (docs). Last code commit `0fa7f0c` (59a), which is what's live. Chunk 60's `a9dab68` changed no `dist/` output.
- Proxy untouched.

**Authority:** `ARCHITECTURE.md` → `prompts/README.md` → this prompt. Read `CLAUDE.md`, `src/lib/clock.ts`, `src/lib/insights.ts`, `src/screens/Insights.tsx`, `src/components/SetReminderPopover.tsx` and `docs/notifications.md` § "Known caveat — reminder timezone" first.

**Scope:** PROGRESS Revisions → Day-7 backlog items **1** (Insights UTC → local-day bucketing) and **2** (chunk-9 `SetReminderPopover` timezone fix). The backlog pairs them; this chunk ships both. Item 11 (`lib/today.ts`) is **not** in scope.

---

## The two bugs, as committed at `265d1e8`

**Insights.** `src/lib/insights.ts` buckets a completion by `t.completedAt.slice(0, 10)` — the UTC date — at two sites in `aggregateForChart` (the day-set builder and the `dayIndex.get` lookup). `src/screens/Insights.tsx` builds its x-axis with `lastNDays(n)`, which also counts UTC days, and fetches from `${days[0]}T00:00:00.000Z`. For a user in `America/New_York`, anything completed after 20:00 EDT (19:00 EST) lands on the next day's bar, and after 20:00 the chart's "today" is already tomorrow.

**Reminders.** `SetReminderPopover` reads the picked `YYYY-MM-DDTHH:mm` with `new Date(s)` and renders an existing `remindAt` back with `getHours()` etc. — the **browser's** zone, never `settings.timezone`. `remind_at` is the right instant only when the two agree. `docs/notifications.md` already names the fix: `fromZonedTime(value, settings.timezone)`, consistent with `src/lib/clock.ts`.

Baseline reproduced by the orchestrator at `265d1e8` (fresh clone, Node 22.22.0, clean `npm ci`, placeholder env except the real `VITE_CALDAV_PROXY_URL`): `vitest run` **783 / 783**, build green, eager JS **1,024,165 B**.

---

## Locked decisions

### D1 One resolver: `src/lib/userTimezone.ts` (new)

```ts
export function browserTimezone(): string
export async function loadUserTimezone(): Promise<string>
```

- `browserTimezone()` returns `Intl.DateTimeFormat().resolvedOptions().timeZone`, or `'UTC'` if that is empty or throws.
- `loadUserTimezone()`: `supabase.auth.getSession()` (`supabase` from `@/lib/supabase`, as `src/lib/ai.ts` does) → user id → `repo.settings.get(userId)` → `settings.timezone`. **Never `useSession()`** — it has no user on its first render (chunk 59a F1). No session, a null row, a blank `timezone`, or any throw → `browserTimezone()`. It never rejects.
- The fallback is the browser zone on purpose, not Routines' `'America/New_York'` default: when settings cannot be read, Insights and reminders behave exactly as they did before this chunk. Routines and Dashboard keep their own default — not touched.
- `repo.settings.get` already falls back to Dexie offline, so this resolves offline from cache.
- New `src/lib/userTimezone.test.ts`: (a) returns the row's `timezone`; (b) no session → browser zone; (c) blank `timezone` → browser zone; (d) `repo.settings.get` throws → browser zone, no rejection.

### D2 `src/lib/insights.ts`: the one authorized change to the aggregation core

`insights.ts` and its tests have been treated as untouchable since the redesign. This chunk is the deliberate exception, and only this:

- New export, placed after the imports:
  ```ts
  /** Calendar day (YYYY-MM-DD) of a completion instant in `timezone`. */
  export function completionDayKey(completedAt: string, timezone: string): string {
    return formatInTimeZone(completedAt, timezone, 'yyyy-MM-dd')
  }
  ```
  (`formatInTimeZone` from `date-fns-tz`, already a dependency.)
- `aggregateForChart` gains a trailing parameter `timezone: string = 'UTC'`, and **both** `.slice(0, 10)` sites become `completionDayKey(t.completedAt, timezone)`.
- The header comment's last sentence becomes: "Day bucketing keys on the calendar date of `completedAt` in the caller's timezone (`settings.timezone`; default `'UTC'`)."
- `buildColorMap`, `applyOtherGrouping`, `summaryTable`, the series sort, `labelFor` and every exported type are **byte-unchanged**.
- The 8 existing tests in `src/lib/insights.test.ts` pass **unmodified** (the `'UTC'` default is what makes that hold). New tests are appended in a new `describe('timezone day bucketing (chunk 61)')`:
  1. `completionDayKey('2026-05-21T02:30:00.000Z', 'America/New_York')` → `'2026-05-20'`.
  2. Fall-back DST, `America/New_York`: `'2026-11-01T03:30:00.000Z'` → `'2026-10-31'`; `'2026-11-01T04:30:00.000Z'` → `'2026-11-01'`; `'2026-11-02T04:30:00.000Z'` → `'2026-11-01'`; `'2026-11-02T05:30:00.000Z'` → `'2026-11-02'`.
  3. PostgREST offset form: `'2026-05-21T02:30:00+00:00'` → `'2026-05-20'`.
  4. `aggregateForChart` with `dayKeys = ['2026-05-20', '2026-05-21']` and one 30-minute task completed `'2026-05-21T02:30:00.000Z'`: with `'America/New_York'` the 30 minutes sit on `2026-05-20`; with the default they sit on `2026-05-21`.
  5. `aggregateForChart` with no `dayKeys` and the same task under `'America/New_York'`: `days` is exactly `['2026-05-20']`.

Tests 1–3 cannot compile against `265d1e8` (no `completionDayKey`); 4's New York half is red. Report the red lines.

### D3 `src/screens/Insights.tsx`: the window and the buckets use the same zone

- `lastNDays(n)` becomes `lastNDays(n, timezone)`: `clock.today(timezone)` (from `@/lib/clock`, so the DEV `__clockOverride` still pins it), then `dateKeyDaysAgo(todayKey, i)` for `i = n - 1 … 0`, oldest first. Its doc comment says "in `timezone`", not "UTC".
- The load effect resolves the zone first, then fetches: `const tz = await loadUserTimezone()`, `from = startOfDayIso(days[0], tz)` (from `@/lib/clock`), `to = new Date().toISOString()` unchanged, then the same three-way `Promise.all`.
- `tz` lives in component state and is **set in the same `.then` as `tasks` / `subcategories` / `categories`**, so the x-axis and the data can never come from different zones. Initial value `browserTimezone()`. `dayKeys` becomes `useMemo(() => lastNDays(range, tz), [range, tz])`, and `aggregateForChart(tasks, filteredSubs, categories, dayKeys, tz)` gets `tz` in its dep list.
- Effect deps stay `[range]`. No `useSession`. Nothing else on the screen changes — stat cards, trend chip, filters, recharts, a11y wiring, `summaryTable` call.
- `src/screens/Insights.test.tsx`: the **only** permitted change is adding
  ```ts
  vi.mock('@/lib/userTimezone', () => ({
    browserTimezone: () => 'UTC',
    loadUserTimezone: async () => 'UTC',
  }))
  ```
  Its fixtures key days on UTC, so `'UTC'` keeps all 5 tests meaning exactly what they meant. No assertion, fixture or helper edits.
- New `src/screens/Insights.timezone.test.tsx`, zone `'America/Los_Angeles'`, Date faked only (`vi.useFakeTimers({ toFake: ['Date'] })`, system time `2026-05-21T03:00:00.000Z` = 20:00 PDT on May 20):
  1. With the default 30-day range, `listCompletedInRange` is called with `from === '2026-04-21T07:00:00.000Z'`. (At `265d1e8` it is `'2026-04-22T00:00:00.000Z'` — red.)
  2. The screen passes the zone to the core: a `vi.mock('@/lib/insights', …)` passthrough spy (`importOriginal`, wrap `aggregateForChart`) sees `'America/Los_Angeles'` as the fifth argument and a `dayKeys` array whose last entry is `'2026-05-20'`. The screen renders no per-day text to assert on instead — `chartLabel` takes only range and filter, and the `<table>` is the per-subcategory summary (verified at `265d1e8`). (At `265d1e8`: no fifth argument and a last key of `'2026-05-21'` — red.)

### D4 `src/components/SetReminderPopover.tsx`: pick and show in `settings.timezone`

- **Props unchanged.** `TaskRow` and every other caller are untouched.
- New state `tz: string | null`. An effect on `open` (the project's pattern: state is set only inside the async callback) calls `loadUserTimezone()` when `open` becomes `true`. On resolve, `setTz(resolved)` and `setValue(toZonedInputValue(remindAt, resolved))`. A resolution is dropped if the popover has since closed or reopened — guard with an incrementing open counter in a ref. On close, `tz` returns to `null`.
- The existing `prevOpen` render-time reset stays for the `value` reset; it no longer computes the local value itself (the value is filled when `tz` resolves).
- `toZonedInputValue(iso, tz)` = `formatInTimeZone(iso, tz, "yyyy-MM-dd'T'HH:mm")`, `''` for null or an unparseable instant. `fromZonedInputValue(s, tz)` = `fromZonedTime(s, tz).toISOString()`, `null` for `''` or a `NaN` date. Both replace `toLocalInputValue` / `fromLocalInputValue`, and both are exported for the tests.
- While `tz === null`: the input is `disabled` with `aria-busy="true"`, and Save is disabled. Clear and Cancel work as today.
- When `tz !== browserTimezone()`, render one line directly under the `Reminder` label: **`Times in {tz}`** (IANA name verbatim), class `text-[11px] text-ink-3`. Nothing when they match.
- DST: a non-existent or ambiguous wall time resolves as `date-fns-tz` resolves it — verified at `date-fns-tz` 3.2: New York `2026-03-08T02:30` → `2026-03-08T06:30:00.000Z`; `2026-11-01T01:30` → `2026-11-01T05:30:00.000Z` (first occurrence). No UI for it.
- The file's header comment: the "Value contract" bullets say `settings.timezone` (resolved by `loadUserTimezone`), not "local TZ", and drop the "revisit if chunk 14 surfaces timezone confusion" sentence.
- New `src/components/SetReminderPopover.test.tsx`, with `@/lib/userTimezone` mocked so `loadUserTimezone` resolves `'Asia/Tokyo'` and `browserTimezone` returns `'America/New_York'` (zone-independent of the machine running the tests):
  1. Picking `2026-10-20T09:00` and Save calls `onSave('2026-10-20T00:00:00.000Z')`. (Red at `265d1e8` on any machine not in `Asia/Tokyo`.)
  2. Opening with `remindAt = '2026-10-20T00:00:00.000Z'` shows input value `2026-10-20T09:00`.
  3. `Times in Asia/Tokyo` is shown; with `loadUserTimezone` resolving `'America/New_York'` it is absent.
  4. Before the zone resolves (a deferred `loadUserTimezone`), the input is disabled and Save is disabled.
  5. A resolution that arrives after the popover closed does not set the value (close, then resolve, then reopen with a different `remindAt` and resolve: the second value wins).
  6. The two exported converters round-trip `America/New_York` across `2026-11-01T01:30` (→ `05:30Z` → back to `01:30`).

### D5 What does not change

- `remind_at` stays a UTC instant. The Edge Function `notify-due-reminders`, `claim_due_reminders`, `InAppReminders` and `lib/inAppReminders.ts` are untouched — their `remind_at < now()` comparison was always right.
- **No backfill** of existing `remind_at` values: a stored instant does not record the zone the pick was made in. For a user whose browser zone matched `settings.timezone` (the normal case) they are already correct.
- `lib/today.ts` (Day-7 item 11), all planner math (browser-local by ARCH §4/§13), `lib/clock.ts`, Routines and Dashboard: untouched.
- No migration, no Dexie bump, no new dependency, no proxy change. `package.json` / `package-lock.json` unchanged.

### D6 Commit routing

- **One code commit**, pushed **alone**, **no `[skip ci]`** (`dist/` changes). Subject: `Chunk 61: Insights day bucketing and reminder picks follow settings.timezone (Day-7 #1, #2)`.
- Gates before the push, on a clean `npm ci`: `tsc -b` clean; `eslint .` 0 problems; `vitest run` all green (783 + the new tests — report the exact count and file count); `npm run build` green.
- Red-first: run every new test against `265d1e8`'s source first (stash the source changes, keep the tests) and report the failing lines for D2 test 4, D3 test 1 and D4 test 1.
- Eager JS: sum the `<script src>` + `<link rel=modulepreload>` `.js` files in `dist/index.html`, before (at `265d1e8`) and after, on your machine. Limit **+10 kB**.
- After the push: the deploy run id and its result, and the live `version.json` read cache-busted (`https://smrios07mdb.github.io/dashboard/version.json?cb=<timestamp>`).

---

## Sequence

### 1. Code (D1–D6)

```bash
cd ~/Documents/To-Do\ Dashboard
git fetch origin
git checkout main
git pull --ff-only origin main
git log -1 --oneline
```

Expect `265d1e8`. If `main` is anywhere else, stop and report.

```bash
rm -rf node_modules
npm ci
npm run build
python3 -c "import re,os;h=open('dist/index.html').read();f=set(re.findall(r'(?:src|href)=\"/dashboard/(assets/[^\"]+\.js)\"',h));print(len(f),sum(os.path.getsize('dist/'+x) for x in f))"
```

Record that eager-JS figure as the base. Make the D1–D4 edits and add the tests. Then:

```bash
npx tsc -b
npx eslint .
npx vitest run
npm run build
python3 -c "import re,os;h=open('dist/index.html').read();f=set(re.findall(r'(?:src|href)=\"/dashboard/(assets/[^\"]+\.js)\"',h));print(len(f),sum(os.path.getsize('dist/'+x) for x in f))"
git diff --stat 265d1e8 -- package.json package-lock.json
git add src/lib/userTimezone.ts src/lib/userTimezone.test.ts src/lib/insights.ts src/lib/insights.test.ts src/screens/Insights.tsx src/screens/Insights.test.tsx src/screens/Insights.timezone.test.tsx src/components/SetReminderPopover.tsx src/components/SetReminderPopover.test.tsx
git status --short
git commit
git push origin main
```

The commit body lists D1–D5 in one line each and ends with the `Co-Authored-By` trailer per `CLAUDE.md`. `git status --short` must show nothing else staged; anything unexpected, stop and report.

**Stop after the push and report.** Do not start step 3.

### 2. Smoke

The orchestrator runs this on the deployed app in Sergio's Chrome. **Not you.**

It covers: `settings.timezone` temporarily set to `Asia/Tokyo` on the operator's row; a `Smoke-61` task's reminder picked at 09:00 shows `Times in Asia/Tokyo`, stores the Tokyo 09:00 instant, and reopens at 09:00; with the zone restored the hint is gone and an existing reminder reopens at its New York wall time; a `Smoke-61` task completed at an evening New York instant counts on that New York day in Insights, not the next; console clean. The original `timezone` is restored and the smoke rows are deleted afterwards.

### 3. Docs (`[skip ci]`, after the orchestrator's smoke passes)

**`ARCHITECTURE.md`**

- §9 Notifications: new bullet group **Reminder time zone (chunk 61)** — the picker reads and writes wall-clock times in `settings.timezone` (resolved by `loadUserTimezone`, browser zone if unreadable) and shows `Times in <zone>` when that differs from the device; `remind_at` stays a UTC instant; existing values were not rewritten.
- §12 Insights: one sentence — days are calendar days in `settings.timezone`, for both the x-axis window and each completion's bucket.
- §13, the planner bullet ending "`settings.timezone` stays a routines/streak concern": becomes "a routines/streak, Insights and reminder-entry concern; the planner stays browser-local."

**`docs/notifications.md`**

- § "Known caveat — reminder timezone (chunk-9 origin)" becomes "Reminder timezone (resolved in chunk 61)": two sentences on what the picker now does and that pre-61 picks made from a device in another zone keep the instant they were stored with.
- Troubleshooting row "Reminder fires at the wrong time": point at `settings.timezone` and the `Times in …` hint.

**`PROGRESS.md`**

- Row 61 ☑: the step-1 SHA, gates, red-first lines, test count, eager JS before/after, deploy run, live `version.json`, the smoke result, deviations numbered.
- Day-7 backlog: items 1 and 2 → ☑ with `(done: chunk 61, <SHA>)`; the status line becomes **5 done, 1 moot, 5 open** with the chunk-61 date.
- Decisions log: D1–D5 (2026-10-13, chunk 61), one row each.
- Last-updated paragraph per the chunk-54 convention; the current chunk-60 paragraph moves to Update history, relabelled `Prior update:` (prefix only).

Commit this prompt as `prompts/chunk-61-timezone-insights-reminders.md` in the same commit. A commit cannot carry its own SHA: if row 61 must name the docs SHA, record it in an immediate `[skip ci]` follow-up (chunk-54 convention).

---

## Out of scope

- Day-7 item 11 (`lib/today.ts` due-today derivation) and items 3, 4, 9, 10.
- A Settings control for `settings.timezone` (there is none today; the column keeps its schema default unless written directly).
- Planner time zones.
- Reformatting `remindAt` anywhere it is displayed outside the popover (nothing else renders it as a time).
- Backfilling or rewriting stored `remind_at` values.
- The Routines/Dashboard `'America/New_York'` fallback.

## Report back

- **Step 1:** commit SHA; `git diff --stat 265d1e8 <SHA>`; gates (`tsc -b`, `eslint .`, test count and file count, build); the red-first failing lines for D2 test 4, D3 test 1 and D4 test 1; eager JS before / after / delta; the empty `package.json` diff; deploy run id and result; live `version.json`.
- Every deviation, numbered.
