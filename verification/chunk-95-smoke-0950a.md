# Chunk 95 — menu bar sound (Spotify) and stable signing: smoke `0950a`

- **Date:** 2026-11-10
- **Code under test:** `8ce904e` on branch `chunk-95-menubar-spotify` (base `a410115`)
- **Drivers:**
  - Browser: `chrome-devtools-axi` (its own launched Chrome, not signed in), page `http://localhost:1421/` under `npm run menubar:dev`.
  - Native: AppleScript System Events for clicks and reads, `screencapture -R` for pixels, `osascript` from Terminal to read Spotify's `player state`.
- **Fixtures:** none. No DB write, no calendar event.
- **Result:** every check that ran passed. One stop condition was hit and resolved by Sergio (popover height, below). The unverified list is at the end.

## Gates

| Gate | Result |
|---|---|
| `npm ci` · `npm run lint` · `npm run menubar:typecheck` | clean |
| `npm test`, `TZ=America/New_York` / `UTC` / `Asia/Tokyo` | 133 files, 1578 tests passed in each (was 129 / 1541) |
| `cargo test --manifest-path menubar/src-tauri/Cargo.toml` | 65 passed (was 28): 29 new in `sound.rs`, 8 new in `pomodoro.rs` |
| Red first, Rust | with `valid_uri`, `parse_state`, `classify_failure`, `installed_in`, `play_plan`, `run_with_timeout` and `music_edge` stubbed, 25 of the 37 new tests failed |
| Red first, Vitest | before the modules existed: 3 new files failed to resolve their imports and 5 of 6 `native.test.ts` cases failed |
| `npm run build`, base `a410115` and head, same `.env.local` | `assets/index-m-5KO8eY.js` both, same SHA-256 (`6f84eb18648fa90f…`); no menubar file and no `spotify` / `mb-sound` / `sound_configure` string in `dist/` |
| `npm run menubar:build` | green, 4.56 MiB (was 4.49); menubar JS `index-BDnvluGB.js`, 712 KB |
| Files under `src/` changed | none |
| New crate / npm dependency / Tauri plugin | none |
| `.p12` / `.pem` / key in the tree | none |

A flaky test of this chunk was found and fixed before the commit. Two `SoundSection` cases asserted right after `user.click`, before React had rendered a state set after an awaited call; they failed once in a sequential three-zone run and every time under four concurrent suites. The tests now flush after each click (`press`). After the fix: four concurrent suites with no menubar failure, then three clean sequential zones. Under that four-suite load other, older tests (`Dashboard.test.tsx`, `ProtectedLayout.test.tsx`, `SubcategorySection.test.tsx`) also fail; they pass sequentially and were not touched.

## Part 0 — signing

- `bash menubar/scripts/make-signing-cert.sh` → `1 identity imported.`; SHA-1 **`8F0D254BDDC27A5990591035BD4DFD49B105611D`**. A second run printed `exists`. `security find-identity -v -p codesigning` → 1 valid identity. Nothing was written under the repo.
- The first signed build stopped at `codesign` behind the keychain dialog for more than 10 minutes (past the tool's timeout) and finished once it was answered. The app launched and ran under the hardened runtime with the one entitlement; no other entitlement was added.

Every build of this run (same Mac):

| Build | What changed | `CDHash` | Designated requirement |
|---|---|---|---|
| 1 | — | `73fe50e7a455ac0a80b10ae94dd07c433495b66a` | `identifier "net.mdblabs.hupomnemata.menubar" and certificate leaf = H"8f0d254bddc27a5990591035bd4dfd49b105611d"` |
| 2 | nothing (`lib.rs` touched) | `73fe50e7…` | same |
| 3 | `MAX_HEIGHT` 560 → 704 | `ea36a1f73136fe112894c82b32a28d9144b63f2c` | same |
| 4 | a temporary log-string change (the rebuild probe, native step 5) | `8873d2da082008f9bc4a6ca4829cad8cb9fcd67c` | same |
| 5 | probe reverted — the committed code | `ea36a1f7…` | same |

- **D3 pass:** builds 1 and 2 both `valid on disk` and `satisfies its Designated Requirement` (`codesign --verify --deep --strict --verbose=2`); the two `codesign -d -r-` outputs are byte-identical (`cmp`), and name a certificate leaf hash, not a `cdhash`.
- `codesign -dv`: `Identifier=net.mdblabs.hupomnemata.menubar`, `flags=0x10000(runtime)`, `TeamIdentifier=not set`, `Runtime Version=27.0.0`. `Authority=Hupomnemata Local Signing` is printed only by `-dvv`.
- `codesign -d --entitlements -`: `com.apple.security.automation.apple-events` = true, nothing else.
- Builds 1 and 2 have the same `CDHash`: the build is reproducible, so they alone do not show that a *changed* binary keeps its requirement. Builds 3 and 4 do.

## Stop condition — popover height

D12 says the popover must fit under `MAX_HEIGHT` (560) on the Today tab with 6 rows. It did not. Measured in the browser, real components and CSS, six sample rows:

| | Focus header | Tabs | Today panel | Sound | Footer | Total |
|---|---|---|---|---|---|---|
| Idle | 43 | 39 | 287 | 161 | 43 | **573** (13 over) |
| Focus session | 171 | 39 | 287 | 161 | 43 | **701** (141 over) |

At 560 nothing was clipped: the task list scrolled inside itself (208 of 221 px idle; 80 of 221 px, about two rows, in a session). Work stopped and Sergio was asked. **He chose to raise `MAX_HEIGHT` to 704** (`lib.rs` and `.mb-pop`'s `max-height`). Re-measured at 704: 573 and 701, list 221 / 221, no scroll. No other section was changed.

## Browser (gate 4)

There is no Rust in the browser and `native.ts` answers `null`, so the section was mounted from a temporary harness page on the dev server (deleted afterwards, never committed): the real `SoundSection` and CSS, one card per state, each with a stand-in backend answering a fixed state and logging its calls, plus two full popovers (real `FocusHeader`, `PopoverTabs`, `TodayList`, six sample rows).

| # | State | Title · subtitle | Transport | Presets | Switch | Result |
|---|---|---|---|---|---|---|
| B1 | `ok`, playing | `Alpha Waves, 10 Hz` · `Binaural Mind` | enabled, `Pause music` | enabled, Binaural pressed | on | pass |
| B2 | `ok`, paused, long title | ellipsis on one line · `Johann Sebastian Bach` | enabled, `Play music` | enabled | on | pass |
| B3 | `ok`, no track | `Nothing playing` · `Binaural` | enabled | enabled | on | pass |
| B4 | `not_installed` | `Spotify isn't installed on this Mac` (two lines) | disabled | disabled | disabled | pass |
| B5 | `not_running` | `Spotify is closed` · `Binaural` | disabled | enabled | on | pass |
| B6 | `denied` | `Allow Hupomnemata to control Spotify` + `Open settings` | disabled | enabled | on | pass |
| B7 | `timeout` | `Spotify didn't respond` · `Binaural` | enabled | enabled | on | pass |
| B8 | `error` | same as B7 | enabled | enabled | on | pass |

- Each card is 161 px tall (172 in `denied`); the four presets sit on one row; no horizontal overflow.
- Clicks, from the backends' logs: Classical on B5 → `configure true spotify:playlist:37i9dQZF1DXd5zUwdn6lPb`, `playPreset` with the same URI, and the card showed the track. Silence on B1 → `configure true null`, a fresh `state`, then `playPause`; the button became `Play music`. The switch on B3 → `configure false spotify:playlist:37i9dQZF1DX7EF8wVxBVhG`, `aria-checked="false"`. `Open settings` on B6 → `openSettings`. Pause and Next on B2 → `playPause`, `next`.
- Light and dark (`<html data-mode>`): both screenshots read correctly — the gradient square, pressed preset, switch and disabled states in each palette.
- Console: no error and no warning (two Vite debug lines and the React DevTools notice).

## Native (gate 5)

The branch build ran from `menubar/src-tauri/target/release/bundle/macos/`; the installed app was quit first. Before: **Spotify was closed** (`pgrep -x Spotify` → none). The web view was already signed in (same bundle id as the installed app); its Today was `0/0`.

| # | Check | Observed | Result |
|---|---|---|---|
| N0 | Reads never launch Spotify | popover open with Spotify closed: `Spotify is closed` · `Binaural`, transport disabled; `pgrep -x Spotify` still none | pass |
| N1 | First control → the Automation prompt | tapped **Classical**: Spotify launched and stayed `paused` on its old track for 120 s. Afterwards the popover read Spotify's track (`ok`), so the permission had been granted. That first `play track` did nothing — its `osascript` is killed at 4 s while the prompt is up | pass, with that first-control gap |
| N2 | Preset tap plays it | **Deep work** → `playing · Just Begin Again · Calmist` (Deep Focus); later **Binaural** → `playing · Sunset Alpha 100 Hz -108 Hz · Ookean` | pass |
| N3 | Transport | Next → `Frozen Frame`; Previous → `Just Begin Again`; `Pause music` → `paused`, button `Play music`; `Play music` → `playing` | pass |
| N4 | Auto on | `Start focus` → `playing`, tray `24:58`; `Pause` → `paused`; `Resume` → `playing`; `Skip to break` → `paused`, tray `04:58`; `Skip break` → idle, still `paused`; later `End` → `paused` | pass |
| N4b | Popover closed (⌥⇧F) | start → `playing`, tray `24:57`; again → `paused`; again → `playing` | pass |
| N4c | Auto off | switch off, `Start focus` → stays `paused`; `End` | pass |
| N4d | Silence | playing, tapped **Silence** → `paused`; `Start focus` → stays `paused` | pass |
| N5 | Rebuild keeps the permission | build 4 (`CDHash` `8873d2da…`, was `ea36a1f7…`), relaunched: the popover read the track with no prompt; `Play music` → `playing`, Next → `Frozen Frame`, `Pause music` → `paused`. `UserNotificationCenter` had no window | pass |
| N6 | Denied path | not run — it needs the permission revoked | unverified by design |

Notes from the run:
- The popover is `window "Hupomnemata"` (340 × 541 on the Scratchpad tab). `window 1` was a small unnamed `AXDialog`.
- The popover hid when Spotify launched or took focus; ⌥H reopened it before the next click.
- No "Terminal wants to control Spotify" prompt appeared for the harness's own reads.

## Left as found

- Spotify: quit at the end (`osascript -e 'quit app "Spotify"'`), as it was closed before. **Not restored:** its queue. It had `Tutankhamun — Coltrane` loaded; it now holds the Binaural playlist.
- Installed app: relaunched; `pgrep -fl Hupomnemata` → one process, `/Users/…/Applications/Hupomnemata.app` (the chunk-94 build, still ad-hoc signed).
- The app's web view now holds `hup:mb:sound` = `{ auto: true, preset: 'binaural' }` (the defaults, written by the preset taps).
- The bundle folder holds build 5, the committed code.

## Unverified

- **Denied** natively (N6). Covered by unit tests (`-1743` → `denied`) and the browser card only.
- **Not installed** natively: Spotify is installed here. Unit tests and the browser card only.
- **Timeout / error** natively as a rendered state. The 4 s kill is unit-tested with a real hung child; N1's missed first control is consistent with it, but the popover's text was not read while the prompt was up.
- **The Automation prompt itself** was not seen by the harness (no screenshot); N1 infers it from the gap and the grant.
- **The Today tab with six real rows** natively: this account's Today was empty. The 701 pt total is the browser measurement.
- **A focus end by the clock and after sleep** natively: only the commands and the hotkey were driven. `music_edge` covers both in unit tests.
- **Resume after Spotify was quit mid-session** (`play track` again) natively: unit-tested only.
- `cargo clippy` is not installed on this toolchain; not run.
