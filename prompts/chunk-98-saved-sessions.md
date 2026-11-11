# Chunk 98 — Saved focus and breathing sessions, shown in Insights

Repo: smrios07mdb/dashboard. Base: `main` at `7bd18f4` (chunk 97 merged ff at `a6d1337`; docs `7bd18f4`). Branch: `chunk-98-saved-sessions`.
Model: Fable 5.2 (Rust shell, a migration and the PWA in one chunk).

**Push the branch and stop. Do not merge to `main`.** The orchestrator gates the branch first.

## Why
The menu bar app runs focus and breathing sessions, but nothing is kept: quitting or finishing a session leaves no trace, and Insights only reports **estimated** time from completed tasks. This chunk saves each focus and breathing session to Supabase and adds a **tracked** section to Insights. It is the last chunk of the menu bar series (91–98).

## Locked decisions

### What is saved
- **D1 One table, two kinds.** Every focus phase and every breathing session that ran for **at least 60 s of active time** becomes one row. Breaks are not saved. Shorter ones are dropped silently.
- **D2 Focus.** A focus phase ends one of three ways:
  - `completed` — time reached its scheduled end. `ended_at` = the **scheduled** `ends_at` (even when the Mac slept through it), active = `phase_len_ms`.
  - `skipped` — Skip to break. `ended_at` = now, active = `phase_len_ms − remaining_ms(prev, now)`.
  - `stopped` — End, or sign-out's `pomodoro_stop`. Same arithmetic as skipped.
  - Pauses are excluded from active time by that arithmetic. `planned` = `phase_len_ms` at the end (so `+5 min` counts). The task (`id`, `title`) is the session's task, or none for a bare session.
- **D3 Breathing.** `completed` — reached `ends_at`: `ended_at` = `ends_at`, active = `ends_at − started_at`. `ended` — Esc, `meditation_end` or sign-out: `ended_at` = now, active = `now − started_at`. `planned` = `ends_at − started_at`. Never a task.
- **D4 Rust records, the web view writes.** The hidden web view is suspended and can miss events (§16), so the shell keeps a **ledger** of finished sessions until the web view confirms each one is written. The web view writes through the app's own `repo` (online, or into the existing outbox when offline), then acknowledges. Nothing is lost while the app runs; D6 covers quitting.

### Shell (`menubar/src-tauri/src/`)
- **D5 `sessions.rs` (new).** Top half pure and tested:
  - `Kind { Focus, Meditation }`, `Outcome { Completed, Skipped, Stopped, Ended }`, `Record { kind, started_at, ended_at, planned_ms, active_ms, outcome, task: Option<(id, title)> }` (all times epoch ms), `Entry { seq: u64, record }`.
  - `keep(&Record) -> bool` — `active_ms >= 60_000`.
  - `entries_json(&[Entry]) -> String` — hand-written, using `pomodoro::json_string`: `[{"seq","kind":"focus"|"meditation","startedAt","endedAt","plannedMs","activeMs","outcome":"completed"|"skipped"|"stopped"|"ended","taskId":string|null,"taskTitle":string|null}]`.
  - `ledger_text(&[Entry]) -> String` and `parse_ledger(&str) -> Vec<Entry>`: one line per entry, fields separated by tabs, in the order of the JSON keys; in `taskId` / `taskTitle`, `\\`, `\t` and `\n` are escaped and `-` means none. A malformed line is skipped, never a panic.
  - Cap: 500 entries; past that the oldest is dropped.

  Bottom half, glue: `Sessions` (one `Mutex`, managed by Tauri). **Its lock is a leaf: never taken while the pomodoro or meditation lock is held, and never held across an emit.** `record(app, Record)`: if `keep`, append with the next `seq`, persist, then emit `sessions` (payload: the pending count as a string). Commands: `sessions_pending` → `entries_json`; `sessions_ack { seqs: number[] }` → remove those, persist, answer the pending JSON; `sessions_clear` → remove all, persist.
- **D6 The ledger survives a quit.** File: `app.path().app_data_dir()` + `sessions-ledger.tsv`. Read once in `setup` (`seq` continues from the highest found), rewritten after every change through a temp file in the same folder and a rename (the `login.rs` pattern). Empty ledger → the file is removed. This is the shell's second file; update every "the only file the shell writes" sentence.
- **D7 `pomodoro.rs`.**
  - `State` gains `started_at: SystemTime` (`UNIX_EPOCH` when idle), set in `start` and reset in `to_idle` / when a focus ends.
  - Pure `ended_focus(prev: &State, next: &State, now: SystemTime) -> Option<Record>`: `Some` only when `prev.phase == Focus && next.phase != Focus`; natural when `!prev.paused && now >= prev.ends_at`, otherwise `skipped` if `next.phase` is a break, else `stopped`.
  - Call it with **the state before `advance`** and the final state, in both `Pomodoro::change` and `spawn_loop`, inside the lock; push to `Sessions::record` **after** the lock is released (beside `send_music`).
  - Nothing else in the pomodoro changes: timing, transitions, tray, events and the snapshot JSON stay as they are (`started_at` is not added to the snapshot).
- **D8 `meditation.rs`.**
  - Pure `ended_session(prev: &MedState, next: &MedState, now: u64) -> Option<Record>`: `prev.session` is `Some(s)` and `next.session` is `None` or has another `started_at`; natural when `now >= s.ends_at`.
  - In `Meditation::apply`, computed from `g.state` (before `tick`) and `next`, inside the lock; recorded after the lock is released, beside the existing `ended` handling.
  - Nothing else changes.
- **D9** `lib.rs`: `mod sessions;`, manage `Sessions` loaded from the file, and the three commands in the handler list. No new crate, plugin or capability; `Cargo.lock` unchanged.

### Database
- **D10 Migration 22, `supabase/migrations/22_tracked_sessions.sql`**, idempotent, in the shape of migration 20:
  ```sql
  create table if not exists public.tracked_sessions (
    id uuid primary key,                                   -- set by the client (D12)
    user_id uuid not null references auth.users(id) on delete cascade,
    kind text not null check (kind in ('focus','meditation')),
    started_at timestamptz not null,
    ended_at timestamptz not null,
    planned_seconds int not null check (planned_seconds between 1 and 86400),
    active_seconds int not null check (active_seconds between 60 and 86400),
    outcome text not null,
    task_id uuid null,                                     -- no FK on purpose
    task_title text null check (char_length(task_title) <= 200),
    created_at timestamptz not null default now(),
    check (ended_at >= started_at),
    check (active_seconds <= extract(epoch from (ended_at - started_at)) + 1),
    check ((kind = 'focus' and outcome in ('completed','skipped','stopped'))
        or (kind = 'meditation' and outcome in ('completed','ended'))),
    check (kind = 'focus' or (task_id is null and task_title is null)),
    unique (user_id, kind, started_at)
  );
  create index if not exists tracked_sessions_user_started_idx
    on public.tracked_sessions (user_id, started_at);
  ```
  - RLS on; select / insert / update / delete own rows only (`auth.uid() = user_id`). Update exists only because an upsert needs it; nothing edits a session.
  - `supabase_realtime` publication + `replica identity full` (the §4 rule), though no client subscribes.
  - **No FK on `task_id`:** a task deleted before the write would otherwise fail the insert. `task_title` keeps the name; Insights joins to live tasks client-side.
  - **Apply it** with the Supabase MCP `execute_sql` on `dctfspcbkqvvyptddtif` in one call (the chunk-64/89 precedent), after the unit tests pass. Verify with SQL: the columns, the five checks, the unique key, four policies, the publication row and `relreplident = 'f'`. Then, as the authenticated test path allows, prove RLS: another user's select returns 0 rows. If the MCP is not available in your session: **stop and report** — do not push code that writes to a table that doesn't exist.

### Client data layer (`src/`)
- **D11** The `today_marks` shape at every touchpoint:
  - `src/db/types.ts`: `TrackedSession` (camelCase), `TABLES.trackedSessions = 'tracked_sessions'`.
  - `mappers.ts`: row type, `trackedSessionFromRow`, `trackedSessionToRow`.
  - `dexie.ts`: **v8**, `tracked_sessions: '&id, startedAt, kind'`, no upgrade.
  - `outbox.ts`: `SPECS.tracked_sessions`, `upsertOnConflict: 'id'`.
  - `repo.ts`: `applyServerEcho` case; `repo.trackedSessions`:
    - `listInRange(fromIso, toIso)` — `readWithFallback`; online selects `started_at >= from and started_at < to` and puts the rows into Dexie (no clear); the fallback filters Dexie by `startedAt` in JS.
    - `save(input)` — `writeRow`, `op: 'insert'`, `.upsert(row, { onConflict: 'id' })`.
    - `listAll()` and `delete(id)` for the wipe, in the `notes` shape.
  - `localCache.ts`: `wipeLocalCache` clears `tracked_sessions`.
  - **No realtime handler.**
- **D12 Deterministic id.** `src/lib/trackedSessions.ts` (pure): `sessionId(userId, kind, startedAtMs)` = SHA-256 (Web Crypto `crypto.subtle`) of `` `${userId}|${kind}|${startedAtMs}` ``, the first 16 bytes formatted as a UUID with version nibble `8` and variant `10`. The same session written twice (a lost ack, two drains) lands on one row. Golden-value test.
- **D13 Wipe, export, import.** "Wipe my data" deletes every tracked session (after notes, before tasks). **Not exported** in this chunk (`EXPORT_TABLES` unchanged, `EXPORT_VERSION` stays 1); Merge and Replace import do not touch the table, and Replace leaves sessions in place with `task_title` intact. Record in the Decisions log.

### Menu bar web view (`menubar/src/`)
- **D14 `menubar/src/sessions.ts`** (pure core, injected backend and writer): `createSessionSync({ pending, ack, clear, write, userId })` with `drain()`:
  - At most one drain at a time; a drain requested while one runs runs once more after it.
  - For each entry, `write` builds `{ id: sessionId(…), userId, kind, startedAt, endedAt (ISO), plannedSeconds: round(ms/1000), activeSeconds: floor(ms/1000), outcome, taskId, taskTitle }` and calls `repo.trackedSessions.save`. Resolved (online **or** queued in the outbox) → its `seq` is acknowledged. A client error (4xx, `isClientError`) → logged, and acknowledged anyway (a malformed entry must not block the rest). Anything else thrown → not acknowledged, the drain stops, the next trigger retries.
  - Acks are sent once per drain, for everything written.
- **D15 Triggers** (`App.tsx`), signed in only:
  - after the sign-in setup;
  - on each `sessions` event;
  - on each `popover-shown`;
  - **Quit** (footer): `await drain()` (at most 3 s), then `quitApp()`;
  - **Sign out**: `await drain()` (at most 3 s), then `signOutUser()`. The signed-out branch calls `sessions_clear` after the existing `pomodoro_stop` / meditation end, so the next account never receives this one's entries.
- **D16** `native.ts`: `sessionsPending()`, `sessionsAck(seqs)`, `sessionsClear()`, `watchSessions(cb)`, no-ops outside Tauri. Argument names tested on both sides (`seqs`).
- No visible change in the popover.

### Insights (`src/screens/Insights.tsx`, `src/lib/sessionInsights.ts`)
- **D17 A tracked section.** Below the existing per-subcategory table: a section `aria-label="Focus and breathing"` with a heading `Focus and breathing` and the label `Tracked in the menu bar app`. Same range and same `settings.timezone` as the screen; a session belongs to the day its `started_at` falls on.
  - Four cards, the existing card grid style:

    | Label | Value | Hint |
    |---|---|---|
    | `Focus time` | sum of focus active time (`fmtMinutes`) | `tracked, pauses excluded` |
    | `Focus sessions` | count | `` `${n} ran to the end` `` (`completed`) |
    | `Breathing` | sum of breathing active time | `` `${n} sessions` `` |
    | `Most focused` | the task with the most focus time (live title, else `task_title`) | `by tracked time`, or `—` |

  - One stacked bar chart per day, two series, `Focus` (`var(--jewel-jade)`) and `Breathing` (`var(--jewel-coral)`), with the existing chart's axes, grid, tooltip and legend markers (`SeriesMarker` 0 and 1). Minutes on the y-axis.
  - **Category filter:** All → everything. Work / Personal → only focus sessions whose `task_id` is a live task in that category; the section then shows the line `Bare focus sessions and breathing show under All.`
  - **Empty** (nothing in range after the filter): no cards, no chart, the line `No focus or breathing sessions in the last ${range} days. Sessions from the menu bar app show here.`
  - The headline estimate cards at the top, and their wording, do not change.
- **D18 Loading.** The existing `load()` adds `repo.trackedSessions.listInRange(from, to)` and `repo.tasks.list()` to its `Promise.all`, each caught on its own (`[]` and a `console.error`) so a failure here never empties the estimates.
- **D19 Pure helpers** in `src/lib/sessionInsights.ts`: `sessionTotals(sessions, scope)` and `sessionDays(sessions, dayKeys, tz)`; `scope` is `null` (All) or the set of live task ids in the chosen category. The screen holds no arithmetic.

## Out of scope
- Any visible change in the popover (no "today" count, no history).
- Editing or deleting a single session; exporting sessions.
- Breaks; streaks from sessions; per-task time on the Dashboard.
- Notifications, sounds; the full-screen reminder limit.

## Guardrails
- `src/` changes only in: `db/types.ts`, `db/mappers.ts`, `db/dexie.ts`, `db/outbox.ts`, `db/repo.ts`, `db/localCache.ts`, `lib/trackedSessions.ts` (new), `lib/sessionInsights.ts` (new), `lib/sample-data.ts` (wipe), `screens/Insights.tsx`, and their tests. Anything else: stop and report.
- No new npm dependency, crate or Tauri plugin. `Cargo.lock` unchanged. `tauri.conf.json`, `capabilities/`, `Info.plist`, `Entitlements.plist`, CSP unchanged.
- `sound.rs` and `login.rs` unchanged. In `pomodoro.rs` and `meditation.rs`, only D7 / D8. The chunk-96 lock rules hold: the `Sessions` lock is a leaf, never taken under another lock.
- No `localStorage` key added. No timer or session state in `localStorage`.
- One run owner for the native run: confirm no other session is driving the app, Spotify or the dev DB.
- DB writes: only the migration and the sessions the native run creates; delete those rows at the end **by the ids you recorded**, never by a time window alone.
- Leave Spotify, the installed app, `hup:mb:*` / `hupo.menubar.theme` storage, `~/Library/LaunchAgents` and the ledger file as you found them.
- Do not start another chunk or write a handoff or brief.

## Tests (red first)
- **Rust** (`cargo test`):
  - `sessions.rs`: `keep` at 59 999 / 60 000; `entries_json` golden text with and without a task, a title holding `"`, `\` and a newline; `ledger_text` → `parse_ledger` round trip including a title with a tab and a newline; malformed lines skipped; the 500 cap drops the oldest; `seq` continues past the highest parsed.
  - `pomodoro.rs` `ended_focus`: natural end (records the scheduled end, not `now`); a Mac that slept through focus **and** break (one `advance` crossing both → one `completed` record); skip while running; skip while paused (pause excluded); stop; `+5 min` then complete (`planned` and active include it); no record for a break ending, for `start` from a break, for pause / resume / extend; `started_at` set by `start` and cleared on idle.
  - `meditation.rs` `ended_session`: natural via `tick`; `end` early; a session that ended while the Mac slept; none when nothing ran; none for `start`, `snooze`, `skip`.
- **Vitest:**
  - `trackedSessions`: `sessionId` golden value; version and variant bits; same input → same id; a different `kind` or `startedAtMs` → a different id.
  - mappers round trip; `repo.trackedSessions.save` online, offline (outbox row with `upsertOnConflict: 'id'`), and the replay; `listInRange` fallback; `wipeLocalCache` clears the store; `wipeMyData` deletes sessions; Dexie v8 opens over a v7 database with data kept.
  - `sessions.ts`: drain writes then acks; outbox path acks; 4xx acks and continues; a thrown network error stops without acking; a second drain request during one runs once more; acks batched.
  - `App`: drain on sign-in, on a `sessions` event, on show; Quit and Sign out drain first (and give up after 3 s); signed-out clears.
  - `native.ts`: the three command names and `seqs`.
  - `sessionInsights`: totals for All and for a category; bare and breathing sessions excluded from a category; `Most focused` uses the live title, else the snapshot; day buckets in `America/New_York`, `UTC` and `Asia/Tokyo` (a session at 23:30 local stays on its own day; a session crossing midnight counts on its start day).
  - `Insights`: the section renders the four cards and the chart; the category note; the empty line; a failed sessions read leaves the estimate cards intact.
  - Existing suite green.

## Gates
1. `npm ci`, `npm run lint`, `npm run menubar:typecheck`; `npm test` with `TZ=America/New_York`, `TZ=UTC`, `TZ=Asia/Tokyo`; `cargo test --manifest-path menubar/src-tauri/Cargo.toml`; `git diff 7bd18f4 -- menubar/src-tauri/Cargo.lock` empty; `npm run build` green (the PWA bundle name **will** change; record base and head names).
2. The migration applied and verified (D10), with the SQL output in the report.
3. `export PATH="$HOME/.cargo/bin:$PATH"`, `npm run menubar:build`, then `codesign --verify --deep --strict --verbose=2 <app>`, `codesign -d -r- <app>` (leaf `H"8f0d254bddc27a5990591035bd4dfd49b105611d"`), entitlements still only apple-events.
4. Native run of the **branch build from its bundle folder** (quit the installed app first; `pgrep -fl Hupomnemata` → one process, from the bundle folder). Drivers: System Events through `osascript` (CLAUDE.md "Driving the menubar popover and Spotify", "Driving Settings natively"); the chunk-95 SQLite method for `localStorage`; `cat` for the ledger file; Supabase MCP `execute_sql` (read only, except the final delete) for the rows. Before: record Spotify's state, every `hup:mb:*` row and `hupo.menubar.theme`, whether the ledger file exists, and `select count(*) from tracked_sessions`. Set `hup:mb:sound` `auto: false` for the run (SQLite method, app quit) so Spotify is never touched. Finder windowed and frontmost.
   1. **Bare focus, completed while hidden.** Settings › Focus 1 min. Start focus, hide the popover (click Finder). After 70 s: read the ledger file (record whether it holds one line or is already empty — both are valid) and the DB. ⌥H; within 5 s: the ledger file is gone and there is exactly one new row: `kind focus`, `outcome completed`, `active_seconds 60`, `planned_seconds 60`, `task_id` null.
   2. **On a task, paused, skipped.** Focus 2 min. Start focus on the first Today row (its play button). After about 30 s Pause; 10 s later Resume; at about 75 s of active time **Skip to break**, then **Skip break**. One new row: `skipped`, `active_seconds` within ±3 of what you timed, `ended_at − started_at` larger than active by the pause (±3 s), `task_id` and `task_title` of that row. End any break.
   3. **Too short.** Start focus, End at about 20 s. No new row, ledger empty.
   4. **Breathing** (any Length of 3 min or more). ⌥⇧M, Esc at about 70 s → one row `meditation`, `ended`, `active_seconds` ≈ 70, no task. Then ⌥⇧M, Esc at about 20 s → no row.
   5. **Survives a quit.** Focus 1 min, start, hide the popover; after 65 s `osascript -e 'quit app "Hupomnemata"'` without showing it. Read the ledger file: record its text (one line expected, unless the hidden view drained first — record which). Relaunch, ⌥H → the file is gone, and there is exactly one new row for it (not two).
   6. **Insights.** Not checkable on the branch (the PWA deploys only from `main`): record as unverified here; the merge step checks it live.
   7. **Cleanup:** delete exactly the rows created in 1, 2, 4 and 5 by id; `select count(*)` equals the before count.
5. **Restore**: put Focus / Length back through Settings or SQLite; every `hup:mb:*` row and `hupo.menubar.theme` exactly as found (delete rows that were absent); the ledger file as found; Spotify as found; quit the branch app; `open ~/Applications/Hupomnemata.app`; `pgrep -fl Hupomnemata` → one process, from `~/Applications`.

## Docs (same pass)
- **ARCHITECTURE §4**: `tracked_sessions` in the schema block and a **Tracked sessions (chunk 98)** paragraph: D1–D4, D10–D13 (deterministic id, no FK, no realtime handler, not exported, wiped). Realtime publication list: twelve tables.
- **ARCHITECTURE §12**: the tracked section (D17–D18), and that the headline cards remain estimates.
- **ARCHITECTURE §16**: a **Saved sessions (chunk 98)** paragraph (D5–D9, D14–D16); Pomodoro "Not built" and Meditation D14 "Nothing is saved (chunk 98)" updated; Shell commands: the three new ones and the `sessions` event; the two files the shell writes (LaunchAgent, ledger). The series is complete: "First of a series (91–98)" → describe it as built.
- **CLAUDE.md**: one paragraph "Reading saved sessions natively (chunk 98)": the ledger file's path and format, reading rows with `execute_sql`, deleting by recorded ids — only what isn't already there.
- **PROGRESS**: row 98, the "Last updated" line (the previous one moves to "Prior update"), and the Decisions log: sessions saved by a Rust ledger acknowledged by the web view; deterministic client id; no FK on `task_id`; sessions under 60 s not kept; not exported (D13).
- Commit this prompt as `prompts/chunk-98-saved-sessions.md` (it's already in the working tree).

## Push
Branch only: code commit(s), then the docs commit with `[skip ci]`.

## Report
- Branch, head SHA and code SHA(s).
- Every file under `src/` touched (must match the guardrail list).
- Vitest counts per zone and the `cargo test` count; base and head PWA bundle names; the `Cargo.lock` diff (expected empty).
- The migration verification output.
- Signature lines.
- Each native step with its driver and pass / fail / unverified, the rows read back (id, kind, outcome, active, planned, task), the ledger file text where read, and the cleanup counts.
- The unverified list and every deviation.
