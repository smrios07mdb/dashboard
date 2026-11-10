# Chunk 95 — Menu bar sound: Spotify via AppleScript, presets, play on focus / pause on break, stable signing

Repo: smrios07mdb/dashboard. Base: main at `a410115` (chunk 94 merged ff at `de5500f`; docs `a410115`). Branch: `chunk-95-menubar-spotify`.
Model: Fable 5.2 (native work).
Design reference: `hupomnemata_handoff/menubar/prototype/hupomnemata-menu-bar.html` — the "Sound · Spotify on this Mac" section (`.now`, `.art`, `.np`, `.tp`, `.presets`, `.pre`, `.auto`, `.sw`).
**Push the branch and stop. Do not merge to main.** The orchestrator gates the branch first.

## Why
Sergio wants focus music that runs itself: pick a preset (Binaural, Classical, Deep work, Silence), and Spotify plays when focus runs and pauses when it stops. He controls the Spotify desktop app on this Mac. No Web API, no Spotify login. Controlling another app needs macOS Automation permission, which is tied to the app's code signature. The menubar app is ad-hoc signed today, so every rebuild would ask for the permission again. This chunk gives it a stable signature first.

## Part 0 — stable signing identity (do this before any code)
Sergio chose a **self-signed code-signing certificate** in his login keychain. Free, no Xcode, 10-year validity.

- **D1 Script** `menubar/scripts/make-signing-cert.sh` (committed, `bash`, `set -euo pipefail`):
  - Name: `Hupomnemata Local Signing`. If `security find-certificate -c "Hupomnemata Local Signing" ~/Library/Keychains/login.keychain-db` finds it, print `exists` and exit 0 (idempotent).
  - Otherwise, in a `mktemp -d` folder that is deleted on exit (`trap`): generate an RSA 2048 key and a self-signed cert with **`/usr/bin/openssl`** (macOS LibreSSL; its PKCS#12 output imports cleanly, OpenSSL 3's default does not) from a small config file: `basicConstraints=critical,CA:false`, `keyUsage=critical,digitalSignature`, `extendedKeyUsage=critical,codeSigning`, `-days 3650`, subject `CN=Hupomnemata Local Signing`. Pack the key and cert into a `.p12` with a random one-time password.
  - `security import <p12> -k ~/Library/Keychains/login.keychain-db -P <pw> -T /usr/bin/codesign`.
  - `security add-trusted-cert -p codeSign -k ~/Library/Keychains/login.keychain-db <cert.pem>`. **This opens a macOS password dialog. That is Sergio's one unavoidable action in Part 0.** Tell him in one line just before running it.
  - Finish with `security find-identity -p codesigning ~/Library/Keychains/login.keychain-db | grep "Hupomnemata Local Signing"` and print the SHA-1.
  - The key and `.p12` never leave the temp folder. Nothing under the repo is written.
- **D2 Config.** `tauri.conf.json` → `bundle.macOS.signingIdentity: "Hupomnemata Local Signing"`, `bundle.macOS.entitlements: "Entitlements.plist"`. New `menubar/src-tauri/Entitlements.plist` with only `com.apple.security.automation.apple-events` = true. A signed Tauri build uses the hardened runtime, which blocks Apple Events without that entitlement. `Info.plist` gains `NSAppleEventsUsageDescription`: `Hupomnemata plays and pauses Spotify for your focus sessions.` Keep `LSUIElement`.
  - The first `codesign` that uses the new key may show a keychain dialog ("codesign wants to use…"). Sergio clicks **Always Allow** once. Name it as an unavoidable action when it appears.
  - If a signed build fails to launch under the hardened runtime, **stop and report**. Do not add other entitlements on your own.
- **D3 Proof of stability** (record in the smoke file): run `npm run menubar:build` twice, and after each: `codesign --verify --deep --strict --verbose=2 <app>`, `codesign -d -r- <app>` and `codesign -dv <app> 2>&1 | grep -E "Authority|TeamIdentifier|Identifier|Runtime"`. Pass: both verify, and the designated requirement is **byte-identical** across the two builds, naming `Hupomnemata Local Signing` (a certificate leaf hash), not a `cdhash`.

## Part 1 — Spotify control

### Locked decisions
- **D4 Rust owns Spotify**, in a new `menubar/src-tauri/src/sound.rs`. Each control runs `/usr/bin/osascript -e <script>` with `std::process::Command`. **No new crate, no plugin.** The script text comes **only** from fixed templates in Rust. The web view never sends AppleScript. The one parameter is a playlist URI, validated against `^spotify:playlist:[A-Za-z0-9]{22}$` before it is put in a template; anything else is rejected.
- **D5 Never block the main thread or hang.**
  - Every `osascript` call runs on **one worker thread** (std `mpsc` of jobs, run in order). Commands hand a job to it with a reply channel, through `tauri::async_runtime::spawn_blocking`, and the command is `async`.
  - Each run has a **4 s timeout**: poll `try_wait`, `kill` on timeout, and report `timeout`.
  - The pomodoro edge (D9) sends a job without waiting.
- **D6 Installed / running checks never launch Spotify and never raise a dialog.**
  - Installed means `/Applications/Spotify.app` or `~/Applications/Spotify.app` exists, checked in Rust **before** any script that names Spotify. Compiling `tell application "Spotify"` without it opens a "Where is Spotify?" dialog.
  - Every **read** script is wrapped in `if application "Spotify" is running then … end if`. That check sends no Apple Event, so it needs no permission.
  - **Writes** (play preset, play/pause, next, previous, the focus edge) may launch Spotify. Sergio asked for music on focus.
- **D7 State read** `spotify_state` → hand-written JSON, like the pomodoro snapshot. Reuse `json_string` by making it `pub(crate)`; don't copy it. Shape:
  `{ "status": "ok" | "not_installed" | "not_running" | "denied" | "timeout" | "error", "playing": bool, "track": string|null, "artist": string|null }`.
  - Script: player state, `name of current track`, `artist of current track`, joined with a separator Rust splits on. No `artwork url`: the CSP allows no remote images, and none are added.
  - Classify `osascript` failures from stderr: `-1743` → `denied`; `-600` → `not_running`; anything else → `error`, with the message kept for the log.
- **D8 Commands** (`lib.rs` handler list, named in `native.ts`):
  - `spotify_state`.
  - `spotify_play_pause`, `spotify_next`, `spotify_previous`.
  - `spotify_play_preset { uri }` → `play track "<uri>"`.
  - `sound_configure { auto: bool, uri: string | null }`: `null` = Silence; validated as D4.
  - `open_automation_settings` → `/usr/bin/open` with the **fixed** URL `x-apple.systempreferences:com.apple.preference.security?Privacy_Automation`, like `open_dashboard`.
  - Each write answers the fresh `spotify_state` after it runs.
- **D9 Play on focus, pause on break.** Lives in Rust, so it works with the popover closed and the web view suspended.
  - A pure `music_edge(prev: &State, next: &State) -> Option<MusicAction>` in `pomodoro.rs`. "Focus running" = `phase == Focus && !paused`. false → true ⇒ `Play`; true → false ⇒ `Pause`. That covers start, resume, pause, natural focus end, skip to break, `End`, and a focus end noticed after sleep. Break → idle, extend and configure ⇒ none.
  - Call it wherever the state is replaced: `change` and the loop. **Never while holding the pomodoro lock.** Dispatch to `sound.rs`, which acts only when `auto` is on and a preset (not Silence) is set.
  - `Play`:
    - Spotify already playing → leave it.
    - Otherwise, if the last preset this app started (kept in memory) is the configured one → `play` (resume where it stopped).
    - Else `play track <configured uri>`, and remember it.
  - `Pause` → `pause` only if Spotify is running (no launch to pause).
- **D10 Presets** in `menubar/src/sound.ts` (pure table): `Binaural`, `Classical`, `Deep work`, `Silence` (`uri: null`).
  - Pick one **Spotify-owned editorial playlist** (id starts `37i9dQZF1`) for each of the first three that fits the label.
  - Confirm each one exists: `curl -sL "https://open.spotify.com/playlist/<id>" | grep -o '<title>[^<]*'`, and record the title.
  - If one can't be confirmed, use another. Sergio may swap in his own playlists in chunk 97's settings.
- **D11 Prefs** `menubar/src/soundPrefs.ts` (pure, guarded like `pomodoroPrefs.ts`):
  - `localStorage['hup:mb:sound']` over `{ auto: true, preset: 'binaural' }`. An unknown preset falls back to the default; a non-boolean `auto` falls back on its own.
  - Sent with `sound_configure` at sign-in (beside `pomodoro_configure`) and whenever it changes.
- **D12 Sound section** (`menubar/src/SoundSection.tsx`), signed in only. Sits between the tab content and the footer, on both tabs, following the prototype's layout.
  - **Now row**: `.art` is a plain square in the ring gradient tokens (no image). The title is the track (or the state line below). The subtitle is the artist, or the preset's label when no track. **Transport**: Previous, Play/Pause (`aria-label` "Play music" / "Pause music"), Next.
  - **Presets**: four `.pre` buttons with `aria-pressed`. A tap saves the preset.
    - A playlist preset also plays it now (`spotify_play_preset`, which may launch Spotify).
    - Silence pauses Spotify if it is playing.
  - **Auto**: the `.sw` switch, "Play on focus, pause on break", saved to prefs.
  - **States**, from `status`:
    - `not_installed` → "Spotify isn't installed on this Mac", controls disabled.
    - `not_running` → title "Spotify is closed"; presets enabled, transport disabled.
    - `denied` → "Allow Hupomnemata to control Spotify" plus a button "Open settings" (`open_automation_settings`).
    - `timeout` / `error` → "Spotify didn't respond", with a retry on the next read.
  - **Reads**: on mount; on every `popover-shown`; 300 ms after each control; and every 3 s **only while the popover is shown** (`watchPopover`), cleared on hide. Nothing runs while hidden.
  - Height: the popover must still fit under `MAX_HEIGHT` (560) on the Today tab with 6 rows. If it doesn't, stop and report with measurements. Don't change `MAX_HEIGHT` or shrink other sections on your own.
  - Tokens: reuse existing ones. Add a token only if the prototype's `.now` / `.pre` need one that's missing, light in `menubar.css` and dark in `dark.css`.
- **D13 Sign-out** stops nothing in Spotify. The session stop (chunk 94) already sends `Pause` through D9 if focus was running.
- **D14 Unchanged:** the pomodoro's timing and transitions (only the edge hook is added), the tray, hotkeys, Today, check-off, scratchpad, theme, window placement, CSP.

## Out of scope
Meditation's Spotify pause (96), settings UI and custom playlists (97), album art, volume, shuffle, any Spotify Web API, notifications.

## Guardrails
- Nothing under `src/` changes. If something must, an added `export` only — anything more: stop and report.
- No new crate, npm dependency or Tauri plugin. No AppleScript text from JS. No `osascript` on the main thread.
- The private key never touches the repo. Commit no `.p12`, `.pem` or key.
- Leave Spotify as you found it: note its player state before the native run and restore it after (pause if it was paused or closed; quit it if it was closed — `osascript -e 'quit app "Spotify"'`).
- Do not start chunk 96 or write a handoff or brief.

## Tests (red-first)
- **Rust**:
  - URI validation (good, wrong prefix, wrong length, quote/backslash injection rejected).
  - Each template's exact text.
  - `parse_state` (playing, paused, stopped, not running empty output).
  - stderr classification (`-1743`, `-600`, other).
  - Installed check against a temp folder.
  - `music_edge` table: idle→focus Play; focus→paused Pause; paused→focus Play; focus→short break Pause (natural end and skip); focus→long break Pause; focus→idle (stop) Pause; break→idle none; break→focus (start from a break) Play; extend none; configure none.
  - The `Play` rule: already playing → nothing; same preset → `play`; different → `play track`.
  - Run the worker against an injected runner (fn pointer) to prove the timeout path and ordering.
- **Vitest**:
  - `soundPrefs` (defaults, stored, per-field fallback, unknown preset).
  - `sound.ts` table (four presets, Silence `null`, URIs match the D4 pattern).
  - `SoundSection`: each status renders as D12; preset tap calls the right native command; Silence pauses; auto switch saves and calls `sound_configure`; polling only while shown, re-read on show, with fake timers.
  - `native.ts` argument names match the Rust signatures exactly: `{ uri }`, `{ auto, uri }`.
  - Existing suite green.

## Gates
1. `npm ci`; `npm run lint`; `npm run menubar:typecheck`; `npm test` with `TZ=America/New_York`, `TZ=UTC`, `TZ=Asia/Tokyo`; `cargo test --manifest-path menubar/src-tauri/Cargo.toml`.
2. `npm run build` on base `a410115` and head with the **same** `.env.local`: same `assets/index-*.js` name, no menubar file in `dist/`.
3. `export PATH="$HOME/.cargo/bin:$PATH"` then `npm run menubar:build`, twice, plus the D3 signature proof.
4. Browser smoke on `npm run menubar:dev` (`native.ts` no-ops; render the section with a stand-in backend as in chunk 94): every D12 state, light and dark, console clean. Name the driver.
5. Native run of the **branch build from its bundle folder** (do not install over `~/Applications`; quit the installed app first, restore it after, `pgrep -fl Hupomnemata` → one process from `~/Applications`). Drivers: AppleScript System Events for clicks and reads, `screencapture -R` for pixels, `osascript` to read Spotify's `player state`. Follow the CLAUDE.md "Native menubar runs" note: ⌥H opens the popover; read button names before clicking.
   1. First control → the Automation prompt "Hupomnemata wants access to control Spotify". **Sergio clicks OK** (unavoidable; tell him in one line first).
   2. Preset tap plays it.
   3. Transport works.
   4. Auto on: `Start focus` → Spotify playing; `Pause` → paused; `Resume` → playing; `Skip to break` → paused; `End`.
   5. **Rebuild** (`npm run menubar:build`), relaunch the new bundle, press a transport button: no prompt appears and the call succeeds. This is the point of Part 0. Record it.
   6. Denied path: unverified by design (needs revoking the permission). Record it so.
6. Leave Spotify as found (Guardrails).

## Docs (same pass)
- ARCHITECTURE §16:
  - **Signing (D13)** rewritten: self-signed `Hupomnemata Local Signing`, the script, entitlements, hardened runtime, why (Automation permission follows the designated requirement).
  - New **Sound** paragraph (D4–D13).
  - **Shell commands**: the six new commands.
  - **Not built**: the out-of-scope list.
- README: one-time setup `bash menubar/scripts/make-signing-cert.sh` before the first `menubar:build` on a Mac, and what the two dialogs are.
- CLAUDE.md, gate environment: a menubar build needs the `Hupomnemata Local Signing` identity in the login keychain (run the script once per Mac). The first build may show the keychain "Always Allow" dialog.
- PROGRESS: row 95, "Last updated". Decisions log:
  - Self-signed local identity, not an Apple account.
  - Spotify through `osascript` from Rust with fixed templates; the edge in Rust.
  - Presets are Spotify editorial playlists until chunk 97.
- Commit this prompt as `prompts/chunk-95-menubar-spotify.md` (it's already in the working tree).

## Push
Branch only. Code commit(s), then the docs commit with `[skip ci]`. Pushed together is fine on a branch.

Report:
- Branch, head SHA and code SHA(s).
- Files under `src/` touched (expected: none).
- Vitest counts per zone and the `cargo test` count.
- Both bundle names.
- The signing proof: both designated requirements and the cert SHA-1.
- The playlist ids with their confirmed titles.
- The smoke record path.
- The unverified list and every deviation.
- Every dialog Sergio was asked to click.
