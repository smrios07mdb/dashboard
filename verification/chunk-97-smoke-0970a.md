# Chunk 97 — menu bar settings: smoke `0970a`

- **Date:** 2026-11-10
- **Code under test:** `ac5c2d4` on branch `chunk-97-menubar-settings` (base `2aca6fb`). The native run used the branch build of that tree (`CDHash b2be53e04b2ac723de63d0710ea8c317b4587b56`), run from its bundle folder.
- **Drivers:**
  - Browser: `chrome-devtools-axi` (its own launched Chrome, not signed in) on `npm run menubar:dev`, `http://localhost:1421/`.
  - Native: System Events through `osascript` (JXA) for clicks, keys and AX reads; `screencapture -R` of the popover and tray; the chunk-95 SQLite method to read `localStorage`; the guarded `osascript` read of Spotify's state.
- **Fixtures:** none. No DB write, no calendar event.
- **Run owner:** Sergio confirmed no other session was driving the app or Spotify before the native run.
- **Result:** every check passed. One layout fix was made during the browser smoke, before the code commit (below). Unverified: a real login with the LaunchAgent.

## Gates

| Gate | Result |
|---|---|
| `npm ci` · `npm run lint` · `npm run menubar:typecheck` | clean |
| `npm test`, `TZ=America/New_York` / `UTC` / `Asia/Tokyo` | 139 files, 1681 tests passed in each (was 138 / 1619) |
| `cargo test --manifest-path menubar/src-tauri/Cargo.toml` | 123 passed (was 114): 9 in `login.rs` |
| `git diff 2aca6fb -- menubar/src-tauri/Cargo.lock` | empty |
| `npm run build`, base `2aca6fb` and head, same real `.env.local` | `assets/index-m-5KO8eY.js` both; no menubar file in `dist/` |
| `npm run menubar:build` | green |
| `codesign --verify --deep --strict --verbose=2` | `valid on disk`, `satisfies its Designated Requirement` |
| `codesign -d -r-` | `identifier "net.mdblabs.hupomnemata.menubar" and certificate leaf = H"8f0d254bddc27a5990591035bd4dfd49b105611d"` — as chunk 95/96 |
| Entitlements | only `com.apple.security.automation.apple-events`; `flags=0x10000(runtime)` |
| Files under `src/` changed | none |
| `osascript` outside `sound.rs` | none added |

## Browser (gate 4)

`native.ts` answers `null` in a browser, so the view was mounted from a temporary harness page on the dev server (deleted afterwards, never committed): the real `SettingsView`, `MeditationPanel` and CSS inside a `.mb-pop` at the 852 cap, with stand-in backends that log their calls; two popovers side by side, one plain and one with a due reminder on top.

| # | Check | Result |
|---|---|---|
| B1 | Every section renders, in order: Focus, Sound, Meditation, Hotkeys, General; header `Settings` with **Done** | pass |
| B2 | Height: the view's content is **1350 pt** (1497 pt with the due panel on top); the popover sits at 852 and the body scrolls (762 / 615 pt visible) | pass |
| B3 | Light and dark, scrolled top, middle, bottom | pass, after the fix below |
| B4 | A pasted `open.spotify.com/playlist/…?si=abc` link in the selected slot is stored as `spotify:playlist:37i9dQZF1DWZeKCadgRdKQ` and logs one `sound_configure(true, uri)` | pass |
| B5 | Console: no errors (one Chrome advisory, "A form field element should have an id or name attribute") | pass |

**Fix during the smoke:** in Chrome the time inputs clipped their text (76 px with the picker icon) and the Every row crowded onto one line. Widened to 96 px, hid the picker icon, and put the window and the times on their own line under the label. Re-shot in both themes.

## Native (gate 5)

Before: Spotify not running; `hupo.menubar.theme` = `light`, `hup:mb:tab` = `scratchpad`, `hup:mb:sound` = `{"auto":true,"preset":"binaural"}`, no other `hup:mb:*` row; no LaunchAgent file (36 files in `~/Library/LaunchAgents`). The installed app was quit; `pgrep -fl Hupomnemata` → one process, from the bundle folder.

| # | Step | Result |
|---|---|---|
| 1 | Settings from the footer (footer: `Open dashboard` · `Settings` · `Sign out` · `Quit`). Focus 1, Short break 1, Compact on → `hup:mb:pomodoro` = `{"focus":1,"short":1,"long":15,"every":4,"compact":true}`. Start focus: tray `1m`; at 21:11:38 the break began, the cup showed with `1m`. Compact off during the break: the tray read `00:23` … `00:03` at once (not only from the next phase), then idle. | pass |
| 2 | Open scratchpad rebound to ⌥J → `{"scratchpad":"Alt+J","focus":"Alt+Shift+F","meditate":"Alt+Shift+M"}`. Hidden, with Today selected: ⌥H did nothing; ⌥J opened the popover on Scratchpad. ⌥⇧F while recording: `Already used for Start or pause focus`, nothing stored, no focus started (tray empty). **Reset to defaults** → `{"scratchpad":"Alt+H",…}`; ⌥J inert, ⌥H opens. | pass |
| 3 | Recording, then Esc: the row went back to `⌥H`, the popover stayed open on Settings; after hiding, ⌥H opened it. | pass |
| 4 | Set times, one time 21:23 (now + 7), Heads-up 5 → `"mode":"times","times":["21:23"],"headsUp":5`. The panel showed by 21:18:12 (`Breathe at 9:23 PM` · `5-minute session · in 4:48`) → **Skip** cleared it. Tuesday off and a time at 21:25 → `"times":["21:23","21:25"]`, `"days":[0,1,3,4,5,6]`; no panel and an empty tray through 21:22:00. The 21:25 time removed and Tuesday back on → `"days":[0,1,2,3,4,5,6]`. | pass |
| 5 | Spotify `paused` on `spotify:track:2FZzpIceoNGBnXcAlmKKM1` before. Binaural link `https://open.spotify.com/playlist/37i9dQZF1DWZeKCadgRdKQ?si=x`, label `Mine` → `"playlists":{"binaural":{"label":"Mine","uri":"spotify:playlist:37i9dQZF1DWZeKCadgRdKQ"}}`; after Done the first preset reads `Mine`. A track link: `Not a Spotify playlist link`, storage unchanged. **Reset Binaural** → `"playlists":{}`. Spotify still `paused` on the same track. | pass |
| 6 | Open at login on → file written (below), `plutil -lint` OK, `ProgramArguments` names the running bundle; the switch reads on after Done and reopening Settings. Off → the file is gone. A real login: **unverified by design**. | pass |
| 7 | Theme Dark → the popover is dark, `hupo.menubar.theme` = `dark`; Light → `light` (as found). | pass |

The LaunchAgent file the branch build wrote:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>Label</key>
	<string>net.mdblabs.hupomnemata.menubar</string>
	<key>ProgramArguments</key>
	<array>
		<string>/usr/bin/open</string>
		<string>-a</string>
		<string>/Users/sergiorios/Documents/To-Do Dashboard/menubar/src-tauri/target/release/bundle/macos/Hupomnemata.app</string>
	</array>
	<key>RunAtLoad</key>
	<true/>
	<key>LimitLoadToSessionType</key>
	<string>Aqua</string>
</dict>
</plist>
```

Notes:
- Starting focus in step 1 launched Spotify through the chunk-95 "Play on focus" switch (on as found). That is existing behaviour, not Settings; Spotify was quit in the restore.
- The `localStorage` SQLite file can lag the app by about a second: a read straight after a toggle showed the old `days`, and the same read a second later showed the new value.

## Restore (gate 6)

The branch app quit; the `hup:mb:*` and `hupo.menubar.theme` rows deleted and the three found rows written back from their saved bytes (a sorted dump is identical to the before dump); no LaunchAgent file (36 files, as found); Spotify quit (not running, as found); `open ~/Applications/Hupomnemata.app` → one process, from `~/Applications`.

## Unverified

- A real login starting the app from the LaunchAgent (by design).
- A login item switched off in System Settings (the known limit: the switch still reads on).
