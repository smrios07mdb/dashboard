import { Suspense, lazy, useCallback, useEffect, useRef, useState } from 'react'
import { Bell, Download, Eye, EyeOff, Link2, Trash2, Upload } from 'lucide-react'
import { toast } from 'sonner'

import About from '@/components/About'
import DeleteConfirm from '@/components/DeleteConfirm'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { wipeLocalCache } from '@/db/localCache'
import {
  discardAllFailed,
  discardOutboxRow,
  getSyncIssues,
  retryAllFailed,
  retryOutboxRow,
} from '@/db/outbox'
import { repo } from '@/db/repo'
import { useSyncStore } from '@/db/syncStore'
import type { CaldavStatus, OutboxRow } from '@/db/types'
import { useSession } from '@/lib/auth'
import {
  downloadExport,
  exportAllData,
  exportFilename,
} from '@/lib/export'
import {
  importData,
  type ImportMode,
  previewCounts,
  validateImport,
} from '@/lib/import'
import { useUIStore } from '@/state/uiStore'
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

function formatAge(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime()
  if (Number.isNaN(ms)) return ''
  const mins = Math.floor(ms / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

/**
 * Sync issues (chunk 15). Rendered only while `syncStore.state === 'sync_issues'`
 * — i.e. one or more outbox rows have exhausted their retries (ARCH §6). Lists
 * the failed bucket with per-row Retry / Discard plus bulk actions. Retry resets
 * the row's attempts/backoff and re-runs the drain; Discard drops the change on
 * this device without touching Supabase.
 */
function SyncIssuesSection() {
  const state = useSyncStore((s) => s.state)
  const [rows, setRows] = useState<OutboxRow[]>([])
  const [busy, setBusy] = useState(false)

  // Reload used by the action handlers (event-driven setState is fine).
  const reload = useCallback(async () => {
    setRows(await getSyncIssues())
  }, [])

  // Initial/on-state-change load uses the .then(setState) + cancelled form so
  // the setState lands in a promise callback (the project's established
  // pattern — avoids react-hooks/set-state-in-effect; see prompts/README.md).
  useEffect(() => {
    if (state !== 'sync_issues') return
    let cancelled = false
    getSyncIssues()
      .then((r) => {
        if (!cancelled) setRows(r)
      })
      .catch(() => {
        // Reading the local outbox shouldn't fail; nothing to surface.
      })
    return () => {
      cancelled = true
    }
  }, [state])

  if (state !== 'sync_issues') return null

  async function run(action: () => Promise<unknown>) {
    setBusy(true)
    try {
      await action()
    } catch (e) {
      console.error('Sync issue action failed', e)
      toast.error(SAVE_ERROR)
    } finally {
      setBusy(false)
      await reload()
    }
  }

  return (
    <section id="sync-issues" className="mt-8 border-t border-border pt-6">
      <div className="label mb-1">Sync</div>
      <h2
        className="mb-3 text-[18px] font-semibold text-destructive"
        style={{ letterSpacing: '-0.01em' }}
      >
        Sync issues
      </h2>
      <p className="mb-4 max-w-md text-[12px] leading-relaxed text-muted-foreground">
        These changes couldn&apos;t be saved to the server after several
        attempts. Retry them, or discard to drop the change on this device.
      </p>

      <ul className="max-w-2xl space-y-2">
        {rows.map((r) => (
          <li
            key={r.id}
            className="flex items-center justify-between gap-3 rounded-md border border-border bg-card px-3 py-2"
          >
            <div className="min-w-0">
              <div className="text-[13px] text-foreground">
                <span className="font-medium capitalize">{r.op}</span>{' '}
                <span className="font-mono text-[12px] text-secondary-foreground">
                  {r.table}
                </span>
              </div>
              <div className="truncate text-[11px] text-muted-foreground">
                {r.lastError ?? 'Unknown error'} · {r.attempts} attempts ·{' '}
                {formatAge(r.createdAt)}
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={busy || r.id === undefined}
                onClick={() => run(() => retryOutboxRow(r.id as number))}
              >
                Retry
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={busy || r.id === undefined}
                onClick={() => run(() => discardOutboxRow(r.id as number))}
              >
                Discard
              </Button>
            </div>
          </li>
        ))}
      </ul>

      <div className="mt-3 flex items-center gap-2">
        <Button
          type="button"
          size="sm"
          disabled={busy || rows.length === 0}
          onClick={() => run(retryAllFailed)}
        >
          Retry all
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={busy || rows.length === 0}
          onClick={() => run(discardAllFailed)}
        >
          Discard all
        </Button>
      </div>
    </section>
  )
}

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

/**
 * Data section (chunk 16): export, import (Merge / Replace), and the SAFE
 * "Wipe local cache" (R3 — Dexie-only, distinct from Developer's destructive
 * "Wipe my data"). Replace validates the file before any delete (R4) and
 * requires a typed REPLACE; Wipe local cache requires a typed CACHE.
 */
function DataSection() {
  const { user } = useSession()
  const userId = user?.id ?? null
  const [busy, setBusy] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [importOpen, setImportOpen] = useState(false)
  const [parsed, setParsed] = useState<unknown>(null)
  const [counts, setCounts] = useState<Record<string, number> | null>(null)
  const [mode, setMode] = useState<ImportMode>('merge')
  const [confirmText, setConfirmText] = useState('')

  const [wipeOpen, setWipeOpen] = useState(false)
  const [wipeConfirm, setWipeConfirm] = useState('')

  async function onExport() {
    if (!userId) return
    setBusy(true)
    try {
      const payload = await exportAllData(userId)
      downloadExport(payload, exportFilename())
      toast('Data exported')
    } catch (e) {
      console.error('Export failed', e)
      toast.error('Could not export — retry')
    } finally {
      setBusy(false)
    }
  }

  async function onFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = '' // allow re-selecting the same file later
    if (!file) return
    try {
      const json = JSON.parse(await file.text())
      // Validate BEFORE opening the dialog so a bad file never reaches Replace.
      const validated = validateImport(json)
      setParsed(json)
      setCounts(previewCounts(validated))
      setMode('merge')
      setConfirmText('')
      setImportOpen(true)
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'That file could not be read.',
      )
    }
  }

  const canConfirmImport =
    mode === 'merge' || confirmText.trim().toUpperCase() === 'REPLACE'

  async function onConfirmImport() {
    if (!userId || parsed === null || !canConfirmImport) return
    setBusy(true)
    try {
      const res = await importData(parsed, mode, userId)
      setImportOpen(false)
      useUIStore.getState().forceDashboardRefresh()
      const total = Object.values(res.counts).reduce((a, b) => a + b, 0)
      toast(
        mode === 'replace'
          ? `Replaced — ${total} items imported. Reconnect Apple Calendar; push notifications weren't included (device-specific).`
          : `Merged — ${total} items applied.`,
      )
    } catch (e) {
      console.error('Import failed', e)
      toast.error(
        mode === 'replace'
          ? 'Replace failed partway — some data may not have imported. Re-import your export file to restore.'
          : 'Could not import — retry',
      )
    } finally {
      setBusy(false)
    }
  }

  async function onWipeCache() {
    if (wipeConfirm.trim().toUpperCase() !== 'CACHE') return
    setBusy(true)
    try {
      await wipeLocalCache()
      useUIStore.getState().forceDashboardRefresh()
      setWipeOpen(false)
      setWipeConfirm('')
      toast('Local cache cleared — re-downloading from the server.')
    } catch (e) {
      console.error('Wipe local cache failed', e)
      toast.error('Could not clear the cache — retry')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="mt-8 border-t border-border pt-6">
      <div className="label mb-1">Data</div>
      <h2
        className="mb-3 text-[18px] font-semibold text-foreground"
        style={{ letterSpacing: '-0.01em' }}
      >
        Export &amp; import
      </h2>
      <p className="mb-4 max-w-md text-[12px] leading-relaxed text-muted-foreground">
        Export pulls your data from the server as JSON (the encrypted calendar
        password is never included). Import can merge into, or fully replace,
        your current data.
      </p>

      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={onExport} disabled={busy || !userId}>
          <Download className="size-4" />
          Export all data
        </Button>
        <Button
          variant="secondary"
          onClick={() => fileInputRef.current?.click()}
          disabled={busy || !userId}
        >
          <Upload className="size-4" />
          Import data
        </Button>
        <input
          ref={fileInputRef}
          type="file"
          accept="application/json,.json"
          className="hidden"
          aria-hidden
          tabIndex={-1}
          onChange={onFileSelected}
        />
      </div>

      <div className="mt-6">
        <div className="label mb-1">Local cache</div>
        <p className="mb-3 max-w-md text-[12px] leading-relaxed text-muted-foreground">
          Safe: clears only this device&rsquo;s cached copy. Your data on the
          server is untouched and re-downloads on next load; un-synced offline
          edits are kept. This is <strong>not</strong> &ldquo;Wipe my
          data&rdquo; (Developer tools), which deletes from the server.
        </p>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            setWipeConfirm('')
            setWipeOpen(true)
          }}
          disabled={busy}
        >
          <Trash2 className="size-4" />
          Wipe local cache
        </Button>
      </div>

      {/* Import dialog */}
      <Dialog open={importOpen} onOpenChange={setImportOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Import data</DialogTitle>
            <DialogDescription>
              Choose how to apply this file to your account.
            </DialogDescription>
          </DialogHeader>

          {counts && (
            <ul className="rounded-md border border-border bg-secondary/40 px-3 py-2 text-[12px] text-secondary-foreground">
              {Object.entries(counts).map(([table, n]) => (
                <li key={table} className="flex justify-between">
                  <span className="font-mono">{table}</span>
                  <span>{n}</span>
                </li>
              ))}
            </ul>
          )}

          <div
            className="flex gap-2"
            role="group"
            aria-label="Import mode"
          >
            {(['merge', 'replace'] as const).map((m) => (
              <button
                key={m}
                type="button"
                aria-pressed={mode === m}
                onClick={() => setMode(m)}
                className={`flex-1 rounded-md border px-3 py-2 text-[13px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                  mode === m
                    ? 'border-primary bg-secondary font-semibold text-foreground'
                    : 'border-border text-muted-foreground hover:text-foreground'
                }`}
              >
                {m === 'merge' ? 'Merge' : 'Replace all'}
              </button>
            ))}
          </div>

          <p className="text-[12px] leading-relaxed text-muted-foreground">
            {mode === 'merge'
              ? 'Adds new rows and overwrites matching ones (by id). Nothing is deleted.'
              : 'Deletes all your current data, then loads the file. The Apple Calendar password and push subscriptions are not restored — you’ll reconnect the calendar and re-enable notifications.'}
          </p>

          {mode === 'replace' && (
            <div>
              <label
                htmlFor="import-replace-confirm"
                className="label mb-1 block"
              >
                Type REPLACE to confirm
              </label>
              <Input
                id="import-replace-confirm"
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value)}
                placeholder="REPLACE"
                autoComplete="off"
              />
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setImportOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={onConfirmImport}
              disabled={!canConfirmImport || busy}
              className={
                mode === 'replace'
                  ? 'bg-destructive text-destructive-foreground hover:bg-destructive/90'
                  : undefined
              }
            >
              {busy
                ? 'Importing…'
                : mode === 'replace'
                  ? 'Replace everything'
                  : 'Merge'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Wipe local cache dialog */}
      <Dialog open={wipeOpen} onOpenChange={setWipeOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Wipe local cache</DialogTitle>
            <DialogDescription>
              Clears this device&rsquo;s cached copy only. The server is
              untouched and the cache rebuilds on next load; un-synced offline
              edits are kept.
            </DialogDescription>
          </DialogHeader>
          <div>
            <label htmlFor="wipe-cache-confirm" className="label mb-1 block">
              Type CACHE to confirm
            </label>
            <Input
              id="wipe-cache-confirm"
              value={wipeConfirm}
              onChange={(e) => setWipeConfirm(e.target.value)}
              placeholder="CACHE"
              autoComplete="off"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setWipeOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={onWipeCache}
              disabled={wipeConfirm.trim().toUpperCase() !== 'CACHE' || busy}
            >
              {busy ? 'Clearing…' : 'Clear cache'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
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

      <SyncIssuesSection />
      <AiKeySection />
      <CalendarSection />
      <NotificationsSection />
      <DataSection />
      <About />

      {isDevSurface && (
        <Suspense fallback={null}>
          <DeveloperSection />
        </Suspense>
      )}
    </div>
  )
}
