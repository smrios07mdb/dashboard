# Hupomnemata — Complete Design Handoff

One package, two halves of the same identity:

```
hupomnemata_handoff/
├── README.md          ← you are here (start here, then read CLAUDE_CODE.md)
├── CLAUDE_CODE.md     ← the single prompt to paste into Claude Code to build the app
├── brand/             ← logo & brand identity ("Quiet") — the cornerstone
│   ├── README.md          mark construction, colourways, lockups, tokens
│   ├── assets/            ✅ production-ready SVGs + PNG favicons/app-icons (ship as-is)
│   └── reference/         logo system canvas (HTML) + source JSX (presentation only)
└── app/               ← dashboard redesign — the product UI
    ├── README.md          authoritative visual spec: tokens, screens, interactions
    ├── DESIGN_NOTES.md    architecture/interaction notes (see caveat below)
    ├── index.html         all design tokens + font links + app mount
    ├── src/               React-via-Babel prototype (app shell, screens, sheets, primitives)
    └── screenshots/       reference renders of every screen
```

## What this is

**Hupomnemata** (Greek *hupomnḗmata*, "the private notebooks the Stoics kept") is a calm,
dignified personal task manager. This handoff is everything needed to rebuild it in a
production codebase (the team's notes point to **React + TypeScript + Tailwind + shadcn/ui**):

- **`brand/`** — the logomark, favicons, app-icons, and the canonical color/type/spacing
  tokens. The `assets/` here are final, hand-authored output — drop them straight into the
  app's static root.
- **`app/`** — a high-fidelity prototype of the full product (Login, Dashboard, Routines,
  Insights, Settings, plus action Sheets) with every token, screen, and interaction
  specified to exact values.

The prototypes are **design references, not production code to copy verbatim** — recreate
them in the target codebase using its established patterns, then map the tokens below onto
its theme system.

## The one source of truth: tokens

Both halves share **one design system** — the same CSS custom properties. Where the two
READMEs describe tokens, they agree. Canonical values (Daylight, the default theme):

| | Token | Value | Role |
|---|---|---|---|
| Surface | `--bg` / `--surface` | `#f6f4f7` / `#ffffff` | page / cards |
| Ink | `--ink` / `--ink-2` / `--ink-3` | `#221f28` / `#635f6c` / `#948f9e` | text scale |
| **Work** | `--work` | `#11a06e` (emerald) | Work category **and the logo point** |
| **Personal** | `--personal` | `#f2552f` (coral) | Personal category |
| Accent | `--accent` | `#1f5142` (pine) | focal accent / reserved logo point |
| Display | `--font-display` | Newsreader 500 | titles, wordmark |
| UI | `--font-ui` | Inter | body, controls |
| Mono | `--font-mono` | IBM Plex Mono | labels, figures, tagline |

The emerald `--work` is literally the logo's point and the Work category color — it is the
thread tying brand and product together. Don't theme it away.

## ⚠️ One caveat — `app/DESIGN_NOTES.md` is partly stale

`DESIGN_NOTES.md` describes the **original dark "Obsidian" theme** (a jade/coral dark UI,
"ice" accent, anti-gamification stance). The product has since moved to the **light
"Daylight" theme with a tasteful gamification layer** documented in `app/README.md`.

- For **color, type, and design philosophy** → `app/README.md` and `brand/README.md` win.
- For **architecture & interaction** (sync states, CalDAV banner, notification gating,
  responsive breakpoints, empty states, component inventory, "what's not in the prototype")
  → `DESIGN_NOTES.md` §2–§6, §8 are still accurate and useful.

## How to use this

1. Read this file, then **`CLAUDE_CODE.md`** — it's the single prompt to drive the build.
2. Skim `brand/README.md` (the mark + tokens) and `app/README.md` (the screens + spec).
3. Open `brand/reference/Hupomnemata Logo - Quiet.html` and `app/index.html` in a browser
   to see the real thing; cross-check against `app/screenshots/`.
4. Ship `brand/assets/` directly; recreate the rest in the target codebase.
