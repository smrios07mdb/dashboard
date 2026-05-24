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
 * Settings screen — chunk 6 ships a stub "Coming soon" body plus a
 * Developer section that's only mounted when `import.meta.env.DEV` is
 * true. Real settings UI lands in later chunks (calendar, AI key,
 * notifications, data export/import).
 */
export default function Settings() {
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
    <div>
      <div className="label mb-2">Settings</div>
      <h1
        className="mb-3 text-[28px] font-semibold"
        style={{ letterSpacing: '-0.02em' }}
      >
        Settings
      </h1>
      <p className="text-[13px] text-muted-foreground">Coming soon.</p>

      {import.meta.env.DEV && (
        <section className="mt-10 border-t border-border pt-8">
          <div className="label mb-2">Developer</div>
          <h2
            className="mb-3 text-[20px] font-medium text-foreground"
            style={{ letterSpacing: '-0.01em' }}
          >
            Developer tools
          </h2>
          <p className="mb-5 text-[13px] text-muted-foreground">
            Only rendered when{' '}
            <span className="font-mono">import.meta.env.DEV</span> is true.
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
                    routine items, clears any push subscriptions, and
                    resets Settings to defaults. Categories (Work,
                    Personal) and your timezone are kept. This affects
                    your real Supabase data — there&rsquo;s no undo.
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
      )}
    </div>
  )
}
