import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

// Self-hosted fonts (@fontsource) — bundled, no network font load (D12).
// Only the weights the popover uses.
import '@fontsource/inter/400.css'
import '@fontsource/inter/500.css'
import '@fontsource/inter/600.css'
import '@fontsource/newsreader/500.css'
import '@fontsource/ibm-plex-mono/400.css'
import '@fontsource/ibm-plex-mono/500.css'
import '@fontsource/ibm-plex-mono/600.css'

// Order matters: the Daylight tokens, then the menubar-only dark values,
// then the popover's own rules.
import '@/index.css'
import './dark.css'
import './menubar.css'

import { installSignOutCleanup } from '@/lib/signOutCleanup'

import App from './App'

// The PWA's sign-out hygiene, unchanged: wipe the cache mirror on SIGNED_OUT
// (ARCHITECTURE §14) and keep the outbox user stamp current.
const stopSignOutCleanup = installSignOutCleanup()
if (import.meta.hot) import.meta.hot.dispose(() => stopSignOutCleanup())

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
