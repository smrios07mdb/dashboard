# Chunk 93 — Menu bar scratchpad: jot lines, send each as a task, ⌥H to open

Repo: smrios07mdb/dashboard. Base: main at the chunk-92 merge (tree of `5cfef04`). Branch: `chunk-93-menubar-scratchpad`.
Design reference: `hupomnemata_handoff/menubar/prototype/hupomnemata-menu-bar.html`, section "Scratchpad".
**Push the branch and stop. Do not merge to main** — the orchestrator gates the branch first.

## Why
Sergio wants to drop to-dos into the menu bar as fast as he thinks of them and sort them later on the website with Sort General. One line = one task.

## Locked decisions
- D1 Tabs. Under the (future) focus header the popover has two tabs: `Today` (with `done/total`) and `Scratchpad`. Proper tablist semantics, ←/→ between tabs. The popover reopens on the tab last used (`localStorage['hup:mb:tab']`); the hotkey always opens Scratchpad. Signed out: no tabs, sign-in only.
- D2 The pad. One plain `<textarea>`, 8 visible lines, ruled as in the prototype, scrolls inside itself. The draft is written to `localStorage['hup:mb:scratch']` on every input and restored at start — it survives hide, quit and restart, and is never synced. Font ≥ 16 px is not required here (desktop only); use the prototype's size.
- D3 Send. `⌘↵` in the pad, or the `Send` button. For each non-empty line, in order:
  1. `parseCapture(line, ctx)` with the Settings time zone and live lists (`src/lib/captureParse.ts`).
  2. Destination = `resolveCaptureDest(parse, { …, picked: <Work › General id> })`, where Work › General is the first live subcategory named `General` (case-insensitive) in the `Work` category. A `#list` / `#work` / `#personal` token therefore wins; with no Work › General, `resolveCaptureDest`'s own fallbacks apply. Do not read or write `hup:captureDest`.
  3. `repo.tasks.create` with exactly the field mapping `QuickCapture.tsx` uses: title from the parse, `estimateMinutes` = parsed ?? the same default QuickCapture uses, `dueAt` through `fromDueInputValue(dueDay, timeZone)`, `priority`, `remindAt: null`, `completedAt: null`. If that default or helper is private to QuickCapture, add an `export` — nothing else changes under `src/`.
  - Creates run one at a time. A line that is created is removed from the pad; a line that fails, or whose title is empty after parsing (e.g. just `p1`), stays.
  - Offline: `repo.tasks.create` queues through the existing outbox; that counts as sent. The chunk-92 sync runner replays it.
  - No live list at all: nothing is sent, the footer reads `No list to send to`.
  - Result line in the footer (not a toast): `Sent 4 tasks to Work › General`, or `Sent 3 · 1 not sent, still here`. When lines went to different lists, `Sent 4 tasks`.
  - After a send, refresh Today and the tray title (a `p1` or `today` line belongs in Today at once).
- D4 Footer of the tab. Left: live count, `4 lines → 4 tasks in Work › General` (`Nothing to send` when empty; singular handled). Right: `Send ⌘↵`, disabled when empty or sending. No per-line chips or preview.
- D5 Keys in the pad. `Esc` hides the popover (the draft is already saved). `⌘↵` sends. Plain `↵` is a new line.
- D6 Global hotkey. Default `⌥H`. Pressing it shows the popover on the Scratchpad tab with the caret at the end of the pad; pressing it while the popover is shown hides it. Use Tauri's official global-shortcut plugin — read its current v2 docs first; add only the permissions it needs to `capabilities/default.json`.
  - The popover still opens under the tray icon. Get the tray rect from the tray API if it exposes one, else the last rect a click gave, else the top-right of the main display.
  - The binding lives in one module (`menubar/src/hotkeys.ts`, `localStorage['hup:mb:hotkeys']`, default table `{ scratchpad: 'Alt+H' }`) with register/unregister, built so chunk 97's settings panel can rebind without touching Rust. No rebinding UI in this chunk.
  - If registration fails (another app holds it), the Scratchpad footer shows `⌥H is taken by another app` and the app works by tray click.
- D7 Height. The window follows content as today; switching tabs resizes it.
- D8 Unchanged: sign-in, Today rows, check-off, Undo toast, theme button, footer buttons.

## Out of scope
Timer and focus header, Spotify, meditation, settings/rebinding UI, launch at login, per-line chips, drag to reorder, syncing the draft.

## Tests (red-first)
- Pure `menubar/src/scratchpad.ts` (lines + ctx in → create inputs + leftover text + result line out), three zones: plain line → Work › General; `#personal` → Personal › General; `#<list>` → that list; `p1 25m tomorrow` mapped like QuickCapture; token-only line kept; blank lines ignored; one failing create leaves only that line; no live list.
- Component: draft restored from storage; input persists; `⌘↵` sends; `Esc` calls hide; button disabled when empty; footer count singular/plural.
- Tabs: remembered tab; hotkey event forces Scratchpad and focuses the pad.
- Hotkeys module: default, stored override, failed registration surfaces the message.
- Existing suite green.

## Gates
1. `npm ci`; `npm run lint`; `npm run menubar:typecheck`; `npm test` in `America/New_York`, `UTC`, `Asia/Tokyo`.
2. `npm run build` on base and head: same `assets/index-*.js` name, no menubar file in `dist/`.
3. `npm run menubar:build` (remember `export PATH="$HOME/.cargo/bin:$PATH"`).
4. Browser smoke on `npm run menubar:dev`, one run owner, name the driver. Fixtures carry `Smoke-<runId>-`; delete only those at the end. Send three lines (`Smoke-<runId>-A`, `Smoke-<runId>-B p1 #personal`, a token-only line): A lands in Work › General, B in Personal › General with P1 and shows in Today, the token-only line stays in the pad; draft survives a reload; light and dark; console clean.
5. Native: do **not** install the branch build over `~/Applications`. List as unverified whatever the shell cannot show (the hotkey itself, focus landing in the pad, position when opened by hotkey).

## Docs (same pass)
ARCHITECTURE §16 (tabs, scratchpad rules D2–D3, hotkey D6, the new plugin); PROGRESS row 93; Decisions log: scratchpad default is Work › General (differs from QuickCapture's Personal-first fallback, on purpose); README if the build steps change; `prompts/chunk-93-menubar-scratchpad.md` committed.

## Push
Branch only. Report: branch, head SHA, files under `src/` touched and why, test counts per zone, both bundle names, smoke record path, the unverified list, any deviation.
