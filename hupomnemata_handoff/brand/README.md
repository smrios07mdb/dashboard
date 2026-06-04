# Handoff: Hupomnemata — Logo & Brand Identity ("Quiet")

## Overview
This bundle contains the **Hupomnemata** logomark — codename **Quiet** — and the brand
tokens it lives inside. Hupomnemata (Greek: *hupomnḗmata*, "the private notebooks the Stoics
kept") is a calm, dignified, personal task manager. The mark is a humanist monoline lowercase
**h** trailed by an emerald **point** — literally the period of the existing wordmark
"hupomnemata." rendered as a symbol.

Use this package as the **brand cornerstone** for rebuilding the app's UX/UI: the logo, the
color tokens, the type system, and the spacing/elevation scale below are the single source of
truth. Everything you build should feel like it belongs next to this mark — quiet, editorial,
unhurried. No exclamation, no gloss, no AI-slop gradients on UI chrome.

## About the design files
The files in `reference/` are **design references authored in HTML/React** — a presentation
canvas showing the mark, its construction, colourways, app-icon and favicon treatments, and
the wordmark lockups. They are **not** production code to copy verbatim. Your job is to
**recreate these in the app's real environment** using its established patterns. The app today
is a React prototype (see the project's `src/` — `app.jsx`, `primitives.jsx`, `icons.jsx`,
`screens/`, `sheets/`). Recreate the mark as a small inline-SVG React component and wire the
tokens into the existing CSS-variable system.

The files in `assets/` **are** production-ready, hand-authored output — clean SVGs (pure
geometry, no font dependency) and rasterized PNG favicons/app-icons. Ship these directly.

## Fidelity
**High-fidelity (hifi).** Colors, geometry, and proportions are final. Match them exactly.
The mark is defined on a 100-unit grid; reproduce the coordinates and stroke weight precisely.

---

## The mark

A humanist monoline lowercase **h** — one stroke for the stem, one for the shoulder, soft
rounded terminals everywhere — followed by a filled circular **point** sitting on the baseline
to its right. The letter is *always* ink (or paper-on-dark); **only the point carries color.**

### Canonical SVG (ink glyph, emerald point)
```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100" height="100">
  <g fill="none" stroke="#221f28" stroke-width="11" stroke-linecap="round" stroke-linejoin="round">
    <path d="M24 21 L24 79"/>
    <path d="M24 53 Q24 36.5 42 36.5 Q60 36.5 60 53 L60 79"/>
  </g>
  <circle cx="76" cy="74.5" r="5.6" fill="#11a06e"/>
</svg>
```

### Construction (100-unit grid)
- **Grid:** 100 × 100 viewBox. The glyph + point are optically centered (content spans
  x ≈ 18.5 → 81.5).
- **Ascender line:** y = 21 · **x-height (shoulder top):** y = 36.5 · **baseline:** y = 79.
- **Stem:** vertical from (24, 21) to (24, 79).
- **Shoulder + leg:** from (24, 53) curve up-and-over `Q24 36.5 42 36.5 Q60 36.5 60 53`,
  then straight down to (60, 79).
- **Stroke weight:** 11 units. **Caps & joins:** round.
- **Point:** circle, center (76, 74.5), radius 5.6 — same diameter as the stroke, so it reads
  as the wordmark's period, resting on the baseline.

### React component (recreate in the app)
```jsx
function HupoMark({ size = 24, glyph = 'var(--ink)', point = 'var(--work)' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" role="img" aria-label="Hupomnemata"
         style={{ display: 'block' }}>
      <g fill="none" stroke={glyph} strokeWidth="11" strokeLinecap="round" strokeLinejoin="round">
        <path d="M24 21 L24 79" />
        <path d="M24 53 Q24 36.5 42 36.5 Q60 36.5 60 53 L60 79" />
      </g>
      <circle cx="76" cy="74.5" r="5.6" fill={point} />
    </svg>
  );
}
```
On dark surfaces pass `glyph="#eceaef"`. Below ~16px, omit the `<circle>` so the h stays clean.

### Clearspace & minimum size
- **Clearspace:** keep one stem-width (≈ the point's diameter, ~11 units / 11% of the mark
  box) clear on every side. Don't crowd it.
- **Minimum size:** 16px (favicon floor). It holds to 16px with the point; below that, drop
  the point and show the h alone.

### Colourways — the point only
| Use | Point color | Token |
|---|---|---|
| **Default** | Emerald `#11a06e` | `--work` |
| Reserved accent | Pine `#1f5142` | `--accent` |
| Reserved accent | Coral `#f2552f` | `--personal` |
| One-color / print | Ink `#221f28` (mono) | `--ink` |

The glyph never changes color (ink on light, `#eceaef` on dark). Don't recolor the h, don't
add a second color to it, don't apply gradients, don't outline it, don't rotate or skew it.

---

## Wordmark & lockups
The wordmark already exists in the app and is unchanged: **"hupomnemata"** set in Newsreader
500, `letter-spacing: -0.025em`, lowercase, followed by an **emerald period** (`--work`).
Tagline (optional, under stacked lockup): `PERSONAL · QUIET · YOURS` in IBM Plex Mono,
`letter-spacing: .22em`, color `--ink-3`.

- **Horizontal (primary):** mark · 1px hairline divider (`--line-strong`) · wordmark.
  Gap ≈ 0.5× mark height on each side of the divider. Mark and wordmark cap-heights aligned.
- **Stacked:** mark centered above wordmark above tagline.
- **App header (short):** small mark + short wordmark "hupo." — this is the in-app top-bar form.

See `reference/Hupomnemata Logo — Quiet.html` for all four lockups rendered, plus the app-icon
tiles and favicon proof.

---

## Favicon & app-icon integration
Drop `assets/` into the app's public/static root and add to `<head>`:
```html
<link rel="icon" type="image/svg+xml" href="/favicon.svg">
<link rel="icon" type="image/png" sizes="32x32" href="/favicon-32.png">
<link rel="icon" type="image/png" sizes="16x16" href="/favicon-16.png">
<link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png">
```
Web-app manifest:
```json
{
  "name": "Hupomnemata",
  "short_name": "Hupomnemata",
  "icons": [
    { "src": "/app-icon-light-512.png", "sizes": "512x512", "type": "image/png" },
    { "src": "/app-icon-dark-512.png",  "sizes": "512x512", "type": "image/png", "media": "(prefers-color-scheme: dark)" }
  ],
  "theme_color": "#f6f4f7",
  "background_color": "#f6f4f7"
}
```

---

## Design tokens (Daylight — the default theme)
These are the app's canonical CSS variables. Use these names; do not invent new ones. The app
also ships alternate aesthetics (Meadow / Blush / Porcelain) and category palettes that
override a subset — see the project's `index.html` `:root` for the full set. For a rebuild,
**Daylight is the default**; preserve the multi-theme structure (tokens overridden via
`[data-aesthetic]` / `[data-catpalette]` attributes on a root element).

### Color
| Token | Value | Role |
|---|---|---|
| `--bg` | `#f6f4f7` | app background |
| `--bg-alt` | `#eceaef` | sunken / secondary background |
| `--surface` | `#ffffff` | cards, sheets |
| `--surface-2` | `#f8f6fa` | nested surface |
| `--line` | `rgba(38,32,46,.09)` | hairline borders |
| `--line-strong` | `rgba(38,32,46,.16)` | dividers |
| `--ink` | `#221f28` | primary text / the glyph |
| `--ink-2` | `#635f6c` | secondary text |
| `--ink-3` | `#948f9e` | tertiary / labels |
| `--ink-4` | `#c7c2d0` | faint / disabled |
| `--accent` | `#1f5142` | deep pine — focal accent |
| `--accent-soft` | `rgba(31,81,66,.10)` | accent wash |
| `--work` | `#11a06e` | vivid emerald — work category **/ the logo point** |
| `--work-soft` | `rgba(17,160,110,.15)` | work wash |
| `--personal` | `#f2552f` | vivid coral — personal category |
| `--personal-soft` | `rgba(242,85,47,.15)` | personal wash |
| `--good` | `#11a06e` | success |
| `--warn` | `#d98a1c` | warning |
| `--destructive` | `#b8462e` | danger |
| `--offline` | `#b0a593` | offline/muted |

### Type
| Token | Stack | Use |
|---|---|---|
| `--font-ui` | `'Inter', ui-sans-serif, system-ui, sans-serif` | body, controls |
| `--font-display` / `--font-serif` | `'Newsreader', Georgia, serif` | titles, **wordmark** |
| `--font-mono` | `'IBM Plex Mono', ui-monospace, monospace` | labels, figures, tagline |

Key utility classes (from the app): `.title` (Newsreader 500, `-0.012em`), `.label` (Plex Mono
10px, `.16em`, uppercase, `--ink-3`), `.mono` (tabular figures), `.display` (Newsreader
`-0.015em`). Body is Inter 14px / 1.5 with `font-feature-settings:"ss01","cv11"`.

### Radius
`--radius-sm: 4px` · `--radius: 7px` · `--radius-md: 11px` · `--radius-lg: 16px`
(App-icon corner radius = 22.5% of tile size — iOS squircle approximation.)

### Elevation
- `--shadow-sm: 0 1px 2px rgba(30,26,40,.06)`
- `--shadow-md: 0 2px 5px rgba(30,26,40,.05), 0 14px 30px -12px rgba(30,26,40,.16)`
- `--shadow-lg: 0 30px 70px -16px rgba(26,22,36,.26)`

### Density
`--row-h: 36px` · `--row-pad: 9px 12px` · `--sec-gap: 18px`

---

## Files in this bundle
```
assets/
  hupomnemata-mark.svg          Primary — ink glyph + emerald point
  hupomnemata-mark-mono.svg     One-color (ink point)
  hupomnemata-mark-dark.svg     Light glyph for dark surfaces
  hupomnemata-mark-pine.svg     Pine point (reserved accent)
  hupomnemata-mark-coral.svg    Coral point (reserved accent)
  favicon.svg                   Scalable favicon (= primary mark)
  favicon-16.png  -32  -48  -64 Raster favicons (transparent)
  apple-touch-icon.png          180×180, light tile, baked rounded bg
  app-icon-light.svg / -512.png Light home-screen tile
  app-icon-dark.svg  / -512.png Dark home-screen tile
reference/
  Hupomnemata Logo — Quiet.html The full logo system canvas (open in a browser)
  marks.jsx                     Source of the mark component(s)
  design-canvas.jsx             Canvas harness (presentation only — not for production)
README.md                       This file
```

## Fonts
Google Fonts — load Inter (400/500/600/700), Newsreader (400/500/600, italic 400/500, optical
6–72), IBM Plex Mono (400/500/600). The app already imports these; match the weights.
