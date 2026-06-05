import { useEffect, useState } from 'react'
import { Link2 } from 'lucide-react'

import { SettingsRow, SettingsSection } from '@/screens/Settings'

type VersionInfo = { sha: string; builtAt: string }

/**
 * Settings → About (chunk 16; Daylight re-skin chunk 30). Surfaces the deployed
 * build version from version.json (written at build time — see vite.config.ts).
 * Fetched respecting the GH-Pages base path (R9): a root-absolute
 * `/version.json` would 404 under the `/dashboard/` subpath. In dev (no build)
 * it shows "—".
 */
export default function About() {
  const [version, setVersion] = useState<VersionInfo | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch(`${import.meta.env.BASE_URL}version.json`)
      .then((r) => (r.ok ? r.json() : null))
      .then((v: VersionInfo | null) => {
        if (!cancelled) setVersion(v)
      })
      .catch(() => {
        // version.json absent (dev / offline) — leave as "—".
      })
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <SettingsSection kicker="07" title="About">
      <SettingsRow title="Build" align="center">
        <span className="num text-[13px] text-ink-2">
          {version?.sha ?? '—'}
          {version?.builtAt
            ? ` · ${new Date(version.builtAt).toLocaleString()}`
            : ''}
        </span>
      </SettingsRow>
      <SettingsRow title="Source" align="center">
        <a
          href="https://github.com/smrios07mdb/dashboard"
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1.5 text-[13px]"
          style={{ color: 'var(--accent)' }}
        >
          <Link2 className="size-3.5" />
          smrios07mdb/dashboard
        </a>
      </SettingsRow>
    </SettingsSection>
  )
}
