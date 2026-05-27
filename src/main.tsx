import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import '@fontsource/inter/400.css'
import '@fontsource/inter/500.css'
import '@fontsource/inter/600.css'
import '@fontsource/inter/700.css'
import '@fontsource/ibm-plex-mono/500.css'

import './index.css'
import App from './App.tsx'
import { __clockOverride } from './lib/clock'

// DEV-only: expose the clock override hook on `window` so the test
// harness can pin `today()` from the DevTools console without doing
// timezone gymnastics. `__clockOverride` is `undefined` in production
// (tree-shaken away), and the wrapper `if` block is dropped by Vite's
// DCE since `import.meta.env.DEV` resolves to `false`. See
// `src/lib/clock.ts` for the API. Added 2026-05-27 — see PROGRESS.md
// Revisions chunk-10 DEV-only clock override hook.
if (import.meta.env.DEV) {
  ;(
    window as Window & { __clockOverride?: typeof __clockOverride }
  ).__clockOverride = __clockOverride
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
