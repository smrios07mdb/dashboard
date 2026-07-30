# Handoff: Week Planner + Priority System

## Overview
The centerpiece feature of **Hupomnemata** (calm, dignified personal task manager — shipped
React PWA, "Daylight" design system): a Week Planner where tasks get scheduled into time
slots against read-only busy overlays from two external calendars (Apple iCloud CalDAV +
work Outlook ICS feed), plus a 3-level priority system (P1/P2/P3) for sorting and triage.

```
design_handoff_week_planner/
├── README.md          ← you are here — the authoritative spec
├── PROMPT.md          ← paste into Claude Code (or Claude chat) to drive the build
├── DESIGN_NOTES.md    ← exact geometry, busy-overlay rationale, mechanics decisions
└── prototype/         ← runnable design reference (open "Week Planner.html" in a browser)
    ├── Week Planner.html         tokens + shell (4 tabs, state tweaks panel)
    ├── planner/                  the four screens + shared planner primitives
    └── src/, tweaks-panel.jsx    app primitives/icons the shell reuses
```

## About the design files
These are **design references written in HTML/React-via-Babel** — prototypes showing
intended look and behavior, not production code. The task is to **recreate them in the
target codebase** (React + TypeScript + Tailwind + shadcn/ui, per the existing app handoff)
using its established patterns: real dnd (`@dnd-kit`), real data, react-router, CalDAV/ICS
proxies. Port the pure functions in `planner/planner-primitives.jsx` exactly; rebuild the
components idiomatically.

## Fidelity
**High-fidelity.** Colors, type, spacing, radii, and copy are final. Recreate
pixel-faithfully with the app's existing token system. All logic in the prototype
(slot-finding, auto-fill, capacity, overlap) is the intended production behavior.

## Design tokens
Uses the app's existing Daylight tokens (`--bg #f6f4f7`, `--surface #fff`, ink scale
`#221f28/#635f6c/#948f9e`, `--accent #1f5142`, `--destructive #b8462e`,
`--warn #d98a1c`, radii 4/7/11/16, three subtle shadows; Newsreader 500 display,
Inter UI, IBM Plex Mono `.label`/`.num`). This feature pins the **emerald category
palette**: `--work #059669`, `--personal #f43f5e` (+14% soft tints).

**The only new values** (neutral family, busy overlays only):
```
--busy-icloud:        rgba(38,32,46,.05)    --busy-icloud-ln:  rgba(38,32,46,.09)
--busy-outlook:       rgba(45,56,88,.06)    --busy-outlook-ln: rgba(45,56,88,.12)
--busy-outlook-hatch: rgba(45,56,88,.055)
```
Derived (no new hexes): P2 chip = `color-mix(--warn 16%)` bg / `color-mix(--warn 62%, --ink)` text.

## Data model (production)
- `Task` gains `priority: 1|2|3` (today the app only has `priority === 1`) and keeps
  `estimateMinutes`, optional due date.
- `ScheduledBlock { taskId, start, end, done }` — a task placed on the planner.
- `BusySpan { source: 'icloud'|'outlook', start, end, title }` — read-only, from the
  CalDAV proxy and the ICS feed. Never editable in-app.

## Screens
### 1. Week Planner — desktop ≥1024 (`planner/WeekPlannerDesktop.jsx`)
- **Left tray (300px, 1px right rule):** `.label UNSCHEDULED` + count pill + destructive
  `N OVERDUE` label; segmented sort (Priority / Due date / Estimate); grouped under
  `P1 — URGENT` etc. labels only in Priority sort. Tray card: priority chip + title,
  meta row = category dot · due label · mono estimate. Overdue card: 3px destructive
  left edge + `Overdue · Tue 5` in destructive.
- **Header:** Newsreader week range ("May 4 – 10") + `.label WEEK 19 · 2026`, prev/Today/next,
  `Fill my week` (sparkles) button, mono capacity `5h 15m planned · 27h free`,
  `OUTLOOK FEED STALE` chip when stale.
- **Grid:** gutter 56px, columns `repeat(5,1fr) repeat(2,.55fr)` (half-width weekends),
  hour height 52px, window 08:00–19:00 default with SHOW/HIDE rails expanding to
  07:00–21:00. Day headers: `.label` day + mono date (today: 600 weight + emerald dot)
  + per-day `Nh Nm free` figure (weekdays; today from now; past `—`). Today column gets a
  60% surface wash; weekends 45% `--bg-alt`. Now-line: 2px `--work` + 7px dot, today only.
- **Blocks:** see DESIGN_NOTES.md for exact insets/thresholds. Busy behind (z1),
  tasks foreground (z3, white card, 3px category edge, shadow-sm, mono range, P1 chip).
- **All mechanics** (drag/move/resize, proposals, carryover, done, popover) in
  "Interactions" below.

### 2. Week Planner — mobile ≤640 (`planner/WeekPlannerMobile.jsx`)
- Day selector strip (7 chips: `.label` day + mono date, selected = `--ink` fill,
  today = emerald dot), selected-day free line, single-day timeline (hour 48px, gutter 46px,
  same rails/overlays/blocks), bottom `UNSCHEDULED (N)` section of compact rows.
- **No drag.** Tap a row → bottom "Schedule" sheet: task summary card, first 3 open slots
  (`11:45–12:45` + `free until 13:30`), custom time row, `Add to Wednesday` primary.
  Placing really schedules; overlap allowed with a toast note.

### 3. Priority on the task list (`planner/PriorityRows.jsx`)
- Existing dashboard row grid `[check][title][estimate][⋯]` + compact chip after the title.
  Chips: mono 9.5px, `.1em` tracking, radius 4 — P1 destructive tint, P2 warn tint,
  P3 `--bg-alt`/`--ink-3`. P1 keeps the existing 3px destructive left edge; chips hide on
  completed rows.
- Chip tap or ⋯ → "Set priority" opens a 216px picker: P1 Urgent "Needs to happen today" /
  P2 Soon "This week" / P3 Whenever "No pressure", check on current.
- List-header sort segment (Priority / Due / Estimate) matching the tray's control.

### 4. Settings — Calendars (`planner/SettingsCalendars.jsx`)
- Existing settings-row pattern (label column 180–220px + content, 1px row rules).
- **Apple Calendar** (restyle only): `✓ Connected · verified 2m ago` accent pill or
  `Reconnect needed` danger pill + Reconnect button.
- **Outlook (work)** (new): mono URL input + `Verify feed` → verified line
  (`✓ Feed verified` pill · feed name · mono `Last refreshed 12m ago` · refresh icon);
  stale state = amber box (`--warn` 32% border / 8% fill): **"Feed unreachable since
  09:14."** + `Retry now` + cached-data explanation. Help line (`--ink-3`):
  "In Outlook: Settings → Shared calendars → Publish a calendar → copy the ICS link."

## Interactions & behavior (desktop planner)
All snapping is **15 minutes**. Overlapping busy is **advisory, never blocked** — previews
flip destructive with `OVERLAPS {title} · {m}M`; the drop lands and the toast notes it.
- **Drag from tray** → floating card (210px, −2° tilt, shadow-lg) + dashed drop preview
  showing the snapped range in the category color.
- **Move** = drag block body (original dims to 30%); **resize** = 7px bottom strip,
  range label updates live; min 15m.
- **Fill my week**: proposes earliest open weekday slots (09:00–18:00, today from now+10m)
  for every P1/P2 tray task. Proposals = dashed category-tint blocks + accent bar
  (`5 proposals · 3h 25m` · Place all / Clear); proposed tray cards dim with `→ WED 11:45`.
- **Carryover**: past + not-done block goes hollow (dashed border, 45% edge, `· unfinished`);
  hover reveals → *move to next open slot* + done-check. Done blocks: strikethrough
  `--ink-3`, 72% opacity, no shadow.
- **Busy popover** (click a busy block): title, mono range, `OUTLOOK · WORK FEED` /
  `ICLOUD · PERSONAL`, `Synced 12m ago` or amber `Cached at 09:14 — feed unreachable`,
  "Open in Outlook / Apple Calendar" link.
- **Stale feed**: header chip + Outlook blocks at 55% opacity stamped `OUTLOOK · 09:14`.
- Empty week: centered serif "Nothing planned yet." + one `--ink-3` line. Empty tray:
  dashed card "No unscheduled tasks."

## Algorithms (port exactly; unit-test)
In `prototype/planner/planner-primitives.jsx`:
`findOpenSlots` (gaps ≥ estimate, 08:00–20:00, around busy+scheduled, today from now),
`nextOpenSlot` (scan today→Sun, 09:00–18:00), `autoFill` (P1→P2, due-date tiebreak,
weekdays only, proposals occupy as placed), `computeCapacity` (planned = all scheduled;
free = Mon–Fri 09–18 − busy − scheduled, clipped), `computeDayFree`, `overlapBusy`,
`sortTray`, `blockPos` (window clamping + ↑/↓ clip stamps).

## State
Per week: `scheduledBlocks[]`, tray = tasks with no block, visible-window flags
(top/bottom expanded), active proposals, drag state, open busy popover. Persist blocks +
priority to the backend; window flags are local UI state.

## Assets
None — no images/illustrations. Icons are the app's existing 1.6px-stroke inline SVG set
(`src/icons.jsx`). 24-hour clock everywhere in the planner.

## Files
Open `prototype/Week Planner.html` — tabs across the four screens; the floating Tweaks
panel switches states (populated/empty week, static drag demos, Outlook fresh/stale,
mobile sheet, Apple status). `DESIGN_NOTES.md` holds exact geometry and rationale.
