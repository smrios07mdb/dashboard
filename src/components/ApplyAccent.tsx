import { useEffect } from 'react'

import { applyAccent, DEFAULT_ACCENT, type AccentName } from '@/lib/theme'

/**
 * Writes the focal-accent CSS vars (`--accent` / `--accent-soft` /
 * `--accent-ink`) onto the document root.
 *
 * Defaults-only for now (chunk 21 scaffold). The `forest` default already
 * matches the `:root` value, so there is no first-paint flash. A later Settings
 * chunk will pass a persisted `accent` preference to drive real switching.
 */
export default function ApplyAccent({
  accent = DEFAULT_ACCENT,
}: {
  accent?: AccentName
}) {
  useEffect(() => {
    applyAccent(accent)
  }, [accent])
  return null
}
