# Claude Code Prompt — Chunk 22: Brand (Logomark + Favicons + Manifest)

## Shared Foundation

You are building **Hupomnemata**, a calm, dignified personal task manager. This is a visual redesign of an existing, shipped app — rebuilt in our **React + TypeScript + Tailwind + shadcn/ui** codebase. The design references live in `hupomnemata_handoff/`.

**This is a re-skin, not a rebuild.** The data layer, Supabase auth/realtime, react-router routes, @dnd-kit, the "What's next?" AI triage (model `claude-haiku-4-5`), the CalDAV proxy, and the PWA service worker / manifest / Web Push are **already built and shipped**. Do **not** rebuild them. Each chunk maps new UI onto the existing state, routing, and services.

**Token source of truth.** The Daylight token system is already in `src/index.css` (Chunk 21). Use the existing CSS variables (`--ink`, `--work`, `--bg`, etc.) — do not redefine them.

**Tone.** Quiet, unhurried. No exclamation marks, no confetti / particle bursts, no gradients on UI chrome.

**Reading order:** `hupomnemata_handoff/brand/README.md` (primary for this chunk) → the rendered reference `hupomnemata_handoff/brand/reference/Hupomnemata Logo — Quiet.html`.

**Guardrail.** Recreate only what's in the handoff. Ask before adding anything that isn't there.

**Per-chunk done bar.** Matches its reference; uses theme tokens (not hardcoded hexes); wired onto the real services; builds clean; verified on-device.

---

## Chunk 22 — Brand: logomark + favicons + manifest

**Branch:** continue on `redesign` (created in Chunk 21). Do not branch again.

**Goal:** the `HupoMark` component exists + all brand assets are wired into the head and the PWA manifest.

**Depends on:** Chunk 21 (tokens — `--ink` / `--work` must resolve).

**In scope:** build `HupoMark` as an inline-SVG React component from the canonical geometry; ship `hupomnemata_handoff/brand/assets/*` into `public/`; add the favicon/apple-touch-icon `<link>`s to the head; update the PWA web manifest to the Hupomnemata identity.

**Out of scope:** placing the mark in the app header or login screen (those are Chunks 24 and 25 — the component just needs to exist and be exported).

**Exit:** favicons render in the browser tab + on PWA install; `HupoMark` renders correctly at 16 / 24 / 48px (point drops below ~16px); manifest is valid with the Hupomnemata name + icons + light theme color; build clean; no CSP violations (assets are `self`).

---

## What to do

### 1. Build the `HupoMark` component

Create `src/components/HupoMark.tsx`. Canonical geometry (100-unit grid, stroke 11, round caps/joins, point at center 76,74.5 r5.6 — same diameter as the stroke):

```tsx
type HupoMarkProps = {
  size?: number;
  glyph?: string;
  point?: string;
  className?: string;
};

export function HupoMark({
  size = 24,
  glyph = 'var(--ink)',
  point = 'var(--work)',
  className,
}: HupoMarkProps) {
  const showPoint = size >= 16;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      role="img"
      aria-label="Hupomnemata"
      className={className}
      style={{ display: 'block' }}
    >
      <g
        fill="none"
        stroke={glyph}
        strokeWidth="11"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M24 21 L24 79" />
        <path d="M24 53 Q24 36.5 42 36.5 Q60 36.5 60 53 L60 79" />
      </g>
      {showPoint && <circle cx="76" cy="74.5" r="5.6" fill={point} />}
    </svg>
  );
}
```

Rules from `brand/README.md` — enforce them:
- The glyph is **always ink** (`var(--ink)` on light; pass `glyph="#eceaef"` on dark surfaces). Never recolor the h, never gradient/outline/rotate/skew it.
- **Only the point carries color.** Default `point="var(--work)"` so it tracks the live category-work color (renders emerald under the default `emerald` palette — see the note below).
- **Below ~16px, drop the point** (`showPoint` guard) so the h stays clean.

### 2. Ship the brand assets

Copy every file from `hupomnemata_handoff/brand/assets/` into `public/` (the app's static root):

```
favicon.svg
favicon-16.png  favicon-32.png  favicon-48.png  favicon-64.png
apple-touch-icon.png            (180×180)
app-icon-light.svg  app-icon-light-512.png
app-icon-dark.svg   app-icon-dark-512.png
hupomnemata-mark.svg            (primary — ink glyph + emerald point)
hupomnemata-mark-mono.svg       (ink point)
hupomnemata-mark-dark.svg       (light glyph for dark surfaces)
hupomnemata-mark-pine.svg       (reserved accent)
hupomnemata-mark-coral.svg      (reserved accent)
```

Ship them as-is (hand-authored, production-ready). Remove any stale favicons from the old branding if they conflict by filename.

### 3. Add the head links

In `index.html` `<head>` (Chunk 21 already set `theme-color`/`color-scheme` to light — keep that):

```html
<link rel="icon" type="image/svg+xml" href="/favicon.svg">
<link rel="icon" type="image/png" sizes="32x32" href="/favicon-32.png">
<link rel="icon" type="image/png" sizes="16x16" href="/favicon-16.png">
<link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png">
```

Mind the deploy base path: the app is served from `…/dashboard/`, so confirm the asset URLs resolve under that base (use the project's existing base-path convention — Vite `BASE_URL` — rather than assuming root `/`).

### 4. Update the PWA manifest

This app already ships a PWA, so the manifest is generated somewhere — **find it first** (a static `public/manifest.webmanifest`, or the `manifest` option in a `VitePWA(...)` block in `vite.config.ts`). Update that existing source; do not create a duplicate. Target values:

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

Apply the base-path convention to the icon `src`s the same way as the head links. Keep all other existing manifest fields (start_url, display, scope, etc.) intact — only the identity, icons, and colors change.

### 5. Verify

- `npm run build` ✓ — assets bundle, no googleapis/gstatic references introduced (CSP `font-src`/`img-src` intact).
- Browser tab shows the new favicon; the SVG favicon loads.
- Render `HupoMark` at 48 / 24 / 16 / 12px (a quick test mount or the existing `/dev/tokens` page): geometry is correct; the point shows at ≥16px and is gone below it; the glyph is ink.
- PWA: the install prompt / installed icon uses the Hupomnemata app-icon; manifest validates (DevTools → Application → Manifest, no errors).
- No console errors.

---

## Acceptance criteria

✓ On `redesign` branch (continued from Chunk 21).
✓ `src/components/HupoMark.tsx` — inline SVG, canonical geometry, `glyph`/`point`/`size` props, point-drop below 16px, exported.
✓ All `brand/assets/*` files copied into `public/`; conflicting old favicons removed.
✓ Favicon + apple-touch-icon `<link>`s in `index.html`, base-path-correct.
✓ Existing PWA manifest updated to Hupomnemata name/short_name + the two app-icons + `theme_color`/`background_color` `#f6f4f7`; no duplicate manifest; other fields preserved.
✓ Favicons render in tab + on PWA install; manifest validates.
✓ `HupoMark` renders correctly across sizes incl. the <16px point-drop.
✓ `npm run build` clean; no CSP violations.

---

## Note — point color (read this)

`brand/README.md`'s token table lists `--work` as `#11a06e` and the canonical favicon SVG bakes that emerald into the point. But the app's authoritative `index.html` / Chunk-21 token system sets the default category palette (`data-catpalette="emerald"`) to **`--work #059669`**. So:

- The in-app `HupoMark` uses `point="var(--work)"` → renders **`#059669`** (the live token). Correct — the mark tracks the theme. Do **not** hardcode `#11a06e`.
- The static favicon/app-icon PNGs/SVGs ship as-authored (point baked at `#11a06e`). This is a hair off the in-app mark; ship them as-is. If you ever want them pixel-identical, regenerate the rasters from `--work` later — not this chunk.

---

## Resources

- `hupomnemata_handoff/brand/README.md` — geometry, colourways, head links, manifest spec
- `hupomnemata_handoff/brand/assets/` — production-ready files to ship
- `hupomnemata_handoff/brand/reference/Hupomnemata Logo — Quiet.html` — rendered proof of all lockups + icon tiles
- `src/index.css` — existing Daylight tokens (don't redefine)
- `index.html` — head + base path
- `vite.config.ts` / `public/` — locate the existing PWA manifest source here
