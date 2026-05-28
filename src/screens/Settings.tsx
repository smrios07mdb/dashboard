import { Suspense, lazy, useEffect, useState } from 'react'
import { Eye, EyeOff } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { repo } from '@/db/repo'
import { useSession } from '@/lib/auth'

/**
 * Settings screen.
 *
 * Chunk 11 adds the first real section: the Anthropic API key used by
 * the "What's next?" triage (ARCHITECTURE.md §10). The key lives in
 * `settings.ai_api_key`, readable only by its owner via RLS, and is sent
 * straight from the browser — the exposure tradeoff is documented in
 * docs/security.md.
 *
 * The Developer section stays gated + lazy-loaded so production users
 * never download its code (Revisions chunk-6). Calendar, notifications,
 * and data export/import land in later chunks.
 */
const DeveloperSection = lazy(() => import('@/components/DeveloperSection'))

const SAVE_ERROR = 'Could not save — retry'

function AiKeySection() {
  const { user } = useSession()
  const userId = user?.id ?? null

  const [apiKey, setApiKey] = useState('')
  const [show, setShow] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!userId) return
    let cancelled = false
    repo.settings
      .get(userId)
      .then((settings) => {
        if (cancelled) return
        setApiKey(settings?.aiApiKey ?? '')
      })
      .catch((e) => {
        console.error('Load settings failed', e)
      })
    return () => {
      cancelled = true
    }
  }, [userId])

  async function save() {
    if (!userId) return
    const trimmed = apiKey.trim()
    setSaving(true)
    try {
      // Store null (not '') when cleared so the triage missing-key path
      // fires correctly.
      await repo.settings.update(userId, { aiApiKey: trimmed || null })
      toast('API key saved')
    } catch (e) {
      console.error('Save API key failed', e)
      toast.error(SAVE_ERROR)
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="mt-8 border-t border-border pt-6">
      <div className="label mb-1">AI assist</div>
      <h2
        className="mb-3 text-[18px] font-semibold text-foreground"
        style={{ letterSpacing: '-0.01em' }}
      >
        Anthropic API key
      </h2>

      <div className="flex max-w-md items-center gap-2">
        <Input
          type={show ? 'text' : 'password'}
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder="sk-ant-…"
          aria-label="Anthropic API key"
          autoComplete="off"
          spellCheck={false}
        />
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={() => setShow((s) => !s)}
          aria-label={show ? 'Hide API key' : 'Show API key'}
          title={show ? 'Hide' : 'Show'}
        >
          {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
        </Button>
      </div>

      <div className="mt-3 flex items-center gap-3">
        <Button onClick={save} disabled={saving || !userId}>
          {saving ? 'Saving…' : 'Save key'}
        </Button>
        <span className="font-mono text-[11px] text-muted-foreground">
          Uses claude-haiku-4-5
        </span>
      </div>

      <p className="mt-3 max-w-md text-[12px] leading-relaxed text-muted-foreground">
        Your key is stored in your Supabase data, accessible only by you (RLS).
        Calls are made directly from your browser. See{' '}
        <span className="font-mono">docs/security.md</span>.
      </p>
    </section>
  )
}

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

      <AiKeySection />

      {isDevSurface && (
        <Suspense fallback={null}>
          <DeveloperSection />
        </Suspense>
      )}
    </div>
  )
}
