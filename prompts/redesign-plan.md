# Hupomnemata Redesign — Chunked Build Plan

This is the rework of `hupomnemata_handoff/CLAUDE_CODE.md`, restructured into a serial chunk
program. Run **one chunk per Claude Code session** from the repo root; ship → deploy →
on-device verify → flip the PROGRESS row before starting the next. No chunk depends on a later one.

The **Shared Foundation** below is the context every chunk inherits — it carries forward (and
corrects) the non-negotiables from the original prompt. When each chunk's runnable prompt is
generated, this foundation is prepended so the chunk stands alone.

---

## Shared Foundation (every chunk inherits this)

**What this is.** A complete visual redesign of an existing, shipped app — rebuilt in our
**React + TypeScript + Tailwind + shadcn/ui** codebase. The design references live in
`hupomnemata_handoff/`. Do not copy the prototype's React-via-Babel files verbatim; rebuild
them as idiomatic components in our patterns.

**This is a re-skin, not a rebuild.** The data layer, Supabase auth/realtime, react-router
routes (`/category/:id`, `/category/:id/subcategory/:id`), @dnd-kit drag-and-drop, the
"What's next?" AI triage (model **`claude-haiku-4-5`**), the CalDAV proxy + connectivity
states, and the PWA service worker / manifest / Web Push are **already built and shipped
(through chunk ~20)**. Do **not** rebuild them. Each chunk maps new UI onto the existing
state, routing, and services. Touch backend/logic only where a chunk explicitly says so.

**Token source of truth.** Lift the full `:root` token set from
`hupomnemata_handoff/app/index.html` into our Tailwind theme as CSS variables — surfaces, ink
scale, radii (4 / 7 / 11 / 16), the three shadow steps, density vars, and the type stack.
**Daylight is the default theme.** When a value is ambiguous, the rendered HTML and
screenshots win over prose.

**Category colors (load-bearing identity).** Default `emerald` palette from `index.html`:
**Work = emerald `#059669`**, **Personal = rose `#f43f5e`** (plus their `*-soft` variants).
> The original prompt listed `#11a06e` / coral `#f2552f` as "non-negotiable" — those are the
> `--jewel-jade` / `--jewel-coral` values, not the category palette. Use `#059669` /
> `#f43f5e`. Take the logomark **point** color from `brand/README.md`, not from the prompt.

**Typography signature.** Newsreader (serif, 500, negative tracking) for display titles +
wordmark; the IBM Plex Mono `.label` primitive (~10px, `.16em`, uppercase, `--ink-3`) and
`.num` mono for every figure; Inter for UI. These carry the editorial tone — keep them.

**Tone.** Quiet, unhurried. No exclamation marks, no confetti / particle bursts, no gradients
on UI chrome. The one vivid moment is the "What's next?" spark button (default purple gradient).

**Reading order for any chunk:** `hupomnemata_handoff/README.md` → `brand/README.md` →
`app/README.md` (the authoritative visual spec) → `app/DESIGN_NOTES.md` **§2–§6 and §8 only**
(architecture / interaction; ignore its color/type advice — it documents an abandoned dark
theme) → the prototype source in `app/src/` + the renders (`app/index.html`,
`app/screenshots/`, `brand/reference/`).

**Guardrail.** Recreate only what's in the handoff. Ask before adding any screen, section, or
copy that isn't there.

**Per-chunk done bar.** Matches its reference render / screenshot; uses theme tokens (not
hardcoded hexes); wired onto the real data / routing / services; builds clean; verified
on-device; PROGRESS row ☑.

---

## Shipping strategy

Foundation chunks (1–3) restyle the existing app cohesively, app-wide; screen chunks (4+) each
change one screen and leave the rest intact — so the app stays usable in production at every
step. If you'd rather not show the half-migrated look on the live site, run the whole series on
a `redesign` branch and merge once the last chunk verifies.

---

## Chunks

### Phase A — Foundation

**Chunk 1 — Design tokens + fonts**
- **Goal:** the new theme exists in Tailwind; the app renders in Daylight colors / type.
- **Depends on:** nothing.
- **In scope:** port `index.html` `:root` (+ theme blocks) to Tailwind CSS vars — surfaces,
  ink scale, `--line` / `--line-strong`, status colors, category palette (emerald default),
  jewel palette, spark gradients, radii, the three shadows, density vars; wire Google Fonts
  (Inter / Newsreader / IBM Plex Mono); add the `.label` / `.num` / `.title` utility classes;
  the fixed `body::before` background glow wash; scaffold the
  `data-aesthetic` / `data-mode` / `data-catpalette` / `data-spark` root attributes +
  `ApplyAccent` effect (defaults only).
- **Out of scope:** any component or screen restructuring; non-default themes beyond scaffolding.
- **Exit:** theme compiles; a throwaway token check renders correct colors / type / shadows;
  the existing app still builds and runs.

**Chunk 2 — Brand: logomark + favicons + manifest**
- **Goal:** the `HupoMark` component + all brand assets wired in.
- **Depends on:** Chunk 1.
- **In scope:** build `HupoMark` as inline SVG from the canonical geometry in `brand/README.md`
  (100-unit grid, stroke 11, round caps, point at 76,74.5 r5.6; glyph = ink, only the point
  carries color; drop the point below 16px); ship `brand/assets/*` favicons / app-icons into
  `public/`; update `index.html` head + web manifest exactly as `brand/README.md` specifies.
- **Out of scope:** placing the mark in header / login (their own chunks — the component just
  needs to exist).
- **Exit:** favicons render in browser + installed PWA; HupoMark renders correctly across
  sizes incl. the <16px point-drop.

**Chunk 3 — Shared primitives → shadcn**
- **Goal:** the reusable UI vocabulary in the new style.
- **Depends on:** Chunk 1.
- **In scope:** map the prototype's `primitives.jsx` to shadcn/ui per `DESIGN_NOTES.md §6` —
  Button, IconBtn, Input, Check, Pill, SyncBadge, TopTabs, BottomTabs, Toast — plus Sheet,
  Dialog, and Menu (from `sheets.jsx`), and the helpers `catColor` / `catSoft` / `fmtMin`.
  Replace prototype icons with lucide-react matching the `icons.jsx` glyphs.
- **Out of scope:** screen-specific composition; the "What's next?" triage content (Chunk 12).
- **Exit:** a primitives showcase renders each element in the new style; no screen regressions.

### Phase B — Frame

**Chunk 4 — App shell + header + responsive nav**
- **Goal:** the frame that holds every screen, re-skinned onto existing routing.
- **Depends on:** Chunks 1–3.
- **In scope:** re-skin the `app.jsx` shell — sticky blurred header (serif wordmark + emerald
  HupoMark dot, top tabs with the 2px `--accent` underline, `SyncBadge`, avatar); bottom nav
  below 640px; wire to the existing react-router setup.
- **Out of scope:** individual screen bodies; routing logic (already built).
- **Exit:** header + nav match the reference on desktop and mobile; tab navigation works
  against existing routes.

**Chunk 5 — Login**
- **Goal:** the magic-link screen in the new style.
- **Depends on:** Chunks 1–3.
- **In scope:** re-skin `login.jsx` — centered ~380px column, serif wordmark + emerald dot,
  mono tagline, `--surface` card with email input + "Send magic link", "Check your email"
  success state; wire to the existing Supabase magic-link auth.
- **Out of scope:** auth backend (already built).
- **Exit:** matches `01-login.png`; magic link still works end-to-end.

### Phase C — Core screens

**Chunk 6 — Dashboard I: gamify + Daily Progress Hero**
- **Goal:** the hero and the game layer, deriving from real data.
- **Depends on:** Chunks 1–4.
- **In scope:** rebuild `gamify.jsx` — `ProgressRing` (88px, 9px stroke, gradient arc
  animating from 0), `CountUp` (interval tween), `CatBar`, the streak + level chips and level
  sliver, the time-aware greeting, and the fused "I have ⟨N⟩ min + What's next?" pill (spark
  gradient, default purple). Derive progress / XP / level / streak from real data
  (`taskXP = 10 + estimateMinutes`, `level = 1 + floor(xp/300)`). Also build the compact
  **Today strip** alternative.
- **Decision — Today view:** the redesign is two-column (Work | Personal); chunk-19's Today
  *column* and per-row Sun toggle are not in the handoff. **Recommended default:** retire the
  Today column + Sun toggle, and keep `planned_for` to feed the hero ring `%` and the Today
  strip's "N open / total min." Confirm or override before building this chunk.
- **Out of scope:** the Work / Personal columns + task rows (Chunk 7); wiring "What's next?"
  to the API (Chunk 12) — the button just opens the existing sheet here.
- **Exit:** hero matches the `02-dashboard.png` hero region; ring / counts animate; all
  figures derive from real data.

**Chunk 7 — Dashboard II: columns, subcategories, task rows + completion FX**
- **Goal:** the signature two-column body.
- **Depends on:** Chunks 3, 6.
- **In scope:** `CategoryColumn` (full-bleed colored header → drill-down), `SubcatSection`
  (jewel dot via `subColor`, counts, "+ New task" / three-dot menu, "+N COMPLETED" reveal),
  `TaskRow` (grid `[checkbox][title][estimate][bell][trash][⋯]`, priority-1 `--destructive`
  left edge, completed fade / strikethrough, completion celebration: `checkPop` / `rowFlush`
  / `xpFloat` / "On a roll ×N" `comboPop` — **no confetti**). Two-column Work | Personal
  layout. Wire onto existing data + @dnd-kit (desktop only). **Implement the Today decision
  from Chunk 6 here.**
- **Out of scope:** drill-down screens (Chunk 11).
- **Exit:** matches `02-dashboard.png`; completion FX play; dnd works; Today decision implemented.

**Chunk 8 — Routines**
- **Goal:** the routines screen on real logs.
- **Depends on:** Chunks 1–3.
- **In scope:** re-skin `routines.jsx` — Morning / Night `RoutinePanel` (gold / amethyst
  accents, icon badge, streak chip, "all done" banner), 14-day `DayGrid` (full / partial /
  empty / faded states, today outline), edit mode (rename / remove / add); wire to existing
  routine state + logs.
- **Out of scope:** routine data model (already built).
- **Exit:** matches `03-routines.png`; streaks / grids derive from real logs.

**Chunk 9 — Insights**
- **Goal:** the analytics screen on real time-series.
- **Depends on:** Chunks 1–3.
- **In scope:** re-skin `insights.jsx` — 4 headline stat cards, the computed trend chip
  (second-half vs first-half daily avg), range (7 / 30 / 90) + segment (All / Work / Personal)
  toggles, the custom SVG stacked-bar chart (jewel palette), the summary table, and the empty
  state; wire to existing data.
- **Out of scope:** none beyond reusing existing data.
- **Exit:** matches `04-insights.png`; chart + trend reflect real data.

**Chunk 10 — Settings**
- **Goal:** the settings list re-skinned.
- **Depends on:** Chunks 1–3.
- **In scope:** re-skin `settings.jsx` — `SettingsRow` items (Appearance / dark-mode,
  hide-completed, calendar status + the prototype's simulate-fail control, notifications
  gating, timezone); wire to existing settings state. Ship the two surviving Tweaks axes —
  **Category palette** and (optionally) **button glow** — as real settings; hardcode every
  other Tweaks default.
- **Out of scope:** the full Tweaks panel (dropped). The dark/Appearance toggle UI ships here,
  but the Espresso-dark theme itself is an optional fast-follow (see below) — wire the toggle
  once that theme exists.
- **Exit:** matches `05-settings.png`; toggles persist; category-palette switch works.

### Phase D — Drill-downs + interactions

**Chunk 11 — Category + Subcategory drill-down screens**
- **Goal:** the drill-down routes in the new style.
- **Depends on:** Chunks 3, 7.
- **In scope:** re-skin `category.jsx` and `subcategory.jsx` (incl. bulk-select) onto the
  existing `/category/:id` + `/category/:id/subcategory/:id` routes.
- **Out of scope:** routing (already built).
- **Exit:** drill-down screens match the system; routing + bulk-select work.

**Chunk 12 — "What's next?" AI triage sheet + block-time**
- **Goal:** the triage UI wired to the existing model.
- **Depends on:** Chunks 3, 6.
- **In scope:** build the "What's next?" triage Sheet (recommendations rendered with the
  category color as a 3px left edge) and the block-time sheet; wire to the **existing**
  `claude-haiku-4-5` triage endpoint — do not rebuild the call.
- **Out of scope:** the AI backend (already built).
- **Exit:** matches `06-whats-next.png`; triage calls the existing API; recommendations render.

---

## Optional fast-follows (after Chunk 12, not part of the core series)

- **Espresso-dark theme** + the other optional palettes (Meadow / Blush / Porcelain).
  `app/README.md` says ship Daylight first, so these come last. The dark-mode toggle UI ships
  in its chunk; point it at the theme switch once the dark theme is built.
- Anything the handoff flags as nice-to-have but not in the screenshots.

---

## Per-chunk rhythm

Build (Claude Code) → review output against this plan → commit → deploy (GitHub Pages) →
on-device verify → Cowork flips the PROGRESS row ☑ → next chunk. PROGRESS row numbering
(continue at 21, or a `redesign-N` series) is yours to assign at closeout.
