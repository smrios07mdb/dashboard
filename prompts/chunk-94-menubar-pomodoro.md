# Chunk 94 — Menu bar pomodoro: timer owned by Rust, countdown in the tray, focus header

Repo: smrios07mdb/dashboard. Base: main at `c984115` (chunk 93 merged; code `e1fc506`). Branch: `chunk-94-menubar-pomodoro`.
Model: Fable 5.2 (native work).
Design reference: `hupomnemata_handoff/menubar/prototype/hupomnemata-menu-bar.html` — the focus header (`.sec.focus`, `.ring`), the Today rows' play button (`.go`) and focusing bars (`.eq`), and "Menu bar states" (Idle, Focus, Break, Paused, Compact).
**Push the branch and stop. Do not merge to main** — the orchestrator gates the branch first.

## Why
Sergio wants a pomodoro in the menu bar: start a focus session (on a Today task or bare), see the countdown in the menu bar without opening anything, and have the break start by itself when focus ends. The timer must keep correct time while the popover is closed and across sleep.

## The rule this chunk exists for
The web view is throttled or suspended by macOS while hidden (ARCHITECTURE §16, Refresh). So **Rust owns the timer and the tray**. The web view only sends commands, renders the header while shown, and supplies the settings. Nothing about the countdown, the phase changes or the tray text may depend on JS running.

## Locked decisions
- **D1 State lives in Rust**, in a new `menubar/src-tauri/src/pomodoro.rs`. One `Mutex`-guarded state, managed by Tauri:
  - `phase`: `Idle | Focus | ShortBreak | LongBreak`; `paused: bool` (only in `Focus`/breaks).
  - `ends_at`: wall-clock end, `SystemTime` (epoch ms across the IPC). **Never `Instant`**: on macOS `Instant` stops during sleep, `SystemTime` does not. No tick counting anywhere — remaining time is always `ends_at − now`.
  - `phase_len_ms` (for the ring fraction), `remaining_ms` while paused (`ends_at` is recomputed on resume).
  - `cycle_pos` 1..=`every` (the `2 OF 4`), `task: Option<{ id, title }>`.
  - `config`: `{ focus, short, long, every, compact }` (minutes / count / bool).
  - `idle_title`: the last open-Today count the web view sent.
  - In memory only. Quitting the app ends any session; no persistence across restarts in this chunk.
- **D2 Transitions are one pure function**, `advance(state, now) -> state`, unit-tested in Rust with injected times:
  - Focus ends → break starts **automatically**: `LongBreak` if `cycle_pos == every`, else `ShortBreak`. The break's end is **anchored to the focus's scheduled end** (`focus_end + break_len`), not to when the change was noticed — so a Mac that slept through focus end *and* break end wakes to `Idle`, not to a fresh break.
  - Break ends → `Idle`. The next focus never starts on its own. After a short break `cycle_pos` += 1; after a long break it resets to 1.
  - `advance` may cross several boundaries in one call (sleep).
- **D3 Commands** (all in `lib.rs`'s handler list, named in `native.ts`):
  - `pomodoro_state` → snapshot.
  - `pomodoro_configure { config }` → validated (focus 1–180, short 1–60, long 1–90, every 1–12; anything else is rejected, not clamped). Applies from the next phase; a running phase keeps its length.
  - `pomodoro_start { task: { id, title } | null }` → `Focus` for `config.focus` minutes. From `Idle` or a break (a break is abandoned, `cycle_pos` unchanged). Rejected while `Focus` is running or paused. Title truncated to 200 chars in Rust.
  - `pomodoro_pause` / `pomodoro_resume` — focus and breaks.
  - `pomodoro_extend` → +5 min to the current phase (running or paused); `phase_len_ms` grows with it.
  - `pomodoro_skip` → in `Focus`: counts the session as done and starts its break now (anchored to now). In a break: → `Idle`, same `cycle_pos` rule as a natural end.
  - `pomodoro_stop` → `Idle` from anywhere; the session is not counted; `cycle_pos` unchanged.
  - Every state change (command or `advance`) emits **one** `pomodoro` event with the snapshot. No per-second events.
- **D4 The loop.** One background thread started in `setup` (std only — no new crate for this). It wakes about every second while a phase is running and not paused, calls `advance`, and sets the tray. Paused or `Idle`: it parks until a command wakes it (`Condvar` or channel) — no polling while idle. Set the tray only when the text or icon actually changed.
- **D5 Tray text** (Rust only; a pure `tray_title(state, now)` with tests):
  - Idle → `idle_title` (the open-Today count, as now; empty at 0 / signed out).
  - Running focus or break → `mm:ss`; `h:mm:ss` from 60 min up. Compact (`config.compact`) → whole minutes rounded up, `17m`; `65m` above an hour.
  - Paused → the frozen remaining time in the same format.
  - `set_tray_title` from the web view now **only stores** `idle_title` (same validation as today) and applies it if `Idle`. The tray is never written from JS while a phase is on.
- **D6 Tray icon.** All template images, so they follow the menu bar's light/dark:
  - Idle → today's mark (`icons/tray.png`), unchanged.
  - Focus → a progress ring like the prototype's states strip: 30 % track, arc for the elapsed fraction, rendered in Rust into RGBA at 44 px by a pure function (`ring_rgba(size, fraction)`), quantised to 1/24 steps so it is redrawn at most 24 times a phase. Unit-test 0, ½ and 1.
  - Break → a cup glyph; Paused → two bars. Draw both with `icons/make-tray-icon.mjs` (the chunk-91 script) into `icons/tray-break.png` and `icons/tray-paused.png`, commit the PNGs, `include_image!` them.
  - macOS template images are one colour, so the prototype's blue break tray is not possible — the cup is what tells a break apart. Record it as a deviation, not a gap.
  - Check after every `set_icon` that the template flag still holds (re-apply `set_icon_as_template(true)` if the API drops it).
- **D7 Settings source.** `menubar/src/pomodoroPrefs.ts` (pure, guarded like `prefs.ts`): `localStorage['hup:mb:pomodoro']` over `{ focus: 25, short: 5, long: 15, every: 4, compact: false }`, invalid fields fall back one by one. Sent with `pomodoro_configure` at start (signed in) and whenever it is saved. **No settings UI** — chunk 97 edits this key.
- **D8 Focus header** (`menubar/src/FocusHeader.tsx`), above the tabs, signed in only:
  - Idle: one slim row — `Focus · 25 min` (from config), and a `Start focus` button (bare session, no task).
  - Focus / break / paused: the prototype's block — 84 px ring (lime gradient for focus, `--break` blue for breaks, track `--ring-track`, glow only in dark), `n OF every` in the ring, label `Focus · ends 10:03` / `Short break · ends 10:08` / `Long break · ends …` / `Paused`, the big `mm:ss`, the task title (one line, ellipsis; `Focus` when bare).
  - Controls: Focus → `Pause` (primary) / `Resume`, `+5 min`, `Skip to break`, `End`. Break → `Pause`/`Resume`, `+5 min`, `Skip break`.
  - The countdown is drawn from the snapshot's `ends_at` with a 1 s interval **only while the popover is shown** (`watchPopover`), cleared on hide. On every `popover-shown` re-read `pomodoro_state` (an event may have been missed while suspended).
  - The `ends …` time: Settings time zone, the app's own short-time formatter (reuse whatever `@/lib/whenLabel` / `@/lib/clock` already use — no new formatter).
  - New tokens (`--ring-a`, `--ring-b`, `--ring-track`, `--ring-glow`, `--break`) go in `menubar/src/menubar.css` (light) and `dark.css` (dark), values from the prototype's two `:root`-level blocks. Nothing under `src/` changes.
- **D9 Start on a Today task.** Each not-done Today row gets the prototype's play button (`aria-label="Focus on <title>"`) at the row's end. Shown when `Idle` or in a break; hidden while focus is running or paused. The row being focused shows the `.eq` bars instead (static under `prefers-reduced-motion`). Checking off the focused task does not end the session.
- **D10 Hotkey.** Add `focus: 'Alt+Shift+F'` to `DEFAULT_HOTKEYS` (prototype: "Start or pause focus"). Idle or break → bare start; running → pause; paused → resume. Does not open the popover. Failure shows `⌥⇧F is taken by another app` in the idle focus row. Same mechanism as ⌥H (web view) — if chunk 93a moves hotkeys to Rust, this one moves with it.
- **D11 Sign-out** calls `pomodoro_stop`. Signed out the header is not shown and the tray falls back to the empty idle title.
- **D12 Unchanged:** sign-in, Today rows apart from D9, check-off and Undo, scratchpad and ⌥H, theme, footer, refresh cadence, window placement.

## Out of scope
Notifications or sounds at phase changes, Spotify (95), meditation (96), settings UI and the compact toggle UI (97), saving sessions to the DB / Insights (98), persistence across quit, launch at login.

## Guardrails
- Nothing under `src/` changes. If something must, an added `export` only — anything more: stop and report.
- No new Tauri plugin. No new Rust crate unless std truly cannot do it — then stop and report before adding.
- No timer state in `localStorage`; Rust is the only truth for a running session.
- Do not start chunk 95 or write a handoff or brief.

## Tests (red-first)
- **Rust** (`cargo test --manifest-path menubar/src-tauri/Cargo.toml`): `advance` — focus → short break auto; 4th focus → long break; break → idle and `cycle_pos` rule; sleep across focus+break → idle; sleep across focus end only → break with the anchored end; pause freezes, resume recomputes `ends_at`; extend while running and paused; skip in focus counts, skip in break; stop; start rejected while running. `tray_title` — mm:ss, h:mm:ss, compact rounding up, paused, idle count. `ring_rgba` — 0, ½, 1. Config validation rejects out-of-range.
- **Vitest:** `pomodoroPrefs` (defaults, stored override, field-by-field fallback); `FocusHeader` (idle row, each phase's label and controls, countdown from `ends_at` with fake timers, interval only while shown, re-read on show); `TodayList` play button visibility by phase and `.eq` on the focused row; hotkeys default table now has `focus`; sign-out calls stop.
- Existing suite green.

## Gates
1. `npm ci`; `npm run lint`; `npm run menubar:typecheck`; `npm test` with `TZ=America/New_York`, `TZ=UTC`, `TZ=Asia/Tokyo`; `cargo test` as above.
2. `npm run build` on base `c984115` and head: same `assets/index-*.js` name, no menubar file in `dist/`.
3. `export PATH="$HOME/.cargo/bin:$PATH"` then `npm run menubar:build`.
4. Browser smoke on `npm run menubar:dev` (no Rust there — `native.ts` no-ops): header idle row, play buttons, light and dark, console clean. Name the driver. No DB fixtures are needed; if any are made, prefix `Smoke-<runId>-` and delete only those.
5. Native: build the app from the branch but **do not install it over `~/Applications`**. Run the built binary from `menubar/src-tauri/target/release/bundle/macos/` with a 1-minute focus / 1-minute break config set in its web view storage if reachable; otherwise record as unverified. Record what the shell can observe; list the rest as unverified (tray text and icon per state, countdown after sleep, ⌥⇧F, header rendering in the native window).

## Docs (same pass)
- ARCHITECTURE §16: new **Pomodoro** paragraph (D1–D11), Tray (D5–D6, the template-colour limit), Shell commands (the new commands, the `pomodoro` event), Hotkey (`focus`).
- PROGRESS: row 94; **also correct rows 92 and 93**, which still read "not merged": 92 merged ff at `5cfef04`, 93 merged ff at `c984115` (code `e1fc506`, deployed). Update "Last updated".
- Decisions log: Rust owns the timer from a wall-clock end (`SystemTime`, not `Instant`); break end anchored to the scheduled focus end; no notification/sound at phase change for now.
- README if build or test steps change (the `cargo test` command).
- Commit this prompt as `prompts/chunk-94-menubar-pomodoro.md`.

## Push
Branch only. Commit order: code commit(s), then the docs commit with `[skip ci]` — pushed together is fine on a branch, since no deploy runs from it. Report: branch, head SHA, code SHA(s), files under `src/` touched (expected: none), Vitest counts per zone, `cargo test` count, both bundle names, smoke record path, the unverified list, every deviation.
