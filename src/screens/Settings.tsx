import { Suspense, lazy, useEffect, useState } from 'react'
import { Bell, Eye, EyeOff, Link2 } from 'lucide-react'
import { toast } from 'sonner'

import DeleteConfirm from '@/components/DeleteConfirm'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { repo } from '@/db/repo'
import type { CaldavStatus } from '@/db/types'
import { useSession } from '@/lib/auth'
import {
  CalendarError,
  clearVerified,
  getVerifiedAt,
  isSignedOut,
  markVerified,
  saveCredentials,
  testCredentials,
  type DiscoveredCalendar,
} from '@/lib/calendarApi'
import {
  getPermission,
  isPushSupported,
  isSubscribed,
  requestPermissionAndSubscribe,
  unsubscribe,
} from '@/lib/push'
import { recoverSignedOut } from '@/lib/session'

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

function formatVerifiedAgo(ts: number | null): string {
  if (!ts) return ''
  const mins = Math.floor((Date.now() - ts) / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  return new Date(ts).toLocaleDateString()
}

function StatusBadge({
  status,
  testing,
}: {
  status: CaldavStatus
  testing: boolean
}) {
  if (testing) return <Badge variant="warning">Testing…</Badge>
  if (status === 'ok') {
    const ago = formatVerifiedAgo(getVerifiedAt())
    return (
      <Badge variant="success">
        {ago ? `Connected · verified ${ago}` : 'Connected'}
      </Badge>
    )
  }
  if (status === 'auth_failed') {
    return <Badge variant="destructive">Reconnect needed</Badge>
  }
  return <Badge variant="secondary">Not configured</Badge>
}

function CalendarSection() {
  const { user } = useSession()
  const userId = user?.id ?? null

  const [caldavStatus, setCaldavStatus] = useState<CaldavStatus>('unconfigured')
  const [appleId, setAppleId] = useState('')
  const [appPassword, setAppPassword] = useState('')
  const [showPass, setShowPass] = useState(false)
  const [calendars, setCalendars] = useState<DiscoveredCalendar[]>([])
  const [calendarUrl, setCalendarUrl] = useState('')
  const [testing, setTesting] = useState(false)
  const [saving, setSaving] = useState(false)

  // Load the saved config. The app-specific password is intentionally NOT
  // loaded — it's write-only from the client (db/types.ts), so the field
  // always starts blank and must be re-entered to (re)save.
  useEffect(() => {
    if (!userId) return
    let cancelled = false
    repo.settings
      .get(userId)
      .then((settings) => {
        if (cancelled) return
        setCaldavStatus(settings?.caldavStatus ?? 'unconfigured')
        setAppleId(settings?.caldavAppleId ?? '')
        setCalendarUrl(settings?.caldavCalendarUrl ?? '')
      })
      .catch((e) => {
        console.error('Load calendar settings failed', e)
      })
    return () => {
      cancelled = true
    }
  }, [userId])

  async function refetchSettings() {
    if (!userId) return
    const settings = await repo.settings.get(userId).catch(() => null)
    if (!settings) return
    setCaldavStatus(settings.caldavStatus)
    setAppleId(settings.caldavAppleId ?? '')
    setCalendarUrl(settings.caldavCalendarUrl ?? '')
  }

  async function reportError(e: unknown, fallback: string) {
    if (isSignedOut(e)) {
      // Stale/expired Supabase JWT (resolution 3, source #2). Try one refresh;
      // on success the user simply retries (we don't auto-resubmit Test/Save),
      // on failure the now-null session drives <Protected> to <Login/>.
      const outcome = await recoverSignedOut()
      toast.error(
        outcome === 'recovered'
          ? 'Session refreshed — please try again.'
          : 'Your session expired — sign in again.',
      )
      return
    }
    console.error('Calendar action failed', e)
    toast.error(e instanceof CalendarError ? e.message : fallback)
  }

  async function testConnection() {
    const id = appleId.trim()
    if (!id || !appPassword) return
    setTesting(true)
    setCalendars([])
    try {
      const result = await testCredentials({ appleId: id, appPassword })
      setCalendars(result.calendars)
      setCalendarUrl((prev) =>
        prev && result.calendars.some((c) => c.url === prev)
          ? prev
          : (result.calendars[0]?.url ?? ''),
      )
      toast(
        result.calendars.length
          ? 'Connection verified — pick a calendar and Save.'
          : 'Connected, but no event calendars were found.',
      )
    } catch (e) {
      await reportError(
        e,
        'Could not connect — check your Apple ID and app-specific password.',
      )
    } finally {
      setTesting(false)
    }
  }

  async function save() {
    const id = appleId.trim()
    if (!id || !appPassword || !calendarUrl) return
    setSaving(true)
    try {
      await saveCredentials({ appleId: id, appPassword, calendarUrl })
      markVerified()
      // The proxy sets caldav_status='ok' server-side; read it back rather than
      // setting it optimistically — the proxy is the source of truth (resolution 4).
      await refetchSettings()
      setAppPassword('') // write-only: don't retain it in the form
      toast('Apple Calendar connected.')
    } catch (e) {
      await reportError(e, 'Could not save — retry.')
    } finally {
      setSaving(false)
    }
  }

  async function disconnect() {
    if (!userId) return
    try {
      // Clears what the proxy reads (apple id, calendar, status). The encrypted
      // password column is left orphaned but unused server-side — the proxy
      // keys off apple_id + status (prompt: "for now, just clear via repo").
      await repo.settings.update(userId, {
        caldavAppleId: null,
        caldavCalendarUrl: null,
        caldavStatus: 'unconfigured',
      })
      clearVerified()
      setCalendars([])
      setCalendarUrl('')
      setAppPassword('')
      await refetchSettings()
      toast('Apple Calendar disconnected.')
    } catch (e) {
      console.error('Disconnect failed', e)
      toast.error(SAVE_ERROR)
    }
  }

  const isConnected = caldavStatus === 'ok' || caldavStatus === 'auth_failed'

  return (
    <section className="mt-8 border-t border-border pt-6">
      <div className="label mb-1">Apple Calendar</div>
      <h2
        className="mb-3 text-[18px] font-semibold text-foreground"
        style={{ letterSpacing: '-0.01em' }}
      >
        Calendar connection
      </h2>

      <div className="mb-4">
        <StatusBadge status={caldavStatus} testing={testing} />
      </div>

      <div className="max-w-md space-y-4">
        <div>
          <label htmlFor="caldav-apple-id" className="label mb-1 block">
            Apple ID
          </label>
          <Input
            id="caldav-apple-id"
            type="email"
            value={appleId}
            onChange={(e) => setAppleId(e.target.value)}
            placeholder="you@icloud.com"
            autoComplete="off"
            spellCheck={false}
          />
        </div>

        <div>
          <label htmlFor="caldav-app-password" className="label mb-1 block">
            App-specific password
          </label>
          <div className="flex items-center gap-2">
            <Input
              id="caldav-app-password"
              type={showPass ? 'text' : 'password'}
              value={appPassword}
              onChange={(e) => setAppPassword(e.target.value)}
              placeholder="xxxx-xxxx-xxxx-xxxx"
              autoComplete="off"
              spellCheck={false}
            />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => setShowPass((s) => !s)}
              aria-label={showPass ? 'Hide password' : 'Show password'}
              title={showPass ? 'Hide' : 'Show'}
            >
              {showPass ? (
                <EyeOff className="size-4" />
              ) : (
                <Eye className="size-4" />
              )}
            </Button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="secondary"
            onClick={testConnection}
            disabled={testing || !appleId.trim() || !appPassword}
          >
            <Link2 className="size-4" />
            {testing ? 'Testing…' : 'Test connection'}
          </Button>

          {calendars.length > 0 && (
            <select
              value={calendarUrl}
              onChange={(e) => setCalendarUrl(e.target.value)}
              aria-label="Calendar"
              className="h-9 rounded-md border border-border bg-background px-2 text-[13px] text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {calendars.map((c) => (
                <option key={c.url} value={c.url}>
                  {c.name}
                </option>
              ))}
            </select>
          )}

          <Button
            type="button"
            onClick={save}
            disabled={saving || !appleId.trim() || !appPassword || !calendarUrl}
          >
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </div>

        {isConnected && (
          <DeleteConfirm
            trigger={
              <Button type="button" variant="outline" size="sm">
                Disconnect
              </Button>
            }
            title="Disconnect Apple Calendar?"
            description="This removes the stored credentials from this app. You can reconnect anytime by testing and saving again."
            confirmLabel="Disconnect"
            onConfirm={disconnect}
          />
        )}
      </div>

      <p className="mt-4 max-w-md text-[12px] leading-relaxed text-muted-foreground">
        Generate an app-specific password at{' '}
        <a
          href="https://appleid.apple.com"
          target="_blank"
          rel="noreferrer"
          className="underline underline-offset-2"
        >
          appleid.apple.com
        </a>{' '}
        → Sign-In and Security → App-Specific Passwords. Your password is
        encrypted by the proxy and never stored in this app. See{' '}
        <span className="font-mono">docs/calendar.md</span>.
      </p>
    </section>
  )
}

function NotificationStatusBadge({
  supported,
  permission,
  subscribed,
}: {
  supported: boolean
  permission: NotificationPermission
  subscribed: boolean
}) {
  if (!supported) {
    return <Badge variant="secondary">Not supported on this device</Badge>
  }
  if (permission === 'denied') {
    return <Badge variant="destructive">Permission denied</Badge>
  }
  if (subscribed) return <Badge variant="success">Enabled</Badge>
  return <Badge variant="secondary">Disabled</Badge>
}

function NotificationsSection() {
  const supported = isPushSupported()
  const [permission, setPermission] = useState<NotificationPermission>(() =>
    getPermission(),
  )
  const [subscribed, setSubscribed] = useState(false)
  const [busy, setBusy] = useState(false)

  // Read the current subscription state once mounted (browser only — in jsdom
  // / unsupported environments `supported` is false and we skip straight to
  // the "Not supported" badge without touching the service worker).
  useEffect(() => {
    if (!supported) return
    let cancelled = false
    isSubscribed()
      .then((s) => {
        if (!cancelled) setSubscribed(s)
      })
      .catch(() => {
        // No active registration yet — treat as not subscribed.
      })
    return () => {
      cancelled = true
    }
  }, [supported])

  async function refresh() {
    setPermission(getPermission())
    try {
      setSubscribed(await isSubscribed())
    } catch {
      setSubscribed(false)
    }
  }

  async function enable() {
    setBusy(true)
    try {
      await requestPermissionAndSubscribe()
      await refresh()
      toast('Notifications enabled')
    } catch (e) {
      // Permission may have just flipped to denied — reflect it in the badge.
      setPermission(getPermission())
      toast.error(
        e instanceof Error ? e.message : 'Could not enable notifications',
      )
    } finally {
      setBusy(false)
    }
  }

  async function disable() {
    setBusy(true)
    try {
      await unsubscribe()
      await refresh()
      toast('Notifications disabled')
    } catch (e) {
      console.error('Disable notifications failed', e)
      toast.error(SAVE_ERROR)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="mt-8 border-t border-border pt-6">
      <div className="label mb-1">Notifications</div>
      <h2
        className="mb-3 text-[18px] font-semibold text-foreground"
        style={{ letterSpacing: '-0.01em' }}
      >
        Reminder notifications
      </h2>

      <div className="mb-4">
        <NotificationStatusBadge
          supported={supported}
          permission={permission}
          subscribed={subscribed}
        />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {supported && permission !== 'denied' && !subscribed && (
          <Button type="button" onClick={enable} disabled={busy}>
            <Bell className="size-4" />
            {busy ? 'Enabling…' : 'Enable notifications'}
          </Button>
        )}
        {supported && subscribed && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={disable}
            disabled={busy}
          >
            {busy ? 'Disabling…' : 'Disable notifications'}
          </Button>
        )}
      </div>

      {permission === 'denied' && (
        <p className="mt-3 max-w-md text-[12px] leading-relaxed text-muted-foreground">
          Notifications are blocked for this site. Re-enable them in your
          browser or system settings, then reload.
        </p>
      )}

      <p className="mt-4 max-w-md text-[12px] leading-relaxed text-muted-foreground">
        On iPhone and iPad, Web Push requires the app to be installed to the
        Home Screen (iOS 16.4+). Without an installed PWA and granted
        permission, reminders only appear in-app while a tab is open. See{' '}
        <span className="font-mono">docs/notifications.md</span>.
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
      <CalendarSection />
      <NotificationsSection />

      {isDevSurface && (
        <Suspense fallback={null}>
          <DeveloperSection />
        </Suspense>
      )}
    </div>
  )
}
