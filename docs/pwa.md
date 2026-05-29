# PWA notes

See `ARCHITECTURE.md` §9 (Notifications) and §13 (UI rules) for the canonical
model. This document covers installation, caching, and platform quirks.

## How to install

Installation behaviour varies by browser. The app is installable wherever the
manifest is served from `/dashboard/manifest.webmanifest` and the service
worker is registered.

| Platform | Steps |
|---|---|
| **iOS Safari** (iPhone, iPad) | Tap the **Share** icon → **Add to Home Screen** → **Add**. The app launches in standalone mode (no Safari chrome). |
| **iPadOS Safari** | Same as iOS Safari. |
| **macOS Safari 17+** | **File → Add to Dock**. The app gets a dock icon and launches in its own window. |
| **Chrome / Edge** (desktop) | Click the install icon (⊞) in the address bar, or **⋮ → Install Dashboard**. |
| **Chrome on Android** | The browser surfaces an in-app banner; or **⋮ → Install app**. |

The first time the app loads on an iPhone or iPad in Safari (and isn't already
running as an installed PWA), an in-app `InstallHint` banner appears above the
header explaining the Share → Add to Home Screen step. The banner can be
dismissed; the dismissal persists in `localStorage` under
`install-hint-dismissed`. It also auto-hides once the app is launched in
standalone mode (detected via `navigator.standalone` and the
`(display-mode: standalone)` media query).

## What the service worker caches

The service worker is built by `vite-plugin-pwa` using the `injectManifest`
strategy: the SW source is `src/sw.ts` (chunk 14 switched from `generateSW` so
the app can own the `push` / `notificationclick` handlers). Workbox still does
the work — `src/sw.ts` calls `precacheAndRoute`, registers the routes below,
and keeps the `autoUpdate` skipWaiting/clientsClaim behaviour — so the caching
and update contract described here is unchanged by the switch. Two cache layers
are in play:

1. **Precache (app shell)** — every `.js`, `.css`, `.html`, `.svg`, `.png`,
   `.webmanifest`, and `.woff2` asset emitted by `vite build` is precached on
   first install. Reloading offline still loads the shell; the router renders
   the login screen if signed out, or the dashboard skeleton if signed in.
2. **Runtime handler for Supabase REST + GraphQL** — `NetworkOnly`,
   keyed on `*.supabase.co/rest/v1/*` and `*.supabase.co/graphql/v1/*`.
   The SW is transparent for these requests: it does not cache responses,
   it does not serve stale data offline. Dexie (see `docs/sync.md`) is the
   canonical offline cache for Supabase reads; layering a second cache at
   the SW level violated the chunk-5 offline-write contract — when the
   SW served a stale 200 GET response during a reload-while-offline, the
   repo's read path saw a non-error response, cleared Dexie, and
   bulkPut the stale list, evicting any task written via the offline
   path. Switching to `NetworkOnly` keeps the SW out of the Supabase
   data path entirely (Bug B revision, 2026-05-24).

Fonts are bundled via `@fontsource/*` (Inter + IBM Plex Mono) and ship as
local `.woff2` assets — they're swept up by the precache above, so there's no
runtime Google Fonts handler.

## Update flow

When a new version of the service worker is published, the `UpdatePrompt`
component surfaces a Sonner toast: "A new version is available. Reload to
update." with a **Reload** action button. Clicking Reload calls
`updateServiceWorker(true)` which activates the waiting worker and reloads
the page. The toast can also be dismissed without reloading (the prompt will
reappear on the next session).

The registration uses `registerType: 'autoUpdate'`, so the worker also
self-promotes silently if the user closes and reopens the app while a new
version is waiting.

## Storage and eviction

- **iOS** can evict Web Storage (including IndexedDB and `localStorage`) under
  disk pressure or after ~7 days of inactivity for installed PWAs. The
  outbox/replay model (chunk 15) is designed to tolerate this — failed writes
  resurface in Settings → Sync issues. The Supabase session itself can also
  be evicted; see `docs/auth.md`.
- **Desktop browsers** are generally durable, but a user clearing site data
  will wipe the Dexie cache. Source of truth remains Supabase.

## Notifications

Web Push on iOS requires **iOS 16.4+**, the PWA installed to the Home Screen,
and notification permission granted. Without all three, the in-app fallback
(60-second polling while a tab is open) is the only delivery path. The custom
service worker (`src/sw.ts`) carries the `push` / `notificationclick` handlers.
Full flow, env setup, cron, and debugging: `docs/notifications.md` (chunk 14).

## Regenerating icons

Icons live under `public/icons/`:

- `icon-192.png` — manifest standard
- `icon-512.png` — manifest standard + maskable
- `apple-touch-icon.png` — 180×180 for iOS Home Screen
- `icon.svg` — design source (also bundled as a static asset)

To regenerate (e.g., after a design change): edit the geometry in
`scripts/gen-icons.mjs` and `public/icons/icon.svg` together, then run
`node scripts/gen-icons.mjs`. The script uses pure Node (zero deps) and
re-renders all three PNG sizes.

## Manual verification still needed

Two acceptance criteria from `prompts/chunk-04-pwa.md` cannot be verified by
the build alone:

- **Lighthouse PWA audit ≥ 90** — must be run against the deployed URL
  (`https://smrios07mdb.github.io/dashboard/`) after the chunk's commit
  ships through GitHub Actions.
- **iPhone Safari install hint flow** — the InstallHint detection logic is
  unit-tested, but the visual flow (tap Share → Add to Home Screen → app
  launches full-screen → banner gone on next visit) requires a real device.
