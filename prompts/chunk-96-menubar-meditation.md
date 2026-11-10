# Chunk 96 — Menu bar meditation: reminders, heads-up panel, breathing overlay on every display

Repo: smrios07mdb/dashboard. Base: `main` at `146d7d4` (chunk 95 merged ff at `e13d3f2`; docs `146d7d4`). Branch: `chunk-96-menubar-meditation`.
Model: Fable 5.2 (native work).
Design reference: `hupomnemata_handoff/menubar/prototype/hupomnemata-menu-bar.html`. The sections to follow are:
- "Meditation reminder": `.pop.hud`, `.hrow`, `.o`, `.hbtn`, `.btn.calm.wide`.
- "Breathing session": `.veil`, `.orbwrap`, `.orb`, `.words`, `.left`, `@keyframes breathe / win / wout`, and the reduced-motion rule.
- The "Breathe due" tray state in the states strip.
- The `--calm` / `--calm-soft` tokens: `#6a3fe0` / `rgba(106,63,224,.10)` in light and `#b9a2ff` / `rgba(185,162,255,.14)` in dark.

**Push the branch and stop. Do not merge to `main`.** The orchestrator gates the branch first.

## Why
Sergio wants short breathing breaks on a schedule. The menu bar warns him 5 minutes before and again at the time, in the app's own drop-down panel. **Nothing starts until he presses Start.** A session covers every display with a breathing guide, pauses Spotify, and ends at any point with Esc. This chunk builds that with fixed default settings. The settings UI is chunk 97.

## Locked decisions

### Who owns what
- **D1 Rust owns the reminder clock and the session.** Both live in a new `menubar/src-tauri/src/meditation.rs`. The structure follows `pomodoro.rs`:
  - The top half is pure state and transitions, tested with injected times.
  - The bottom half is the glue: managed state, commands, one `meditation` thread, events, windows.
  - Time is wall-clock `SystemTime`, never `Instant`.
  - The thread parks on a condvar until its next event (heads-up, due, missed, auto-hide, session end). Every wait is capped at 30 s, so a Mac waking from sleep is caught within 30 s.
  - The lock is never held across a window operation, an emit, a tray write or a call into `sound` / `pomodoro`.
- **D2 The web view owns the schedule's arithmetic. Rust only receives due times.**
  - The shell has no time-zone code and gets none. Do not add `chrono`, `time`, `libc` or similar.
  - `menubar/src/meditationSchedule.ts` (pure) turns the prefs into the due times for the **next 14 days** in the Mac's local time. Build each time with `new Date(y, m, d, h, min)`, so DST is handled by the platform.
  - The list is sent with `meditation_configure` at sign-in, on every `popover-shown`, and on every prefs change.
  - The popover is shown every time a reminder fires (D5), so the list refills itself as long as reminders are happening.
  - Signed out, the schedule is cleared: `meditation_configure` with `due: []`. Reminders run only while signed in.

### Settings
- **D3 Prefs**: `menubar/src/meditationPrefs.ts` (pure, guarded like `soundPrefs.ts`). It reads `localStorage['hup:mb:meditation']` over these defaults:
  - `enabled: true`.
  - `length`: 5 (minutes). Valid values: 3, 5 or 10.
  - `mode`: `'every'` or `'times'`; default `'every'`.
  - `every`: 90 (minutes). Valid 15–240.
  - `from` / `to`: `'09:00'` / `'18:00'` (`HH:MM`). `from` must be before `to`.
  - `times`: `['10:30', '13:00', '15:30']`. 1–12 valid `HH:MM` strings; duplicates are dropped and the rest sorted.
  - `headsUp`: 5 (minutes). Valid 0–30; 0 means no heads-up.
  - `pauseSpotify`: `true`.

  Each field that is invalid falls back to its default on its own.
- **D4 The schedule**:
  - `'every'`: due at `from`, then every `every` minutes after it, for as long as the time is strictly before `to`. With the defaults that gives 9:00, 10:30, 12:00, 13:30, 15:00 and 16:30.
  - `'times'`: due at each time in the list.
  - Every day; days of the week are chunk 97's job.
  - Times already past are not sent. `enabled: false` sends `[]`.

### The reminder
- **D5 One pending reminder at a time.** Rust keeps the sorted due list from the last configure, plus a set of occurrences already handled (started, skipped or missed), keyed by due ms and pruned after 24 h. A reconfigure never brings back a handled occurrence.

  States:
  - `none`
  - `heads_up` (from `due − headsUp` until `due`)
  - `due` (from `due` until it is handled, or until `due + 30 min`, when it becomes **missed**)
  - `running` (a session is on)

  A Mac that wakes after `due + 30 min` drops that occurrence silently. One that wakes inside the 30 minutes goes straight to `due`.
- **D6 The panel drops by itself, without taking focus.** At heads-up time and again at due time, Rust:
  - Emits a `meditation` snapshot.
  - Shows the popover under the tray with a new `show_passive`: the same placement as `show`, with no `set_focus`.

  Because the panel never takes focus, the blur rule never hides it, and it doesn't take the keyboard from the app Sergio is typing in (`acceptFirstMouse` is already on, so buttons work on the first click).

  If the popover is still unfocused, Rust hides it on its own after **60 s** (heads-up) or **120 s** (due). Once Sergio clicks into it, it is focused and the normal blur rule applies.

  While the state is `heads_up` or `due`, the tray keeps showing it (D9). Clicking the tray or pressing ⌥H shows the panel again.
- **D7 Panel actions**:
  - **Start now / Start session**: start a session now (D10).
  - **Snooze 5 / Snooze 15**: the reminder becomes due at `now + n` min, with no second heads-up.
  - **Skip**: the occurrence is handled, and the panel and tray clear.

  A scheduled occurrence that falls at or before a snoozed time replaces the snooze.

  The panel is `menubar/src/MeditationPanel.tsx`, signed in only, rendered **above the tabs** (and above the focus header) while the state is `heads_up` or `due`. It follows the prototype's two HUDs:
  - Heads-up: title `Breathe at 10:30` (Mac local time; use the app formatter `timeText` and record what it prints). Subtitle `5-minute session · in 4:59`, counting down while shown. Buttons: Start now, Snooze 5, Snooze 15, Skip.
  - Due: title `Time to breathe`. Subtitle `5 minutes. Spotify pauses, Esc ends it.` (drop "Spotify pauses" when `pauseSpotify` is off). A wide calm button `Start session` with the ⌥⇧M `kbd`, then Snooze 5, Snooze 15, Skip.
  - The `.o` orb uses the `breathe` animation and honours `prefers-reduced-motion`.
  - Add `--calm` / `--calm-soft` with the values above: light in `menubar.css`, dark in `dark.css`.
  - The popover must still fit under `MAX_HEIGHT` (704) with the panel, a focus session, Sound and six Today rows. If it doesn't, stop and report with measurements. Don't change `MAX_HEIGHT` or shrink other sections on your own.
- **D8 Hotkey ⌥⇧M** starts a session now, due or not. If a session is already running, it does nothing.
  - Add `meditate: 'Alt+Shift+M'` to `DEFAULT_HOTKEYS` in `hotkeys.ts` (rebindable in 97).
  - A failed registration shows the same "taken" message pattern as focus.
  - While a session runs, the ⌥⇧F handler does nothing.

### The tray
- **D9 The pomodoro loop stays the only tray writer.**
  - `meditation.rs` exposes a pure `tray_hint(&MedState, now) -> Option<MedTray>`.
  - The pomodoro loop picks what to show with a pure `tray_view(pomo, hint, now) -> (title, icon)`. Precedence: **session running** (orb + time left, `m:ss`) > **a pomodoro phase** (unchanged) > **heads-up** (orb + `m:ss` until due) > **due** (orb + the due time as `h:mm`, as the prototype's `10:30`) > idle count.
  - Meditation wakes the loop with a new `Pomodoro::poke()` (bump the generation, notify).
  - While the shown hint counts down, the loop wakes once a second, as a running phase does.
  - New template icon `icons/tray-breathe.png`: the prototype's orb glyph (`r 5.5` ring at 40 % alpha, `r 2.6` filled dot, viewBox 14). Draw it in `make-tray-icon.mjs` like the cup and the bars.
  - It is not violet: a template image has one colour, the same limit that kept the break from being blue.

### The session
- **D10 Start.**
  1. If pomodoro focus is running, pause it through the existing `pause` transition (call the managed `Pomodoro`, not a copy). The chunk-95 edge pauses Spotify as usual. Focus stays paused after the session; nothing resumes it.
  2. If `pauseSpotify` is on, queue a new sound op, `Op::MeditationStart`: read the state; if Spotify is playing, `PAUSE_SCRIPT`, and remember that this session paused it.
  3. Set `started_at = now` and `ends_at = now + length`. Mark the occurrence handled, emit `meditation`, hide the popover, open the overlays (D11), and register Esc (D12).

  It needs no Automation prompt beyond the one chunk 95 already granted.
- **D11 One overlay window per display.**
  - At start, for every monitor in `available_monitors()`, build a `WebviewWindow` labelled `breathe-<n>`:
    - It loads the same bundle at `index.html#breathe`.
    - Borderless, transparent, no shadow, not resizable, `skip_taskbar`, `always_on_top`, `visible_on_all_workspaces`.
    - Positioned and sized to that monitor's full frame (menu bar and Dock included).
  - Then raise each window **above full-screen spaces, the menu bar and the Dock**, through its `ns_window()`:
    - `setLevel(NSScreenSaverWindowLevel)`.
    - `collectionBehavior` `canJoinAllSpaces | fullScreenAuxiliary | stationary | ignoresCycle`.
  - The one allowed new direct dependency: `objc2` and `objc2-app-kit` **only at the versions already in `Cargo.lock`** (`0.6.5` / `0.3.2`), with the fewest features that compile. If those versions don't work, or something else is needed, stop and report. **Do not** enable `macOSPrivateApi`, and add no Tauri plugin.
  - The window on the display under the mouse takes focus.
  - Displays added or removed during a session are not handled. Record that.
- **D12 Esc always ends it.** While a session runs:
  - Rust registers `Escape` as a global shortcut through the existing global-shortcut plugin's **Rust** API, with a handler that ends the session.
  - It unregisters at the end. If registration fails, the overlay's own `keydown` Esc still works; log the failure.
  - The overlay page also ends on `keydown` Escape.
- **D13 The overlay page**: `menubar/src/BreatheOverlay.tsx`.
  - `main.tsx` renders only it when `location.hash === '#breathe'`: no `App`, no Supabase, no sign-out cleanup, no sync runner. It still applies the theme.
  - It follows the prototype's `.veil`. A `color-mix(var(--bg) 84%, transparent)` veil is enough; desktop blur is not possible without the private API, so don't try.
  - The orb, the two rings, `Breathe in` / `Breathe out` on the 10 s cycle, and `3:42 LEFT · ESC TO END` at the bottom (hidden on displays narrower than 900 pt, as the prototype's `.sm`).
  - **In sync across displays**: every animation gets `animation-delay: -((now − startedAt) mod 10000) ms`, from the snapshot's `startedAt`, so all windows breathe together whenever each one loaded. The time left is computed from `endsAt`, not counted.
  - Reduced motion: no animation; the words stay on `Breathe in`.
- **D14 End.** The session ends at `ends_at` (the thread), on Esc, on `meditation_end`, or on sign-out.
  - Close every `breathe-*` window, unregister Esc and emit `meditation` (state `none`).
  - If this session paused Spotify, queue `Op::MeditationEnd`: read the state; if Spotify is still paused, `PLAY_SCRIPT`; clear the flag. If Sergio changed it in between, leave it alone.
  - Saving the session is chunk 98; nothing is written anywhere.

### Interface
- **D15 Commands** (`lib.rs` handler list; named in `native.ts`; argument names tested on both sides):
  - `meditation_state`.
  - `meditation_configure { due: number[], headsUp, length, pauseSpotify }`. Rust validates: at most 400 entries, each within `[now − 1 day, now + 15 days]`; sorts and de-duplicates; `headsUp` 0–30; `length` 1–60. Anything else is rejected.
  - `meditation_start`, `meditation_snooze { minutes }` (only 5 or 15), `meditation_skip`, `meditation_end`.
  - Each answers the snapshot JSON (hand-written, with `json_string`): `{ "status": "none" | "heads_up" | "due" | "running", "dueAt": ms|null, "startedAt": ms|null, "endsAt": ms|null, "length": n, "pauseSpotify": bool, "nextDueAt": ms|null }`.
  - Event `meditation` carries the same JSON on every change.
  - Capabilities: the overlay windows get their own capability file (`breathe.json`, windows `breathe-*`), with only what they need to listen to `meditation` and call `meditation_state` / `meditation_end`. `default.json` is unchanged.
- **D16 Unchanged**:
  - The pomodoro's timing and transitions. The only additions are `poke()`, the tray-view selection and a pub way for meditation to call `pause`.
  - Sound's existing ops and templates (only the two new ops are added).
  - Today, check-off, scratchpad, theme, the Sound section, CSP and window placement.

## Out of scope
- The settings UI, rebinding, days of the week, launch at login (97).
- Saved sessions and Insights (98).
- Notifications, sounds, guided audio, any other Spotify behaviour.

## Guardrails
- Nothing under `src/` changes. If something must, an added `export` only; anything more: stop and report.
- No new npm dependency, crate or Tauri plugin. The one exception is D11's `objc2` / `objc2-app-kit` at the locked versions; `Cargo.lock` must gain no new package.
- No `osascript` outside `sound.rs`. Nothing blocks the main thread.
- One run owner for the native run: confirm no other session is driving the app or Spotify. No DB writes.
- Leave Spotify, the installed app and `hup:mb:*` storage as you found them (method below).
- Do not start chunk 97 or write a handoff or brief.

## Tests (red first)
- **Rust**, `meditation.rs` with injected times:
  - `heads_up` / `due` boundaries, including `headsUp = 0` (straight to `due`).
  - `due + 30 min` → missed and handled.
  - Wake from sleep: past the window → dropped; inside the window → `due`.
  - Snooze 5 and 15 (no second heads-up).
  - A scheduled occurrence before a snooze replaces it.
  - Skip; a reconfigure does not bring back a handled occurrence; pruning after 24 h.
  - `configure` validation (count, range, `headsUp`, `length`); snooze minutes other than 5 / 15 rejected.
  - `start` from `none`, `heads_up` and `due` → `running` with `ends_at = start + length`.
  - The natural end at `ends_at`; `end`.
  - The snapshot JSON for each status.
  - `tray_hint` per state.
- **Rust**, `pomodoro.rs`: a `tray_view` table covering every precedence pair of D9, the loop's 1 s wake while a countdown hint is shown, and `poke` bumping the generation.
- **Rust**, `sound.rs` against the injected runner:
  - `MeditationStart` playing → `PAUSE_SCRIPT` and the flag set; paused → nothing.
  - `MeditationEnd` with the flag and Spotify paused → `PLAY_SCRIPT`; flag but playing → nothing; no flag → nothing.
  - Not installed → no script.
- **Vitest**:
  - `meditationPrefs`: defaults, stored values, per-field fallback, `from ≥ to`, duplicate and invalid times.
  - `meditationSchedule`: the defaults give 6 a day; times mode; past times dropped; `enabled: false` → `[]`; 14 days; a DST change in `America/New_York` (run under the three zones like the rest) keeps the local clock time.
  - `MeditationPanel`: both HUDs, each button calls the right command, the countdown with fake timers, the "Spotify pauses" text off when `pauseSpotify` is off.
  - `BreatheOverlay`: the delay is computed from `startedAt`, the time left from `endsAt`, Esc calls `meditation_end`, reduced motion.
  - `hotkeys`: `meditate` is in the defaults and registers; ⌥⇧F does nothing while running.
  - `native.ts`: command names and argument names match the Rust signatures exactly.
  - `App`: configure at sign-in and on show; `due: []` on sign-out.
  - Existing suite green.

## Gates
1. Run these:
   - `npm ci`, `npm run lint`, `npm run menubar:typecheck`.
   - `npm test` with `TZ=America/New_York`, `TZ=UTC` and `TZ=Asia/Tokyo`.
   - `cargo test --manifest-path menubar/src-tauri/Cargo.toml`.
   - `git diff 146d7d4 -- menubar/src-tauri/Cargo.lock`: only the root package's dependency list may change, with no new `[[package]]`.
2. `npm run build` on base `146d7d4` and on the head with the **same** real `.env.local`: the same `assets/index-*.js` name and hash, and no menubar file in `dist/`.
3. `export PATH="$HOME/.cargo/bin:$PATH"`, then `npm run menubar:build`. Then:
   - `codesign --verify --deep --strict --verbose=2 <app>`.
   - `codesign -d -r- <app>`: the same requirement as chunk 95 (`certificate leaf = H"8f0d254bddc27a5990591035bd4dfd49b105611d"`).
   - Entitlements are still only apple-events.
4. Browser smoke on `npm run menubar:dev` (`native.ts` no-ops; render with a stand-in backend as in chunks 94–95): both HUDs and the overlay page (`#breathe`), light and dark, reduced motion, console clean. Name the driver.
5. Native run of the **branch build from its bundle folder**. Quit the installed app first; `pgrep -fl Hupomnemata` must show one process, from the bundle folder.
   - Drivers: AppleScript System Events for clicks, keys and window reads; `screencapture` (each display: `-D 1`, `-D 2`) for pixels; `osascript` to read Spotify's `player state`.
   - Follow the CLAUDE.md "Native menubar runs" and "Driving the menubar popover and Spotify" notes.
   - Note Spotify's state before; note `hup:mb:meditation` (absent or its value) before.
   - **Short schedule**: quit the app, write `hup:mb:meditation` with `{"enabled":true,"length":3,"mode":"times","times":["<now+7 min>","<now+12 min>"],"headsUp":5,"pauseSpotify":true}` into the web view's localStorage (the chunk-95 SQLite method), and relaunch.
   1. **Heads-up** at `T−5`: the window appears without taking focus. Check that the frontmost app is unchanged (`tell application "System Events" to get name of first process whose frontmost is true`). The tray title counts down. The panel reads `Breathe at …`. Unfocused, it hides on its own after ~60 s, and the tray keeps the countdown.
   2. **Due** at `T`: the panel shows again, `Time to breathe`, and the tray shows the time. Press **Snooze 5** → the panel and the tray countdown clear to the next state. Record the times.
   3. Start Spotify playing (`osascript` `play`). At the snoozed due time, press **Start session**:
      - Spotify is `paused` within 2 s.
      - One `breathe-*` window per display (`get name of every window of process "Hupomnemata"`, plus a `screencapture` of each display).
      - The tray shows the time left.
   4. **Full screen**: before step 3's Start, put Safari in full screen (`osascript` to open a page, then ⌃⌘F) on one display. Pass: that display's capture shows the overlay over it. If it doesn't, record it as a failure with the capture; don't work around it.
   5. **Sync**: capture both displays within 200 ms of each other at two moments 3 s apart. The orb's scale or the word should match across displays. Record what you compared.
   6. **Esc** (`key code 53`, frontmost app anything): every overlay closes within 1 s, the tray returns, and Spotify is `playing` again (this session paused it).
   7. Second occurrence (`T+12`): press **Skip** → it clears; nothing starts.
   8. **⌥⇧M** with Spotify paused: a session starts, and Spotify stays paused. Let it run to its natural end (3 min): the overlays close, and Spotify is still paused (this session didn't pause it).
   9. **Focus interplay**: ⌥⇧F (focus running, Spotify playing via Auto), then ⌥⇧M → the pomodoro paused (tray bars after the session), Spotify paused. Esc → focus stays paused, and Spotify stays paused. Then End the pomodoro.
   10. Unverified by design (record, don't attempt): sleep across a heads-up or due, a display plugged in during a session, Esc registration refused, six real Today rows with the panel.
6. **Restore**:
   - Quit the branch app.
   - Restore `hup:mb:meditation` (delete the row if it was absent).
   - Exit Safari full screen and quit Safari if it was closed.
   - Spotify as found.
   - `open ~/Applications/Hupomnemata.app`; `pgrep -fl Hupomnemata` → one process, from `~/Applications`.

## Docs (same pass)
- **ARCHITECTURE §16**:
  - A new **Meditation (chunk 96)** paragraph covering D1–D16, in the style of the Sound paragraph.
  - **Shell commands**: the six new commands and the `meditation` event.
  - **Dependencies**: `objc2` / `objc2-app-kit`, direct, at the locked versions, for the window level only.
  - **Not built**: the out-of-scope list.
- **CLAUDE.md**: one paragraph on driving and observing the overlay natively (window names, per-display capture, full-screen setup), if anything you learned isn't already there.
- **PROGRESS**: row 96, the "Last updated" line, and the Decisions log:
  - Rust owns the reminder clock; the web view computes due times (no time-zone code in the shell).
  - Overlays at screen-saver level through `objc2`; no private API.
  - Starting a session pauses a running focus and doesn't resume it.
  - Spotify resumes only if this session paused it.
- Commit this prompt as `prompts/chunk-96-menubar-meditation.md` (it's already in the working tree).

## Push
Branch only: code commit(s), then the docs commit with `[skip ci]`.

## Report
- Branch, head SHA and code SHA(s).
- Files under `src/` touched (expected: none).
- Vitest counts per zone and the `cargo test` count.
- Both bundle names and hashes; the `Cargo.lock` diff.
- Signature lines.
- The default schedule as it shows in the panel (exact strings).
- Each native step with its driver and pass / fail / unverified: frontmost-app check, auto-hide times, window count per display, full-screen capture, sync comparison, Esc close time, Spotify state at each point.
- Screenshot paths, the unverified list, and every deviation.
