import { Suspense, lazy, useCallback, useEffect, useRef, useState } from 'react'
import { Bell, Download, Eye, EyeOff, Info, Link2, Trash2, Upload } from 'lucide-react'
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
import { supabase } from '@/lib/supabase'
import {
  TODAY_LIST_VARIANTS,
  type TodayListVariant,
  useTodayListStore,
} from '@/state/todayList'
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
 * Settings screen — Daylight re-skin (chunk 30). Every section's logic is the
 * shipped wiring (AI key, Apple Calendar credential flow + recovery, push,
 * export/import with typed REPLACE/CACHE confirmations, sync-issue recovery,
 * About, the gated Developer tools). This pass only restyles the markup and
 * tokens, drops the never-built dark/Appearance toggle (Decision A), and adds
 * the new Account section.
 *
 * The two layout primitives below (SettingsSection / SettingsRow) mirror the
 * prototype's vocabulary and are exported so About / DeveloperSection share
 * them rather than duplicating the grid.
 */
const DeveloperSection = lazy(() => import('@/components/DeveloperSection'))

const SAVE_ERROR = 'Could not save — retry'

/**
 * Numbered section block: a `.label` kicker, then a serif h2. `tone="danger"`
 * paints the kicker + title with the Daylight danger token (used by the
 * conditional Sync-issues recovery surface).
 */
export function SettingsSection({
  kicker,
  title,
  children,
  tone = 'default',
  id,
}: {
  kicker: React.ReactNode
  title: string
  children: React.ReactNode
  tone?: 'default' | 'danger'
  id?: string
}) {
  const danger = tone === 'danger'
  return (
    <section id={id} className="mb-9">
      <header className="mb-1.5">
        <span
          className="label"
          style={danger ? { color: 'var(--destructive)' } : undefined}
        >
          {kicker}
        </span>
        <h2
          className="mt-1.5 font-display text-[22px] font-medium"
          style={{
            letterSpacing: '-0.01em',
            color: danger ? 'var(--destructive)' : 'var(--ink)',
          }}
        >
          {title}
        </h2>
      </header>
      {children}
    </section>
  )
}

/**
 * Two-column row: title/hint on the left, control on the right, hairline
 * divider below. `align="center"` vertically centres the columns (used for
 * single-control rows like Email / Status).
 */
export function SettingsRow({
  title,
  hint,
  children,
  align = 'top',
}: {
  title: React.ReactNode
  hint?: React.ReactNode
  children: React.ReactNode
  align?: 'top' | 'center'
}) {
  return (
    <div
      className={`grid gap-7 border-b border-line py-5 ${
        align === 'center' ? 'items-center' : 'items-start'
      }`}
      style={{ gridTemplateColumns: 'minmax(180px, 220px) 1fr' }}
    >
      <div>
        <div className="text-[14px] font-medium text-ink">{title}</div>
        {hint && (
          <div className="mt-1 text-[12px] leading-relaxed text-ink-3">
            {hint}
          </div>
        )}
      </div>
      <div>{children}</div>
    </div>
  )
}

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
    <SettingsSection id="sync-issues" kicker="Sync" title="Sync issues" tone="danger">
      <p className="mb-4 max-w-xl text-[12px] leading-relaxed text-ink-3">
        These changes couldn&apos;t be saved to the server after several
        attempts. Retry them, or discard to drop the change on this device.
      </p>

      <ul className="max-w-2xl space-y-2">
        {rows.map((r) => (
          <li
            key={r.id}
            className="flex items-center justify-between gap-3 rounded-md border border-line bg-surface px-3 py-2"
          >
            <div className="min-w-0">
              <div className="text-[13px] text-ink">
                <span className="font-medium capitalize">{r.op}</span>{' '}
                <span className="num text-[12px] text-ink-2">{r.table}</span>
              </div>
              <div className="truncate text-[11px] text-ink-3">
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
    </SettingsSection>
  )
}

/**
 * Account (chunk 30, new). Email + sign out. Sign-out reuses the app's existing
 * Supabase call (the same one the header AccountMenu uses); the `<Protected>`
 * guard redirects to Login on the auth-state change, so we don't route manually
 * (Decision G).
 */
function AccountSection() {
  const { user } = useSession()
  const email = user?.email ?? ''

  async function signOut() {
    const { error } = await supabase.auth.signOut()
    if (error) {
      toast.error(error.message || 'Could not sign out. Try again.')
    }
  }

  return (
    <SettingsSection kicker="01" title="Account">
      <SettingsRow title="Email" align="center">
        <div className="flex items-center gap-3">
          <span className="num text-[14px] text-ink">{email}</span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="ml-auto"
            onClick={signOut}
          >
            Sign out
          </Button>
        </div>
      </SettingsRow>
    </SettingsSection>
  )
}

/**
 * Display (Today list). A client-only VIEW preference — no schema migration, no
 * synced field — persisted per-device via the `todayList` store. Placed near the
 * top as the dashboard's layout control. This is the "density/layout options"
 * home the brief refers to; the app didn't previously have one, so it's created
 * here.
 */
const TODAY_LIST_LABELS: Record<TodayListVariant, string> = {
  stacked: 'Stacked',
  rail: 'Rail',
  banner: 'Banner',
  off: 'Off',
}

function DisplaySection() {
  const todayList = useTodayListStore((s) => s.todayList)
  const setTodayList = useTodayListStore((s) => s.setTodayList)

  return (
    <SettingsSection kicker="Display" title="Display">
      <SettingsRow
        title="Today list"
        hint="How the Today plan appears on your dashboard: a full-width card (stacked), a side rail, a compact banner, or hidden."
      >
        <div
          className="inline-flex flex-wrap rounded-full border border-line bg-bg-alt p-0.5"
          role="group"
          aria-label="Today list layout"
        >
          {TODAY_LIST_VARIANTS.map((v) => (
            <button
              key={v}
              type="button"
              aria-pressed={todayList === v}
              onClick={() => setTodayList(v)}
              className={`rounded-full px-4 py-1.5 text-[13px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                todayList === v
                  ? 'bg-surface font-semibold text-ink shadow-[0_1px_0_var(--line)]'
                  : 'font-medium text-ink-3 hover:text-ink'
              }`}
            >
              {TODAY_LIST_LABELS[v]}
            </button>
          ))}
        </div>
      </SettingsRow>
    </SettingsSection>
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
    <SettingsSection kicker="03" title="AI assist">
      <SettingsRow
        title="Anthropic API key"
        hint={
          <>
            Stored in your Supabase data, accessible only by you (RLS). Calls are
            made directly from your browser. See{' '}
            <span className="mono">docs/security.md</span>.
          </>
        }
      >
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
          <span className="num text-[11px] text-ink-3">
            Uses claude-haiku-4-5
          </span>
        </div>

        <p className="mt-3 max-w-md text-[12px] leading-relaxed text-ink-3">
          “What’s next?” triage sends your incomplete task titles, their category
          and subcategory, time estimate, due date, and priority to Anthropic —
          never your notes.
        </p>
      </SettingsRow>
    </SettingsSection>
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
    <SettingsSection kicker="02" title="Apple Calendar">
      <SettingsRow title="Status" align="center">
        <div className="flex flex-wrap items-center gap-3">
          <StatusBadge status={caldavStatus} testing={testing} />
          <span className="text-[12px] leading-relaxed text-ink-3">
            CalDAV via our serverless proxy. The app-specific password is
            encrypted at rest.
          </span>
        </div>
      </SettingsRow>

      <SettingsRow title="Apple ID" hint="Your iCloud email.">
        <Input
          id="caldav-apple-id"
          type="email"
          value={appleId}
          onChange={(e) => setAppleId(e.target.value)}
          placeholder="you@icloud.com"
          aria-label="Apple ID"
          autoComplete="off"
          spellCheck={false}
          className="max-w-md"
        />
      </SettingsRow>

      <SettingsRow
        title="App-specific password"
        hint={
          <>
            Generate one at{' '}
            <a
              href="https://appleid.apple.com"
              target="_blank"
              rel="noreferrer"
              className="underline underline-offset-2"
              style={{ color: 'var(--accent)' }}
            >
              appleid.apple.com
            </a>{' '}
            → Sign-In and Security → App-Specific Passwords. Encrypted by the
            proxy and never stored in this app. See{' '}
            <span className="mono">docs/calendar.md</span>.
          </>
        }
      >
        <div className="flex max-w-md items-center gap-2">
          <Input
            id="caldav-app-password"
            type={showPass ? 'text' : 'password'}
            value={appPassword}
            onChange={(e) => setAppPassword(e.target.value)}
            placeholder="xxxx-xxxx-xxxx-xxxx"
            aria-label="App-specific password"
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

        <div className="mt-2.5 flex flex-wrap items-center gap-2">
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
              className="h-9 rounded-md border border-line bg-surface px-2 text-[13px] text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
          <div className="mt-2.5">
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
          </div>
        )}
      </SettingsRow>
    </SettingsSection>
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
    <SettingsSection kicker="04" title="Notifications">
      <SettingsRow
        title="Web push"
        hint="Reminders fire when a task comes due, even if the app isn't open."
      >
        <div className="mb-3">
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
          <p className="mt-3 max-w-md text-[12px] leading-relaxed text-ink-3">
            Notifications are blocked for this site. Re-enable them in your
            browser or system settings, then reload.
          </p>
        )}

        <div className="mt-3 flex max-w-md items-start gap-2.5 rounded-md border border-line bg-bg-alt px-3.5 py-3">
          <Info className="mt-0.5 size-4 shrink-0 text-ink-3" />
          <p className="text-[12px] leading-relaxed text-ink-2">
            On iPhone and iPad, Web Push requires the app to be installed to the
            Home Screen (iOS 16.4+). Without an installed PWA and granted
            permission, reminders only appear in-app while a tab is open. See{' '}
            <span className="mono">docs/notifications.md</span>.
          </p>
        </div>
      </SettingsRow>
    </SettingsSection>
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
          ? `Replaced — ${total} items imported from the file. Your Apple Calendar connection is preserved; re-enable notifications on this device if you use them (push subscriptions aren't part of an export).`
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
    <SettingsSection kicker="05" title="Data">
      <SettingsRow
        title="Export"
        hint="Pulls your data from the server as a single JSON file. The encrypted calendar password is never included."
      >
        <Button onClick={onExport} disabled={busy || !userId}>
          <Download className="size-4" />
          Export all data
        </Button>
      </SettingsRow>

      <SettingsRow
        title="Import"
        hint="Merge into, or fully replace, your current data."
      >
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
      </SettingsRow>

      <SettingsRow
        title="Local cache"
        hint={
          <>
            Safe: clears only this device&rsquo;s cached copy. Your data on the
            server is untouched and re-downloads on next load; un-synced offline
            edits are kept. This is <strong className="text-ink-2">not</strong>{' '}
            &ldquo;Wipe my data&rdquo; (Developer tools), which deletes from the
            server.
          </>
        }
      >
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
      </SettingsRow>

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
            <ul className="rounded-md border border-line bg-bg-alt px-3 py-2 text-[12px] text-ink-2">
              {Object.entries(counts).map(([table, n]) => (
                <li key={table} className="flex justify-between">
                  <span className="mono">{table}</span>
                  <span className="num">{n}</span>
                </li>
              ))}
            </ul>
          )}

          <div
            className="inline-flex rounded-full border border-line bg-bg-alt p-0.5"
            role="group"
            aria-label="Import mode"
          >
            {(['merge', 'replace'] as const).map((m) => (
              <button
                key={m}
                type="button"
                aria-pressed={mode === m}
                onClick={() => setMode(m)}
                className={`rounded-full px-4 py-1.5 text-[13px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                  mode === m
                    ? 'bg-surface font-semibold text-ink shadow-[0_1px_0_var(--line)]'
                    : 'font-medium text-ink-3 hover:text-ink'
                }`}
              >
                {m === 'merge' ? 'Merge' : 'Replace all'}
              </button>
            ))}
          </div>

          <p className="text-[12px] leading-relaxed text-ink-3">
            {mode === 'merge'
              ? 'Adds new rows and overwrites matching ones (by id). Nothing is deleted.'
              : 'Deletes all your current data, then loads the file. Your Apple Calendar connection is preserved; you’ll re-enable notifications on this device (push subscriptions aren’t part of an export).'}
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
    </SettingsSection>
  )
}

export default function Settings() {
  const { user } = useSession()
  const isDevSurface =
    import.meta.env.DEV ||
    (typeof window !== 'undefined' &&
      new URLSearchParams(window.location.search).has('dev'))

  return (
    <div>
      <header className="mb-7">
        <h1
          className="m-0 font-display text-[32px] font-medium text-ink"
          style={{ letterSpacing: '-0.02em' }}
        >
          Settings
        </h1>
        <span className="label">{user?.email}</span>
      </header>

      <SyncIssuesSection />
      <AccountSection />
      <DisplaySection />
      <CalendarSection />
      <AiKeySection />
      <NotificationsSection />
      <DataSection />

      {isDevSurface && (
        <Suspense fallback={null}>
          <DeveloperSection />
        </Suspense>
      )}

      <About />
    </div>
  )
}
