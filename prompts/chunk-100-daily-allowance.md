# Chunk 100 — Site blocking: a daily time allowance per group

Repo: smrios07mdb/dashboard. Base: `main` at `609ac5d` (chunk 99 merged ff at `c3ded51`; code `e8db7e8`; docs `609ac5d`). Branch: `chunk-100-daily-allowance`.
Model: Fable 5.2 (Rust shell, a migration and the PWA in one chunk).

**Push the branch and stop. Do not merge to `main`.** The orchestrator gates the branch first.

## Why
Chunk 99 blocks a group's sites during focus and at set hours. Sergio also wants a screen-time allowance: "X minutes a day on these sites, then they close until tomorrow". This chunk adds a third trigger to a block group, a daily allowance, counted and enforced by the menu bar app's tab watcher on the Mac.

## Locked decisions

### The rule
- **D1 Daily allowance.** A group can carry `Daily allowance`: 1–1440 minutes a day, shared by all of the group's sites. While today's count is under it, the sites open normally. Once it is reached, the group's sites are blocked until the next midnight, like any other block (D5 of chunk 99: the active tab of any window is sent to the blocked page).
- **D2 What counts.** Time counts for a group while one of its sites is the **active tab of the front window of a supported browser, and that browser is the frontmost app**. A background tab, a window behind another, a browser behind another app: none of them count. A host in two groups counts for both. Nothing counts for a group that is switched off, has no allowance, or while `Block sites on this Mac` is off. Counting is by poll: each read that sees a counting tab adds the time since the previous pass, capped at 10 s (so sleep adds nothing).
- **D3 The day** is the Mac's local day; the count resets at local midnight. Counted on this Mac only; a second Mac counts on its own, and phone use counts nowhere.
- **D4 Precedence.** Focus and schedule blocks apply whether or not allowance is left. The blocked page's reason is `#focus`, else `#schedule`, else `#limit`.
- **D5 Five-minute warning.** When a group's remaining time first drops to 5 minutes or less (and its allowance is more than 5 minutes), the popover drops without taking focus, showing `5 minutes left for <name> today` and **OK**. It hides by itself after 10 s if not clicked into. One warning per group per day.
- **D6 Usage is shown in the menu bar only.** Settings › Blocking shows each group's `12 of 30 min today`. The dashboard sets the allowance and does not show usage (the hidden web view cannot keep it current; recorded as not built).
- **D7 Not a lock** (chunk 99's D7 stands): raising the allowance, switching the group off, switching the Mac switch off or quitting the app lifts the block. Quitting does **not** reset the count (D11).

### Database
- **D8 Migration 24, `supabase/migrations/24_block_group_daily_limit.sql`**, idempotent:
  ```sql
  alter table public.block_groups
    add column if not exists daily_limit_on boolean not null default false,
    add column if not exists daily_limit_minutes smallint not null default 30;
  do $$ begin
    if not exists (select 1 from pg_constraint where conname = 'block_groups_daily_limit_minutes_check') then
      alter table public.block_groups add constraint block_groups_daily_limit_minutes_check
        check (daily_limit_minutes between 1 and 1440);
    end if;
  end $$;
  ```
  **Apply it** with the Supabase MCP `execute_sql` on `dctfspcbkqvvyptddtif`, after the unit tests pass; verify the two columns, their defaults and the check with SQL. If the MCP is not available: **stop and report**.

### Client data layer and dashboard (`src/`)
- **D9** `BlockGroup` gains `dailyLimitOn: boolean` and `dailyLimitMinutes: number`; `db/mappers.ts` both ways; `repo.blockGroups.create` / `update` accept them. No Dexie version change (no new index), no outbox, realtime or cache change. `lib/blockRules.ts`: `ruleSummary` appends `30 min a day` (after `Focus` and the schedule, joined with ` · `); `No trigger` only when all three are off.
- **D10 Settings › Site blocking** (`components/SiteBlockingSection.tsx`): under `Block on a schedule`, a switch `Daily allowance` and, while it is on, a number input `Minutes a day` (1–1440, whole numbers; an out-of-range or empty value reads `1 to 1440 minutes` and is not saved) with the hint `Counted on your Mac while the site is the tab in front. Resets at midnight.` **`public/blocked.html`** gains a third `:target` paragraph, `id="limit"`: `Today's time for these sites is used up. It opens again tomorrow.` Still no script.

### Shell (`menubar/src-tauri/src/`)
- **D11 `allowance.rs` (new), all pure and tested:**
  - `day_start(midnights: &[u64], now) -> u64`: the greatest midnight at or before `now`; with none, the first.
  - `Usage`: seconds by `(day_start, group id)`. `add(day, id, ms)`, `used_ms(day, id)`, `prune(day)` (drops other days).
  - `exhausted(limit_ms, used_ms) -> bool` (`limit_ms > 0 && used_ms >= limit_ms`); `warn_now(limit_ms, before_ms, after_ms) -> bool` (D5: crossed to `limit − used <= 5 min`, still under the limit, `limit_ms > 5 min`).
  - `usage_text(&Usage) -> String` / `parse_usage(&str) -> Usage`: one line per entry, `day_start` TAB `group id` TAB `ms`; a malformed line is skipped.
  - The file: `usage.tsv` in the app data folder, read once in `setup`, rewritten through a temp file and a rename (the `sessions.rs` pattern) when a group's **whole-minute** count changes, when a limit is reached, and at a day change; an empty map removes the file. This is the shell's third file: update every sentence that counts them.
- **D12 `blocker.rs`.**
  - `Group` gains `id: String` and `limit_ms: u64` (0 = no allowance). `Config` gains `midnights: Vec<u64>`.
  - `Reason::Limit` (`…/blocked.html#limit`). `verdict` takes the day's usage: after `Focus` and `Schedule`, a matching group that is `exhausted` gives `Limit`.
  - `anything_active` is also true when a group is exhausted. New `tracking(config, usage, day) -> bool`: some group with domains has an allowance not yet exhausted.
  - **The read script** gains one leading line, `front` or `back`: `frontmost of application id "<bundle id>"`, read **outside** the `tell` block (an AppleScript application property; it sends the browser nothing). Windows are already listed front to back, so the first window line is the front window. `parse_tabs` skips the new line; new `parse_front(stdout) -> bool`.
  - **`pass`**: when blocking is active it behaves as today (2 s). When nothing blocks but `tracking` is true it reads each installed browser on a **5 s** cadence (`TRACK_WAIT`), with the same 10 s / 30 s back-offs. In both modes, after a read: if the browser is `front` and its first window's URL matches groups with an allowance, each gets `min(now − last_pass, 10 s)`; then verdicts are taken with the updated usage, so the tab that spends the last second is redirected in the same pass. With neither blocking nor tracking: no `osascript`, as today.
  - A day change (`day_start` differs from the last pass's) prunes usage and clears the warnings given.
  - **Warning (D5):** when `warn_now` fires for a group, the state gains `"warning": { "id", "name", "minutesLeft" }` and the thread calls `crate::show_passive` after releasing the lock; 10 s later `crate::hide_unfocused`. `blocker_dismiss_warning` clears it. It also clears when the limit is reached or the day changes.
  - **State JSON** gains `"usage": [{ "id", "usedMinutes", "limitMinutes" }]` for groups with an allowance (`usedMinutes` rounded down, so the JSON, and the `blocker` event, change at most once a minute per group) and `"warning"` (object or `null`). Still no URL.
- **D13 `blocker_configure`** gains three lists: `ids: string[]` (each 1–64 characters of `[A-Za-z0-9-]`, distinct), `limits: number[]` (minutes, 0–1440; 0 = none), both parallel to `names`, and `midnights: number[]` (1–20 values, ascending, inside `[now − 2 days, now + 17 days]`). Rejected whole on any miss, as today. New command `blocker_dismiss_warning` → the state JSON.
- **D14** `lib.rs`: `mod allowance;`, load `usage.tsv` in `setup` before the blocker thread starts, the new command. No new crate, plugin or capability; `Cargo.toml` and `Cargo.lock` unchanged. `pomodoro.rs`, `meditation.rs`, `sessions.rs`, `login.rs`, `sound.rs` unchanged.

### Menu bar web view (`menubar/src/`)
- **D15 `blocker.ts`**: `blocking()` also keeps a group whose only trigger is the allowance. `buildConfig` sends `ids`, `limits` (`dailyLimitOn ? dailyLimitMinutes : 0`) and `midnights`: local midnights from today's through today + 15, each `new Date(y, m, d).getTime()` (new pure `midnightsFrom(now)` in `blockSchedule.ts`; DST is the platform's).
- **D16 `AllowancePanel.tsx`**: above the focus header on both tabs and in Settings, under `MeditationPanel`, only while the state holds a warning: `5 minutes left for <name> today` (`minutesLeft`, singular at 1) and **OK** (`blocker_dismiss_warning`). Built from `MeditationPanel`'s existing classes; no new visual language. **`MAX_HEIGHT` does not change**; with a meditation panel also up, the list scrolls.
- **D17 Settings › Blocking**: each group row's summary gains the allowance (`ruleSummary`), and a group with one shows a second line, `12 of 30 min today` (`30 of 30 min today · blocked until midnight` once reached), from the state's `usage`, live through `watchBlocker`.
- **D18** `native.ts`: the new `blockerConfigure` arguments, `blockerDismissWarning()`, and the wider `BlockerState` type. Argument names tested on both sides.

## Out of scope
- Usage on the dashboard; usage history or charts; usage synced between Macs.
- Per-site allowances inside a group (make a second group); weekday-specific allowances.
- Pausing the count when the Mac is idle or the screen is locked with the tab in front (known limit, recorded in docs).
- Notifications or sounds; any tray change; any friction to lift a block.
- Firefox, Arc; a browser extension; the hosts file.

## Guardrails
- `src/` changes only in: `db/types.ts`, `db/mappers.ts`, `db/repo.ts`, `lib/blockRules.ts`, `components/SiteBlockingSection.tsx`, and their tests; plus `public/blocked.html`. Anything else: stop and report.
- No new npm dependency, crate or Tauri plugin. `Cargo.toml`, `Cargo.lock`, `tauri.conf.json`, `capabilities/`, `Info.plist`, `Entitlements.plist`, CSP unchanged.
- Script text still holds only the bundle id from the fixed table. A URL read from a browser never leaves `blocker.rs`: not in the state JSON, an event, a log line, or `usage.tsv` (which holds group ids and milliseconds only).
- The `Blocker` lock stays a leaf, never held across an `osascript` run, an emit, a file write, or `show_passive`.
- No `localStorage` key added.
- One run owner for the native run: confirm no other session is driving the app, the browsers or the dev DB. Fixture groups are named `Smoke-<runId>-…` and deleted **by the ids you recorded**.
- The native run uses only `example.com`, `example.org` and `example.net`, in new windows it opens itself; it never touches or closes the operator's windows or tabs. Close the ones it opened if your permissions allow it; if not, list them at the top of the report.
- Take one full `sqlite3 .dump` of the menubar `localStorage` file with the app quit, and restore from that dump only. Leave Spotify, the installed app, the LaunchAgent, the sessions ledger and `usage.tsv` as you found them (delete `usage.tsv` if it was absent). Do not revoke or reset any macOS permission.
- Do not start another chunk or write a handoff or brief.

## Tests (red first)
- **Rust** (`cargo test`):
  - `allowance.rs`: `day_start` (before the first, between two, exactly on one, past the last); `add` / `used_ms`; `prune`; `exhausted` at `limit − 1`, `limit`, and with no limit; `warn_now` (crosses 5 min left → true once; already inside → false; a 5-minute allowance → never; at the limit → false); `usage_text` → `parse_usage` round trip; malformed lines skipped.
  - `blocker.rs`: `parse_front` (`front`, `back`, missing); `parse_tabs` skips the new line; the read script's golden text for Chrome and Safari with `frontmost of application id` outside the `tell`; `verdict` — under the limit → `None`; at it → `Limit`; `Focus` and `Schedule` still win; the dashboard still exempt.
  - `pass`, with an injected runner and clock: **no runner call with neither blocking nor tracking**; tracking alone waits 5 s; a front browser's first window counts and a second window does not; `back` counts nothing; a host in two groups counts for both; the elapsed time is capped at 10 s; the pass that reaches the limit writes the redirect with `#limit` in the same pass; a day change resets the count and the warning; `warn_now` sets the warning once; a closed browser keeps its 10 s back-off while tracking.
  - `validate`: each new rejection (list lengths, a bad id, duplicate ids, a limit over 1440, `midnights` empty, unsorted, out of range), one test each.
  - `state_json`: golden text with usage and with a warning; `usedMinutes` rounds down.
- **Vitest:**
  - mappers round trip with the two fields; `repo.blockGroups.update` with them, online and through the outbox.
  - `blockRules.ruleSummary`: every combination of the three triggers.
  - `blockSchedule.midnightsFrom`, under `America/New_York`, `UTC` and `Asia/Tokyo`: 16 ascending values, the first today's local midnight, the DST change dates in New York (23 h and 25 h days).
  - `blocker.ts`: an allowance-only group is kept; `ids`, `limits` and `midnights` are sent; `dailyLimitOn` off → 0.
  - `SiteBlockingSection`: the switch saves; the input shows only while on; 0, 1441, an empty value and `1.5` are refused with the message; a valid value saves.
  - `AllowancePanel`: shown only with a warning; `1 minute left`; **OK** calls dismiss.
  - `SettingsView`: the usage line, the reached line, no line for a group without an allowance.
  - `App`: the panel sits under `MeditationPanel` on both tabs and in Settings.
  - `native.ts`: every new argument name and the new command.
  - `blocked.html`: three `:target` ids, still no `<script` and no absolute URL.
  - Existing suite green.

## Gates
1. `npm ci`, `npm run lint`, `npm run menubar:typecheck`; `npm test` with `TZ=America/New_York`, `TZ=UTC`, `TZ=Asia/Tokyo`, **one after the other**; `cargo test --manifest-path menubar/src-tauri/Cargo.toml`; `git diff 609ac5d -- menubar/src-tauri/Cargo.lock menubar/src-tauri/Cargo.toml` empty; `npm run build` green (the PWA bundle name **will** change; record base and head names with the same `.env.local`); `dist/blocked.html` holds `id="limit"` and no `<script`.
2. The migration applied and verified (D8), with the SQL output in the report.
3. `export PATH="$HOME/.cargo/bin:$PATH"`, `npm run menubar:build`, then `codesign --verify --deep --strict --verbose=2 <app>`, `codesign -d -r- <app>` (leaf `H"8f0d254bddc27a5990591035bd4dfd49b105611d"`), entitlements still only apple-events.
4. Browser smoke of the dashboard on `npm run dev` with the real `.env.local`: in Settings › Site blocking, add `Smoke-<runId>-A` with `example.com`, switch `Daily allowance` on, set 2, reload: as left; console clean. Record the group's id. Name the driver.
5. Native run of the **branch build from its bundle folder** (quit the installed app first; `pgrep -fl Hupomnemata` → one process, from the bundle folder). Drivers: System Events through `osascript` for the popover and for window titles; `open -na "Google Chrome" --args --new-window <url>`; Supabase MCP `execute_sql` for fixture changes, each followed by ⌥H (the reload). The live blocked page has no `#limit` text until the merge: **pass = the window's title contains `Blocked · Hupomnemata`**. Before: the `localStorage` dump, Spotify's state, whether `usage.tsv` exists, and `select count(*) from block_groups`. Set `hup:mb:sound` `auto: false`. In the step-4 group set `block_in_focus = false`. Chrome and Safari are already allowed; no Automation prompt is expected.
   1. **`frontmost` works.** With Chrome in front, then Finder in front, Settings › Blocking's usage line moves only in the first case (steps 2 and 3 prove it). If the read fails or every read says `back`: **stop and report** with the `osascript` stderr.
   2. **Counts in front, then blocks.** Allowance 2 min. Open one new Chrome window at `https://example.com` and keep Chrome frontmost. After about 65 s the row reads `1 of 2 min today`. Between 120 s and 135 s the window's title contains `Blocked · Hupomnemata`, and the row reads `2 of 2 min today · blocked until midnight`.
   3. **Does not count behind.** `execute_sql`: allowance 4 min (2 used). Open `https://example.com` in a new window, then bring Finder to the front for 90 s: the row still reads `2 of 4 min today` and the page is still `Example Domain`. A second Chrome window on `https://example.net` in front of it for 60 s: still 2.
   4. **Survives a quit.** `osascript -e 'quit app "Hupomnemata"'`; `cat` `usage.tsv` (one line: a day start, the group's id, about 120000 ms; no URL). `open "$APP"`, ⌥H: the row still reads `2 of 4 min today`.
   5. **Warning.** `execute_sql`: allowance 8 min (2 used). Chrome frontmost on `https://example.com` with the popover hidden: at about 3 min used the popover drops with `5 minutes left for Smoke-<runId>-A today`, the frontmost app is still Chrome, and it hides by itself within about 12 s. It does not show again in the next minute.
   6. **Focus still wins.** With allowance left, set `block_in_focus = true`, start a focus: `example.com` is blocked within 6 s. End.
   7. **Cost.** Tracking only (allowance left, no focus), Chrome running, popover closed: the app's `osascript` runs over 20 s (expected about 4 per running browser, plus about 2 per installed, closed one) and `ps -o %cpu`. With the group switched off: 0 runs.
   8. **Cleanup:** delete the fixture group by id; the count equals the before count.
   9. Record without attempting: the midnight reset (unit-tested), Safari and Edge counting (same script path as Chrome; Safari if time allows), Brave.
6. **Restore**: `localStorage` from the dump (every `hup:mb:*` row and `hupo.menubar.theme` as found); `usage.tsv` as found; Spotify as found; quit the branch app; `open ~/Applications/Hupomnemata.app`; `pgrep -fl Hupomnemata` → one process, from `~/Applications`.

## Docs (same pass)
- **ARCHITECTURE §4**: the two columns and the Block groups paragraph (D1–D4, D8).
- **ARCHITECTURE §13**: the allowance row in Settings › Site blocking and the blocked page's third reason.
- **ARCHITECTURE §16**, Site blocking: the allowance (D2–D7, D11–D18): what counts, the `front` line, the 5 s tracking cadence, `usage.tsv` (the shell's third file), the warning panel, the state JSON; known limits (counts while the tab is in front even if he is away; this Mac only; usage not shown on the dashboard). Shell commands: the wider `blocker_configure` and `blocker_dismiss_warning`.
- **CLAUDE.md**: add to the chunk-99 paragraph only what is new for driving an allowance natively (keeping a browser frontmost while timing, reading `usage.tsv`).
- **PROGRESS**: row 100, the "Last updated" line (the previous one moves to "Prior update"), and the Decisions log: the allowance is per group and shared by its sites; counted only for the front tab of the frontmost browser; resets at the Mac's midnight; kept across a quit in `usage.tsv`; usage shown in the menu bar only.
- Commit this prompt as `prompts/chunk-100-daily-allowance.md` (it's already in the working tree).

## Push
Branch only: the code commit(s) first, then the docs commit with `[skip ci]`.

## Report
- Windows left open, if any (first line).
- Branch, head SHA and code SHA(s).
- Every file under `src/` and `public/` touched (must match the guardrail list).
- Vitest counts per zone and the `cargo test` count; base and head PWA bundle names; the `Cargo` diff (expected empty).
- The migration verification output.
- Signature lines.
- Each native step with its driver and pass / fail / unverified, the usage lines and titles read, the times measured, `usage.tsv`'s text, the run counts and CPU, and the cleanup counts.
- The unverified list and every deviation.
