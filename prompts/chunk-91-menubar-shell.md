# Chunk 91 — Menu bar companion (macOS): shell, sign-in by code, Today read-only

Repo: smrios07mdb/dashboard. Base: main `3c550f3`. Branch: `chunk-91-menubar-shell`, ff-merge, delete after landing.
Design reference (unwired, never imported): `hupomnemata_handoff/menubar/prototype/hupomnemata-menu-bar.html`. Commit it and its README in this chunk.
First chunk of a series (91–98, list at the end). Build only what this chunk scopes.

## Why
Sergio wants Hupomnemata in the Mac menu bar: click the icon, a popover drops with the Today list; later chunks add a pomodoro countdown in the bar, Spotify presets, a scratchpad and meditation reminders. This chunk ships the shell the rest hangs on.

## Locked decisions
- D1 Tauri v2, macOS only. Check the current Tauri v2 docs for tray, window and plugin API names before writing Rust; do not write them from memory.
- D2 One package, second entry. No nested `package.json`. Layout:
  - `menubar/index.html`, `menubar/src/**` (React entry + components), `menubar/src-tauri/**` (Rust, `tauri.conf.json`, icons).
  - `vite.menubar.config.ts` at the root: `root: 'menubar'`, `envDir` = repo root, same `@` → `./src` alias, React plugin, **no** PWA plugin, `build.outDir: 'menubar/dist'`.
  - Root `package.json`: add `@tauri-apps/api` (+ plugins used) and dev `@tauri-apps/cli`; scripts `menubar:dev`, `menubar:build`, `menubar:typecheck`.
  - `tsconfig.menubar.json` (include `menubar/src`, same paths). Do **not** add it to `tsconfig.json` references — `npm run build` must not typecheck or bundle menubar code.
  - Ignore `menubar/dist` and `menubar/src-tauri/target` in `.gitignore`, ESLint `globalIgnores` and the Vitest `exclude`. Menubar `*.test.ts(x)` files run in the normal `npm test`.
- D3 Shared code. The menubar imports the app's own modules through `@/`: `@/lib/supabase`, `@/db/repo` (reads only this chunk), `@/lib/today`, `@/lib/clock`, `@/state/todayPlan` pure exports (`applyTodayDeltas` and friends), `@/db/types`, `@/index.css` tokens. No Today logic is re-implemented. If any of these cannot be imported without side effects that break outside the PWA (service worker, router, realtime start), stop and report — do not fork the logic.
- D4 Sign-in. Email → `supabase.auth.signInWithOtp` → 6-digit code → `verifyOtp({ type: 'email' })`, the same calls `src/screens/Login.tsx` makes. No magic-link redirect handling, no deep link. Session persists in the web view's `localStorage`. Single user; no account switcher.
- D5 Today. `repo.tasks.list()`, `repo.subcategories.list()`, `repo.categories.list()`, `repo.todayMarks.list()`, `settings.timezone` → the same membership rule as the Dashboard (`(auto ∪ pins) − removes`, marks dated today in the Settings zone) → `resolveToday`. Row order is `resolveToday`'s. Rows are read-only this chunk: category dot, title (one line, ellipsis), priority chip, when-chip, minutes; done rows struck and last. Header: `Today`, `N of M done`, progress bar. Empty plan: one line, `Nothing planned today.`
- D6 Refresh. Refetch when the popover is shown and every 5 min while it stays open. **No realtime subscription** — macOS suspends hidden web views. Offline: `repo` falls back to its cache; show `Offline — showing the last list` under the header.
- D7 Window. One frameless popover, ~340 px wide, height to content (max ~560, list scrolls), anchored under the tray icon, hidden on blur and on Esc, toggled by tray click. No Dock icon, no app switcher entry (accessory activation policy). Always on top while shown.
- D8 Tray. Template icon from `public/hupomnemata-mark-mono.svg` (rasterise to the sizes Tauri needs) plus a title: the count of open Today tasks, empty when 0 or signed out. Update it after every refresh — from Rust via a command/event, since the web view may be hidden.
- D9 Theme follows the system (`prefers-color-scheme`), no toggle. Light = the Daylight tokens from `src/index.css`. Dark = the values in the prototype's `.mac[data-mode="dark"]` block, defined in `menubar/src/dark.css` and scoped to the menubar only. This is an explicit exception to "dark themes are eliminated" — the PWA stays light-only; log it in the Decisions log and say so in ARCHITECTURE.
- D10 Footer. `Open dashboard` (the live GitHub Pages URL, in the default browser), `Sign out`, `Quit`.
- D11 CSP in `tauri.conf.json`: `connect-src` limited to the Supabase project (https + wss) and the CalDAV proxy host; no remote scripts.
- D12 Fonts come from the `@fontsource` packages already installed — no network font load.
- D13 Signing: ad-hoc for now. Bundle id `net.mdblabs.hupomnemata.menubar`. A stable signing identity is chunk 95's problem (Spotify automation permission).

## Out of scope (later chunks)
Checking tasks off, capture/scratchpad, timer, Spotify, meditation, hotkeys, settings panel, launch at login, focus header, tabs. Do not stub their UI.

## Tests (red-first where it applies)
- A pure `menubar/src/todayView.ts` (data in → rows + counts + tray title out) tested in the three zones: auto member, pinned, removed, done-sinks-last, a mark dated yesterday ignored, tray title `''` at 0 open.
- Sign-in component: code entry calls `verifyOtp` with `type: 'email'`; a rejected code shows the same message Login shows; no redirect option is passed.
- Refresh: showing the popover refetches; the 5-min timer stops when hidden.
- Existing suite untouched and green.

## Gates
1. `npm ci`; `npm run lint`; `npm run menubar:typecheck`; `npm test` under `TZ=America/New_York`, `TZ=UTC`, `TZ=Asia/Tokyo`.
2. `npm run build` on base and on head: `dist/` must contain no menubar file and the `assets/index-*.js` name must be identical. Record both names.
3. `npm run menubar:build` produces `Hupomnemata.app`. If `rustc`/`cargo` or the Xcode command line tools are missing, install Rust with rustup yourself; if Xcode CLT is missing, stop and report that one command.
4. Popover smoke in a normal browser (`npm run menubar:dev`, Tauri calls no-op when `window.__TAURI_INTERNALS__` is absent). Driver: Claude in Chrome; name it in the record. Check signed-out → code sign-in → Today rows match the Dashboard's Today panel for the same account (titles and order), light and dark (emulate `prefers-color-scheme`), console clean. Read-only run: create no fixtures.
5. Native smoke: copy the app to `~/Applications`, launch it, and verify what you can observe from the shell (process running, no Dock icon, tray title equals the open count). Anything you cannot observe — popover anchoring, blur-to-hide, the dark vibrancy — goes in the record as **unverified**. Do not ask Sergio to check it.

## Docs (same pass)
- ARCHITECTURE: new section "Menu bar companion (macOS)" covering D2–D9, D11; §2 Stack and §15 Repos/env one line each; §14 one row (macOS only, online writes arrive in chunk 92).
- PROGRESS row 91; Decisions log rows for D2 (one package, second entry), D6 (no realtime in the menubar), D9 (menubar-only dark palette).
- `README.md`: how to build and run the menubar app (full commands).
- `hupomnemata_handoff/menubar/` committed as delivered.
- `prompts/chunk-91-menubar-shell.md` committed.

## Push
Code commit pushed on its own, **no** `[skip ci]` (root `package.json`/lockfile change) — confirm the deploy run exists and is green with `gh run list`, and that the live `index-*.js` name is unchanged. Docs follow-up with `[skip ci]`.

## Report
Code SHA, docs SHA, test counts per zone, both `index-*.js` names, app bundle size, smoke record path, the unverified list.

## Series plan (context only — each gets its own prompt)
- 92 Check off from the popover (same `repo.tasks.markComplete` path and 6 s Undo; offline via the existing outbox).
- 93 Scratchpad tab: local draft, `⌘↵` turns each line into a task in Work/General through `lib/captureParse`; global hotkey, rebindable.
- 94 Pomodoro: timer owned by Rust from a stored end time, countdown in the tray, focus/break/paused/compact states, focus header, start focus on a Today task.
- 95 Spotify on this Mac via AppleScript: presets, transport, play on focus / pause on break; stable signing identity.
- 96 Meditation: schedule by interval or by set times, heads-up panel 5 min before and at the time (Start / Snooze 5 / Snooze 15 / Skip), session starts only on Start, full-screen breathing overlay on every display, Esc always ends it, Spotify pauses.
- 97 Settings panel: hotkeys editable, meditation schedule, compact tray, launch at login.
- 98 Saved focus and meditation sessions → Insights (migration).
