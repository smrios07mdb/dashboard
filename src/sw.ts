/// <reference lib="webworker" />
/*
 * Custom service worker (vite-plugin-pwa `injectManifest`).
 *
 * Chunk 14 switched the PWA from `generateSW` to `injectManifest` so we can
 * own the `push` / `notificationclick` handlers. That switch makes precache +
 * runtime caching + the update flow OUR responsibility — so this file must
 * keep reproducing chunk 4's PWA contract, not merely add the push handlers.
 *
 * Preserved from the chunk-4 `vite.config.ts` workbox config (a locked
 * subsystem — see prompts/README.md):
 *   - precache the app shell + bundled @fontsource woff2 (via globPatterns,
 *     injected as `self.__WB_MANIFEST`);
 *   - SPA navigation fallback to the precached /dashboard/index.html;
 *   - Supabase REST + GraphQL stay `NetworkOnly` (the Bug-B offline contract:
 *     the SW must be transparent so the repo's network-error -> Dexie fallback
 *     survives, instead of replaying a stale cached list);
 *   - `registerType: 'autoUpdate'` => skipWaiting + clientsClaim.
 *
 * The thin handlers delegate to the unit-tested `lib/pushPayload` (imported by
 * relative path so esbuild bundles it into the worker without the `@` alias).
 * Everything is under the `/dashboard/` base path (ARCHITECTURE.md §3).
 */
import { clientsClaim } from 'workbox-core'
import {
  cleanupOutdatedCaches,
  createHandlerBoundToURL,
  precacheAndRoute,
} from 'workbox-precaching'
import { NavigationRoute, registerRoute } from 'workbox-routing'
import { NetworkOnly } from 'workbox-strategies'

import { notificationTargetUrl, parsePushPayload } from './lib/pushPayload'

declare let self: ServiceWorkerGlobalScope

// --- chunk 4 PWA behavior (preserved across the injectManifest switch) ---

// autoUpdate semantics: activate a new SW at once and take control of open
// clients — the same behavior the chunk-4 generateSW build shipped.
self.skipWaiting()
clientsClaim()

// Precache the build manifest injected by vite-plugin-pwa (app shell + fonts).
precacheAndRoute(self.__WB_MANIFEST)
cleanupOutdatedCaches()

// SPA navigation fallback -> precached shell (was workbox.navigateFallback).
registerRoute(
  new NavigationRoute(createHandlerBoundToURL('/dashboard/index.html')),
)

// Supabase REST + GraphQL stay NetworkOnly. Dexie is the canonical offline
// cache for these endpoints; the SW must stay transparent so the repo's
// offline-write path holds (Bug B revision; ARCHITECTURE locked subsystem).
registerRoute(
  ({ url }) =>
    url.hostname.endsWith('.supabase.co') &&
    (url.pathname.startsWith('/rest/v1') ||
      url.pathname.startsWith('/graphql/v1')),
  new NetworkOnly(),
)

// --- chunk 14: Web Push ---

self.addEventListener('push', (event) => {
  const { title, options } = parsePushPayload(readPushJson(event))
  event.waitUntil(self.registration.showNotification(title, options))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = notificationTargetUrl(event.notification.data)
  event.waitUntil(focusOrOpenWindow(url))
})

/** Parse the push body as JSON, tolerating an empty or non-JSON payload. */
function readPushJson(event: PushEvent): unknown {
  try {
    return event.data?.json() ?? {}
  } catch {
    return {}
  }
}

/**
 * Focus an already-open app window (navigating it to `url` when possible),
 * otherwise open a new one — satisfies "opens or focuses the app at the task's
 * URL".
 */
async function focusOrOpenWindow(url: string): Promise<void> {
  const clientList = await self.clients.matchAll({
    type: 'window',
    includeUncontrolled: true,
  })
  for (const client of clientList) {
    if ('focus' in client) {
      await client.focus()
      if ('navigate' in client) {
        try {
          await client.navigate(url)
        } catch {
          // detached/cross-origin client — focusing it is enough.
        }
      }
      return
    }
  }
  await self.clients.openWindow(url)
}
