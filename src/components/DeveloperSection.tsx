import { useState } from 'react'
import { toast } from 'sonner'

import DeleteConfirm from '@/components/DeleteConfirm'
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
import { repo } from '@/db/repo'
import { useSession } from '@/lib/auth'
import { loadSampleData, wipeMyData } from '@/lib/sample-data'

/**
 * Developer tools panel — "Load sample data", "Wipe my data", and
 * "Reset routine logs".
 *
 * Extracted from Settings.tsx in the Revisions chunk-6 pass so it can
 * be loaded lazily. The gating (`import.meta.env.DEV || ?dev=1`) lives
 * at the lazy boundary in Settings.tsx; this file assumes its caller
 * already decided to render it. Default export keeps the dynamic
 * `import('@/components/DeveloperSection')` shape simple.
 *
 * All three helpers operate on the currently authenticated user's own
 * data (per ARCHITECTURE §6 / RLS). Per-user blast radius is acceptable
 * for MVP-stage / personal-productivity scope.
 *
 * "Reset routine logs" was added in the Revisions 2026-05-27 pass as a
 * targeted affordance for smoke testing — "Wipe my data" preserves
 * routine_logs by design (so a user wiping items doesn't lose historical
 * performance), but smoke v3 needs a known-empty baseline to verify
 * streak behavior unambiguously. Online-only; no outbox enqueue for a
 * destructive bulk op.
 */
export default function DeveloperSection() {
  const { user } = useSession()
  const userId = user?.id ?? null

  const [loading, setLoading] = useState(false)
  const [wiping, setWiping] = useState(false)
  const [isResetting, setIsResetting] = useState(false)

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

  async function handleResetRoutineLogs() {
    if (!userId) return
    setIsResetting(true)
    try {
      const count = await repo.routineLogs.deleteAllForUser(userId)
      toast.success(`Routine logs reset (${count} logs deleted)`)
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Could not reset routine logs'
      toast.error(message)
    } finally {
      setIsResetting(false)
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

        <DeleteConfirm
          trigger={
            <Button variant="outline" disabled={isResetting || !userId}>
              {isResetting ? 'Resetting…' : 'Reset routine logs'}
            </Button>
          }
          title="Clear all routine completion history?"
          description={
            'This deletes every routine log for your account. Routine items, tasks, subcategories, and settings are not affected. Streak calculations and the 14-day dot grid will reset to empty. Developer/testing utility — "Wipe my data" is the broader reset.'
          }
          confirmLabel="Reset routine logs"
          onConfirm={handleResetRoutineLogs}
        />
      </div>
    </section>
  )
}
