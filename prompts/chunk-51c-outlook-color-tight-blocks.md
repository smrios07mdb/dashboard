# Chunk 51c — Outlook busy color · legible 30-minute blocks

**Repos:** `smrios07mdb/dashboard` (`main`, HEAD `0d25476`; last code SHA on gh-pages `94c6e7e`). Proxy `smrios07mdb/dashboard-caldav-proxy` at `caa8e0f` — **no proxy change expected** in this chunk. **Prerequisite (met):** chunk 51b closed at `94c6e7e` + docs `9071e47`; proxy deployed.

Run per `CLAUDE.md` and `prompts/README.md`. Authority order: `ARCHITECTURE.md` → `prompts/README.md` → this prompt. If this prompt and `ARCHITECTURE.md` disagree, stop and surface it.

Read the committed source before writing anything. This prompt was written against `0d25476`; if a file differs from its description here, the file wins and you say so in the report.

---

## Why this chunk exists

Two operator reports from the first live look at chunk 51b (2026-09-02):

1. **"Outlook calendar doesn't have a color."** Chunk 51b gave every iCloud calendar a distinct tint, and deliberately left Outlook on the flat cool tint + 135° hatch (`BusyBlock.tsx`, `lib/calendarColors.ts` — "Outlook is never colored"). Next to five colored iCloud calendars the work feed now reads as the one calendar without an identity.
2. **"30-minute meetings are too small to read without hovering."** At `PLANNER.hourH = 52` a 30-minute block is `52/2 − 2 = 24px` tall (`blockPos`, `plannerGeometry.ts:84`); `BusyBlock` renders the title only when `pos.height >= 26` (`BusyBlock.tsx`), so a 30-minute meeting shows **no text at all** — only the tint. Mobile (`mHourH = 48`) is worse: 22px. The title is reachable only through the popover.

## Locked decisions (never relitigate)

- **D1 — Outlook gets its own distinct color.** The feed is one calendar in the color sense: `calendarColorMap` takes the Outlook feed as an extra entry (name = `sources.outlook.feedName ?? 'Outlook'`) so its color is distinct from every iCloud calendar in the read set, and `withCalendarColors` colors `source: 'outlook'` intervals with it. The **hatch stays** — it is the *source* cue (stale/cached semantics ride on it); the color is the *identity* cue. Stale Outlook keeps the 55% opacity rule.
- **D2 — A 30-minute block shows its title without hover, on both branches.** At `hourH 52` (24px) and `mHourH 48` (22px) the title must render. Do it with tight typography, not a bigger hour: `PLANNER.hourH`/`mHourH` are **unchanged** (they drive the drop-slot math, 52px/hour = 13px per 15 min, which the smoke harness notes depend on).
- **D3 — 15-minute blocks stay text-free.** `blockPos` floors height at 14px; that is a tint-only block and the popover is the reveal. Do not lower the floor.
- **D4 — `TaskBlock` gets the same tight treatment only if it has the same defect.** Check `TaskBlock.tsx` (`tight = pos.height < 40`, title at 11.5px/1.25): if a 30-minute *task* block already shows its title, leave it alone and say so; if it doesn't, apply the same threshold.
- **D5 — No proxy change, no Outlook write.** Everything here is client rendering.

## Files to read first

- `src/components/planner/BusyBlock.tsx` — thresholds (`>= 26` title, `>= 46` source tag), `py-1` padding, `text-[10.5px]`, the chunk-51b `calColor` / `background` / `ring` block
- `src/lib/calendarColors.ts` — `CALENDAR_PALETTE`, `calendarColorMap`, `withCalendarColors` (the `source !== 'icloud'` early return is what D1 removes)
- `src/screens/Planner.tsx` — `calendarColors` / `busyBlocks` memos (chunk 51b), `sources` (`busyState.busy?.sources`, has `outlook.feedName`), `readCalendars`
- `src/components/planner/BusyPopover.tsx` — `OUTLOOK · WORK FEED` line + chunk-51b swatch
- `src/components/planner/CalendarPicker.tsx` — rows + swatch; decide whether the Outlook feed is *listed* (read-only row, no switch, `FEED` tag) — recommended, so the legend is complete in one place
- `src/components/planner/TaskBlock.tsx` — D4
- `src/lib/plannerGeometry.ts` — `PLANNER` l.16, `blockPos` l.72
- `design/DESIGN_NOTES.md` §Busy-overlay treatment (the "context, not content" rule the tint honours)
- Tests: `src/lib/calendarColors.test.ts`, `src/components/planner/WeekGrid.test.tsx` (the chunk-51b tint test + "Tall enough (90m ≥ 46px)" fixtures), `src/components/planner/CalendarPicker.test.tsx`, `src/screens/Planner.test.tsx`

---

## Task 1 — Outlook color (D1)

1. `calendarColorMap(calendars, extras?)` — accept an optional list of extra names to color after the read set (order: iCloud read set first, then extras), same distinctness rule. Export a small helper `outlookColorName(sources)` → `sources?.outlook.feedName ?? 'Outlook'`.
2. `withCalendarColors` — an `outlook` interval takes the map entry for the Outlook name; iCloud behaviour unchanged.
3. `Planner.tsx` — build the map with the Outlook extra only when `sources?.outlook.configured` is true.
4. `BusyBlock.tsx` — Outlook `background` = the hatch over `color-mix(in srgb, <color> 16%, transparent)`; ring `42%`; dot beside the `OUTLOOK` tag as for iCloud. Without a color (pre-fetch, unconfigured) the existing `--busy-outlook*` tokens stay.
5. `BusyPopover.tsx` — swatch on the Outlook line too.
6. `CalendarPicker.tsx` — a read-only Outlook row at the bottom of the list (dot, feed name, `FEED` tag, no switch) when the feed is configured; the chip count stays `n/m` over iCloud only.

## Task 2 — Tight blocks (D2, D3, D4)

1. `BusyBlock.tsx`: title renders at `pos.height >= 18`; below 30px use `py-[2px]`, `text-[10px]`, `leading-[1.1]`; 30px+ keeps today's look. Source tag threshold `>= 46` unchanged.
2. Both branches: `WeekGrid` (52) and `DayTimeline` (48) render through the same component — verify a 30-minute fixture shows its title on each.
3. D4 check on `TaskBlock`.

## Task 3 — Tests

- `calendarColors.test.ts`: extras are distinct from the read set; Outlook intervals colored; iCloud untouched.
- `WeekGrid.test.tsx`: a 30-minute iCloud block (`startMin 600, endMin 630`) shows its title; a 15-minute one does not; an Outlook block with a color has both the hatch and the `color-mix` in `style.background` (jsdom serializes hex as `rgb()` in `background` but not in `box-shadow` — match either).
- `CalendarPicker.test.tsx`: Outlook row present/absent by `configured`; it has no switch.
- Expected: app 561 → ≥ 570, each new test proven red against `0d25476`.

## Task 4 — Docs

- `ARCHITECTURE.md` §7: amend the chunk-51b paragraph — "Outlook blocks keep their hatch and are never colored" → hatch + distinct color; add the tight-block thresholds.
- `PROGRESS.md`: row 51c ☑ with SHA and review notes; decisions D1–D5; "Last updated".
- Push code alone first (deploy must run), docs with `[skip ci]` after.

## Acceptance

1. On the live Planner with Outlook configured, an Outlook block is tinted a color no iCloud calendar uses, still hatched, dot beside `OUTLOOK`; the picker lists the feed.
2. A 30-minute meeting on the desktop grid and on the 570px iframe branch shows its title with no hover.
3. A 15-minute block is tint-only.
4. `npm run build`, `npm test` green; lint baseline unchanged (2 pre-existing errors); deploy green; `version.json` shows the code SHA.
