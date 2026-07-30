# Week Planner — design notes

Reference prototypes for the Week Planner, priority system, and calendar settings.
Entry point: `Week Planner.html` (tabs across the four screens; states in the Tweaks panel).
Files: `planner/planner-primitives.jsx` (shared), one JSX per screen. All mock data lives
in `PLANNER_DATA` in the primitives file.

## Grid geometry (exact values)

| Value | Desktop | Mobile |
|---|---|---|
| Visible range | 08:00–19:00 default, expandable to 07:00–21:00 | same |
| Hour height | 52px | 48px |
| Time gutter | 56px | 46px |
| Day columns | `repeat(5, 1fr) repeat(2, .55fr)`, 1px `--line` left rule each | single day |
| Hour rules | 1px `--line` via repeating-linear-gradient | same |
| Busy block inset | 1px each side, radius 4 (`--radius-sm`) | same |
| Task block inset | 3px each side, radius 7 (`--radius`), 1px top/bottom gap | same |
| Task block padding | 5px 8px (3px 7px under 40px tall) | same |
| Header sep | 1px `--line-strong` under day headers | same |

Block position: `top = (start − 07:00) / 60 × hourH + 1`, `height = duration/60 × hourH − 2` (min 14px).
Blocks under 40px drop the time range and P1 chip; title only.

## Busy-overlay treatment (rationale)

Busy blocks are context, not content, so they get **no surface, no shadow, no ink-strength
text** — just a tint recessed into the canvas, with task cards (white `--surface`,
`--shadow-sm`, 3px category edge) clearly floating above.

- **iCloud**: flat neutral tint `rgba(38,32,46,.05)` + inset 1px ring at `.09`.
- **Outlook**: same construction shifted one step cooler `rgba(45,56,88,.06)` + a fine
  135° hatch (1px stripes, 6px period). Texture + temperature distinguish the two sources
  without adding chroma; both stay in the neutral family.
- Titles render in `--ink-3` at 10.5px when height ≥ 26px; the `ICLOUD`/`OUTLOOK` source
  tag (8.5px `.label`) appears at height ≥ 46px, bottom-aligned.

Z-order: hour rules → busy (z1) → now-line (z2, 2px `--work` + 7px dot, today only) →
task blocks (z3) → drop highlight (z4) → dragged card (z6, 210px, −2° rotation, `--shadow-lg`).

## Priority system

- P1 `--destructive` tint · P2 `color-mix(--warn 16%)` tint with `color-mix(--warn 62%, --ink)`
  text · P3 `--bg-alt`/`--ink-3`. Chip: Plex Mono 9.5px, `.1em` tracking, radius 4, 2×6px padding.
- P1 rows keep the existing 3px destructive left edge; chips hide on completed rows.
- Picker: 3 options (Urgent / Soon / Whenever), opens from the chip or ⋯ → Set priority.
- Tray groups under `P1 — URGENT` etc. `.label` headers only when sorted by Priority;
  Due date / Estimate sorts render flat.

## Interaction decisions

- **24h clock everywhere** in the planner (gutter, ranges, slots) — calmer, and tabular
  mono ranges stay compact inside blocks.
- **Drop states**: 1.5px dashed outline + 7% tint fill; valid uses the task's category
  color and shows the snapped range; conflict uses `--destructive` + `CONFLICTS WITH BUSY`
  label. Snap grid: 15 minutes.
- **Mobile**: no dnd. Tap a tray row → Schedule sheet (bottom, mirrors block-time sheet):
  first 3 open slots ≥ estimate in an 08:00–20:00 window, computed around busy + already
  scheduled; today's proposals start after "now" rounded to :15. Manual time row as fallback.
  Adding actually places the block in this prototype.
- **Stale feed** surfaces twice: amber notice in Settings ("Feed unreachable since 09:14",
  cached-data explanation, retry) and a quiet `OUTLOOK FEED STALE` chip in both planner
  headers. Amber = `--warn` mixes; not full `--destructive` since data is stale, not lost.
- Weekend columns get a 45% `--bg-alt` wash; today gets a 60% `--surface` lift + emerald
  dot in the header. Both washes sit under the hour rules.

## Live mechanics (v2 additions)

- **Fill my week** (header): proposes earliest open weekday slots (09:00–18:00, today
  starts after now+10m, 15m snap) for every P1/P2 tray task, honoring busy + scheduled +
  earlier proposals. Proposals render as dashed category-tint blocks (`PROPOSED` range
  label) with an accent bar: Place all / Clear. Tray cards of proposed tasks dim and show
  `→ WED 11:45`.
- **Drag, move, resize** (desktop): tray cards drag onto the grid; block bodies move;
  a 7px bottom strip resizes. All snap to 15m; the mono range updates live. Overlapping
  a busy block is *advisory*: the preview flips to destructive with
  `OVERLAPS {title} · {m}M`, but the drop is allowed (double-booking is the user's call).
  Column hit-testing accounts for half-width weekends (units 5×1 + 2×0.55).
- **Carryover**: past + not-done blocks go hollow (dashed border, 45% edge, translucent
  fill, `· unfinished` suffix). Hover (tap on mobile) exposes → *move to next open slot*
  and a done-check. `nextOpenSlot` scans today→Sunday, 09:00–18:00.
- **Done state**: hover check on any block; done = strikethrough `--ink-3` title, 45%
  edge, no shadow, 72% opacity. The week doubles as a record.
- **Per-day capacity**: `Nh Nm free` under each weekday header (09:00–18:00 window minus
  busy minus scheduled; today counts from now; past days show `—`; weekends none).
  Mobile shows it for the selected day under the strip.
- **Collapsed hours**: default window 08:00–19:00 with quiet `SHOW 07:00–08:00 · N HIDDEN`
  rails top and bottom (full range 07:00–21:00). Blocks crossing the window edge clamp
  and stamp `↑ 07:30` / `↓ 21:00` in 8px mono.
- **Stale feed on the grid**: stale Outlook blocks drop to 55% opacity and their source
  tag becomes `OUTLOOK · 09:14` (cache time) — the risk of trusting a phantom-free slot
  stays visible where scheduling happens, not just in the header chip.
- **Busy popover**: click a busy block → title, range, source (`OUTLOOK · WORK FEED`),
  sync state (`Synced 12m ago` / cached warning), and an *Open in Outlook / Apple
  Calendar* deep link. Read-only but inspectable.
- **P1 aging**: overdue tray tasks (due < today) get the 3px destructive left edge (same
  convention as task rows), a destructive `Overdue · Tue 5` meta line, and an
  `N OVERDUE` counter beside the tray header.
- Weekend columns render at 0.55fr — mostly-empty days stop taxing weekday legibility.

## Handoff guardrails

- Only tokens used; the two busy tints (above) are the only new values.
- Screens are self-contained; the shell only passes tweak state
  (`week`, `drag`, `outlook`, `apple`, `mobileSheet`) + a toast callback.
- Reuses app primitives: `Button`, `IconBtn`, `Input`, `Check`, `Pill`, `Menu`, `TopTabs`,
  `Toast` from `src/primitives.jsx`, icons from `src/icons.jsx`.
