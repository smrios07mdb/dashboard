import { useEffect, useState } from 'react'

type VersionInfo = { sha: string; builtAt: string }

/**
 * Settings → About (chunk 16). Surfaces the deployed build version from
 * version.json (written at build time — see vite.config.ts). Fetched
 * respecting the GH-Pages base path (R9): a root-absolute `/version.json`
 * would 404 under the `/dashboard/` subpath. In dev (no build) it shows "—".
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
    <section className="mt-8 border-t border-border pt-6">
      <div className="label mb-1">About</div>
      <h2
        className="mb-3 text-[18px] font-semibold text-foreground"
        style={{ letterSpacing: '-0.01em' }}
      >
        About this app
      </h2>
      <dl className="max-w-md space-y-1.5 text-[13px]">
        <div className="flex items-center justify-between">
          <dt className="text-muted-foreground">Version</dt>
          <dd className="font-mono text-secondary-foreground">
            {version?.sha ?? '—'}
          </dd>
        </div>
        <div className="flex items-center justify-between">
          <dt className="text-muted-foreground">Built</dt>
          <dd className="font-mono text-secondary-foreground">
            {version?.builtAt
              ? new Date(version.builtAt).toLocaleString()
              : '—'}
          </dd>
        </div>
      </dl>
      <p className="mt-3 max-w-md text-[12px] leading-relaxed text-muted-foreground">
        Personal productivity dashboard. See{' '}
        <span className="font-mono">ARCHITECTURE.md</span> for the full design.
      </p>
    </section>
  )
}
