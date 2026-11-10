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

import { applyTheme, readTheme, watchSystemTheme } from './theme'

// Set the mode before the first paint so a forced theme never flashes.
applyTheme(readTheme())

const root = createRoot(document.getElementById('root')!)

if (location.hash === '#breathe') {
  // A breathing overlay (chunk 96, D13): only the overlay. No App, no
  // Supabase, no sign-out cleanup, no sync runner — those live behind the
  // other import. It still follows the theme, macOS switches included.
  watchSystemTheme(readTheme())
  void import('./BreatheOverlay').then(({ default: BreatheOverlay }) =>
    root.render(
      <StrictMode>
        <BreatheOverlay />
      </StrictMode>,
    ),
  )
} else {
  void import('./popover').then(({ mountPopover }) => mountPopover(root))
}
