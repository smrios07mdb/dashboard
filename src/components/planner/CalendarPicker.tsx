import { useState } from 'react'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { Switch } from '@/components/ui/switch'
import { repo } from '@/db/repo'
import type { ReadCalendar } from '@/db/types'
import { listCalendars } from '@/lib/calendarApi'
import { calendarColorMap } from '@/lib/calendarColors'
import { useUIStore } from '@/state/uiStore'

/*
 * Planner "Calendars" picker (chunk 51, D1). A quiet header chip in the
 * `StaleChip` family opening a popover with one row per iCloud calendar and
 * a switch: the READ set. `caldav_calendar_url` — the WRITE target for
 * planner mirrors — is chosen in Settings and only tagged here.
 *
 * Persistence lives in this component: each toggle is optimistic (draft-or-
 * null, prompts/README), writes `settings.caldav_read_calendars` through the
 * repo, and on success bumps `busyRefreshKey` so the per-week busy cache
 * drops and the next `/busy` reflects the change; on error it toasts and
 * reverts to the stored set. Opening the popover re-runs discovery with the
 * stored credentials: calendars created since init are appended enabled,
 * calendars that vanished upstream are dropped — silently on failure.
 *
 * Initialization of a `null` set is the Planner's job (once per mount);
 * this component only renders whatever it is given. Each row carries a
 * color dot (chunk 51b) — the same per-calendar color the busy blocks use
 * (`lib/calendarColors`: iCloud's color, made distinct across the set).
 */

export type CalendarPickerProps = {
  userId: string
  /** The stored read set; `null` = not initialized yet. */
  calendars: ReadCalendar[] | null
  /** `settings.caldavCalendarUrl` — tagged `WRITE` in the list. */
  writeTargetUrl: string | null
  /** True while the Planner's one-shot initialization is in flight. */
  initializing: boolean
  /** Called with the set that was just persisted so the owner's copy of
   *  settings stays current without waiting for the realtime echo. */
  onPersisted: (next: ReadCalendar[]) => void
}

const SAVE_ERROR = 'Could not save — retry.'

export default function CalendarPicker({
  userId,
  calendars,
  writeTargetUrl,
  initializing,
  onPersisted,
}: CalendarPickerProps) {
  // Draft-or-null: render from the prop unless a write is in flight.
  const [draft, setDraft] = useState<ReadCalendar[] | null>(null)
  const [open, setOpen] = useState(false)
  const shown = draft ?? calendars

  const enabledCount = shown?.filter((c) => c.enabled).length ?? 0
  const label =
    shown === null
      ? initializing
        ? 'CALENDARS · …'
        : 'CALENDARS · –'
      : `CALENDARS · ${enabledCount}/${shown.length}`

  async function persist(next: ReadCalendar[], bump: boolean) {
    setDraft(next)
    try {
      await repo.settings.update(userId, { caldavReadCalendars: next })
      onPersisted(next)
      if (bump) useUIStore.getState().forceBusyRefresh()
    } catch (e) {
      console.error('Calendar picker: save failed', e)
      toast.error(SAVE_ERROR)
    } finally {
      setDraft(null)
    }
  }

  function toggle(url: string, enabled: boolean) {
    if (!shown) return
    void persist(
      shown.map((c) => (c.url === url ? { ...c, enabled } : c)),
      true,
    )
  }

  /** Re-discover on open; merge new calendars in (enabled), drop vanished. */
  async function refresh(current: ReadCalendar[] | null) {
    let discovered
    try {
      discovered = (await listCalendars()).calendars
    } catch {
      return // silent: show the stored set
    }
    const known = new Map((current ?? []).map((c) => [c.url, c]))
    const next: ReadCalendar[] = discovered.map((d) => {
      const k = known.get(d.url)
      return {
        url: d.url,
        name: d.name,
        enabled: k ? k.enabled : true,
        ...(d.color ? { color: d.color } : {}),
      }
    })
    const same =
      current !== null &&
      current.length === next.length &&
      current.every(
        (c, i) =>
          c.url === next[i]?.url &&
          c.name === next[i]?.name &&
          c.enabled === next[i]?.enabled &&
          c.color === next[i]?.color,
      )
    if (same) return
    // Only a change in what is READ needs the busy cache dropped.
    const readChanged =
      current === null ||
      current
        .filter((c) => c.enabled)
        .map((c) => c.url)
        .join('\n') !==
        next
          .filter((c) => c.enabled)
          .map((c) => c.url)
          .join('\n')
    await persist(next, readChanged)
  }

  const writeName = shown?.find((c) => c.url === writeTargetUrl)?.name
  const colors = calendarColorMap(shown)

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o)
        if (o && !initializing) void refresh(shown)
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="Calendars"
          className="mono inline-flex items-center gap-1.5 rounded-full px-[9px] py-[3px] text-[9px] font-semibold tracking-[.13em] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          style={{
            background: 'color-mix(in srgb, var(--ink) 6%, transparent)',
            border: '1px solid color-mix(in srgb, var(--ink) 14%, transparent)',
            color: 'var(--ink-2)',
          }}
        >
          {label}
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="w-[264px] rounded border-line bg-surface p-0 text-ink shadow-md"
      >
        <div className="label px-[13px] pt-[11px]" style={{ fontSize: 8.5 }}>
          READ FROM
        </div>
        {shown === null ? (
          <div className="px-[13px] py-2.5 text-[12px] text-ink-3">
            {initializing
              ? 'Loading calendars…'
              : 'Could not load calendars — retry on the next visit.'}
          </div>
        ) : shown.length === 0 ? (
          <div className="px-[13px] py-2.5 text-[12px] text-ink-3">
            No event calendars found on this Apple ID.
          </div>
        ) : (
          <ul className="m-0 list-none px-[13px] py-1.5">
            {shown.map((c) => {
              const id = `cal-${c.url.replace(/[^A-Za-z0-9]/g, '-')}`
              const isWrite = c.url === writeTargetUrl
              const color = colors.get(c.name)
              return (
                <li
                  key={c.url}
                  className="flex items-center gap-2 py-[5px]"
                >
                  <span
                    aria-hidden
                    data-testid="calendar-swatch"
                    className="inline-block h-[8px] w-[8px] shrink-0 rounded-full"
                    style={{
                      background: color ?? 'var(--busy-icloud-ln)',
                      opacity: c.enabled ? 1 : 0.35,
                    }}
                  />
                  <label
                    htmlFor={id}
                    className="min-w-0 flex-1 cursor-pointer truncate text-[12.5px] text-ink"
                  >
                    {c.name || c.url}
                  </label>
                  {isWrite && (
                    <span
                      className="label rounded-sm px-1 py-px"
                      style={{
                        fontSize: 8,
                        background: 'var(--accent-soft)',
                        color: 'var(--accent-ink)',
                      }}
                    >
                      WRITE
                    </span>
                  )}
                  <Switch
                    id={id}
                    aria-label={c.name || c.url}
                    checked={c.enabled}
                    disabled={draft !== null}
                    onCheckedChange={(v) => toggle(c.url, v)}
                  />
                </li>
              )
            })}
          </ul>
        )}
        <hr className="m-0 border-line" />
        <div className="px-[13px] py-2 text-[11px] text-ink-3">
          Planner blocks write to{' '}
          <span className="text-ink-2">{writeName ?? 'the selected calendar'}</span>
          . Change in{' '}
          <Link
            to="/settings"
            className="underline underline-offset-2"
            style={{ color: 'var(--accent)' }}
          >
            Settings
          </Link>
          .
        </div>
      </PopoverContent>
    </Popover>
  )
}
