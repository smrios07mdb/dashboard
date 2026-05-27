import { Suspense, lazy } from 'react'

/**
 * Settings screen — chunk 6 ships a stub "Coming soon" body. The
 * Developer section is gated and lazy-loaded so production users never
 * download its code (Revisions chunk-6 pass — chunk-8's smoke against
 * the deployed PWA surfaced that the original DEV-only inline gate had
 * no runtime escape hatch).
 *
 * Gate: `import.meta.env.DEV` (always-on locally) OR `?dev=1` in the
 * current URL. The second clause keeps Vite's DCE working — the lazy
 * boundary moves the `loadSampleData` / `wipeMyData` helpers and the
 * panel JSX into a separate chunk, so the production hot path stays
 * clean while still being reachable by Cowork smoke passes.
 *
 * Real settings UI (calendar, AI key, notifications, data export/
 * import) lands in later chunks.
 */
const DeveloperSection = lazy(() => import('@/components/DeveloperSection'))

export default function Settings() {
  const isDevSurface =
    import.meta.env.DEV ||
    (typeof window !== 'undefined' &&
      new URLSearchParams(window.location.search).has('dev'))

  return (
    <div>
      <div className="label mb-2">Settings</div>
      <h1
        className="mb-3 text-[28px] font-semibold"
        style={{ letterSpacing: '-0.02em' }}
      >
        Settings
      </h1>
      <p className="text-[13px] text-muted-foreground">Coming soon.</p>

      {isDevSurface && (
        <Suspense fallback={null}>
          <DeveloperSection />
        </Suspense>
      )}
    </div>
  )
}
