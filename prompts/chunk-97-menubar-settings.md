# Chunk 97 — Menu bar settings: focus lengths, playlists, meditation schedule, hotkeys, open at login

Repo: smrios07mdb/dashboard. Base: `main` at `2aca6fb` (chunk 96 merged ff at `9632586`; docs `2aca6fb`). Branch: `chunk-97-menubar-settings`.
Model: Opus 5.5.
Design reference: `hupomnemata_handoff/menubar/prototype/hupomnemata-menu-bar.html`, section "Settings": `.sec`, `.lab`, `.setlist`, `.set`, `.set.dim`, `.seg` / `.seg button.on`, `.val`, `.sw`, `.key` / `.key.rec`, `.hint`, and the footer's Settings icon button. The prototype draws Meditation and Hotkeys only; build the other sections from the same row pattern.

**Push the branch and stop. Do not merge to `main`.** The orchestrator gates the branch first.

## Why
Every setting the menu bar app has is already stored per Mac under `hup:mb:*`, with defaults and validation, but nothing lets Sergio change them. This chunk adds one Settings view in the popover that edits those keys, plus the two things that have no key yet: rebinding hotkeys and open at login. It also adds days of the week to the meditation schedule and lets him put his own playlists behind the three presets.

## Locked decisions

### The view
- **D1 One Settings view, signed in only.** The footer gets a **Settings** button (signed in only). It swaps the popover body: `MeditationPanel` stays on top (a reminder must stay actionable); `FocusHeader`, `PopoverTabs` and `SoundSection` are replaced by `menubar/src/SettingsView.tsx`. A header row reads `Settings` with a **Done** button. The view closes on Done, on Esc (the view handles Esc and marks it handled, like the scratchpad, so the popover stays open), when the popover hides, and when ⌥H forces Scratchpad. Closing it remounts `SoundSection`, so it rereads its prefs.
- **D2 Sections, in order:** Focus, Sound, Meditation, Hotkeys, General. Each change saves at once; there is no Save button. The view's body scrolls inside the popover's existing 852 pt cap. **`MAX_HEIGHT` does not change.**
- **D3 Footer.** Signed in: `Open dashboard` · spacer · `Settings` · `Sign out` · `Quit`. The Theme button moves into Settings › General. Signed out: the footer is unchanged from today (Theme stays there, no Settings).

### Focus
- **D4** Rows, each a stepper (− value +) over `pomodoroPrefs`' ranges: `Focus` (1–180 min), `Short break` (1–60), `Long break` (1–90), `Long break after` (1–12 sessions). A switch, `Compact menu bar timer` (`compact`: `17m` instead of `16:48`). Hint: `Changes apply from the next phase.` Every change goes through `pomodoro.saveConfig` (already there), which saves and sends `pomodoro_configure`. The buttons disable at each range end.

### Sound
- **D5 Own playlists.** `soundPrefs` gains `playlists`: for each of `binaural`, `classical`, `deep`, an optional `{ label, uri }`. Missing or invalid → that slot's built-in preset. Silence is fixed.
  - `label`: trimmed, 1–20 characters.
  - `uri`: must match `PLAYLIST_URI`. The input also accepts an `open.spotify.com` playlist link (`https://open.spotify.com/playlist/<22>`, an optional `/intl-xx/` segment before `playlist`, any `?si=…` query) and stores it as `spotify:playlist:<22>`. Anything else shows `Not a Spotify playlist link` and is not saved.
  - `menubar/src/sound.ts` gains `presetsFor(prefs)` and `presetFor(prefs, id)` (pure). Every caller of `PRESETS` / `presetById` that resolves what plays (`App.tsx` at sign-in, `SoundSection`) uses them. The built-in table and its tests stay.
  - Each slot's row: label input, link input, **Reset** (back to the built-in). If the changed slot is the selected preset, `sound_configure` is sent with the new URI. Nothing plays from Settings.

### Meditation
- **D6 Rows** (the prototype's): `Reminders` switch (`enabled`); `Length` segmented 3 / 5 / 10 min; `Schedule` segmented `Every` / `Set times`, the other mode's row dimmed (`.set.dim`) and disabled; `Every` row: a select (15, 30, 45, 60, 90, 120, 180, 240 min) and `from` / `to` as `<input type="time">`; `Set times` row: one `<input type="time">` per time, × to remove (not the last one), **+ Add** (up to 12; a new row is the last time + 1 h, capped at 23:00); `Days` (D7); `Heads-up` select (None, 2, 5, 10, 15 min before); `Pause Spotify during a session` switch. Hint: `Sessions never start on their own. You press Start.` Every change goes through `meditation.savePrefs` (already there).
  - `from` at or after `to` shows `Start must be before end` and is not saved.
  - A stored value outside a select's list (e.g. `every: 75` written by hand) is shown as an extra option, not changed.
- **D7 Days of the week.** `meditationPrefs` gains `days: number[]` (JS `getDay()`: 0 = Sunday … 6 = Saturday). Default: all seven, so behaviour is unchanged until he edits it. Valid: 1–7 distinct integers 0–6, sorted; invalid → the default. `dueTimes` skips a day whose `getDay()` is not in `days`. UI: seven toggles `S M T W T F S` (`aria-pressed`, full day name as the accessible name); the last one on cannot be switched off.
- The shell is unchanged: it still only receives due times.

### Hotkeys
- **D8 Rows**: `Open scratchpad`, `Start or pause focus`, `Start meditation`, each a `.key` button showing `hotkeyLabel`. Click → `Press keys…` (`.key.rec`). Under the rows, **Reset to defaults**. A failed registration shows `takenMessage` under its row.
- **D9 Recording.** While a row records, **all** global shortcuts are released (`hotkeys.stop()`) so the combo reaches the web view, and are registered again when recording ends (`hotkeys.start()`), whatever the outcome. Recording ends on: a valid combo, Esc (cancel, handled so the popover stays), blur of the button, Done, or the popover hiding.
  - Build the accelerator from `e.code`, never `e.key` (⌥ changes `e.key` on a Mac): `KeyA`–`KeyZ` → the letter, `Digit0`–`Digit9` → the digit, `Space`, `F1`–`F12`. Any other key: ignored, keep recording.
  - Modifier order `Control+Alt+Shift+Command+<key>` (the plugin's names). At least one of ⌃ ⌥ ⌘ is required; ⇧ alone is not enough — ignore and keep recording.
  - A combo already bound to another action: not saved, the row reads `Already used for <action label>`.
- **D10 `rebind` keeps the old key on failure.** In `hotkeys.ts`, `rebind(action, accel)`: release the old one, try the new one; if registration fails, register the old one again, keep the stored map unchanged, and set `failed[action]` to `` `${takenMessage(accel)} — kept ${hotkeyLabel(old)}` ``. It returns whether it took. `resetDefaults()` rebinds every action to `DEFAULT_HOTKEYS` the same way. (Today's `rebind` saves first and has no caller.)
- An "Open Today" hotkey (the prototype's ⌥T) is not built.

### General
- **D11 Theme**: segmented `Auto` / `Light` / `Dark`, the same `theme.ts` state and storage the footer button used (`hupo.menubar.theme`).
- **D12 Open at login** — a switch. **Mechanism: a LaunchAgent plist written by the shell. No crate, no plugin, no `launchctl`, no AppleScript.**
  - New `menubar/src-tauri/src/login.rs`. Top half pure and tested: `bundle_path(exe: &Path) -> Option<PathBuf>` (the nearest ancestor whose name ends in `.app`), `plist_text(bundle: &Path) -> String` (hand-written XML, the path XML-escaped), and `parse_program(text) -> Option<String>` (reads back the bundle path from a plist this file wrote).
  - The file: `~/Library/LaunchAgents/net.mdblabs.hupomnemata.menubar.plist` (`HOME` from the environment). Keys: `Label` = the bundle id; `ProgramArguments` = `/usr/bin/open`, `-a`, `<bundle path>`; `RunAtLoad` = true; `LimitLoadToSessionType` = `Aqua`. Written to a temp file in the same folder, then renamed. Off removes the file; a missing file is not an error.
  - Commands: `login_item_state` → `{ "status": "on" | "off" | "other" | "unavailable", "path": string|null }` (hand-written JSON with `json_string`): `on` = the file names this bundle; `other` = it names another path (`path` is that path); `unavailable` = this binary is not inside a `.app` (dev runs). `login_item_set { on: bool }` → the same JSON; rejected with `unavailable`.
  - UI: the switch reads `on`. `other` shows `Set for another copy: <path>` and switching on rewrites it for this one. `unavailable` disables the switch with `Only in the installed app`. Hint: `Takes effect at your next login. macOS may list it under Login Items › Allow in the Background.`
  - Known limit, recorded in docs: if Sergio turns it off in System Settings, the file stays and the switch still reads on.

## Interface
- New commands in `lib.rs`'s handler list and `native.ts` (no-ops outside Tauri), argument names tested on both sides: `login_item_state`, `login_item_set { on }`. Nothing else in the shell changes.
- `default.json` and `breathe.json` unchanged. CSP unchanged. `Info.plist`, `Entitlements.plist`, `tauri.conf.json` unchanged.

## Out of scope
- An "Open Today" hotkey; per-action enable / disable of hotkeys.
- Saved sessions and Insights (98).
- Notifications, sounds, Spotify artwork, any Web API.
- Detecting a login item switched off in System Settings (needs `SMAppService`, macOS 13+ and a new crate).
- The full-screen reminder limit (accepted at the chunk-96 gate).

## Guardrails
- Nothing under `src/` changes. If something must, an added `export` only; anything more: stop and report.
- No new npm dependency, crate or Tauri plugin. `Cargo.lock` unchanged.
- No new `localStorage` key beyond the fields above inside the existing `hup:mb:sound` and `hup:mb:meditation`. Settings never stores timer or session state.
- No `osascript` outside `sound.rs`. No file write by the shell other than D12's one path.
- `pomodoro.rs`, `meditation.rs`, `sound.rs` unchanged. If one must change: stop and report.
- One run owner for the native run: confirm no other session is driving the app or Spotify. No DB writes.
- Leave Spotify, the installed app, `hup:mb:*` / `hupo.menubar.theme` storage and `~/Library/LaunchAgents` as you found them.
- Do not start chunk 98 or write a handoff or brief.

## Tests (red first)
- **Rust**, `login.rs`: `bundle_path` (inside a bundle, nested `Contents/MacOS`, not in a bundle); `plist_text` golden text, a path with a space and with `&`; `parse_program` round trip, a foreign plist → `None`; the state JSON for each status.
- **Vitest**:
  - `soundPrefs` / `sound`: `playlists` defaults, a valid override, invalid label or URI → built-in, link normalisation (plain, `?si=`, `/intl-de/`, a track link rejected, an album link rejected), `presetsFor` / `presetFor`.
  - `meditationPrefs`: `days` default, valid, empty, out of range, duplicates.
  - `meditationSchedule`: `days` skips the right dates over 14 days, under the three zones like the rest.
  - `hotkeys`: `rebind` success; failure keeps the old key registered and the map unchanged, with the message; `resetDefaults`; `stop` / `start` around a recording.
  - Accelerator from a `KeyboardEvent` (pure helper): ⌥H → `Alt+H`, ⌃⌥⇧⌘K order, `Digit5`, `Space`, `F5`, no modifier → null, ⇧ only → null, an unsupported key → null.
  - `SettingsView`: each section renders; steppers at range ends; a step calls `saveConfig` with the new value; the mode switch dims the other row; `from ≥ to` not saved; adding a 13th time impossible; the last day cannot be switched off; recording releases and restores hotkeys, Esc cancels and does not hide the popover, a duplicate is refused; login states `on` / `off` / `other` / `unavailable`.
  - `App`: the Settings button signed in only; Done, Esc, hide and ⌥H close it; the footer as D3; `SoundSection` rereads after close.
  - `native.ts`: the two new command names and the `on` argument.
  - Existing suite green.

## Gates
1. `npm ci`, `npm run lint`, `npm run menubar:typecheck`; `npm test` with `TZ=America/New_York`, `TZ=UTC`, `TZ=Asia/Tokyo`; `cargo test --manifest-path menubar/src-tauri/Cargo.toml`; `git diff 2aca6fb -- menubar/src-tauri/Cargo.lock` empty.
2. `npm run build` on base `2aca6fb` and on the head with the **same** real `.env.local`: the same `assets/index-*.js` name, and no menubar file in `dist/`.
3. `export PATH="$HOME/.cargo/bin:$PATH"`, `npm run menubar:build`, then `codesign --verify --deep --strict --verbose=2 <app>`, `codesign -d -r- <app>` (same leaf as chunk 95/96: `H"8f0d254bddc27a5990591035bd4dfd49b105611d"`), entitlements still only apple-events.
4. Browser smoke on `npm run menubar:dev` with a stand-in backend: the Settings view in light and dark, every section, the popover at its cap with the body scrolling, console clean. Name the driver.
5. Native run of the **branch build from its bundle folder** (quit the installed app first; `pgrep -fl Hupomnemata` → one process, from the bundle folder). Drivers: System Events through `osascript` for clicks, keys and AX reads (follow CLAUDE.md "Driving the menubar popover and Spotify"); `screencapture` of the display under the mouse; the chunk-95 SQLite method to read `localStorage`. Before: record Spotify's state, every `hup:mb:*` row and `hupo.menubar.theme`, and whether the LaunchAgent file exists.
   1. Open Settings from the footer. Set Focus to 1 min and Short break to 1 min; switch Compact on. Start focus: tray reads `1m`; within ~70 s the cup shows; switch Compact off during the break: tray reads `m:ss` from the next phase. End the pomodoro. `hup:mb:pomodoro` holds the values.
   2. Rebind `Open scratchpad` to ⌥J (click the key, `key code 38 using {option down}`). Hide the popover. ⌥J opens it on Scratchpad; ⌥H does nothing. Then rebind it to ⌥⇧F (taken by focus): the row reads `Already used for Start or pause focus`. Then **Reset to defaults**; ⌥H works again.
   3. Recording, then Esc: the popover stays open and the old key still works afterwards.
   4. Meditation: Set times, one time at now + 7 min, Heads-up 5. The heads-up panel shows at now + 2 min → **Skip**. Then switch today's day off and add a time at now + 7 min again: no heads-up appears by now + 3 min (tray checked). Days back on.
   5. Sound: paste `https://open.spotify.com/playlist/37i9dQZF1DWZeKCadgRdKQ?si=x` into the Binaural slot with label `Mine`: stored as `spotify:playlist:37i9dQZF1DWZeKCadgRdKQ`; the Sound section's first preset reads `Mine` after Done. Paste a track link: refused. **Reset** the slot. Nothing played from Settings (Spotify state read before and after).
   6. Open at login: on → the file exists, `plutil -lint` OK, `ProgramArguments` names the running bundle; the switch reads on after closing and reopening Settings. Off → the file is gone. A real login is **unverified by design**.
   7. Theme: Dark from Settings → the popover is dark; back to how it was.
6. **Restore**: quit the branch app; put every `hup:mb:*` row and `hupo.menubar.theme` back exactly (delete rows that were absent); the LaunchAgent file as found; Spotify as found; `open ~/Applications/Hupomnemata.app`; `pgrep -fl Hupomnemata` → one process, from `~/Applications`.

## Docs (same pass)
- **ARCHITECTURE §16**: a new **Settings (chunk 97)** paragraph covering D1–D12. Update the paragraphs that say "no settings UI yet" or "chunk 97" (Hotkey, Pomodoro D7, Sound D10/D11 and Not built, Meditation D3 and Not built, Theme). **Shell commands**: the two new ones. **Known limit**: a login item switched off in System Settings is not detected.
- **CLAUDE.md**: one paragraph on driving Settings natively (recording a hotkey with System Events, reading the LaunchAgent), if anything you learned isn't already there.
- **PROGRESS**: row 97, the "Last updated" line (the previous one moves to "Prior update"), and the Decisions log: open at login is a hand-written LaunchAgent (no plugin, no `SMAppService`); Theme moved from the footer into Settings while signed in; `rebind` keeps the old key on failure; meditation `days` default all seven.
- Commit this prompt as `prompts/chunk-97-menubar-settings.md` (it's already in the working tree).

## Push
Branch only: code commit(s), then the docs commit with `[skip ci]`.

## Report
- Branch, head SHA and code SHA(s).
- Files under `src/` touched (expected: none).
- Vitest counts per zone and the `cargo test` count.
- Both bundle names; the `Cargo.lock` diff (expected empty).
- Signature lines.
- The Settings view's tallest height in pt, and whether the body scrolled.
- Each native step with its driver and pass / fail / unverified, with the stored values read back and the LaunchAgent file text.
- Screenshot paths, the unverified list, and every deviation.
