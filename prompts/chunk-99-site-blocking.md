# Chunk 99 — Site blocking: block groups, block during focus and on a schedule

Repo: smrios07mdb/dashboard. Base: `main` at `dd4825e` (chunk 98 merged ff at `c11766a`; docs `dd4825e`). Branch: `chunk-99-site-blocking`.
Model: Fable 5.2 (Rust shell, a migration and the PWA in one chunk).

**Push the branch and stop. Do not merge to `main`.** The orchestrator gates the branch first.

## Why
Sergio wants a screen-time style block: named sites he cannot open while a focus session runs, or during set hours. A web page cannot block other sites, so the rules live in Supabase, the dashboard edits them, and the menu bar app enforces them on the Mac by watching the active tab of each browser window and sending a blocked tab to a "blocked" page. This chunk builds the rules, the two triggers (focus, schedule) and the watcher. A daily time allowance per group is **chunk 100** and is not built here.

## Locked decisions

### Rules
- **D1 Block groups.** A group is a name, a list of domains and its triggers: `Block during focus` and/or `Block on a schedule` (days of the week, `from`, `to`). A group can be switched off without deleting it. At most 20 groups, 50 domains each.
- **D2 Domains.** Stored lowercase, without scheme, path, port or a leading `www.`. A rule for `x.com` matches the host `x.com` and every subdomain (`mobile.x.com`), never `notx.com`. `src/lib/blockRules.ts` (pure): `normalizeDomain(input) -> string | null` accepts a bare domain or a pasted URL; valid is 1–253 characters of `[a-z0-9.-]`, at least one dot, no leading or trailing dot or hyphen, no `..`. Paths (`reddit.com/r/x`) are not supported: the path is dropped.
- **D3 Focus trigger.** "Focus" is the pomodoro `phase == Focus`, **running or paused**. Pause does not lift the block; a break, Skip to break and End do. A breathing session changes nothing.
- **D4 Schedule trigger.** Active on each day in `schedule_days` (JS `getDay()`, 0 = Sunday) from `from` to `to`, **in the Mac's own clock** (the meditation rule). `to` at or before `from` runs past midnight into the next day and belongs to its start day; `from == to` is 24 hours.
- **D5 What a block does.** The active tab of any window of a supported browser whose host matches is sent to a fixed page, `https://smrios07mdb.github.io/dashboard/blocked.html#focus` or `…#schedule` (focus wins when both apply). Tabs in the background are left alone until they become the active tab. Nothing is closed. URLs are compared in memory only: never stored, logged, emitted or sent anywhere.
- **D6 Browsers.** Google Chrome, Safari, Brave Browser, Microsoft Edge. Firefox and Arc are not covered. Each browser shows the macOS Automation prompt once, the first time a block is active while it runs.
- **D7 Not a lock.** Quitting the app, signing out, switching a group off or switching `Block sites on this Mac` off lifts every block at once. No delay, no passphrase.

### Database
- **D8 Migration 23, `supabase/migrations/23_block_groups.sql`**, idempotent, in the shape of migration 16 (`notes`):
  ```sql
  create table if not exists public.block_groups (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users(id) on delete cascade,
    name text not null check (char_length(btrim(name)) between 1 and 40),
    domains text[] not null default '{}'
      check (cardinality(domains) <= 50
         and array_to_string(domains, ' ') ~ '^[a-z0-9. -]*$'),
    enabled boolean not null default true,
    block_in_focus boolean not null default true,
    block_on_schedule boolean not null default false,
    schedule_days smallint[] not null default '{1,2,3,4,5}'
      check (schedule_days <@ array[0,1,2,3,4,5,6]::smallint[]),
    schedule_from time not null default '09:00',
    schedule_to time not null default '17:00',
    sort_order int not null default 0,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
  );
  create index if not exists block_groups_user_idx
    on public.block_groups (user_id, sort_order);
  ```
  - `set_updated_at` trigger; RLS on, select / insert / update / delete own rows only; `supabase_realtime` publication + `replica identity full` (the §4 rule).
  - **Apply it** with the Supabase MCP `execute_sql` on `dctfspcbkqvvyptddtif` in one call, after the unit tests pass. Verify with SQL: the columns and defaults, the checks, four policies, the trigger, the publication row and `relreplident = 'f'`. If the MCP is not available in your session: **stop and report**.

### Client data layer (`src/`)
- **D9** The `today_marks` shape at every touchpoint, realtime included:
  - `db/types.ts`: `BlockGroup` (camelCase; `scheduleFrom` / `scheduleTo` as `HH:MM`), `TABLES.blockGroups = 'block_groups'`.
  - `db/mappers.ts`: row type, `blockGroupFromRow` (trims `HH:MM:SS` to `HH:MM`), `blockGroupToRow`.
  - `db/dexie.ts`: **v9**, `block_groups: '&id, sortOrder'`, no upgrade.
  - `db/outbox.ts`: `SPECS.block_groups`.
  - `db/repo.ts`: `applyServerEcho` case; `repo.blockGroups`: `list()` (by `sortOrder`, then `createdAt`), `create(input)`, `update(id, patch)`, `delete(id)`, `listAll()` — the `notes` shape.
  - `db/realtime.ts`: a `block_groups` handler and subscription.
  - `db/localCache.ts`: `wipeLocalCache` clears `block_groups`.
- **D10 Wipe, export, import.** "Wipe my data" deletes every block group. **Not exported**; Merge and Replace import do not touch the table (the chunk-98 D13 rule). Record in the Decisions log.

### Dashboard (`src/`)
- **D11 Settings › Site blocking.** A new `SettingsSection kicker="06" title="Site blocking"`, placed before Data (Data becomes `07`), in its own file `src/components/SiteBlockingSection.tsx`, built only from the existing Settings row, switch, input and confirm-dialog patterns. No new visual language.
  - Lead hint: `Enforced by the menu bar app on your Mac, in Chrome, Safari, Brave and Edge. A change reaches the Mac the next time its panel opens.`
  - One block per group: name input (1–40); the domains as removable chips with an input `Add a site` (Enter or comma adds; a pasted URL is reduced to its domain; an invalid entry reads `Not a site address`; a duplicate is ignored; the 51st reads `50 sites at most`); switch `Block during focus`; switch `Block on a schedule` with, while on, seven day toggles `S M T W T F S` (`aria-pressed`, full day name as the accessible name, the last one on cannot be switched off) and `From` / `To` `<input type="time">` with the hint `Times follow your Mac's clock.` and, when `to` is at or before `from`, `Runs past midnight.`; switch `On` (the group's `enabled`); **Delete** behind the existing confirm dialog (`Delete "<name>"?`).
  - **Add group** creates `{ name: 'New group', domains: [], blockInFocus: true }` and focuses its name; disabled at 20 with `20 groups at most`.
  - Empty: `No groups yet. Add one to block sites during focus or at set hours.`
  - Every change saves at once through `repo.blockGroups`.
- **D12 The blocked page.** `public/blocked.html`: one static file, **no script**, inline `<style>` only, no external request beyond `hupomnemata-mark.svg` beside it. `<title>Blocked · Hupomnemata</title>`, `<meta name="robots" content="noindex">`, background `#f6f4f7`, the font stack of `src/index.css`'s body rule. Heading `This site is blocked right now`. Two paragraphs shown by `:target` only: `id="focus"` — `A focus session is running. It opens again when the focus phase ends.`; `id="schedule"` — `It is inside a scheduled block. It opens again when the block ends.` A link `Open Hupomnemata` to `./`. It must be served as itself, not as the app shell: it is in the precache (`globPatterns` already takes `html`), and `precacheAndRoute` is registered before the `NavigationRoute` in `src/sw.ts`. Confirm that on the built `dist/`; if it does not hold, add a denylist entry for `/dashboard/blocked.html` in `sw.ts` and say so.

### Shell (`menubar/src-tauri/src/`)
- **D13 `blocker.rs` (new).** Top half pure and tested:
  - `valid_domain(&str) -> bool` (D2's rule); `host_of(url) -> Option<String>` (`http` / `https` only; lowercase; userinfo, port and a trailing dot dropped); `matches(host, domain) -> bool`.
  - `Group { name, domains, focus: bool, windows: Vec<(u64, u64)> }` (epoch ms, `start < end`), `Config { enabled, groups }`.
  - `Reason { Focus, Schedule }`; `verdict(config, focus_on, now, url) -> Option<Reason>`: `None` when disabled, when the URL starts with `https://smrios07mdb.github.io/dashboard/`, or when no group matches; `Focus` beats `Schedule`.
  - `anything_active(config, focus_on, now) -> bool` and `next_start(config, now) -> Option<u64>`.
  - `parse_tabs(stdout) -> Vec<(i64, String)>`: one line per window, `<window id>` + U+001F + `<url>`; a malformed line is skipped.
  - `read_script(browser) -> String` and `write_script(browser) -> String` from **fixed templates**, the only variable being the application name from the fixed browser table. Two dialects: Chromium (`URL of active tab of w`) and Safari (`URL of current tab of w`). The read is wrapped in `if application "<name>" is running then … end if`, so it never launches a browser, and each window sits in its own `try`. The write is `on run argv`: window id, the URL that was read, the block URL; it changes the tab **only if its URL still equals the one read**. Those three values travel as `osascript` arguments after the script, never inside its text.
  - `installed(folders, app_file) -> bool` (`/Applications`, `~/Applications`), checked before any script that names a browser (the Spotify "Where is …?" rule).
  - `state_json(...)`: hand-written with `pomodoro::json_string`: `{ "enabled", "active": bool, "browsers": [{ "name", "status": "ok" | "not_installed" | "not_running" | "denied" | "timeout" | "error" | "unknown" }] }`. `unknown` = installed and not read yet.

  Bottom half, glue: `Blocker` (one `Mutex` + `Condvar`, managed by Tauri) and one thread, `blocker`. **Its lock is a leaf: never taken under the pomodoro, meditation or sessions lock, and never held across an `osascript` run or an emit.** Each pass reads the wall clock:
  - nothing active → wait on the `Condvar` until notified, or, when `next_start` is `Some`, at most `min(next_start − now, 30 s)` (the cap makes a start after sleep at most 30 s late); **no `osascript` runs while nothing is active**;
  - something active → for each installed browser, one read through `sound::run_with_timeout` (4 s); each tab with a verdict gets one write; then wait 2 s (woken early by any change). A browser that answered `denied`, `timeout` or `error` is tried again after 30 s, not 2 s. `-1743` → `denied`, `-600` → `not_running`.
  - `blocker` is emitted (payload: the state JSON) when the state JSON changed.
- **D14 Commands.** `blocker_configure { enabled, names: string[], domains: string[][], focus: boolean[], starts: number[][], ends: number[][] }` — parallel by group; rejected whole (not clamped) unless: the five lists have one length ≤ 20; each name 1–40 characters; ≤ 50 domains per group, each `valid_domain`; ≤ 60 windows per group, `starts[i].len() == ends[i].len()`, each `start < end` and inside `[now − 2 days, now + 16 days]`. `blocker_state` → the state JSON. `blocker_check` → one read of every installed, running browser now (so the Automation prompt can be met on purpose), then the state JSON. All three answer `tauri::ipc::Response`.
- **D15 `pomodoro.rs`.** Pure `focus_edge(prev: &State, next: &State) -> Option<bool>`: `Some(next.phase == Focus)` when that differs from `prev.phase == Focus`. Computed beside `music_edge` in `Pomodoro::change` and `spawn_loop`, inside the lock; `Blocker::set_focus(on)` is called **after** the lock is released, beside `send_music`. Nothing else in the pomodoro changes.
- **D16** `lib.rs`: `mod blocker;`, manage `Blocker`, start its thread in `setup`, the three commands in the handler list. `sound.rs`: visibility changes only, if `run_with_timeout` / `Run` need them, and its header comment ("the only AppleScript this app ever runs") corrected. `Info.plist`: `NSAppleEventsUsageDescription` becomes `Hupomnemata plays and pauses Spotify for your focus sessions and checks browser tabs against your blocked sites.` `Entitlements.plist`: the comment only. No new crate, plugin or capability; `Cargo.lock` unchanged.

### Menu bar web view (`menubar/src/`)
- **D17 `blockSchedule.ts`** (pure): `windowsFor(group, now: Date) -> Array<[number, number]>` — for each local day from yesterday to today + 13 whose `getDay()` is in `scheduleDays`, `[new Date(y, m, d, fh, fm), end]` with `end` on the same day when `to > from`, else on the next day (D4); windows already ended are dropped, overlapping ones merged, sorted. Empty when `blockOnSchedule` is off. DST is the platform's.
- **D18 `blockerPrefs.ts`** (pure): `localStorage['hup:mb:blocker']` over `{ enabled: true }`, an invalid value falling back.
- **D19 `blocker.ts`** (pure core, injected repo and shell): `sync()` reads `repo.blockGroups.list()` (the existing online / Dexie fallback), keeps groups that are `enabled` with at least one domain and one trigger on, builds each one's windows, and sends `blocker_configure`. At most one sync at a time; one requested meanwhile runs once more after it. A failed read keeps the shell's last configuration.
- **D20 Triggers** (`App.tsx`), signed in only: after the sign-in setup; on each `popover-shown`; on each refresher tick; on each `pomodoro` event; after any change made in Settings › Blocking. Signed out (and in the sign-out path beside `pomodoro.signedOut()`): `blocker_configure` with `enabled: false` and empty lists. **Known limit, recorded in docs:** the hidden web view is suspended, so a rule changed on the dashboard reaches the Mac at the next of those triggers, not at once.
- **D21 Settings › Blocking** (`SettingsView.tsx`), a new section between Meditation and Hotkeys, from the existing row pattern:
  - switch `Block sites on this Mac` (`hup:mb:blocker`);
  - one row per group: its name, `` `${n} sites` `` and a summary from `ruleSummary(group)` in `src/lib/blockRules.ts` (`Focus`, `Mon–Fri 9:00 AM – 5:00 PM`, or both joined with ` · `; `No trigger` when neither), with a switch for the group's `enabled` (`repo.blockGroups.update`, then `sync()`); no groups: `No groups yet.`;
  - one row per browser that is not `not_installed`: its name and `Allowed` (`ok`), `Not running`, `Needs permission` (`denied`, with the existing **Open Automation settings** button), `Didn't respond` (`timeout`), `Couldn't be read` (`error`), `Checked when a block starts` (`unknown`); a **Check browsers** button calls `blocker_check`;
  - hint: `Add and edit sites on the dashboard, under Settings › Site blocking. Quitting this app lifts every block.`
- **D22** `native.ts`: `blockerConfigure(config)`, `blockerState()`, `blockerCheck()`, `watchBlocker(cb)`, no-ops outside Tauri. Argument names tested on both sides.
- Nothing outside Settings changes in the popover. **`MAX_HEIGHT` does not change.**

## Out of scope
- A daily time allowance and usage counts (chunk 100).
- Firefox, Arc, other browsers; blocking apps; blocking on iPhone.
- Path-level rules; allow-lists; a "block now" button; any friction to lift a block (D7).
- Closing tabs; touching background tabs; any browser extension; the hosts file.
- Notifications or tray changes when a tab is blocked.
- Exporting block groups.

## Guardrails
- `src/` changes only in: `db/types.ts`, `db/mappers.ts`, `db/dexie.ts`, `db/outbox.ts`, `db/repo.ts`, `db/realtime.ts`, `db/localCache.ts`, `lib/blockRules.ts` (new), `lib/sample-data.ts` (wipe), `components/SiteBlockingSection.tsx` (new), `screens/Settings.tsx` (mount the section, renumber Data, an added `export` of its row / section components if needed), `sw.ts` (only under D12's condition), and their tests; plus `public/blocked.html`. Anything else: stop and report.
- No new npm dependency, crate or Tauri plugin. `Cargo.lock` unchanged. `tauri.conf.json`, `capabilities/`, CSP unchanged. `Info.plist` and `Entitlements.plist`: D16 only.
- `meditation.rs`, `sessions.rs`, `login.rs` unchanged. `pomodoro.rs`: D15 only. `sound.rs`: D16 only; the sound worker runs no browser script.
- No AppleScript text is ever built from a URL, a domain, a group name or anything the web view sends. The web view never sends AppleScript.
- A URL read from a browser never leaves `blocker.rs`: not in the state JSON, an event, a log line or a file.
- One `localStorage` key added: `hup:mb:blocker`.
- One run owner for the native run: confirm no other session is driving the app, the browsers or the dev DB. Every fixture group is named `Smoke-<runId>-…`; delete **by the ids you recorded**, never by a name pattern alone.
- The native run uses only `example.com`, `example.org` and `example.net`, in **new** browser windows it opens itself. Do not touch or close the operator's existing windows or tabs.
- Leave Spotify, the installed app, `hup:mb:*` / `hupo.menubar.theme` storage, `~/Library/LaunchAgents` and the ledger file as you found them. Do not revoke or reset any macOS permission.
- Do not start chunk 100 or write a handoff or brief.

## Tests (red first)
- **Rust** (`cargo test`):
  - `valid_domain`: accepts `x.com`, `news.ycombinator.com`; rejects empty, no dot, uppercase, a scheme, a path, a space, a quote, `..`, a leading or trailing dot or hyphen, 254 characters.
  - `host_of`: plain, `www.`, a port, userinfo, uppercase host, a trailing dot, `chrome://`, `file://`, `about:blank`, an empty string → the last four `None`.
  - `matches`: the domain itself, a subdomain, `notx.com` against `x.com` (no), `x.com.evil.org` against `x.com` (no).
  - `verdict`: disabled; focus only; schedule only at `start`, at `end − 1`, at `end` (no); both → `Focus`; a paused focus still `Focus` (through `focus_edge`); the dashboard and the blocked page exempt even when `github.io` is in a group.
  - `anything_active` / `next_start`: no groups; a future window; inside a window; windows of two groups.
  - `parse_tabs`: two windows, a URL holding spaces, a blank line, a line without the separator.
  - `read_script` / `write_script`: golden text for Chrome and Safari; no script holds a URL or a domain.
  - `blocker_configure`'s validation: each rejection in D14, one test each.
  - `state_json`: golden text.
  - The loop's core with an injected runner and clock: **no runner call while nothing is active**; one read per installed browser per pass while active; a write only for a matching tab, carrying the three arguments in order; `denied` backs off to 30 s; `-1743` and `-600` classified.
  - `pomodoro.rs` `focus_edge`: start → `Some(true)`; pause, resume, extend, configure → `None`; natural end, skip to break, stop → `Some(false)`; break → focus → `Some(true)`; break → idle → `None`.
- **Vitest:**
  - `blockRules`: `normalizeDomain` (bare, `https://www.x.com/path?q#h`, a port, uppercase, an IP-less junk string, an empty string); `ruleSummary` for each combination.
  - mappers round trip (`HH:MM:SS` → `HH:MM`); `repo.blockGroups` create / update / delete online, offline (outbox) and the replay; `list` fallback and order; the realtime handler; `wipeLocalCache`; `wipeMyData`; Dexie v9 opens over a v8 database with data kept.
  - `blockSchedule`, under `America/New_York`, `UTC` and `Asia/Tokyo`: a weekday window; a day not in `scheduleDays`; past midnight (starts on its start day, yesterday's still-running window kept); `from == to` is 24 h; a window already ended is dropped; the DST change dates in New York keep `09:00` at 09:00; off → empty.
  - `blockerPrefs`: default, valid, invalid.
  - `blocker.ts`: `sync` filters disabled / empty / trigger-less groups, sends the parallel lists, keeps the last configuration on a failed read, runs once more after a concurrent request.
  - `SiteBlockingSection`: add a group; add a site by Enter, by comma, from a pasted URL; an invalid site; the 51st; a duplicate; each switch saves; the schedule row shows only when on; the last day stays on; `Runs past midnight.`; delete behind the confirm; the 20-group cap; the empty line.
  - `SettingsView`: the Blocking section's switch, group rows and their switch, each browser status line, **Check browsers**.
  - `App`: `sync` on sign-in, on show, on a `pomodoro` event; signed out sends the disabled configuration.
  - `native.ts`: the three command names and every argument name.
  - `blocked.html`: the file holds no `<script` and no absolute URL, and has both `:target` ids and the title.
  - Existing suite green.

## Gates
1. `npm ci`, `npm run lint`, `npm run menubar:typecheck`; `npm test` with `TZ=America/New_York`, `TZ=UTC`, `TZ=Asia/Tokyo`; `cargo test --manifest-path menubar/src-tauri/Cargo.toml`; `git diff dd4825e -- menubar/src-tauri/Cargo.lock` empty; `npm run build` green (the PWA bundle name **will** change; record base and head names); `dist/blocked.html` exists and is in the service worker's precache list.
2. The migration applied and verified (D8), with the SQL output in the report.
3. `export PATH="$HOME/.cargo/bin:$PATH"`, `npm run menubar:build`, then `codesign --verify --deep --strict --verbose=2 <app>`, `codesign -d -r- <app>` (leaf `H"8f0d254bddc27a5990591035bd4dfd49b105611d"`), entitlements still only apple-events.
4. Browser smoke of the dashboard on `npm run dev` with the real `.env.local`: Settings › Site blocking — add `Smoke-<runId>-A`, add `example.com` by Enter and `https://www.example.org/x` by paste (stored `example.org`), switch the schedule on, change a day and the times, reload: everything is as left; console clean. Record the group's id. Name the driver.
5. Native run of the **branch build from its bundle folder** (quit the installed app first; `pgrep -fl Hupomnemata` → one process, from the bundle folder). Drivers: System Events through `osascript` for the popover (CLAUDE.md "Driving the menubar popover and Spotify", "Driving Settings natively"); **read a browser window's state by its title through System Events** (it contains `Example Domain`, or it does not; browsers append their own name), not by scripting the browser, so the harness needs no Automation grant of its own; `open -na "Google Chrome" --args --new-window <url>` and `open -a Safari <url>` to open pages; Supabase MCP `execute_sql` for the fixture rows. The blocked page is not live until the merge, so a redirected tab shows the app shell or a 404 from GitHub Pages: on the branch, **pass = the window's title no longer contains `Example Domain`**, and record the title seen. Before: record every `hup:mb:*` row and `hupo.menubar.theme`, Spotify's state, and `select count(*) from block_groups`. Set `hup:mb:sound` `auto: false` for the run.
   **The one operator action:** macOS asks once per browser, "Hupomnemata wants access to control Google Chrome / Safari". Tell the operator before step 1, and wait for **OK**. A browser he declines is recorded as declined, not failed.
   1. **Idle costs nothing.** With the step-4 group present (focus on, schedule off) and no focus running: over 20 s, `pgrep -P <app pid> -x osascript` sampled every ~40 ms shows 0 runs. A new Chrome window at `https://example.com` keeps the title `Example Domain` for 10 s.
   2. **Focus blocks.** Settings › Focus 2 min. Start focus. Within 6 s the window's title is no longer `Example Domain`. Open `https://www.example.com/` again in a new window: gone within 6 s. Open `https://example.net`: still `Example Domain` after 10 s (not in the group).
   3. **Pause keeps it; a break lifts it.** Pause; open `https://example.org`: blocked within 6 s. Resume, **Skip to break**; open `https://example.com`: still `Example Domain` after 10 s. End the break.
   4. **Cost while active.** During step 2 or 3, over 20 s: the `osascript` run count (expected about 10 per running browser) and the app's `ps -o %cpu`. Record both.
   5. **Schedule.** Through `execute_sql`, set the group to `block_in_focus = false`, `block_on_schedule = true`, today's day, `schedule_from` = now − 1 min, `schedule_to` = now + 3 min (the Mac's clock). ⌥H (the reload). `https://example.com` is blocked within 6 s with no focus running. One minute after `schedule_to`, open it again: still `Example Domain` after 10 s, and step 1's zero-run check passes again.
   6. **Safari.** Start focus; a new Safari window at `https://example.com` is blocked within 6 s. End.
   7. **The Mac switch.** `Block sites on this Mac` off, start focus (group back to focus on through `execute_sql`, ⌥H): `https://example.com` stays. Switch back on: blocked within 6 s. End.
   8. **Settings › Blocking** reads: the group row with `2 sites` and its summary; Chrome and Safari `Allowed`; switching the group off there lifts the block and the DB row reads `enabled = false`.
   9. **Cleanup:** close only the windows this run opened; delete the fixture rows by id; `select count(*)` equals the before count.
6. **Restore**: Focus length back; every `hup:mb:*` row and `hupo.menubar.theme` exactly as found (delete `hup:mb:blocker` if it was absent); Spotify as found; quit the branch app; `open ~/Applications/Hupomnemata.app`; `pgrep -fl Hupomnemata` → one process, from `~/Applications`.

If either script dialect fails on this Mac's Chrome or Safari (the read returns nothing for an open page, or the write does not move the tab): **stop and report** with the `osascript` stderr; do not improvise another mechanism.

## Docs (same pass)
- **ARCHITECTURE §4**: `block_groups` in the schema block and a **Block groups (chunk 99)** paragraph (D1–D4, D8–D10). Realtime publication list: thirteen tables.
- **ARCHITECTURE §13**: Settings › Site blocking (D11) and the blocked page (D12).
- **ARCHITECTURE §16**: a **Site blocking (chunk 99)** paragraph (D5–D7, D13–D22): the watcher, the fixed templates and argument passing, the leaf lock, the 2 s / 30 s cadence, the focus edge, the web view's schedule windows, the known limits (rule changes reach the Mac at the next trigger; quitting lifts every block; Firefox and Arc not covered). Shell commands: the three new ones and the `blocker` event. Sound D4's "only from fixed templates in that file" and the Signing paragraph's Automation sentences now name the browsers too.
- **CLAUDE.md**: one paragraph "Driving a block natively (chunk 99)": reading a browser window's title through System Events, opening test windows, the fixture rule — only what isn't already there.
- **PROGRESS**: row 99, the "Last updated" line (the previous one moves to "Prior update"), and the Decisions log: blocking is a tab watcher in the menu bar app (not an extension, not the hosts file); a blocked tab is redirected, not closed; pause keeps a focus block; schedules follow the Mac's clock; block groups not exported; no friction to lift a block.
- Commit this prompt as `prompts/chunk-99-site-blocking.md` (it's already in the working tree).

## Push
Branch only: code commit(s), then the docs commit with `[skip ci]`.

## Report
- Branch, head SHA and code SHA(s).
- Every file under `src/` and `public/` touched (must match the guardrail list).
- Vitest counts per zone and the `cargo test` count; base and head PWA bundle names; the `Cargo.lock` diff (expected empty); how `blocked.html` is served (precache or denylist).
- The migration verification output.
- Signature lines.
- Each native step with its driver and pass / fail / unverified / declined, the titles seen, the `osascript` run counts and CPU from steps 1 and 4, and the cleanup counts.
- The unverified list and every deviation.
