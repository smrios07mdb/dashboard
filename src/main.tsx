import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

// Self-hosted fonts (@fontsource) — CSP-safe (font-src 'self'), precached for
// offline by the PWA service worker. Daylight type stack: Inter (UI),
// Newsreader (serif display + italics), IBM Plex Mono (labels / figures).
import '@fontsource/inter/300.css'
import '@fontsource/inter/400.css'
import '@fontsource/inter/500.css'
import '@fontsource/inter/600.css'
import '@fontsource/inter/700.css'
import '@fontsource/inter/800.css'
import '@fontsource/newsreader/400.css'
import '@fontsource/newsreader/500.css'
import '@fontsource/newsreader/600.css'
import '@fontsource/newsreader/400-italic.css'
import '@fontsource/newsreader/500-italic.css'
import '@fontsource/newsreader/600-italic.css'
import '@fontsource/ibm-plex-mono/400.css'
import '@fontsource/ibm-plex-mono/500.css'
import '@fontsource/ibm-plex-mono/600.css'

import './index.css'
import App from './App.tsx'
import { repo } from './db/repo'
import { __clockOverride } from './lib/clock'
import { installSignOutCleanup } from './lib/signOutCleanup'

// DEV-only: expose the clock override hook on `window` so the test
// harness can pin `today()` from the DevTools console without doing
// timezone gymnastics. `__clockOverride` is `undefined` in production
// (tree-shaken away), and the wrapper `if` block is dropped by Vite's
// DCE since `import.meta.env.DEV` resolves to `false`. See
// `src/lib/clock.ts` for the API. Added 2026-05-27 — see PROGRESS.md
// Revisions chunk-10 DEV-only clock override hook.
//
// Also DEV-only: expose `repo` on `window.__claudeDashboard` so smoke
// passes can backdate `routine_items.created_at` or otherwise drive the
// data layer from the DevTools console without going through Supabase
// Studio. Same DCE guarantee as `__clockOverride` — the `if` block is
// dropped from prod builds and `window.__claudeDashboard` is undefined
// there. Added 2026-05-27 as a smoke-v3 prerequisite — see PROGRESS.md
// Revisions chunk-10 smoke v3 pass.
if (import.meta.env.DEV) {
  ;(
    window as Window & { __clockOverride?: typeof __clockOverride }
  ).__clockOverride = __clockOverride
  ;(
    window as Window & { __claudeDashboard?: { repo: typeof repo } }
  ).__claudeDashboard = { repo }
}

// Wipe the per-device cache on sign-out (chunk 18 — AUTH-01/PRIV-01). Installed
// once here, at module scope, rather than inside `useSession` (mounted by ~14
// components) so it fires exactly once per sign-out and also catches token
// expiry / sign-out on another tab or device.
const stopSignOutCleanup = installSignOutCleanup()
// In dev, drop the previous listener on HMR so hot-reloads don't stack
// duplicates (no-op in production, where modules don't hot-reload).
if (import.meta.hot) import.meta.hot.dispose(() => stopSignOutCleanup())

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
