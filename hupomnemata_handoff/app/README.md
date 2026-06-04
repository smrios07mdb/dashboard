# Handoff: hupomnemata — Dashboard Redesign

## Overview
**hupomnemata** is a personal productivity dashboard. Tasks are organized into two
top-level categories (**Work** / **Personal**), each containing subcategories that hold
individual tasks with time estimates. The app has four tabs: **Dashboard**, **Routines**,
**Insights**, **Settings**, plus a **Login** screen and several action **Sheets**.

This handoff documents a complete visual redesign: a **bright, colorful, lightly
gamified** product (warm-but-clean light canvas, editorial serif titles + monospace
labels, a vivid action button, and a subtle game layer — progress ring, streaks, XP,
levels — built to make the user *want* to check in daily).

## About the Design Files
The files in this bundle are **design references created in HTML/React-via-Babel** —
prototypes showing intended look and behavior, **not production code to copy directly**.
The task is to **recreate these designs in the target codebase's environment** (the team's
notes point to React + TypeScript + Tailwind + shadcn/ui) using its established patterns,
routing, state, and data layer. Where this README and the older `DESIGN_NOTES.md` conflict,
**this README wins for all visual/color/type values** — the prototype was substantially
restyled after those notes were written.

> ⚠️ **`DESIGN_NOTES.md` (in the project root) is partially stale.** It describes the
> original *dark "Obsidian"* theme with `jade #4cc8a3` + `coral #ff7d6b`, an `ice` accent,
> and advises *against* gamification. The product has since moved to a **light theme with
> emerald/rose categories, a vivid button, and an intentional (tasteful) gamification
> layer**. Use `DESIGN_NOTES.md` only for the still-accurate **architecture/interaction**
> sections (§2 Interaction Patterns, §3 Empty States, §4 Connectivity, §5 Breakpoints,
> §6 Component Inventory, §8 "What's NOT in the prototype"). Ignore its color/type/§9 advice.

## Fidelity
**High-fidelity (hifi).** Final colors, typography, spacing, radii, shadows, and
interactions are all specified below as exact values. Recreate the UI pixel-faithfully
using the codebase's component library, then map the tokens below onto its theme system.

## Screenshots
Reference renders of the current design live in `screenshots/`:
```
01-login.png        Login / magic-link
02-dashboard.png    Dashboard — hero + Work/Personal columns (the signature screen)
03-routines.png     Routines — Morning/Night panels + 14-day dot grids
04-insights.png     Insights — stat cards, trend chip, stacked-bar chart
05-settings.png     Settings rows
06-whats-next.png   "What's next?" AI triage sheet
```
These reflect the **default** look: Daylight theme, Emerald & Rose categories, purple
spark button, serif display titles. Treat them as the visual source of truth alongside the
token values below.

---

## Design Tokens

All tokens are CSS custom properties defined at the top of `index.html`. Map them 1:1 onto
Tailwind CSS-variable theme tokens. **The default theme is "Daylight" (light).** Other
themes (Meadow / Blush / Porcelain / Espresso-dark) are optional and switch via a
`data-aesthetic` / `data-mode` attribute on the page root — ship Daylight first.

### Color — Daylight (default)
```
/* Surfaces */
--bg            #f6f4f7   /* page background (a soft, near-neutral white) */
--bg-alt        #eceaef   /* track fills, hover surfaces, progress backgrounds */
--surface       #ffffff   /* cards, sheets, dialogs */
--surface-2     #f8f6fa   /* nested/secondary surface */
--line          rgba(38,32,46,.09)   /* hairline borders */
--line-strong   rgba(38,32,46,.16)   /* stronger borders, input outlines */

/* Ink (text scale) */
--ink           #221f28   /* primary text */
--ink-2         #635f6c   /* secondary text */
--ink-3         #948f9e   /* hints, captions */
--ink-4         #c7c2d0   /* placeholder, disabled */

/* Focal accent (swappable via Tweaks "accent": forest default) — see ApplyAccent below */
--accent        #1f5142   /* base value; runtime-overridden by accent swatch */
--accent-soft   rgba(31,81,66,.10)
--accent-ink    #1f5142

/* Status */
--destructive       #b8462e
--destructive-soft  rgba(184,70,46,.13)
--warn          #d98a1c
--good          #11a06e
--offline       #b0a593
```

### Category colors — load-bearing identity
The two category colors are the most visible color decision in the app. They are driven
by a **`data-catpalette`** attribute on the page root. **The current/default pairing is
`emerald` (Emerald + Rose).**

```
/* data-catpalette="emerald"  ← DEFAULT */
--work          #059669   --work-soft     rgba(5,150,105,.14)     /* Work = emerald */
--personal      #f43f5e   --personal-soft rgba(244,63,94,.14)      /* Personal = rose */

/* Other selectable pairings (Tweaks → "Category palette"): */
indigo : --work #4f46e5 / --personal #f43f5e   (Indigo & Rose)
azure  : --work #2563eb / --personal #f97316   (Azure & Tangerine)
violet : --work #7c3aed / --personal #ec4899   (Violet & Magenta)
```
`catColor(name)` → `--work` for "Work", `--personal` for "Personal".
`catSoft(name)`  → the matching `*-soft`.
Category column header titles, "N OPEN" pills, card top-borders, and the hero progress
bars all derive from these.

### Jewel palette (Insights chart bars + per-subcategory dots)
```
--jewel-sapphire  #2f6bf0
--jewel-amethyst  #7a4ff5
--jewel-coral     #f2552f
--jewel-citron    #c8a017
--jewel-jade      #11a06e
--jewel-rose      #e83f93
--jewel-teal      #14a6bd
--jewel-gold      #e0982a
```
Each subcategory is assigned a stable jewel hue by hashing its id (`subColor(id)` in
`src/gamify.jsx`). The Insights stacked-bar chart rolls Work-side bars through
green/teal jewels and Personal-side through coral/rose/gold. When the "Color pop" tweak
is set to **calm**, subcategory dots fall back to the parent category color instead.

### "What's next?" button gradient (`--spark-*`)
The primary CTA uses a switchable gradient via **`data-spark`** on the page root.
**Default = `purple`.** White text on all presets except Lime, which uses dark ink.
```
purple   (DEFAULT): linear-gradient(135deg,#b249f5,#8b3df0,#6d28d9)  glow rgba(139,61,240,.55)  ink #fff
lime              : linear-gradient(135deg,#d4f87a,#a3e635,#65d10e)  glow rgba(132,204,22,.55)  ink #1a2e05
aurora            : linear-gradient(135deg,#7c3aed,#e0218a,#ff7a18)  glow rgba(224,33,138,.50)  ink #fff
electric          : linear-gradient(135deg,#4f46e5,#9b30e0,#fb2576)  glow rgba(155,48,224,.52)  ink #fff
sunset            : linear-gradient(135deg,#ff2d78,#ff5a5f,#ffb020)  glow rgba(255,90,95,.52)   ink #fff
ocean             : linear-gradient(135deg,#2563eb,#06b6d4,#7c3aed)  glow rgba(6,182,212,.52)   ink #fff
```
Button: `background: var(--spark-grad)`, `color: var(--spark-ink)`, weight 700,
`box-shadow: inset 0 1px 0 rgba(255,255,255,.30), 0 6px 20px -5px var(--spark-glow)`.

### Radii
```
--radius-sm  4px    /* tags, edge accents */
--radius     7px    /* inputs, buttons, small chips */
--radius-md  11px   /* cards, sheets */
--radius-lg  16px   /* hero card, routine panels */
```

### Elevation (neutral, soft)
```
--shadow-sm  0 1px 2px rgba(30,26,40,.06)
--shadow-md  0 2px 5px rgba(30,26,40,.05), 0 14px 30px -12px rgba(30,26,40,.16)
--shadow-lg  0 30px 70px -16px rgba(26,22,36,.26)
```

### Typography
```
--font-ui       'Inter'            /* all body, controls, nav */
--font-display  'Newsreader' serif /* page titles, hero greeting, wordmark, category titles */
--font-serif    'Newsreader'       /* same family */
--font-mono     'IBM Plex Mono'    /* numbers, durations, uppercase tracked labels */
```
- Google Fonts: `Inter` (300–800), `Newsreader` (400/500/600, incl. italic), `IBM Plex Mono` (400/500/600).
- The **`.title`/`.display`** classes use `--font-display` at weight 500 with negative
  letter-spacing (`-.012em` to `-.02em`). Page titles run **large** (e.g. Insights/Routines
  `h1` ≈ 40px; hero greeting ≈ 27–28px; category titles ≈ 31px).
- The **`.label`** utility — Plex Mono, ~9–10px, weight 500, `letter-spacing:.16em`,
  uppercase, color `--ink-3` — does heavy structural work (kickers, "TODAY", section
  labels). Treat it as a primitive.
- **`.num`** = `--font-mono` for any numeric value (estimates, durations, XP, counts, %).
- A **"type pairing"** tweak swaps `--font-display`: `serif` (Newsreader, default in this
  build), `sans` (Inter), or `mono` (labels lean mono). Ship the serif display titles —
  they're the editorial signature.

### Density
```
comfortable (default): --row-h 36px   --row-pad 9px 12px   --sec-gap 18px
compact              : --row-h 30px   --row-pad 5px 10px   --sec-gap 12px
```

### Background glow wash (Daylight)
A fixed, non-interactive `body::before` paints three soft radial gradients (top-left
`--jewel-amethyst` ~20%, top-right `--jewel-rose` ~17%, bottom-center `--jewel-sapphire`
~14%) at `opacity:.6`. It's decorative; keep it behind content (`z-index:0`, content at
`z-index:1`). Do **not** reintroduce a green/coral wash over a warm-cream base — that
combination read as muddy "khaki" and was explicitly rejected.

### Runtime accent override (`ApplyAccent`)
A small effect writes `--accent` / `--accent-soft` / `--accent-ink` from the chosen accent
swatch. Options and values:
```
forest (default): #1f5142   terracotta: #bb4f2c   plum: #774063   ink: #2c2620
```
`--accent` colors the active nav-tab underline, the level/secondary chips, focus states,
and other non-category focal touches.

---

## Screens / Views

### 1. Login (`src/screens/login.jsx`)
- **Purpose:** Magic-link sign-in.
- **Layout:** Centered column, max ~ 380px. Serif wordmark "hupomnemata." (with an
  emerald `--work` dot) above a `--font-mono` tracked tagline "PERSONAL · QUIET · YOURS".
  Below: a `--surface` card (`--radius-lg`, `--shadow-md`) holding the form.
- **States:** (a) email input + "Send magic link" button; (b) "Check your email" success
  state with the submitted address. Titles use the serif display at ~27px.

### 2. App header (in `src/app.jsx`)
- Sticky, `background: color-mix(in srgb, var(--bg) 82%, transparent)` + `backdrop-filter:
  blur(14px)`, hairline bottom border, faint shadow.
- Left: serif wordmark **hupo** + emerald `.` dot.
- Center: top tabs (Dashboard / Routines / Insights / Settings). Active tab = `--ink`
  text weight 600 with a **2px `--accent` underline** (`left/right:14px, bottom:-1px`);
  inactive = `--ink-3`, brighten to `--ink` on hover.
- Right: `<SyncBadge>` (status dot + label) and an avatar circle.
- On mobile (<640px) the tabs move to a bottom nav.

### 3. Dashboard (`src/screens/dashboard.jsx` + hero in `src/gamify.jsx`)
The landing screen. Top = a **Daily Progress Hero** (when `hero` tweak is on) or a compact
**Today strip** (when off). Below = a two-column grid: **Work** | **Personal**.

**Daily Progress Hero** (`DailyHero` in `gamify.jsx`):
- Card: `linear-gradient(135deg, --surface, --surface-2)`, `--radius-lg`, `--shadow-md`,
  with two faint radial glows (work + personal) bleeding in from the corners.
- **Progress ring** (`ProgressRing`): 88px, 9px stroke. Track = `--bg-alt`. A faint
  full-circle `--work`→`--personal` gradient tint (opacity .16) sits under a brighter
  animated progress arc (same gradient, `stroke-linecap:round`, `drop-shadow` glow). Center
  shows `NN%` (mono) + a `.label` "today". Arc animates from 0 on mount (1.1s ease).
- Greeting: time-aware ("Good morning/afternoon/evening, Sam") in serif display ~28px.
- Chips row: **streak** (flame `--jewel-gold`-ish + "N days", amber-tinted pill),
  **level** ("LVL N" + animated XP count-up + "xp", amethyst-tinted pill). Then an
  encouraging line + a thin **level-progress sliver** (amethyst→sapphire gradient).
- Action: a two-segment pill — numeric "I have ⟨90⟩ min" input fused with the
  **"What's next?"** spark button (see `--spark-*`).
- Footer: **Work** and **Personal** progress bars (`CatBar`), each `done/total` with an
  animated fill in the category color + soft glow.

**Today strip** (compact alternative, `TodayStrip` in `dashboard.jsx`): single rounded
bar — "TODAY · N open · Xh Ym · SHOW/HIDE done" on the left, the "I have ⟨⟩ min +
What's next?" control on the right.

**Category column** (`CategoryColumn`):
- Full-bleed header (not a card): a tall rounded color bar (`catColor`, with glow) + the
  category title in serif display ~31px **colored with `catColor`** (emerald Work / rose
  Personal) + a **filled** "N OPEN" pill (solid `catColor`, white text, soft shadow) +
  total time (mono) + a chevron `IconBtn`. Whole header is clickable → drill into category.
- Below: a `--surface` card, **3–4px top border in `catColor`**, `--radius-md`,
  `--shadow-md` + a colored drop-glow, and a faint top-down `catColor` wash (~11% → transparent over 140px).
- Card contains **subcategory sections** (`SubcatSection`), each:
  - Header row: chevron, a **colored dot** (`subColor(id)` jewel, with a soft ring),
    subcategory name, open-count, total minutes, "+ New task" / three-dot menu.
  - Expanded: task rows (`TaskRow`).
  - A "+N COMPLETED" reveal when completed tasks are hidden.
- Footer: "+ ADD SUBCATEGORY".

**Task row** (`TaskRow`):
- Grid: `[24px checkbox] [title 1fr] [estimate] [bell] [trash] [⋯]`, row padding from
  `--row-pad`, hairline bottom border, hover → `--bg-alt`.
- **Priority 1** (and not completed): a **3px `--destructive` left edge** with reduced
  left padding (not a dot).
- Completed: row fades to ~.5 opacity, title strikethrough.
- **Completion celebration** (when `celebrate` ≠ off): the checkbox **springs**
  (`checkPop`), the row **flushes** its category color (`rowFlush`, fades to transparent),
  and a **"+XP" floater** rises and fades (`xpFloat`). The just-completed row **lingers
  ~1.1s** before being hidden so the animation can play. Completing several quickly fires
  an **"On a roll ×N"** badge (`comboPop`, bottom-center). **No confetti** — it was
  explicitly removed; do not add particle bursts.

### 4. Routines (`src/screens/routines.jsx`)
- Title "Routines" (serif ~40px) + mono kicker "DAILY RITUALS · STREAKS"; a "Dark mode"
  toggle button sits top-right.
- Two panels (`RoutinePanel`): **Morning** and **Night**, side by side (single column
  on mobile). Each `--surface`, `--radius-md`, `--shadow-md`, 22px padding.
- Each panel has an **accent token**: Morning = `--jewel-gold`, Night = `--jewel-amethyst`
  (matches the purple button + level system). The accent colors the **icon badge** (sun/
  moon in a soft-tinted circle), the **streak chip** (flame + "N days", or mono "START
  TODAY" when streak is 0), and the **"All done for today" banner**.
- Item rows: 20px `<Check>` + label; completed = `--ink-3` strikethrough.
- Edit mode: grip handle + inline rename + remove, plus an "Add a new item…" input.
- **14-day dot grid** (`DayGrid`): 14 circles. `full` = solid panel accent with a soft
  glow; `partial` = accent at 28%; `empty` = `--bg-alt`; `faded` (before item existed) =
  dashed hairline. Today's cell gets a 2px `--ink` outline. Day-of-week letters below in mono.

### 5. Insights (`src/screens/insights.jsx`)
- Title "Insights" (serif ~40px) + mono kicker "WHERE THE TIME WENT". A **trend chip**
  ("▲ +N% vs first half", or ▼) sits at the right — `--work-soft`/green when ≥0, neutral
  when negative. It's computed from the data (second-half daily avg vs first-half), not a
  static figure.
- **Headline stat cards**: a 1px-gap grid of 4 cells (Last 30 days total, Daily average,
  Active subcategories, Most-touched) inside one rounded bordered container with
  `--shadow-md`. Each cell has a thin colored top accent; value in serif display, label in mono.
- **Range toggle** (7 / 30 / 90 days) + **segment filter** (All / Work / Personal) as
  pill segmented controls.
- **Stacked bar chart** (custom SVG): one bar per day, segmented by subcategory using the
  jewel palette, y-axis gridlines/labels in minutes. Below: a summary table by subcategory.
- Empty state (`totalMinutes === 0`): centered "No time logged yet" card.

### 6. Settings (`src/screens/settings.jsx`)
- Stacked `SettingsRow` items (title + hint + control). Includes Appearance ("Light by
  default. A warm dark mode is there if you want it."), Completed-tasks Hide/Show,
  Calendar status with a (prototype-only) Simulate-fail/Restore control, Notifications
  gating, timezone, etc. Inherits all tokens; no bespoke colors.

### 7. Sheets & dialogs (`src/sheets/sheets.jsx`)
- **`<Sheet>`**: right-side slide-in (bottom sheet on mobile), `--surface`,
  `box-shadow:-1px 0 0 var(--line), var(--shadow-lg)`, veil `rgba(40,28,14,.30)` +
  `backdrop-filter:blur(3px)`.  *(Veil tint is a legacy warm value; fine to neutralize to
  match the new ink-based shadows.)*
- **"What's next?" AI triage** lives in a Sheet from the hero/Today strip. Recommendations
  each render with the category color as a 3px left edge. (Prototype synthesizes the
  response after ~900ms; wire to the real API in production.)
- **`<Dialog>`**: centered modal, `--surface`, `--radius-md`, `--shadow-lg`.
- **`<Menu>`**: three-dot dropdown.

---

## Interactions & Behavior
- **Tab navigation** is state-based in the prototype → use the router in production
  (`/category/:id`, `/category/:id/subcategory/:id`).
- **Drill-down:** single chevron tap, or double-click the category header (desktop).
- **Hide-completed:** persisted preference, default on; per-section "+N COMPLETED" reveal.
- **Completion animations:** `checkPop` (.34s spring), `rowFlush` (.75s), `xpFloat` (1s),
  `comboPop` (1.5s). All gated by the `celebrate` tweak (full / subtle / off). The
  XP **count-up** uses an interval tween (not rAF) so it always converges even off-screen.
- **Progress/level/streak** are derived client-side in `gamify.jsx`
  (`calcStats`, `calcStreak`, `catProgress`, `taskXP = 10 + estimateMinutes`,
  `level = 1 + floor(xp/300)`). Re-derive against real data server- or client-side.
- For the deeper interaction/connectivity/empty-state/breakpoint specs (sync states,
  CalDAV banner, notification gating, responsive rules), see the still-accurate sections
  of `DESIGN_NOTES.md` (§2–§6, §8).

## Tweak axes (prototype-only controls → drop or productize as you see fit)
The prototype exposes a Tweaks panel; these are **design exploration toggles**, not
required product features. Defaults shipped: `aesthetic=daylight`, `accent=forest`,
`pairing=mono/serif`, `density=comfortable`, `mode=light`, `celebrate=full`,
`colorPop=vibrant`, `hero=on`, **`spark=purple`**, **`catPalette=emerald`**.
The two worth keeping as real settings: **Category palette** and possibly **Button glow**.

## State Management (to build in production)
Tasks, subcategories, categories, routine items + logs, settings. Derived: per-category
progress, daily completion ratio, XP/level, streaks, Insights time-series. The prototype's
fixtures live in `src/data.jsx` and show the expected shapes.

## Assets
- **Fonts:** Google Fonts — Inter, Newsreader, IBM Plex Mono (see the `<link>` in `index.html`).
- **Icons:** inline SVG components in `src/icons.jsx` (18×18 default, sized via an `s`
  prop) — sun, moon, flame, sparkles, check, chevrons, bell, trash, grip, plus, x, etc.
  Replace with the codebase's icon set (e.g. lucide-react) matching these glyphs.
- No raster image assets. `uploads/` contains a reviewer screenshot only — not used in the UI.

## Files (in this bundle)
```
index.html               ← all design tokens (the :root + theme blocks) + font links + app mount
src/app.jsx              ← app shell, header, tab routing, ApplyAccent, Tweaks wiring, page data-attrs
src/gamify.jsx           ← DailyHero, ProgressRing, CountUp, CatBar, streak/XP/level math, animations CSS
src/screens/dashboard.jsx← Dashboard: TodayStrip, CategoryColumn, SubcatSection, TaskRow (+ completion FX)
src/screens/routines.jsx ← Routines: RoutinePanel, DayGrid (gold/amethyst accents)
src/screens/insights.jsx ← Insights: stat cards, trend chip, SVG stacked-bar chart, summary table
src/screens/category.jsx ← Category drill-down
src/screens/subcategory.jsx ← Subcategory drill-down (bulk-select)
src/screens/settings.jsx ← Settings rows
src/screens/login.jsx    ← Login / magic-link
src/sheets/sheets.jsx    ← Sheet, Dialog, Menu, "What's next?" AI triage, block-time
src/primitives.jsx       ← Button, IconBtn, Input, Check, Pill, SyncBadge, TopTabs, BottomTabs, Toast, catColor/catSoft/fmtMin
src/icons.jsx            ← inline SVG icon set
src/data.jsx             ← mock fixtures (expected data shapes)
DESIGN_NOTES.md          ← ORIGINAL notes — accurate for architecture/interaction (§2–§6,§8); STALE for color/type
```

*This prototype is a visual reference. Component names, the shape of state, and the exact
CSS values above are authoritative for the look. Implementation choices (routing, dnd,
data sync, AI/calendar integration) are the engineering team's to make.*
