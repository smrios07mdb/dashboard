# Claude Code prompt — Chunk 81: loose ends (sign-out flush, note focus, zone-independent reminders, hero dead code)

You are Claude Code in `/Users/sergiorios/Documents/To-Do Dashboard` (`smrios07mdb/dashboard`). Base: `c2f6da1` (code = `0c7231d`, deployed). Authority: `ARCHITECTURE.md` → `prompts/README.md` → this prompt.

App code only: no SQL, no migration, no proxy, no new dependency, no `vite.config.ts` / `src/sw.ts` / workflow change. None of the files below is on the `prompts/README.md` locked list.

This prompt runs end to end: implement, ship, gate, smoke, docs. On any failure, stop at that point and report.

## Why

Four known gaps carried in PROGRESS.md, all verified against the source at `c2f6da1`:

1. **Delete, then sign out within 6 s → the task silently survives** (chunk 72). `deleteTasksWithUndo` commits from its own 6 s timer. Both sign-out handlers (`AccountMenu.tsx:28`, `Settings.tsx:317` `AccountSection`) call `supabase.auth.signOut()` directly, so the timer fires after the session is gone, the delete matches no rows under RLS, and nothing says so. `flushPendingDeletes` exists but is only wired to `pagehide` and returns `void`, so nothing can wait for it.
2. **A note opened from a list's Notes section returns focus to `body` on close** (chunk 77c). `ListNotesSection.tsx:72` calls `openTaskNotes(task.id, n.id)` with no third argument. The sheet is mounted by `NotesProvider`, not opened from a Radix trigger, so Radix has nothing to return focus to.
3. **`SetReminderPopover.test.tsx` (6) fails with the runner in `Asia/Tokyo`** (chunk 73). This is a real app bug, not a test artefact. `fromZonedInputValue` uses `date-fns-tz` `fromZonedTime`, which resolves an ambiguous wall time (the repeated hour at a fall-back) using the **host** zone. Measured with the installed `date-fns-tz`, `fromZonedTime('2026-11-01T01:30', 'America/New_York')`:
   - host `America/New_York`, `UTC`, `America/Los_Angeles`, `Europe/London` → `2026-11-01T05:30:00.000Z` (the first 01:30, EDT);
   - host `Asia/Tokyo`, `Australia/Sydney` → `2026-11-01T06:30:00.000Z` (the second 01:30, EST).
   So a device in Tokyo saves a different reminder instant than a device in New York for the same input. `fromZonedTime('2026-04-05T01:45', 'Australia/Lord_Howe')` (30-minute DST) returns the later instant `2026-04-04T15:15:00.000Z` on every host.
4. **Dead branches in the full hero** (chunk 74, deviation 5). `DailyHero.tsx` returns the compact layout when `today.total === 0` (line ~269), so in the full layout `planned` is always true: the ternaries at ~359, ~370 and ~414 have unreachable arms, and `encourage`'s `total === 0` line (~60) is unreachable.

## Decisions (locked)

- **D1 — Flush before sign-out.**
  - `src/lib/taskUndo.ts`: `flushPendingDeletes(): Promise<void>` — same body, but `return commit(ids)` instead of `void commit(ids)`. `ProtectedLayout`'s `pagehide` listener keeps working unchanged (the returned promise is ignored there). Update its doc comment: fire-and-forget on `pagehide`, awaited on sign-out.
  - `src/lib/signOutCleanup.ts`: new export `signOutUser(): Promise<{ error: AuthError | null }>`:
    1. `await Promise.race([flushPendingDeletes(), <4,000 ms timer>])` — export the cap as `SIGN_OUT_FLUSH_CAP_MS = 4000`. Clear the timer when the flush wins.
    2. `return supabase.auth.signOut()` result's `{ error }`.
    - A flush that rejects must not block sign-out (`commit` already catches and toasts; still wrap the race so a rejection falls through to sign-out).
    - Header comment: why (this chunk), and why the cap (a hung request must not trap the user signed in; on timeout the ids stay pending in localStorage and `resumePendingDeletes` commits them on the next signed-in start, when RLS lets them match).
  - `AccountMenu.tsx` and `Settings.tsx` `AccountSection`: call `signOutUser()` instead of `supabase.auth.signOut()`. Error handling and navigation unchanged. Drop the `supabase` import from either file only if nothing else in it uses it.
  - Out of scope: sign-outs not started by these two buttons (token expiry, another tab). Record as a known gap.
- **D2 — Note row gets focus back.** `ListNotesSection.tsx`: the row's `onClick` captures `e.currentTarget` and, for a task note, calls `openTaskNotes(task.id, n.id, refocus)` where `refocus(ev)`:
  - if the captured button `isConnected`: `ev.preventDefault()` then `button.focus()`;
  - otherwise does nothing (default Radix behaviour; e.g. the note was deleted in the sheet and its row unmounted).
  - The list-note branch (`navigate`) is unchanged. `NotesProvider`, `notesContext`, `TaskNotesSheet` unchanged (the third argument already exists, chunk 77c).
  - Out of scope: the Planner's `BlockActionSheet` → notes opener (`Planner.tsx` ~1429), which also passes no refocus target. Record it as a known gap; do not touch `Planner.tsx`.
- **D3 — Ambiguous wall times resolve to the earlier instant, on every host.** `SetReminderPopover.tsx` `fromZonedInputValue`:
  ```ts
  const F = "yyyy-MM-dd'T'HH:mm"
  const d = fromZonedTime(s, tz)
  if (Number.isNaN(d.getTime())) return null
  // date-fns-tz picks between the two instants of a repeated wall time using
  // the HOST zone (chunk 81). Take the earlier one, deterministically.
  const wall = formatInTimeZone(d, tz, F)
  let best = d
  for (const m of [30, 60]) {
    const c = new Date(d.getTime() - m * 60_000)
    if (formatInTimeZone(c, tz, F) === wall) best = c
  }
  return best.toISOString()
  ```
  - Non-existent wall times (spring-forward gap) keep today's result; `fromZonedTime` is host-independent there (`2026-03-08T02:30` NY → `2026-03-08T06:30:00.000Z` on every host measured).
  - Orchestrator check of this exact code, run under host zones `America/New_York`, `UTC`, `Asia/Tokyo`, `Australia/Sydney`, `Australia/Lord_Howe` and `Pacific/Kiritimati` — identical on all six:
    - `2026-11-01T01:30` NY → `2026-11-01T05:30:00.000Z`
    - `2026-03-08T02:30` NY → `2026-03-08T06:30:00.000Z`
    - `2026-11-01T02:30` NY → `2026-11-01T07:30:00.000Z`
    - `2026-04-05T01:45` `Australia/Lord_Howe` → `2026-04-04T14:45:00.000Z`
    - `2026-10-25T01:30` `Europe/London` → `2026-10-25T00:30:00.000Z`
    - `2026-10-14T13:00` NY → `2026-10-14T17:00:00.000Z`
  - Out of scope: the other `fromZonedTime` call sites (`SetDuePopover.tsx:58`, `lib/clock.ts:85`, `lib/slots.ts:78/82`) — they convert midnight or slot bounds, not user-typed times. List them in the report as known gaps; do not change them.
- **D4 — Hero dead code.** `DailyHero.tsx`, full layout only:
  - `aria-label` → `` `Today: ${today.done} of ${today.total} planned tasks done` ``;
  - ring text → the `{pct}<span …>%</span>` arm only;
  - the trailing figure → render the `· {done}/{total} today` span unconditionally;
  - `encourage`: delete the `total === 0` line and update its comment (called only with a plan);
  - `planned` / `ratio` / `pct`: keep whatever is still read; `ratio` becomes `today.done / today.total` computed after the compact return (or guard-free if moved below it). No division by zero may remain reachable.
  - Rendered markup with a plan must be **identical** to base. No test expectation may change for this item. The two existing absence checks for `Nothing planned yet — pick a few for today.` (`DailyHero.test.tsx:131`, `Dashboard.test.tsx:456`) stay as they are.
- **D5 — Tests, red-first against `c2f6da1`.**
  1. `src/lib/taskUndo.test.ts`: `(12) flushPendingDeletes resolves only after the delete settles` — with a deferred `bulkDelete`, the returned promise is pending until the deferred resolves, then storage is clear.
  2. `src/lib/signOutCleanup.test.ts` (mock `@/lib/taskUndo` `flushPendingDeletes` and `@/lib/supabase`):
     - `signOutUser` does not call `auth.signOut` until the flush resolves, then calls it once;
     - with a flush that never resolves, `auth.signOut` is called at exactly `SIGN_OUT_FLUSH_CAP_MS` (fake timers), not before;
     - a rejected flush still signs out;
     - the `{ error }` from `auth.signOut` is returned unchanged.
  3. `src/components/AccountMenu.test.tsx`: Sign out calls `signOutUser` once and navigates to `/` on success; on `{ error }` it toasts and does not navigate. Adapt existing sign-out cases that asserted `supabase.auth.signOut` directly; list each changed lookup in the report.
  4. `src/screens/Settings.test.tsx`: Account → Sign out calls `signOutUser` once.
  5. New `src/components/notebook/ListNotesSection.test.tsx` (mock `./notesContext`: `useListNotes` returns one task note and one list note; `useOpenTaskNotes` returns a spy):
     - clicking the task-note row calls the spy with `(taskId, noteId, fn)`; calling `fn` with `{ preventDefault }` calls it and focuses that row (`document.activeElement` is the row);
     - after unmount, `fn` neither throws nor calls `preventDefault`;
     - clicking the list-note row navigates to `/notebook/<id>` and does not call the spy.
  6. `src/components/SetReminderPopover.test.tsx`: `(6b) an ambiguous wall time resolves to the earlier instant` — `2026-04-05T01:45` in `Australia/Lord_Howe` → `2026-04-04T14:45:00.000Z`, and `toZonedInputValue` of that returns `2026-04-05T01:45`.
  - **Red-first:** restore `src/lib/taskUndo.ts`, `src/lib/signOutCleanup.ts`, `src/components/AccountMenu.tsx`, `src/screens/Settings.tsx`, `src/components/notebook/ListNotesSection.tsx` and `src/components/SetReminderPopover.tsx` from `c2f6da1` (new tests kept), then run the six test files with `TZ=America/New_York`, and `SetReminderPopover.test.tsx` again with `TZ=Asia/Tokyo`. Report fail/pass per file. Every new case must fail except the list-note-row navigate case and the unmount case (pass at base — not guards; say so). Existing (6) must fail under Tokyo at base. Restore the tree and confirm `git status --short` matches the change set.
- **D6 — Budget.** Eager JS delta ≤ **+300 B** (measure the chunk-79 way; base on the Mac expected 1,051,696 B, 7 files). Tests expected around 1,197 → ~1,207, 103 → 104 files; report actual.
- **D7 — Docs scope** (Step 9 only, after gate and smoke):
  - `PROGRESS.md`: row 81; Last-updated; decisions log D1–D4; known gaps — remove the four closed items (delete-then-sign-out, list-note focus, `SetReminderPopover` (6) in `Asia/Tokyo`, hero dead branches) wherever the gaps list / Last-updated carries them; add: sign-outs not started by the two buttons, the Planner notes opener focus, the other `fromZonedTime` call sites, and "sign-out flush verified by unit tests only — not exercised live (signing out would end Sergio's session)".
  - `ARCHITECTURE.md`: one line where task undo / sign-out is described — sign-out from the app awaits pending deletes (capped at 4 s) before ending the session; one line where reminder time zones are described — ambiguous wall times resolve to the earlier instant regardless of device zone.
  - `CLAUDE.md`: add `Asia/Tokyo` as a third gate zone in the definition-of-done test line.
  - Commit this prompt to `prompts/`.

## Steps

1. **Sync.**
   ```bash
   cd "/Users/sergiorios/Documents/To-Do Dashboard"
   find .git -name '*.lock' -print
   git fetch origin && git checkout main && git pull --ff-only
   git rev-parse --short HEAD
   git status --short
   ```
   Expect: no `.lock` files (delete any and re-run); HEAD `c2f6da1`; only `?? prompts/chunk-81-loose-ends.md` untracked. If the prompt file is not on disk, write it from this prompt and say so.
2. **Base on the Mac.**
   ```bash
   npm ci && npm run build
   TZ=Asia/Tokyo npx vitest run src/components/SetReminderPopover.test.tsx
   ```
   Expect: build green; (6) fails under Tokyo. Record base eager JS.
3. **Tests red-first** (D5).
4. **Implement** D1–D4.
5. **Gates** (Mac):
   ```bash
   npm ci && npx tsc -b && npx eslint . && TZ=America/New_York npx vitest run && TZ=UTC npx vitest run && TZ=Asia/Tokyo npx vitest run && npm run build
   git diff --stat c2f6da1 -- package.json package-lock.json
   ```
   Expect: all green in all three zones (Tokyo green for the first time since chunk 61); `package.json` / lockfile diff empty; eager JS within D6.
6. **Ship the code alone.** Push without `[skip ci]`:
   ```bash
   git add src
   git status --short
   git commit -m "fix: flush pending deletes before sign-out; note rows keep focus; zone-independent reminder times; drop dead hero branches (chunk 81)" -m "D1 signOutUser awaits flushPendingDeletes (4 s cap) before supabase.auth.signOut. D2 ListNotesSection passes a refocus target. D3 fromZonedInputValue takes the earlier instant of an ambiguous wall time on every host. D4 DailyHero full layout loses unreachable arms." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
   git push origin main
   gh run list --workflow "Deploy to GitHub Pages" --limit 1
   ```
   - `git status --short` before the commit must show only the D1–D5 files under `src/` plus the untracked prompt (not staged).
   - Wait for the run to finish green. One `gh run rerun --failed` is allowed only for a GitHub-side 5xx pushing to `gh-pages` (chunk 78 rule). Anything else, stop.
7. **Gate from a clean archive.**
   ```bash
   NEW=$(git rev-parse --short HEAD)
   rm -rf /tmp/c81 && mkdir -p /tmp/c81/base /tmp/c81/head
   git archive c2f6da1 | tar -x -C /tmp/c81/base
   git archive $NEW | tar -x -C /tmp/c81/head
   diff -rq /tmp/c81/base /tmp/c81/head
   cp .env.local /tmp/c81/head/
   cd /tmp/c81/head
   npm ci && npx tsc -b && npx eslint . && TZ=America/New_York npx vitest run && TZ=UTC npx vitest run && TZ=Asia/Tokyo npx vitest run && npm run build
   ```
   Expect: `diff -rq` lists only the D1–D5 `src/` files; all gates green in all three zones. The `.env.local` needs the real `VITE_CALDAV_PROXY_URL` (CLAUDE.md, chunk 77).
8. **Live checks.**
   ```bash
   curl -s "https://smrios07mdb.github.io/dashboard/version.json?cb=$(date +%s)"
   ```
   Expect `$NEW` (re-check every 2 minutes, up to 10).

   **Smoke** with **Claude in Chrome** (Sergio's Chrome + extension), live site:
   1. Load the tools in one ToolSearch call. Open a new tab and bring it to the foreground; if `visibilityState` is `hidden`, ask Sergio to bring the window forward (expect the first click after that to be swallowed). Reload until `document.scripts` serves the same `index-*.js` as the live HTML (CLAUDE.md, chunk 77c). Arm `read_console_messages`.
   2. **Fixture:** press `N`, enter `Smoke-81 #personal`, Enter, Escape. On its row, ⋯ → Add a note, type `Smoke-81 note`, close the sheet.
   3. **Note focus (D2):** open Personal › General's drill-down. In its Notes section, focus the `Smoke-81 note` row (`[data-testid="list-note-row"]`) and press Enter → the sheet opens. Press Escape → `document.activeElement` is that same row button. Repeat opening it by click and closing with the sheet's close button → same result. Report `document.activeElement.outerHTML` (first 200 chars) both times.
   4. **Hero (D4):** on Tasks, read the hero: if nothing is planned, the one-line hero; if something is planned, the ring's `aria-label` reads `Today: N of M planned tasks done` and the line ends `· N/M today`. Report which and the text.
   5. **Reminder (D3), read-only:** none — covered by the three-zone gate.
   6. **Sign-out (D1):** not run live — it would end Sergio's session. Unit-tested only (D5 items 1–4); record that in the docs, do not ask Sergio to check it.
   7. **Cleanup:** delete `Smoke-81 note` from the notes sheet, then ⋯ → Delete on `Smoke-81` and wait 9 s. Confirm 0 `Smoke-81` rows remain on the Personal › General screen after a reload. No other task or note may be touched.
   8. **Console:** report every entry verbatim; expect none.
9. **Docs** (D7), only if Steps 5–8 are all green:
   ```bash
   cd "/Users/sergiorios/Documents/To-Do Dashboard"
   git add ARCHITECTURE.md PROGRESS.md CLAUDE.md prompts/chunk-81-loose-ends.md
   git diff --cached --stat
   git commit -m "docs(chunk-81): loose ends; close chunk 81 [skip ci]" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
   git push origin main
   gh run list --workflow "Deploy to GitHub Pages" --limit 1
   curl -s "https://smrios07mdb.github.io/dashboard/version.json?cb=$(date +%s)"
   rm -rf /tmp/c81
   find .git -name '*.lock' -print
   git status --short
   ```
   Expect: no `src/` or `package.json` change in the docs commit; no new deploy run; `version.json` still `$NEW`; a clean tree and no locks.

## Out of scope

- `Planner.tsx`, `NotesProvider.tsx`, `TaskNotesSheet.tsx`, `notesContext.ts`, `ProtectedLayout.tsx` (its `pagehide` listener needs no edit).
- The other `fromZonedTime` call sites (D3).
- Sign-outs not started by the two buttons (D1).
- Audit #4 archive-time choice, #9 free-time sizing, #19 — later chunks.

## Report

Include:
- files changed + stat;
- red-first counts per file (both zones for `SetReminderPopover`), naming non-guards;
- every existing test lookup changed, with the reason;
- the gate table on the Mac and from the clean archive (all three TZ test counts);
- eager JS base, head and delta;
- the deploy run ID and `version.json`;
- smoke results per item, the two `activeElement` readings, the hero text, and every console entry;
- the docs commit SHA and stat;
- any deviations, with a reason each;
- the final `git status --short`.
