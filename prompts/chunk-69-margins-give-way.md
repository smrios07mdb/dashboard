# Chunk 69: Saved page margins give way to the window (UX audit #1, #18 margins-on-phone)

**Ran on:** Claude Code, in `~/Documents/To-Do Dashboard` on Sergio's Mac. Written by Claude Code as the record of what was built: Sergio pasted the 2026-10-13 UX audit and chose "Build chunk 69", so there was no orchestrator prompt ahead of the code. App code only: no SQL, no migration, no proxy, no new dependency.

**Bases:** app `343862b` (docs); last code commit `a4ea591` (chunk 68), which was live. Proxy untouched.

**Authority:** `ARCHITECTURE.md` → `prompts/README.md` → this file.

**Scope:** UX audit 2026-10-13 finding 1, and the "Page margins is offered on phone" bullet of finding 18. Nothing else from the audit.

---

## The problem, as committed at `343862b`

- Page margins are stored as absolute pixels (`hup:shellMargins`) and written inline on `.shell` as `--shell-side`. A side set on a wide display is applied unchanged on a narrower window.
- `clampMargins` kept only 280 px of content, and ran at load and on edits, never on resize.
- Audit measurement at a 1224 px window with a saved side of 250 px: columns ~285 px, titles truncated to two or three characters.
- The dashboard's category grid switched to two columns on the viewport (`sm:grid-cols-2`), which says nothing about the room the margins and the Today rail leave.
- Settings offered "Adjust margins" on phones.

## Decisions

### D1 The saved side is a ceiling, applied in CSS

- `AppShell` passes the saved (or draft) set inline as `--shell-side-saved` / `--shell-top-saved` / `--shell-bottom-saved`. It no longer sets `--shell-side` / `--shell-top` / `--shell-bottom`.
- `.shell` in `index.css` declares `--shell-*-default` per breakpoint and resolves, from `sm` up:
  `--shell-side: min(saved, max(default, (100vw − 900px) / 2))`.
- Pure CSS, so it follows the window live with no resize listener.
- Storage shape and key are unchanged (`{ side, top, bottom }`); no migration of saved values. The audit's alternative — store a max content width — needs the viewport the value was set at, which existing saved values do not carry.

### D2 Phones always get the defaults

- Below `sm` (640 px) `.shell` reads no `-saved` variable. A value saved on that device earlier is ignored, not deleted.

### D3 Store

- `MARGIN_LIMITS.minContentWidth` 280 → **900**. `maxSideFor(viewport)` = `max(default side, floor((viewport − 900) / 2))`, so a window too narrow for the floor keeps its default side instead of clamping to 0.
- `readInitial` sanitises but does not clamp the side to the current window (a wider window later gets the saved side back).
- `startEditing` seeds the draft from the saved set clamped to this window, so the guides sit on the rendered padding edges.
- `MarginEditor` re-clamps the draft on `resize`, and cancels the edit below `sm`.
- Accepted: opening the editor on a narrow window and pressing Save stores the narrowed side.

### D4 Category grid switches on its container

- `Dashboard.tsx`: the grid is wrapped in `.category-cols` (`container-type: inline-size`) and carries `.category-grid`.
- `index.css`: `.category-grid` is one `minmax(0, 1fr)` column; `@container category-cols (min-width: 48rem)` makes it two.
- No `grid-cols-*` utility on the grid: Tailwind emits utilities after the components layer, so one would override the container rule.
- Plain CSS — Tailwind 3.4, no container-queries plugin.
- Behaviour change at default margins: two columns now need a 768 px grid. Stacked layout: one column for viewports under ~848 px (was 640). Rail layout: one column under ~1180 px (was two ~290 px columns from 1024).

### D5 Settings

- The "Page margins" row is wrapped in `hidden sm:block`.
- Its hint shows what this window renders (`clampMargins(saved)`), not the stored figure.

### D6 What does not change

- Top and bottom margins' limits, the guides, the Save / Reset / Cancel bar, saving-the-defaults-clears-the-key.
- `CategoryColumn`'s header (chunk 68), task rows, the Today panel, the rest of Settings' phone layout (audit #18), `package.json`.

## Tests

jsdom applies neither media nor container queries, so CSS behaviour is pinned as text (`index.css?raw`) against the store's constants; real widths were measured in Chrome.

- `state/shellMargins.test.ts`: clamp at 1728 / 1224 / 900 / 600; saved side survives a narrow load and the draft starts clamped; three CSS-text tests (side cap uses `minContentWidth`; `-saved` read only from `sm`; container rule after the one-column default).
- `components/AppShell.test.tsx` (new): `-saved` variables inline, never the resolved ones; draft wins.
- `components/MarginEditor.test.tsx`: resize re-clamps; resize below `sm` cancels.
- `screens/Dashboard.test.tsx`: the chunk-68 grid assertion now expects `.category-grid` inside `.category-cols` and no `grid-cols-*` utility.
- `screens/Settings.test.tsx`: the row carries `hidden sm:block`.

## Out of scope

- Audit #8 (row controls), #14 (contrast), the rest of #18 (Settings is still 460 px wide in a 386 px frame), the rest of #17.
- Sizing the floor against the classic-scrollbar width (`100vw` includes it, so content is 885 px, not 900, where a 15 px scrollbar shows).
