# Claude Code prompt — Chunk 82: park deletes on any sign-out, Planner block focus, one zone-wall helper

You are Claude Code in `/Users/sergiorios/Documents/To-Do Dashboard` (`smrios07mdb/dashboard`). Base: `6ae1574` (code = `0f33459`, deployed). Authority: `ARCHITECTURE.md` → `prompts/README.md` → this prompt.

App code only: no SQL, no migration, no proxy, no new dependency, no `vite.config.ts` / `src/sw.ts` / workflow change. None of the files below is on the `prompts/README.md` locked list.

This prompt runs end to end: implement, ship, gate, smoke, docs. On any failure, stop at that point and report.

## Why

The three known gaps chunk 81 added to PROGRESS.md, verified against the source at `6ae1574`:

1. **Sign-outs not started by the two buttons still lose a just-deleted task.** Token expiry and a sign-out in another tab fire `SIGNED_OUT` (handled once, app-wide, by `installSignOutCleanup` in `src/lib/signOutCleanup.ts`), but nothing touches `taskUndo`. The batch's 6 s timer then fires with no session, `repo.tasks.bulkDelete` matches no rows under RLS, `commit` calls `drop(ids)`, the id leaves localStorage, and the task silently survives. `ProtectedLayout` already calls `resumePendingDeletes()` whenever `userId` becomes non-null, so ids that are still pending at the next sign-in would commit then.
2. **The Planner's notes opener returns focus to `body`.** `Planner.tsx:1428–1431` calls `openTaskNotes(actionEntry.task.id, noteId)` with no third argument. The same holds for the block action sheet itself: `BlockActionSheet` is opened from state (`setActionBlock`, passed as `onOpenActions` to `WeekGrid` at ~1330 and `DayTimeline` at ~1362), not from a Radix trigger, so closing it (Escape, Cancel, or any action) also leaves focus on `body`.
3. **The other `fromZonedTime` call sites still depend on the device's zone — and two are wrong on every device.** Measured by the orchestrator with `date-fns-tz` 3.2.0 under hosts `America/New_York`, `UTC`, `Asia/Tokyo`, `Australia/Sydney`, `America/Havana`, `Pacific/Kiritimati`:
   - **Midnight that does not exist** (clocks jump 00:00 → 01:00): `fromZonedTime('2026-03-08T00:00:00.000', 'America/Havana')` → `2026-03-08T04:00:00.000Z` on **every** host, which is 23:00 on **March 7** in Havana. So `SetDuePopover.fromDueInputValue('2026-03-08', 'America/Havana')` stores a due date that reads back as the day before, and `clock.startOfDayIso` returns an instant on the previous day. Same pattern: `Asia/Beirut` 2026-03-29, `Africa/Cairo` 2026-04-24, `America/Santiago` 2026-09-06.
   - **Midnight that happens twice** (`America/Havana` 2026-11-01, clocks 01:00 → 00:00): `04:00:00.000Z` on New York / UTC / Havana hosts, `05:00:00.000Z` on Tokyo / Sydney / Kiritimati hosts.
   - **Late-evening repeats** (`Asia/Beirut` 2026-10-24T23:30, `America/Santiago` 2026-04-04T23:30) are host-dependent the same way; these reach `SetReminderPopover`, where chunk 81's ±30/60-minute loop (built on `formatInTimeZone`) covers them only partly.
   - `formatInTimeZone` itself is not fully host-independent: under host `America/Havana`, `formatInTimeZone(new Date('2026-03-08T05:00:00.000Z'), 'America/New_York', …)` printed `01:00 -05:00` (correct: `00:00 -05:00`). The new helper therefore reads wall times with `Intl` only.
   - Call sites at `6ae1574`: `SetReminderPopover.tsx` (`fromZonedInputValue`), `SetDuePopover.tsx:58` (`fromDueInputValue`), `lib/clock.ts:85` (`startOfDayIso`), `lib/slots.ts:78` and `:82` (working-window bounds).

## Decisions (locked)

- **D1 — Park pending deletes on every sign-out.**
  - `src/lib/taskUndo.ts`: new export `parkPendingDeletes(): number`:
    1. For every batch in `waiting`: `clearTimeout(batch.timer)` and, if it has one, `toast.dismiss(batch.toastId)`. Then `waiting.clear()`.
    2. For every id in `pending` that is **not** in `committing`: `scheduled.delete(id)`. The id stays in `pending` (so it stays hidden from list reads) and in storage.
    3. `persist()` — rewrites storage from this tab's map, so a drop in another tab cannot have erased these ids.
    4. Return the number of ids parked (step 2's count). No toast, no `refresh()`.
    - Ids already in `committing` are left alone (their request is in flight).
    - Effect: the next `resumePendingDeletes()` (run by `ProtectedLayout` when a user is present again) commits them at once, because they are overdue.
    - Update the module header comment: pending ids are parked on `SIGNED_OUT` (chunk 82) and committed by `resumePendingDeletes` at the next signed-in start.
  - `src/lib/signOutCleanup.ts` `installSignOutCleanup`: on `SIGNED_OUT`, call `parkPendingDeletes()` **synchronously, before** `clearLocalDataOnSignOut(...)`. No other event parks. Extend the function's comment with one line on why (chunk 82).
  - `signOutUser` is unchanged in behaviour. Correct its comment: on a timeout, a delete whose request is already in flight is **not** retried; anything still waiting is parked by the `SIGNED_OUT` that follows and committed at the next sign-in.
  - `AccountMenu.tsx`, `Settings.tsx`, `ProtectedLayout.tsx`, `main.tsx`: unchanged.
  - Out of scope (record as known gaps): a delete request already in flight when the session ends is not retried; the `hup:pendingTaskDeletes` key is last-writer-wins across tabs; parked ids commit under whichever user next signs in on this device (a different user's RLS matches nothing, so they are dropped and the first user's delete is lost).
- **D2 — Planner hands focus back to the block.** Files: `src/screens/Planner.tsx`, `src/components/planner/BlockActionSheet.tsx`. `WeekGrid`, `DayTimeline`, `TaskBlock`, `NotesProvider`, `notesContext`, `TaskNotesSheet` unchanged.
  - `BlockActionSheet`: new optional prop `onCloseAutoFocus?: (e: Event) => void`, passed straight to `<SheetContent onCloseAutoFocus={…}>`. Doc comment: where focus goes on close (chunk 82). Nothing else changes in it.
  - `Planner.tsx`:
    - `actionOpener = useRef<HTMLElement | null>(null)` and `notesHandoff = useRef(false)`.
    - `openActions(block)` (a `useCallback`, no deps): set `actionOpener.current` to `document.activeElement` if it is an `HTMLElement` and not `document.body`, else `null`; then `setActionBlock(block)`. Pass `openActions` instead of `setActionBlock` as `onOpenActions` to **both** `WeekGrid` and `DayTimeline`.
    - `refocusOpener(ev: Event)`: if `actionOpener.current?.isConnected`, `ev.preventDefault()` then `actionOpener.current.focus()`; otherwise do nothing (Radix default — e.g. the block was unscheduled and unmounted, or a touch tap left focus on `body`).
    - `BlockActionSheet onCloseAutoFocus`: if `notesHandoff.current` is true, set it false, `ev.preventDefault()` and return (focus belongs to the notes sheet now); otherwise `refocusOpener(ev)`.
    - `onOpenNotes`: set `notesHandoff.current = true`, call `openTaskNotes(actionEntry.task.id, noteId, refocusOpener)`, then `setActionBlock(null)` (same order as today, plus the flag and the third argument).
  - Closing the action sheet by any route — Escape, Cancel, Mark done / not done, Move to next open slot — returns focus to the block that opened it when that block is still in the DOM. Unschedule removes the block, so it falls back to the default.
- **D3 — One zone-wall helper, used by every call site.**
  - New `src/lib/zonedTime.ts`, export `zonedWallToDate(wall: string, tz: string): Date | null`:
    - Accepts `YYYY-MM-DDTHH:mm`, `YYYY-MM-DDTHH:mm:ss` or `YYYY-MM-DDTHH:mm:ss.SSS`. Anything else → `null`. Out-of-range fields (month 13, Feb 30, hour 24) → `null` (check by round-tripping the fields through `Date.UTC`). An unknown zone (`Intl.DateTimeFormat` throws `RangeError`) → `null`.
    - Reads wall times with `Intl.DateTimeFormat(…, { timeZone: tz, hourCycle: 'h23', year/month/day/hour/minute/second: 2-digit or numeric }).formatToParts` — **not** `date-fns-tz` (see Why 3). Cache one formatter per zone in a module `Map`.
    - Rule (Temporal's `"compatible"` disambiguation): let `U` = the wall's fields read as a UTC timestamp. Read the zone offset at `U − 24 h` (`o1`) and at `U + 24 h` (`o2`). Candidates: `U − o1` and `U − o2`. A candidate is valid when its wall in `tz` equals the input wall to the second.
      - one or two valid → return the **earliest** (a repeated wall time resolves to its first occurrence);
      - none valid (the wall time falls in a gap) → return `U − o1` (the offset before the gap, which lands **after** it, shifted forward by the gap's length).
    - Header comment: why (chunk 82), the rule, and that it is host-independent because it uses `Intl` only.
  - Call sites — after this, `git grep -n fromZonedTime -- src` prints nothing:
    - `SetReminderPopover.tsx` `fromZonedInputValue`: `if (!s) return null`, then `zonedWallToDate(s, tz)?.toISOString() ?? null`. Delete chunk 81's ±30/60 loop and its comment. Doc comment: a repeated wall time is its earlier instant; a skipped one is shifted forward by the gap. `formatInTimeZone` stays for `toZonedInputValue`.
    - `SetDuePopover.tsx` `fromDueInputValue`: keep the regex; `zonedWallToDate(`${s}T00:00`, tz)?.toISOString() ?? null`. Doc comment: on a day with no 00:00 this is the day's first instant.
    - `lib/clock.ts` `startOfDayIso`: `zonedWallToDate(`${dateKey}T00:00`, timezone)`; if `null`, `throw new RangeError(`Invalid date or time zone: ${dateKey} ${timezone}`)` (base threw `RangeError` from `toISOString` on invalid input — keep it throwing). Doc comment: the first instant of the day, even where midnight is skipped.
    - `lib/slots.ts` `windowStart` / `windowEnd`: `zonedWallToDate(…)`; if either is `null`, throw the same `RangeError` shape. The `${dateKey}T${pad(h)}:00:00` strings stay.
    - If `git grep -n "fromZonedTime" -- src` at `6ae1574` finds any call site other than these five, **stop and report** before implementing D3.
  - **Revises chunk 81 D3 for skipped times only.** `fromZonedInputValue('2026-03-08T02:30', 'America/New_York')` changes from `2026-03-08T06:30:00.000Z` (01:30 EST, an hour **before** the typed time, so the reminder would fire early) to `2026-03-08T07:30:00.000Z` (03:30 EDT). Ambiguous times are unchanged (earlier instant). Existing `SetReminderPopover.test.tsx` (6)'s `02:30` assertion is the **only** existing expectation allowed to change in this chunk.
  - **Expected values** (orchestrator oracle: an `Intl`-only brute-force scan, byte-identical under hosts `UTC`, `Asia/Tokyo`, `America/Havana`):

    | wall | zone | kind | result |
    |---|---|---|---|
    | 2026-03-08T00:00 | America/Havana | gap | 2026-03-08T05:00:00.000Z |
    | 2026-11-01T00:00 | America/Havana | repeated | 2026-11-01T04:00:00.000Z |
    | 2026-11-01T00:30 | America/Havana | repeated | 2026-11-01T04:30:00.000Z |
    | 2026-03-29T00:00 | Asia/Beirut | gap | 2026-03-28T22:00:00.000Z |
    | 2026-10-24T23:30 | Asia/Beirut | repeated | 2026-10-24T20:30:00.000Z |
    | 2026-10-25T00:00 | Asia/Beirut | normal | 2026-10-24T22:00:00.000Z |
    | 2026-04-24T00:00 | Africa/Cairo | gap | 2026-04-23T22:00:00.000Z |
    | 2026-09-06T00:00 | America/Santiago | gap | 2026-09-06T04:00:00.000Z |
    | 2026-04-04T23:30 | America/Santiago | repeated | 2026-04-05T02:30:00.000Z |
    | 2026-04-05T00:00 | America/Santiago | normal | 2026-04-05T04:00:00.000Z |
    | 2026-03-08T00:00 | America/New_York | normal | 2026-03-08T05:00:00.000Z |
    | 2026-03-08T02:30 | America/New_York | gap | 2026-03-08T07:30:00.000Z |
    | 2026-11-01T01:30 | America/New_York | repeated | 2026-11-01T05:30:00.000Z |
    | 2026-11-01T02:30 | America/New_York | normal | 2026-11-01T07:30:00.000Z |
    | 2026-04-05T01:45 | Australia/Lord_Howe | repeated (30 min) | 2026-04-04T14:45:00.000Z |
    | 2026-10-04T02:15 | Australia/Lord_Howe | gap (30 min) | 2026-10-03T15:45:00.000Z |
    | 2026-10-25T01:30 | Europe/London | repeated | 2026-10-25T00:30:00.000Z |
    | 2026-10-14T09:00 | America/New_York | normal | 2026-10-14T13:00:00.000Z |
    | 2026-10-14T13:00 | America/New_York | normal | 2026-10-14T17:00:00.000Z |
    | 2026-10-14T18:00 | America/New_York | normal | 2026-10-14T22:00:00.000Z |

- **D4 — Tests, red-first against `6ae1574`.**
  1. `src/lib/taskUndo.test.ts` (follow the file's existing mocks):
     - `(13) parkPendingDeletes cancels the window without committing` — delete one task, park, advance past `UNDO_MS` → `bulkDelete` not called; `isPendingDelete(id)` is true; the storage key still lists the id; the return value is 1.
     - `(14) parked ids commit on the next resume` — delete, park, advance to past the window, `resumePendingDeletes()` → `bulkDelete` called once with `[id]`, then storage is clear.
     - `(15) park leaves an in-flight commit alone` — with a deferred `bulkDelete`: delete, `flushPendingDeletes()`, park (returns 0), `resumePendingDeletes()` → `bulkDelete` called exactly once until the deferred settles.
     - `(16) park takes the Undo toast down` — `toast.dismiss` called with the batch's toast id.
  2. `src/lib/signOutCleanup.test.ts` (add `parkPendingDeletes` to the file's existing `@/lib/taskUndo` mock; create that mock if it is absent):
     - a `SIGNED_OUT` event calls `parkPendingDeletes` once, ordered before the outbox count of `clearLocalDataOnSignOut` (compare `invocationCallOrder`);
     - `SIGNED_IN` and `TOKEN_REFRESHED` do not call it.
  3. `src/components/planner/BlockActionSheet.test.tsx`: `onCloseAutoFocus` reaches the content — render open, rerender `open={false}`, the prop is called once with an `Event`.
  4. `src/screens/Planner.test.tsx`, new `describe('Planner — block focus (chunk 82)')`. Reuse the drift test's task/block shape (task `t1` "Deep work", a block today 10:00–11:00 in the default window). Mock `@/components/notebook/notesContext` at file scope with hoisted state: `useTaskNotes(id)` returns `notesFor[id] ?? []` (empty for every existing test), `useOpenTaskNotes` returns a spy; this describe sets one note for `t1`. Both breakpoint branches are mounted (CLAUDE.md), so use the first `task-block` that `WeekGrid` renders.
     - a. focus the block, press Enter → the action sheet opens; click Cancel → once the sheet is gone, `document.activeElement` is that block.
     - b. focus the block, Enter, click `Open` on the note card → the spy is called with `('t1', <noteId>, fn)`; once the action sheet is gone, `document.activeElement` is **not** the block; calling `fn({ preventDefault })` calls `preventDefault` and focuses the block.
     - c. same as b, then remove the block from the DOM (unmount) → `fn` neither throws nor calls `preventDefault`.
  5. New `src/lib/zonedTime.test.ts`: every row of the D3 table; `null` for `''`, `'nope'`, `'2026-02-30T00:00'`, `'2026-10-14T24:00'`, `'2026-10-14'`, and zone `'Mars/Base'`; seconds and milliseconds forms (`'2026-10-14T13:00:00'`, `'2026-10-14T13:00:00.000'` in New York → `2026-10-14T17:00:00.000Z`).
  6. `src/components/SetDuePopover.test.tsx`: `fromDueInputValue('2026-03-08', 'America/Havana')` → `'2026-03-08T05:00:00.000Z'` and `toDueInputValue` of it → `'2026-03-08'`; `fromDueInputValue('2026-11-01', 'America/Havana')` → `'2026-11-01T04:00:00.000Z'`.
  7. `src/lib/clock.test.ts`: `startOfDayIso('2026-03-29', 'Asia/Beirut')` → `'2026-03-28T22:00:00.000Z'`; `startOfDayIso('2026-05-27', 'America/New_York')` → `'2026-05-27T04:00:00.000Z'` (the doc example — passes at base, not a guard); `startOfDayIso('nope', 'America/New_York')` throws `RangeError`.
  8. `src/components/SetReminderPopover.test.tsx`: in (6), change only the `2026-03-08T02:30` expectation to `'2026-03-08T07:30:00.000Z'`; add `(6c) a repeated late-evening time resolves to the earlier instant` — `2026-04-04T23:30` `America/Santiago` → `'2026-04-05T02:30:00.000Z'`; add `(6d) a skipped wall time shifts forward by the gap` — `2026-10-04T02:15` `Australia/Lord_Howe` → `'2026-10-03T15:45:00.000Z'`.
  - **Red-first:** restore `src/lib/taskUndo.ts`, `src/lib/signOutCleanup.ts`, `src/screens/Planner.tsx`, `src/components/planner/BlockActionSheet.tsx`, `src/components/SetReminderPopover.tsx`, `src/components/SetDuePopover.tsx`, `src/lib/clock.ts` and `src/lib/slots.ts` from `6ae1574`, and move `src/lib/zonedTime.ts` aside (new tests kept). Run the eight test files with `TZ=America/New_York`, then again with `TZ=Asia/Tokyo`. Report fail/pass per file and per new case, per zone.
    - Must fail at base on both hosts: D4 items 1–2 (all new cases), 3, 4a, 4b, 5 (module missing), 6's Havana 03-08 case, 7's Beirut case, 8's changed (6) and (6d).
    - Must fail at base under Tokyo only: 6's Havana 11-01 case, 8's (6c).
    - Expected to pass at base (not guards — say so): 4c, 7's New York example, 7's `RangeError` case.
    - Any other outcome: stop and report. Restore the tree and confirm `git status --short` matches the change set.
- **D5 — Budget.** Eager JS delta ≤ **+600 B** (measure the chunk-79 way; base on the Mac expected 1,051,915 B). Tests expected around 1,209 → ~1,240, 104 → 105 files; report actual.
- **D6 — Docs scope** (Step 9 only, after gate and smoke):
  - `PROGRESS.md`: row 82; Last-updated; decisions log D1–D3 (D3 names the chunk-81 D3 revision for skipped times); known gaps — remove the three closed items (sign-outs not started by the two buttons, the Planner notes opener focus, the other `fromZonedTime` call sites); add: a delete request in flight when the session ends is not retried (includes the sign-out cap); `hup:pendingTaskDeletes` is last-writer-wins across tabs; parked deletes commit under whichever user next signs in on the device; "sign-out park verified by unit tests only — not exercised live (signing out would end Sergio's session)"; `formatInTimeZone` display paths still use `date-fns-tz` (host quirk under `America/Havana`, Why 3).
  - `ARCHITECTURE.md`: where task undo / sign-out is described — any sign-out parks pending deletes and the next signed-in start commits them; where time zones are described — wall time → instant goes through `lib/zonedTime.ts` (`Intl` only): a repeated wall time is its earlier instant, a skipped one shifts forward by the gap, and a day's start is its first instant.
  - Commit this prompt to `prompts/`.

## Steps

1. **Sync.**
   ```bash
   cd "/Users/sergiorios/Documents/To-Do Dashboard"
   find .git -name '*.lock' -print
   git fetch origin && git checkout main && git pull --ff-only
   git rev-parse --short HEAD
   git status --short
   git grep -n "fromZonedTime" -- src
   ```
   Expect: no `.lock` files (delete any and re-run); HEAD `6ae1574`; only `?? prompts/chunk-82-park-focus-zones.md` untracked; `fromZonedTime` only in `SetReminderPopover.tsx`, `SetDuePopover.tsx`, `lib/clock.ts`, `lib/slots.ts` (twice). If the prompt file is not on disk, write it from this prompt and say so.
2. **Base on the Mac.**
   ```bash
   npm ci && npm run build
   ```
   Expect: build green. Record base eager JS.
3. **Tests red-first** (D4).
4. **Implement** D1–D3.
5. **Gates** (Mac):
   ```bash
   npm ci && npx tsc -b && npx eslint . && TZ=America/New_York npx vitest run && TZ=UTC npx vitest run && TZ=Asia/Tokyo npx vitest run && npm run build
   TZ=America/Havana npx vitest run src/lib/zonedTime.test.ts src/components/SetDuePopover.test.tsx src/components/SetReminderPopover.test.tsx src/lib/clock.test.ts src/lib/slots.test.ts
   TZ=Australia/Lord_Howe npx vitest run src/lib/zonedTime.test.ts src/components/SetDuePopover.test.tsx src/components/SetReminderPopover.test.tsx src/lib/clock.test.ts src/lib/slots.test.ts
   git grep -n "fromZonedTime" -- src
   git diff --stat 6ae1574 -- package.json package-lock.json
   ```
   Expect: all green in all five zones; the `fromZonedTime` grep prints nothing; `package.json` / lockfile diff empty; eager JS within D5.
6. **Ship the code alone.** Push without `[skip ci]`:
   ```bash
   git add src
   git status --short
   git commit -m "fix: park pending deletes on any sign-out; planner blocks keep focus; one host-independent zone-wall helper (chunk 82)" -m "D1 parkPendingDeletes on SIGNED_OUT keeps waiting deletes pending for the next signed-in start. D2 Planner returns focus to the block that opened the action sheet, including after the notes handoff. D3 zonedWallToDate (Intl only, Temporal compatible) replaces fromZonedTime in the reminder, due, startOfDay and slot paths; skipped reminder times now shift forward." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
   git push origin main
   gh run list --workflow "Deploy to GitHub Pages" --limit 1
   ```
   - `git status --short` before the commit must show only the D1–D4 files under `src/` plus the untracked prompt (not staged).
   - Wait for the run to finish green. One `gh run rerun --failed` is allowed only for a GitHub-side 5xx pushing to `gh-pages` (chunk 78 rule). Anything else, stop.
7. **Gate from a clean archive.**
   ```bash
   NEW=$(git rev-parse --short HEAD)
   rm -rf /tmp/c82 && mkdir -p /tmp/c82/base /tmp/c82/head
   git archive 6ae1574 | tar -x -C /tmp/c82/base
   git archive $NEW | tar -x -C /tmp/c82/head
   diff -rq /tmp/c82/base /tmp/c82/head
   cp .env.local /tmp/c82/head/
   cd /tmp/c82/head
   npm ci && npx tsc -b && npx eslint . && TZ=America/New_York npx vitest run && TZ=UTC npx vitest run && TZ=Asia/Tokyo npx vitest run && npm run build
   TZ=America/Havana npx vitest run src/lib/zonedTime.test.ts src/components/SetDuePopover.test.tsx src/components/SetReminderPopover.test.tsx src/lib/clock.test.ts src/lib/slots.test.ts
   TZ=Australia/Lord_Howe npx vitest run src/lib/zonedTime.test.ts src/components/SetDuePopover.test.tsx src/components/SetReminderPopover.test.tsx src/lib/clock.test.ts src/lib/slots.test.ts
   ```
   Expect: `diff -rq` lists only the D1–D4 `src/` files; all gates green in all five zones. The `.env.local` needs the real `VITE_CALDAV_PROXY_URL` (CLAUDE.md, chunk 77).
8. **Live checks.**
   ```bash
   curl -s "https://smrios07mdb.github.io/dashboard/version.json?cb=$(date +%s)"
   ```
   Expect `$NEW` (re-check every 2 minutes, up to 10).

   **Smoke** with **Claude in Chrome** (Sergio's Chrome + extension), live site, desktop width (≥ `sm`):
   1. Load the tools in one ToolSearch call. Open a new tab and bring it to the foreground; if `visibilityState` is `hidden`, ask Sergio to bring the window forward (expect the first click after that to be swallowed). Reload until `document.scripts` serves the same `index-*.js` as the live HTML (CLAUDE.md, chunk 77c). Arm `read_console_messages`.
   2. **Fixture:** press `N`, enter `Smoke-82 #personal`, Enter, Escape. On its row, ⋯ → Add a note, type `Smoke-82 note`, close the sheet.
   3. **Schedule it:** on Planner, schedule `Smoke-82` from the tray into the first open slot today (or the next weekday if today has none) through its schedule sheet. If Apple Calendar write-out is on, this creates a calendar event; Step 7 removes it.
   4. **Block focus (D2):** in the desktop branch, focus the `Smoke-82` `[data-testid="task-block"]` and press Enter → the action sheet opens.
      - Press Escape → `document.activeElement` is that block.
      - Enter again, click Cancel → same.
      - Enter again, click `Open` on the note card → the notes sheet opens on `Smoke-82 note`; press Escape → `document.activeElement` is that block.
      - The extension's output filter blocks `outerHTML`: report the element's tag, `data-testid` and `aria-label` each time.
   5. **Zones (D3):** none live — covered by the five-zone gate.
   6. **Sign-out park (D1):** not run live — it would end Sergio's session. Unit-tested only (D4 items 1–2); record that in the docs, do not ask Sergio to check it.
   7. **Cleanup:** focus the `Smoke-82` block, Enter → Unschedule. Then on the Personal › General screen delete `Smoke-82 note` from the notes sheet, then ⋯ → Delete on `Smoke-82` and wait 9 s. After a reload, confirm 0 `Smoke-82` rows there and no `Smoke-82` block on Planner; if write-out is on, confirm the unschedule's calendar delete returned 2xx (`read_network_requests`). No other task, note, block or event may be touched.
   8. **Console:** report every entry verbatim; expect none.
9. **Docs** (D6), only if Steps 5–8 are all green:
   ```bash
   cd "/Users/sergiorios/Documents/To-Do Dashboard"
   git add ARCHITECTURE.md PROGRESS.md prompts/chunk-82-park-focus-zones.md
   git diff --cached --stat
   git commit -m "docs(chunk-82): park deletes, planner focus, zone-wall helper; close chunk 82 [skip ci]" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
   git push origin main
   gh run list --workflow "Deploy to GitHub Pages" --limit 1
   curl -s "https://smrios07mdb.github.io/dashboard/version.json?cb=$(date +%s)"
   rm -rf /tmp/c82
   find .git -name '*.lock' -print
   git status --short
   ```
   Expect: no `src/` or `package.json` change in the docs commit; no new deploy run; `version.json` still `$NEW`; a clean tree and no locks.

## Out of scope

- `AccountMenu.tsx`, `Settings.tsx`, `ProtectedLayout.tsx`, `main.tsx` (D1 needs no edit there).
- `WeekGrid.tsx`, `DayTimeline.tsx`, `TaskBlock.tsx`, `NotesProvider.tsx`, `TaskNotesSheet.tsx`, `notesContext.ts` (D2).
- Display paths that use `formatInTimeZone` (`toZonedInputValue`, `toDueInputValue`, `clock.today`, `dateKeyIn`, `slots` `todayKey`) — record as a known gap.
- Retrying an in-flight delete after the session ends; per-user keying of `hup:pendingTaskDeletes`; cross-tab merging of that key.
- Audit #4 archive-time choice, #9 free-time sizing, #19 — later chunks.

## Report

Include:
- files changed + stat;
- the Step 1 `fromZonedTime` grep;
- red-first results per file and per new case, both zones, naming non-guards;
- every existing test expectation changed, with the reason (expected: only (6)'s `02:30` line);
- the gate table on the Mac and from the clean archive (three full-suite zones with counts, plus the Havana and Lord Howe targeted runs);
- eager JS base, head and delta;
- the deploy run ID and `version.json`;
- smoke results per item, the three `activeElement` readings, the cleanup confirmation, and every console entry;
- the docs commit SHA and stat;
- any deviations, with a reason each;
- the final `git status --short`.
