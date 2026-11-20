# Chunk 101 — Today pins stay until the task is done

**Base:** `main` at `4f4afb5`. Branch: `chunk-101-today-pins-persist`.
Authority: `ARCHITECTURE.md` → `prompts/README.md` → this prompt. Read `CLAUDE.md` first.

## The problem

A task the user puts on Today with the sun toggle disappears the next morning.
`today_marks.day` is stamped with the day the pin was made, and
`resolveTodayDeltas` (`src/state/todayPlan.ts`) keeps only marks where
`m.day === day`. At rollover every pin stops applying, so only tasks with an
auto signal (overdue, due today, P1) come back. The menu bar app reads the same
function (`menubar/src/todayView.ts`), so its Today list loses them too.

The user's rule: **a task on Today stays there until it is completed.**

## Decisions (locked)

- **D1 — Pins don't expire.** A `pin` mark applies on every day from the one it
  was made on, until the task is completed or the user takes it off Today.
- **D2 — Completion ends a pin.** A pinned task completed on an earlier day (in
  the Settings time zone) is not a member. A task completed **today** stays a
  member, as now (it lingers and counts toward done/total). Un-completing a task
  whose pin is still stored puts it back on Today.
- **D3 — Removals stay day-scoped.** A `remove` mark still applies only on the
  day it is dated. Taking a task off Today is an explicit choice for that day; an
  overdue/due/P1 task removed today comes back tomorrow, so nothing open falls
  off Today for good without being completed or edited.
- **D4 — Taking a pinned task off writes `remove` as now.** The upsert replaces
  the pin row (one row per task), so the pin is gone; from tomorrow the task is
  on Today only if it has an auto signal.
- **D5 — Auto members are unchanged.** They leave only when their signal goes
  (the user moved the due date, cleared the reminder, lowered priority) or on
  completion. No writes for auto members.
- **D6 — No migration.** `today_marks` keeps its shape; `day` now means "the
  day the mark was made". Don't edit `supabase/migrations/20_today_marks.sql`.
- **D7 — One code path.** The change lives in `resolveTodayDeltas`, so the
  dashboard and the menu bar app pick it up together. No Rust change.
- **D8 — Rollover.** `useTodayPlan`'s re-seed on a new day must keep every
  standing pin (it re-resolves from marks, so it should; prove it with a test).
  A rollover still writes nothing.

## Implementation

1. `src/state/todayPlan.ts` — `resolveTodayDeltas(marks, tasks, day, localWrites)`:
   - Needs the time zone to place `completedAt`. Add a `timeZone: string`
     parameter (update both callers: `useTodayPlan` and
     `menubar/src/todayView.ts`).
   - For each mark whose task is in `tasks`:
     - `remove`: counts only when `m.day === day` (unchanged).
     - `pin`: counts when `m.day <= day` (string compare of `YYYY-MM-DD` is fine)
       **and** the task is open, or its `completedAt` falls on `day` in
       `timeZone` (`dateKeyIn`).
   - The newer-observation rule for local writes is unchanged. A local `pin`
     write follows the same completion rule as a stored one.
   - Update the file header comment and the `useTodayPlan` comments that say
     yesterday's plan never resurfaces.
2. `src/lib/today.ts` — no logic change expected. If `resolveToday` is the
   cleaner place to drop a completed-before-today pin, say so in Review notes;
   the behaviour in D2 is what's required.
3. `ARCHITECTURE.md` — §4 "Today marks" ("Day-scoping") and the §13 Today
   paragraph ("They hold for the Settings-zone day they were made on and stop
   applying at day rollover"): rewrite to D1–D4. Note the suggestion strip
   (`lib/todaySuggest`) counts standing pins like any other member.

## Tests (red first)

`src/state/todayPlan.test.ts`:
- Replace "ignores a mark dated before today": a pin dated `2020-01-01` on an
  open task **is** a member; a remove dated `2020-01-01` on a P1 task does
  **not** stick; nothing is written.
- A pin from an earlier day on a task completed on an earlier day → not a member.
- A pin from an earlier day on a task completed today → member (lingers).
- A pin from an earlier day whose task is un-completed (completedAt → null) →
  member again.
- A pin dated in the future (clock skew) does not apply until that day.
- Rollover with the tab open (extend the chunk-44 block): after midnight, a pin
  made yesterday is still a member and no write happens; yesterday's removal of
  a P1 task no longer applies.
- Completion boundary is the Settings zone: a task completed 23:30 New York on
  the previous day, viewed just after midnight New York, is dropped — in all
  three test zones.

`menubar/src/todayView.test.ts`:
- Replace "ignores marks dated yesterday, pin and remove alike": a yesterday pin
  shows, a yesterday remove doesn't.
- A yesterday pin on a task completed yesterday doesn't show.

Check `src/screens/Dashboard.test.tsx` and `src/lib/taskStreak.test.ts` for any
case that relies on a pin expiring, and update only what D1/D2 change.

## Guardrails

Touch only: `src/state/todayPlan.ts`, `menubar/src/todayView.ts`, their tests,
`src/screens/Dashboard.test.tsx` / `src/lib/taskStreak.test.ts` if needed,
`ARCHITECTURE.md`, `PROGRESS.md`, this prompt. No schema, no Rust, no
`package*.json` / `Cargo.*` changes.

## Gates

- `npm run lint`, `npm run menubar:typecheck`, `npx tsc -p tsconfig.app.json --noEmit`.
- Vitest in `TZ=America/New_York`, `TZ=UTC`, `TZ=Asia/Tokyo` — all green.
- `cargo test` in the menu bar crate (unchanged count expected).
- `npm run build` green. Placeholder `.env.local` rules per `CLAUDE.md`
  (real `VITE_CALDAV_PROXY_URL`).
- Mutations: flip `<=` to `===` on the pin day check, drop the completion check,
  and drop the "completed today" exception — each must fail a test; revert.
- Live check against the dev DB (driver: Claude in Chrome on `npm run dev`,
  5173; one run owner, prefix `Smoke-1011-*`): create task `Smoke-1011-T1`
  (no due date, P3), pin it, then set its `today_marks.day` to yesterday with
  Supabase MCP `execute_sql` (by id). Reload: it is on Today. Complete it, then
  set `completed_at` to yesterday by SQL; reload: it is gone. Delete the task by
  id (the mark cascades). Name the driver in the run record.

## Ship

Code commit → push → deploy workflow green (`gh run list`) → docs commit with
`[skip ci]` pushed separately (CLAUDE.md chunk-46 rule). Merge ff to `main`,
delete the branch. `PROGRESS.md` row 101 per CLAUDE.md; Decisions log row:
"2026-11-20 — Today pins persist until completion; removals stay day-scoped".
