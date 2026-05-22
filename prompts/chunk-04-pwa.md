# Chunk 4 — PWA shell

**Goal:** Installable PWA on iOS, iPadOS, macOS Safari. Offline app shell. Install hint.
**Dependencies:** Chunks 1, 3.
**Effort:** ~3h.

> Reference `ARCHITECTURE.md` §9 (Notifications) and §13 (UI rules — install banner).

## What to build

### Enable vite-plugin-pwa

In `vite.config.ts`, enable `VitePWA` with:
- `registerType: 'autoUpdate'`
- Manifest:
  - `name: 'Dashboard'`
  - `short_name: 'Dashboard'`
  - `description: 'Personal productivity dashboard'`
  - `theme_color: '#3a5a40'`
  - `background_color: '#faf8f3'`
  - `display: 'standalone'`
  - `start_url: '/dashboard/'`
  - `scope: '/dashboard/'`
  - Icons: 192x192, 512x512, 180x180 (apple-touch-icon)
- Workbox config:
  - Precache the app shell
  - Runtime caching for Supabase REST/GraphQL endpoints: `NetworkFirst`, 30s network timeout, 5-minute freshness window
  - Runtime caching for fonts (Google Fonts): `CacheFirst`, 1-year max
- `injectRegister: 'auto'`

### Icons

Generate three PNG icons from a simple SVG placeholder (a stylized chevron in brand green on warm-off-white background). Place under `public/icons/`. Suggested approach: create the SVG, render to PNG at 192, 512, and 180 with `sharp` or include pre-rendered PNGs.

### Install hint component

`src/components/InstallHint.tsx`:
- Detect: on iOS Safari (UA test for iPhone/iPad/iPod) AND not in standalone mode (`window.navigator.standalone === false` OR `!window.matchMedia('(display-mode: standalone)').matches`)
- Show a dismissible banner at the top: "Install Dashboard to your Home Screen for notifications and full-screen use. Tap the Share icon, then 'Add to Home Screen'."
- Dismiss button persists dismissal in `localStorage` under key `install-hint-dismissed`
- Hidden once dismissed or once running in standalone mode
- Use shadcn Card or a custom banner — must be unobtrusive

Mount in `App.tsx` so it appears across all protected routes.

### Update prompt

When the service worker detects a new version, surface a toast: "A new version is available. Reload to update." with a "Reload" button.

### Docs

`docs/pwa.md`:
- How installation works on each platform (iOS Safari: Share → Add to Home Screen; macOS Safari: File → Add to Dock; Chrome/Edge: install icon in address bar)
- Note that storage can be evicted under disk pressure (especially on iOS)
- Note that notifications (chunk 14) require installed PWA on iOS 16.4+

## Files to create/modify

```
vite.config.ts                 (modify — enable VitePWA)
public/icons/icon-192.png      (new)
public/icons/icon-512.png      (new)
public/icons/apple-touch-icon.png  (new, 180x180)
src/components/InstallHint.tsx (new)
src/components/UpdatePrompt.tsx (new)
src/App.tsx                    (modify — mount InstallHint and UpdatePrompt)
docs/pwa.md                    (new)
```

## Acceptance criteria

- `npm run build` produces a service worker and manifest in `dist/`
- Lighthouse PWA audit ≥90 on the deployed URL
- On iPhone Safari: install hint banner appears; after "Add to Home Screen", banner disappears and app launches full-screen
- On macOS Safari or Chrome: app is installable
- Service worker caches the shell; offline reload still loads the app (login screen if signed out, cached dashboard shell if signed in)

## Do NOT

- Touch auth or data code
- Add Web Push handlers (chunk 14)
- Implement offline mutation queue (chunk 15)

## How to test

1. `npm run build && npm run preview` → confirm SW and manifest exist
2. Deploy to GH Pages
3. Open on iPhone Safari → see install banner → install → confirm full-screen launch
4. Run Lighthouse audit on the deployed URL → PWA score ≥90
5. With DevTools, set network to Offline → reload → app shell still renders
