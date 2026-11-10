# Chunk 91 — menu bar companion: smoke `0910a`

- **Date:** 2026-11-10
- **Code under test:** `ba170f6` (base `3c550f3`)
- **Driver (browser):** `chrome-devtools-axi`, isolated session `chunk91` (own Chrome, fresh profile). **Not Claude in Chrome**, which the prompt names: its extension was not connected (`Browser extension is not connected`, two attempts) and Sergio's Chrome was not opening.
- **Driver (native):** shell only (`open`, `pgrep`, `lsappinfo`, `plutil`, `codesign`).
- **Fixtures:** none created. Read-only run.
- **Result:** every check that ran passed. The signed-in browser checks ran on 2026-11-10 in a follow-up session — see "Signed in".

## Gates

| Gate | Result |
|---|---|
| `npm run lint` | clean |
| `npm run menubar:typecheck` | clean |
| `npm test`, `TZ=America/New_York` | 119 files, 1443 tests passed |
| `npm test`, `TZ=UTC` | 119 files, 1443 tests passed |
| `npm test`, `TZ=Asia/Tokyo` | 119 files, 1443 tests passed |
| `npm run build` on base `3c550f3` (clean worktree) | `assets/index-m-5KO8eY.js`, `assets/index-C4TwGD7t.css` |
| `npm run build` on head | `assets/index-m-5KO8eY.js`, `assets/index-C4TwGD7t.css` |
| `dist/` base vs head | 202 files each; SHA-256 identical for every file except `version.json` (SHA + timestamp); `sw.js` identical; no file in `dist/` contains `menubar`, `__TAURI` or `mb-pop` |
| `npm run menubar:build` | `Hupomnemata.app`, 4.35 MiB (4468 KB on disk), ad-hoc signed, `rustc 1.99.1` installed with rustup for this run |

New tests: 24 in 3 files (`menubar/src/todayView.test.ts` 13, `refresher.test.ts` 6, `SignIn.test.tsx` 5). The suite was 116 files / 1419 tests before.

## Browser — `npm run menubar:dev`, `http://localhost:1421/`

| # | Check | Result |
|---|---|---|
| B1 | Signed out: the sign-in form renders (`Sign in`, Email, `Send code` disabled while empty); footer has `Open dashboard` and `Quit`, no `Sign out` | pass |
| B2 | `window.__TAURI_INTERNALS__` absent; page loads with no shell | pass |
| B3 | Light (`prefers-color-scheme: light` emulated): `--surface #ffffff`, `--ink #221f28` (Daylight) | pass |
| B4 | Dark (emulated): `--surface #1f1c26`, `--ink #ece9f1`, `--work #3fcf96` (prototype dark block) | pass |
| B5 | Fonts loaded from the bundle: Inter 400/600, Newsreader 500, IBM Plex Mono 400 | pass |
| B6 | Console after reload: Vite and React DevTools notices only, no error or warning | pass (a first load logged a 404 for `/favicon.ico`; fixed with an empty icon link before this commit, then re-checked) |

## Native — `~/Applications/Hupomnemata.app`

| # | Check | Result |
|---|---|---|
| N1 | Launches; process `hupomnemata-menubar` running | pass (pid observed, ~100 MB RSS) |
| N2 | No Dock icon / app switcher entry | pass by proxy: `lsappinfo` reports `type="UIElement"`; `Info.plist` has `LSUIElement = true` |
| N3 | Bundle id and signature | pass: `net.mdblabs.hupomnemata.menubar`, `Signature=adhoc` |
| N4 | The web view loaded the bundle | pass by proxy: `~/Library/WebKit/net.mdblabs.hupomnemata.menubar/WebsiteData` holds a LocalStorage database for the app's origin |

## Signed in (follow-up, 2026-11-10)

- **Driver:** Claude in Chrome (extension connected this time), Sergio's Chrome. Popover at `http://localhost:1421/` (`npm run menubar:dev` on `60329aa`, same menubar code as `ba170f6`); Dashboard at the deployed app.
- **Fixtures:** the Dashboard's 3 Suggested tasks added to Today with `Add all 3`, removed again with each row's `Remove … from Today` after the checks. No task edited or completed. Today was empty before and after.

| # | Check | Result |
|---|---|---|
| S1 | Code sign-in end to end: email → `Send code` → 6-digit code → Today view; footer gains `Sign out`. Sergio typed the email and code himself (real account) | pass |
| S2 | Empty Today: popover `Nothing planned today.`, Dashboard `Nothing planned yet.` | pass |
| S3 | Today with 3 rows — Dashboard: Great Husband Project, First aid kit, Send something to George tonight. Popover: same titles, same order, minutes 30m / 30m / 3h, header `0 of 3 done` | pass |
| S4 | Refresh policy: the open popover kept the old empty list after the Dashboard change, and showed the rows after a reload (= shown). Matches D6 (load on show, every 5 min while open) | pass |
| S5 | Rows in dark (system dark): `--surface #1f1c26`, `--ink #ece9f1`, category dot per row, mono minute chips; no horizontal overflow | pass |
| S6 | After removal, popover reload shows `Nothing planned today.` again | pass |
| S7 | Console errors on the popover tab | none |

**Not run:** rows in light while signed in — Claude in Chrome cannot emulate `prefers-color-scheme`, and the system is in dark. The light palette is covered by B3 (signed out, same tokens). Chunk 91b's Theme button now makes this checkable without changing macOS.

## Native, by the operator (2026-11-10)

- Sergio: "menu bar works" — tray icon and popover checked on the Mac. Recorded as a pass for the tray/popover items under "Unverified"; which of them he exercised individually was not itemised.

## Unverified (cannot be observed from the shell)

- The tray icon is visible, and its title equals the open count. System Events refused (`osascript is not allowed assistive access`); a screen capture of the menu bar strip failed. The app was also signed out, where the title is `''` by design.
- The popover opens on a tray click, is anchored under the icon, and stays inside the screen (multi-display setup).
- Hide on blur, hide on Esc, hide on a second tray click (the 300 ms re-open guard).
- Height follows content; the list scrolls past 560 pt.
- The transparent window's rounded corners and shadow; the dark palette inside the web view. There is no vibrancy effect — the card is a solid surface.
- The production CSP inside the web view (nothing blocked that the popover needs). Indirect evidence only: N4.
- `Open dashboard`, `Sign out`, `Quit` in the native app.
- `npm run menubar:app` (`tauri dev`) was not run.
