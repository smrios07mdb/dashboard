# Chunk 94 — menu bar pomodoro: smoke `0940a`

- **Date:** 2026-11-10
- **Code under test:** `1044500` on branch `chunk-94-menubar-pomodoro` (base `c984115`)
- **Driver:** Claude in Chrome, Sergio's Chrome. Popover at `http://localhost:1421/` (`npm run menubar:dev`), already signed in. There is no Rust in the browser: every `native.ts` call is a no-op, so the timer itself is not exercised here.
- **Fixtures:** none. No DB write, no calendar event. `hup:mb:pomodoro` was never written (read back `null` at the end); theme and tab keys left as found.
- **Result:** every check that ran passed. The native behaviour is unverified — see the last section.

## Gates

| Gate | Result |
|---|---|
| `npm ci` · `npm run lint` · `npm run menubar:typecheck` | clean |
| `npm test`, `TZ=America/New_York` / `UTC` / `Asia/Tokyo` | 129 files, 1541 tests passed in each (was 124 / 1499) |
| `cargo test --manifest-path menubar/src-tauri/Cargo.toml` | 28 passed. Red first: with the pure functions stubbed, 27 of the 28 failed |
| `npm run build`, base `c984115` and head | `assets/index-m-5KO8eY.js` both, same SHA-256; no menubar or pomodoro file or string in `dist/` |
| `npm run menubar:build` | `Hupomnemata.app` built (4.49 MiB); menubar JS 716 → 722 KB |
| Files under `src/` changed | one: `src/lib/whenLabel.ts`, `timeText` gains `export` |
| New crate / new Tauri plugin | none |

## Browser

The signed-in account's Today was empty (`0/0`), and no fixture was made. B1, B2 and B8 are the real app. B3–B7 mount the real `FocusHeader` and `TodayList` (imported from the dev server) beside it, with four sample rows and a stand-in backend that answers a fixed snapshot — the real components and CSS, not the real data path.

| # | Check | Result |
|---|---|---|
| B1 | Real app, signed in: idle row `Focus · 25 min` + **Start focus** above the tabs; tabs, Today and footer unchanged | pass |
| B2 | Real app: clicking **Start focus** changes nothing (no shell) and logs nothing | pass |
| B3 | Idle, sample rows: a play button on each of the 3 not-done rows, none on the done row; clicking one reports that row's id | pass |
| B4 | Focus on a task: ring with `2 OF 4`, `Focus · ends 12:45 PM`, countdown ticking once a second, task title, `Pause` · `+5 min` · `Skip to break` · `End` (wrapped to two rows); no play buttons; the focused row tinted with animated bars (`animation-name: mb-eq`). Each control sends its command (`pause`, `extend`, `skip`, `stop`) | pass |
| B5 | Short break: blue ring (`rgb(127, 166, 255)` in dark, `--break`), no glow, `Short break · ends 12:33 PM`, `Pause` · `+5 min` · `Skip break`; play buttons back on the 3 not-done rows, no bars | pass |
| B6 | Paused bare focus: `Paused`, frozen `16:48` (did not move across 20 s), title `Focus`, `Resume` first; no play buttons | pass |
| B7 | Idle row with a failed hotkey: `⌥⇧F is taken by another app` on its own line, not clipped (found clipped on the first pass; fixed before the code commit) | pass |
| B8 | Dark (Auto, system dark) and light (`data-mode="light"`): header, ring, glow (dark only: `drop-shadow(rgba(132, 204, 22, 0.45) …)`), buttons, rows all read correctly | pass |
| B9 | Console armed right after load: no errors or exceptions through B1–B8 | pass |

Screenshots are inline in the session transcript only.

## Native (gate 5)

The branch build was run from `menubar/src-tauri/target/release/bundle/macos/Hupomnemata.app/Contents/MacOS/hupomnemata-menubar` for about 20 s and stopped by PID. It was **not** installed over `~/Applications`; the installed app (already running) was left alone.

| # | Observed from the shell | Result |
|---|---|---|
| N1 | The process starts and stays up; nothing on stdout/stderr | pass |
| N2 | A thread named `pomodoro` exists | pass |
| N3 | Idle, that thread is parked: all 2650 samples of a 3 s `sample` sit in `_pthread_cond_wait` → `__psynch_cvwait` | pass |
| N4 | Idle cost: 0.0 % CPU, 0 idle wake-ups (`top`), 0.24 s CPU in total after ~20 s | pass |

The 1-minute focus / 1-minute break config was **not** set. The branch build has the installed app's bundle id, so it shares that app's web view storage; and the shell can neither click the popover nor press a hotkey, so no session could have been started with it anyway.

## Not run / unverified

- **Tray text per state** — the idle count, `mm:ss` counting down, the frozen time when paused, compact minutes; whether the title's width jitters as digits change (the menu bar font's digits may be proportional).
- **Tray icon per state** — the ring filling in 24 steps, the cup, the bars; that each stays a template image in a light and in a dark menu bar.
- **A phase change with the popover closed** — focus → break by itself, break → idle, and the tray going back to the count.
- **The countdown after real sleep** — covered only by `advance` tests with injected times.
- **⌥⇧F** — registers, starts / pauses / resumes without opening the popover; the `taken` message live.
- **The header in the native window** — rendering, the window growing to fit it, the countdown stopping when the popover hides and catching up on show.
- **The live IPC round trip** — `pomodoro_configure`'s flat arguments, `pomodoro_start`'s `task`, and the hand-written snapshot JSON arriving as an object, both as a command's answer and as the `pomodoro` event. Each side is unit-tested against the same shape; nothing has run them against each other.
- **Start focus on a real Today row** end to end, and **sign-out stopping a running session** in the app (unit-tested at the web-view seam: `App.test.tsx`, `pomodoro.test.ts`).
