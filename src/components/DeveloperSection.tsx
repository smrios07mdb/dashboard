import { useState } from 'react'

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { useSession } from '@/lib/auth'
import { loadSampleData, wipeMyData } from '@/lib/sample-data'

/**
 * Developer tools panel — "Load sample data" and "Wipe my data".
 *
 * Extracted from Settings.tsx in the Revisions chunk-6 pass so it can
 * be loaded lazily. The gating (`import.meta.env.DEV || ?dev=1`) lives
 * at the lazy boundary in Settings.tsx; this file assumes its caller
 * already decided to render it. Default export keeps the dynamic
 * `import('@/components/DeveloperSection')` shape simple.
 *
 * Both helpers operate on the currently authenticated user's own data
 * (per ARCHITECTURE §6 / RLS). Per-user blast radius is acceptable for
 * MVP-stage / personal-productivity scope.
 */
export default function DeveloperSection() {
  const { user } = useSession()
  const userId = user?.id ?? null

  const [loading, setLoading] = useState(false)
  const [wiping, setWiping] = useState(false)

  async function onLoad() {
    if (!userId) return
    setLoading(true)
    try {
      await loadSampleData(userId)
    } finally {
      setLoading(false)
    }
  }

  async function onWipe() {
    if (!userId) return
    setWiping(true)
    try {
      await wipeMyData(userId)
    } finally {
      setWiping(false)
    }
  }

  return (
    <section className="mt-10 border-t border-border pt-8">
      <div className="label mb-2">Developer</div>
      <h2
        className="mb-3 text-[20px] font-medium text-foreground"
        style={{ letterSpacing: '-0.01em' }}
      >
        Developer tools
      </h2>
      <p className="mb-5 text-[13px] text-muted-foreground">
        Visible when{' '}
        <span className="font-mono">import.meta.env.DEV</span> is true, or
        when the URL carries <span className="font-mono">?dev=1</span>.
      </p>

      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={onLoad} disabled={loading || !userId}>
          {loading ? 'Loading…' : 'Load sample data'}
        </Button>

        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="destructive" disabled={wiping || !userId}>
              {wiping ? 'Wiping…' : 'Wipe my data'}
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Wipe my data?</AlertDialogTitle>
              <AlertDialogDescription>
                Removes all your tasks, archives subcategories and
                routine items, clears any push subscriptions, and resets
                Settings to defaults. Categories (Work, Personal) and
                your timezone are kept. This affects your real Supabase
                data — there&rsquo;s no undo.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={onWipe}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                Wipe everything
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </section>
  )
}
