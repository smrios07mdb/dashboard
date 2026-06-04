# Claude Code Prompt — Build Hupomnemata

> Paste everything below the line into Claude Code from the root of your app repo, with
> this `hupomnemata_handoff/` folder copied in (or its path adjusted). It's written to be
> run as a single instruction; Claude Code should read the referenced files itself.

---

You are building **Hupomnemata**, a calm, dignified personal task manager (Greek
*hupomnḗmata*, "the private notebooks the Stoics kept"). A complete design handoff lives in
`./hupomnemata_handoff/`. Treat it as the source of truth and recreate it in this codebase
using our **React + TypeScript + Tailwind + shadcn/ui** stack — do not copy the prototype's
React-via-Babel files verbatim; rebuild them as idiomatic components in our patterns.

## Read first (in this order)
1. `hupomnemata_handoff/README.md` — overview + the shared token table + the stale-notes caveat.
2. `hupomnemata_handoff/brand/README.md` — the logomark and brand tokens.
3. `hupomnemata_handoff/app/README.md` — the authoritative visual spec for every screen.
4. `hupomnemata_handoff/app/DESIGN_NOTES.md` — **§2–§6 and §8 only** (architecture &
   interaction). Ignore its color/type advice; it documents an abandoned dark theme.
5. The prototype source in `hupomnemata_handoff/app/src/` and the rendered references
   (`hupomnemata_handoff/app/index.html`, `app/screenshots/`,
   `brand/reference/Hupomnemata Logo - Quiet.html`).

## Non-negotiables (get these exactly right)
- **Design tokens.** Lift the full `:root` token set from `app/index.html` into our Tailwind
  theme as CSS variables — surfaces, ink scale, radii (`4/7/11/16`), the three shadow steps,
  and the type stack (Inter / Newsreader / IBM Plex Mono). Daylight is the default theme.
- **The two category colors are identity:** `--work` emerald `#11a06e`, `--personal` coral
  `#f2552f`. The emerald is also the **logo's point**. Don't substitute or theme them away.
- **The logomark.** Build `HupoMark` as a small inline-SVG component from the canonical
  geometry in `brand/README.md` (100-unit grid, stroke 11, round caps, point at 76,74.5 r5.6).
  Glyph is always ink (`#eceaef` on dark); only the point carries color. Below 16px, drop the
  point. Wire up the favicons/app-icons from `brand/assets/` (ship those files as-is) and the
  web manifest exactly as `brand/README.md` specifies.
- **Typography signature:** serif (Newsreader 500, negative tracking) display titles, the
  Plex Mono `.label` primitive (≈10px, `.16em`, uppercase, `--ink-3`), and `.num` mono for
  every figure. These carry the editorial tone — keep them.
- **Tone.** Quiet and unhurried. No exclamation marks, no confetti/particle bursts, no
  AI-slop gradients on UI chrome. The one vivid moment is the "What's next?" spark button.

## Build scope
Implement all screens from `app/README.md`: **Login**, app **header** (wordmark + top tabs +
SyncBadge), **Dashboard** (Daily Progress Hero with progress ring / streak / XP / level, the
two-column Work | Personal layout, subcategory sections, task rows with priority edge and
completion animations), **Routines** (Morning/Night panels + 14-day dot grids), **Insights**
(stat cards, trend chip, stacked-bar chart), **Settings**, and the **Sheets/Dialogs**
(including the "What's next?" AI triage). Map the prototype primitives to shadcn/ui per the
component-inventory table in `DESIGN_NOTES.md §6`.

## What's ours to implement (not in the prototype — see `DESIGN_NOTES.md §8`)
react-router routes (`/category/:id`, `/category/:id/subcategory/:id`); real drag-and-drop
(@dnd-kit, desktop only); the data layer + state for tasks/subcategories/routines/settings;
the Anthropic API call behind "What's next?"; the CalDAV proxy + connectivity states; PWA
service worker, manifest, and Web Push. Derive progress/XP/level/streaks from real data using
the formulas in `app/README.md` (`taskXP = 10 + estimateMinutes`, `level = 1 + floor(xp/300)`).
The prototype's `src/data.jsx` shows the expected data shapes.

## Drop / productize, don't port
The prototype's **Tweaks panel** is a design-exploration tool, not a product feature. Ship the
defaults (Daylight, forest accent, serif display, emerald category palette, purple spark,
comfortable density) as fixed values. The only two axes worth keeping as real settings are
**Category palette** and possibly **button glow** — everything else, hardcode the default.

## Definition of done
Every screen matches its reference render and screenshot; tokens map 1:1 onto our Tailwind
theme; the logomark and favicons are wired in; the type and color systems are pixel-faithful;
routing, dnd, data, AI, and calendar integration use our codebase's real patterns. When a
value is ambiguous, the rendered HTML/screenshots win over prose. Ask me before adding any
screen, section, or copy that isn't in the handoff.
