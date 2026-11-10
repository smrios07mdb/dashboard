# Chunk 96 — menu bar meditation (reminders, heads-up panel, breathing overlay): smoke `0960a`

- **Date:** 2026-11-10
- **Code under test:** `e0eaaea` on branch `chunk-96-menubar-meditation` (base `146d7d4`). Native steps 1–8 ran on the build before the step-9 fix; step 9 and step 3b ran on the rebuilt `e0eaaea` binary (`CDHash dc541ca4be2edc86b11003ead7261a4f819d4285`).
- **Drivers:**
  - Browser: `chrome-devtools-axi` (its own launched Chrome, not signed in) on `npm run menubar:dev`, `http://localhost:1421/`.
  - Native: AppleScript System Events from Terminal for clicks, keys and window reads; `screencapture -x -D 1|2|3` for pixels; the guarded `osascript` read of Spotify's `player state`.
- **Displays:** three — 2560×1440 (main), 2560×1440, 1080×1920 (portrait).
- **Fixtures:** none. No DB write, no calendar event.
- **Run owner:** Sergio confirmed no other session was driving the app or Spotify before the native run.
- **Result:** every check that ran passed after one fix (step 9). One stop condition was hit and resolved by Sergio (popover height). Two findings are recorded and not fixed (below). The unverified list is at the end.

## Gates

| Gate | Result |
|---|---|
| `npm ci` · `npm run lint` · `npm run menubar:typecheck` | clean |
| `npm test`, `TZ=America/New_York` / `UTC` / `Asia/Tokyo` | 138 files, 1619 tests passed in each |
| `cargo test --manifest-path menubar/src-tauri/Cargo.toml` | 114 passed (was 76): 34 in `meditation.rs`, 6 new in `pomodoro.rs`, 8 new in `sound.rs` |
| Red first, Rust | with the pure half of `meditation.rs` stubbed (`todo!()`), 36 of the new tests failed; the step-9 fix's test failed before the fix (113 passed, 1 failed) |
| Red first, Vitest | before the modules existed: 8 files and 12 tests failed (missing modules, `meditationState is not a function`) |
| `git diff 146d7d4 -- menubar/src-tauri/Cargo.lock` | one line: `+ "objc2-app-kit",` in the root package's dependency list; no new `[[package]]` |
| `npm run build`, base `146d7d4` and head, same real `.env.local` | `assets/index-m-5KO8eY.js` both, SHA-256 `6f84eb18648fa90fdc41e49c868c709d0fadc96785cb2f813051aba8edc693bc` both; only `version.json` differs; no menubar, breathe or meditation file in `dist/` |
| `npm run menubar:build` | green; the overlay is its own chunk (`BreatheOverlay-*.js`, 1.8 kB) and App/Supabase sit behind `popover-*.js` |
| `codesign --verify --deep --strict --verbose=2` | `valid on disk`, `satisfies its Designated Requirement` |
| `codesign -d -r-` | `identifier "net.mdblabs.hupomnemata.menubar" and certificate leaf = H"8f0d254bddc27a5990591035bd4dfd49b105611d"` — as chunk 95 |
| Entitlements | only `com.apple.security.automation.apple-events`; `flags=0x10000(runtime)` |
| Files under `src/` changed | none |
| `osascript` outside `sound.rs` | none added |

## Stop condition: popover height

The prompt said to stop if the popover no longer fits under `MAX_HEIGHT` (704) with the panel, a focus session, Sound and six Today rows. Measured in the browser harness (real components, six sample rows):

| Popover | Height needed | At the 704 cap |
|---|---|---|
| Focus session + Sound + six rows, no panel | 701.1 | fits (list 221 / 221) |
| + heads-up panel (102.5 pt) | 803.5 | list 121 of 221 px visible, scrolls |
| + due panel (147.5 pt) | 848.5 | list 76 of 221 px visible, scrolls |
| Idle focus row + due panel | 720.3 | list 205 of 221 px visible |

Work stopped and Sergio was asked. **He chose to raise `MAX_HEIGHT` to 852** (`lib.rs` and `.mb-pop`'s `max-height`). Re-measured at 852: 803.5 and 848.5, list 221 / 221 in every case. No other section was changed.

## Browser (gate 4)

`native.ts` answers `null` in a browser, so both HUDs were mounted from a temporary harness page on the dev server (deleted afterwards, never committed): the real `MeditationPanel`, `FocusHeader`, `PopoverTabs`, `TodayList`, `SoundSection` and CSS with stand-in backends that log their calls. The overlay was loaded through the real `main.tsx` at `#breathe` with a stand-in `__TAURI_INTERNALS__` answering a running session.

| # | Check | Result |
|---|---|---|
| B1 | Heads-up HUD: `Breathe at 5:20 PM` · `5-minute session · in 4:57` · `Start now`, `Snooze 5`, `Snooze 15`, `Skip` | pass |
| B2 | Due HUD: `Time to breathe` · `5 minutes. Spotify pauses, Esc ends it.` · `Start session ⌥⇧M`, `Snooze 5`, `Snooze 15`, `Skip` | pass |
| B3 | Each button calls its command (log: `start`, `snooze [5]`, `snooze [15]`, `skip`, for both HUDs) | pass |
| B4 | Tokens: light `--calm #6a3fe0`, `--calm-soft rgba(106, 63, 224, 0.1)`; dark `#b9a2ff`, `rgba(185, 162, 255, 0.14)`; Start button background is `--calm` in both | pass |
| B5 | Overlay at `#breathe`, light and dark: no `.mb-pop`; of App / Supabase / popover / sign-out cleanup / sync runner, only `BreatheOverlay.tsx` was fetched; 84 % veil; `--bo-delay: -3785ms` for a session 23.7 s old; rings at +350 / +700 ms; `4:34 LEFT · ESC TO END` | pass |
| B6 | Esc on the overlay page calls `meditation_end` | pass |
| B7 | 880 px wide: the time-left line is hidden, words 14 px | pass |
| B8 | Reduced motion (`--force-prefers-reduced-motion`): `data-still`, no delay variable, no animation on orb, rings or words, only `Breathe in`; the HUD orb is still too | pass |
| B9 | Console: no errors on any page | pass |

The first screenshot showed the Start button grey: `.mb-fbtn`'s rule comes later in the file and won. Fixed with a two-class selector before the commit.

## Native (gate 5)

The installed app was quit; one process ran, from the bundle folder. Before: Spotify not running, Safari not running, `hup:mb:meditation` absent. Schedule written into the web view's localStorage: `{"enabled":true,"length":3,"mode":"times","times":["17:55","18:00","18:08"],"headsUp":5,"pauseSpotify":true}` — a third time was added, because the snooze of the first is replaced by the second (D5) and step 7 needs its own occurrence.

| # | Step | Observed | Result |
|---|---|---|---|
| 1 | Heads-up at T−5 | 17:50:00 window `Hupomnemata` shown, tray `5:00` counting down; panel `Breathe at 5:55 PM` · `3-minute session · in 4:45`. Hidden on its own at 17:50:59.97 (60 s); tray kept the countdown (`4:00`). Frontmost app: this sample is not clean (it read Chrome → Terminal in the same second while Sergio was using the Mac); the clean sample is 18:03:00 — `Finder` before and after, tray `5:00`, `Hupomnemata`'s process `frontmost` false, window `AXFocused` false | pass |
| 2 | Due at T, Snooze 5 | 17:54:59.97 window shown, tray `5:55`, frontmost `Microsoft Outlook` unchanged; panel `Time to breathe` · `3 minutes. Spotify pauses, Esc ends it.` Snooze 5 clicked at 17:55:11 → by 17:55:12.8 the panel read `Breathe at 6:00 PM` · `in 4:47`, tray `4:47`: the 18:00 occurrence replaced the snooze | pass |
| 3 | Start with Spotify playing | See the finding below: with Safari full screen in front the panel could not be reached, so the session was started with ⌥⇧M at 18:01:03.81. Spotify `playing` → `paused` by 18:01:04.40 (0.6 s). Windows `breathe-0`, `breathe-1`, `breathe-2` at (0,0) 2560×1440, (2560,0) 1080×1920, (−2560,0) 2560×1440. Tray `2:59` | pass (by hotkey) |
| 3b | Start from the panel | Second schedule (`18:21`), Spotify playing, Finder in front. Heads-up at 18:16; `Start now` clicked at 18:16:03.23 → `paused` by 18:16:03.91 (0.7 s), three `breathe-*` windows, tray `3:00`, frontmost still `Finder`. Esc at 18:16:07.91 → windows gone by 18:16:08.11, `playing` by 18:16:08.41 | pass |
| 4 | Full screen | Safari full screen on the main display, frontmost. Display 1's capture shows the veil, orb and words over Safari's page and toolbar; displays 2 and 3 show them over the desktop, menu bar included | pass |
| 5 | Sync | Three displays captured in parallel twice (18:01:05.39–05.61 and 18:01:07.97–08.24). Compared: the orb's diameter as a share of its largest size, from the count of orb-coloured pixels. A: 0.664 / 0.668 / 0.662. B: 0.921 / 0.920 / 0.917. All three read `Breathe in` and `2:59 LEFT` in A | pass |
| 6 | Esc | Key code 53 at 18:01:16.50 with Safari frontmost: no `breathe-*` window at 18:01:16.69 (0.2 s), Spotify `playing` at 18:01:17.03, tray back to idle, Safari still frontmost and full screen | pass |
| 7 | Skip | 18:08:00 due, tray `6:08`, frontmost `Finder`. Skip at 18:08:01.46 → the panel section gone, tray idle, no overlay, Spotify unchanged (`playing`) | pass |
| 8 | ⌥⇧M, natural end | Spotify paused first. ⌥⇧M at 18:08:23.33 → three overlays, tray `2:59`, the popover hidden, Spotify `paused`. Overlays gone between 18:11:22.3 and 18:11:23.5 (3:00), tray idle, Spotify still `paused`, frontmost unchanged | pass |
| 9 | Focus interplay | **First run failed**, see below. On the fixed build: ⌥⇧F → tray `24:56`, Spotify `playing`. ⌥⇧M → overlays, tray `2:59`, Spotify `paused`. ⌥⇧F during the session → nothing. Esc → tray `24:56` with the pause bars (capture), unchanged 4 s later, Spotify `paused`. `End` in the popover → idle | pass after fix |
| 10 | Unverified by design | not attempted | — |

**Step 9, first run — failed and fixed.** After Esc the focus stayed paused but Spotify was `playing`. Cause, measured: Spotify answers `player state` = `playing` for a few hundred ms after a `pause` (3 of 3 trials: two reads right after the pause said `playing`, 0.5 s later `paused`). The pomodoro's Pause edge ran first; `Op::MeditationStart` then read `playing`, paused again and remembered the pause as the session's, so the end started the music. Fix: `Pomodoro::pause_focus` answers whether it paused a focus, and `Op::MeditationStart { after_focus_pause }` reads nothing when the edge has just paused the music ("play on focus" on and a preset set). Two tests, one red before the fix.

**Finding, not fixed: the popover does not show over a full-screen app.** With Safari full screen and frontmost, the 18:00 due panel never appeared in a capture or in System Events' window list, though the tray changed to `6:00`. ⌥H did not bring the popover up there either, so this is the popover's existing behaviour in a full-screen Space, not the passive show. The overlay does cover full-screen apps, and ⌥⇧M starts a session from there. A reminder that falls while a full-screen app is in front is therefore seen only in the tray, which that Space hides.

**Finding, not fixed: ⌥⇧F brings Spotify to the front.** Starting focus with the hotkey left `Spotify` frontmost (chunk 95's `play track`). Not part of this chunk.

**Restore.** Branch app quit; the `hup:mb:meditation` row deleted (it was absent); Safari quit (it was closed); Spotify paused and quit (it was not running); `~/Applications/Hupomnemata.app` reopened — one process, from `~/Applications`. `hup:mb:sound`, `hup:mb:tab`, `hup:lastUserId` and the theme key untouched.

## Default schedule

With no stored settings: every 90 minutes from 09:00, before 18:00 — 09:00, 10:30, 12:00, 13:30, 15:00, 16:30 — a 5-minute heads-up, 5-minute sessions. The panel prints the time through `timeText` in the Mac's own zone: `Breathe at 10:30 AM` · `5-minute session · in 4:59`, then `Time to breathe` · `5 minutes. Spotify pauses, Esc ends it.` The tray shows the heads-up countdown as `4:59` and the due time as `10:30` (12-hour, no AM/PM).

## Unverified

- Sleep across a heads-up or a due (unit-tested with injected times only).
- A display plugged in or removed during a session (not handled, by design).
- Esc registration refused by the system.
- Six real Today rows with the panel (the signed-in Today was `0/0`; measured in the browser harness).
- The due panel's own 120 s auto-hide (each due panel was answered before then; the 60 s heads-up hide was observed).
- The panel's `⌥⇧M is taken by another app` message natively.
- Missed at due + 30 min, natively.
- The default schedule on a real day (the run used a short `times` schedule).
