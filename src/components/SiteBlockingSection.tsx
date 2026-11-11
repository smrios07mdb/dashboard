import { useEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'
import { toast } from 'sonner'

import DeleteConfirm from '@/components/DeleteConfirm'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { repo, type BlockGroupPatch } from '@/db/repo'
import type { BlockGroup } from '@/db/types'
import { useSession } from '@/lib/auth'
import {
  MAX_DOMAINS,
  MAX_GROUPS,
  MAX_NAME,
  normalizeDomain,
  parseDailyMinutes,
} from '@/lib/blockRules'
import { SettingsRow, SettingsSection } from '@/screens/Settings'
import { useUIStore } from '@/state/uiStore'

/*
 * Settings › Site blocking (chunk 99, ARCHITECTURE.md §13 / D11; the daily
 * allowance, chunk 100 / D10). Edits the `block_groups` rows the menu bar app
 * enforces on the Mac. Built from the
 * existing Settings row, switch, input and confirm-dialog patterns. Every
 * change saves at once through `repo.blockGroups`.
 */

const SAVE_ERROR = 'Could not save — retry'
const INVALID_SHADOW = 'shadow-[inset_0_0_0_1px_hsl(var(--destructive))]'

const DAY_LETTERS = ['S', 'M', 'T', 'W', 'T', 'F', 'S']
const DAY_NAMES = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
]

export default function SiteBlockingSection() {
  const { user } = useSession()
  const userId = user?.id ?? null
  const refreshKey = useUIStore((s) => s.dashboardRefreshKey)
  const [groups, setGroups] = useState<BlockGroup[] | null>(null)
  const [focusId, setFocusId] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)

  useEffect(() => {
    if (!userId) return
    let cancelled = false
    repo.blockGroups
      .list()
      .then((g) => {
        if (!cancelled) setGroups(g)
      })
      .catch((e) => {
        console.error('Load block groups failed', e)
        if (!cancelled) setGroups((prev) => prev ?? [])
      })
    return () => {
      cancelled = true
    }
  }, [userId, refreshKey])

  const list = groups ?? []
  const atCap = list.length >= MAX_GROUPS

  async function addGroup() {
    if (!userId || atCap) return
    setAdding(true)
    try {
      const sortOrder = list.reduce((m, g) => Math.max(m, g.sortOrder + 1), 0)
      const created = await repo.blockGroups.create({
        userId,
        name: 'New group',
        domains: [],
        blockInFocus: true,
        sortOrder,
      })
      setGroups((prev) => [...(prev ?? []), created])
      setFocusId(created.id)
    } catch (e) {
      console.error('Create block group failed', e)
      toast.error(SAVE_ERROR)
    } finally {
      setAdding(false)
    }
  }

  async function save(id: string, patch: BlockGroupPatch) {
    try {
      const next = await repo.blockGroups.update(id, patch)
      setGroups((prev) => (prev ?? []).map((g) => (g.id === id ? next : g)))
    } catch (e) {
      console.error('Update block group failed', e)
      toast.error(SAVE_ERROR)
    }
  }

  async function remove(id: string) {
    try {
      await repo.blockGroups.delete(id)
      setGroups((prev) => (prev ?? []).filter((g) => g.id !== id))
    } catch (e) {
      console.error('Delete block group failed', e)
      toast.error(SAVE_ERROR)
    }
  }

  return (
    <SettingsSection kicker="06" title="Site blocking">
      <p className="mb-1 max-w-xl text-[12px] leading-relaxed text-ink-3">
        Enforced by the menu bar app on your Mac, in Chrome, Safari, Brave and
        Edge. A change reaches the Mac the next time its panel opens.
      </p>

      {groups !== null && list.length === 0 && (
        <p className="border-b border-line py-5 text-[13px] text-ink-3">
          No groups yet. Add one to block sites during focus or at set hours.
        </p>
      )}

      {list.map((g) => (
        <GroupBlock
          key={g.id}
          group={g}
          autoFocusName={focusId === g.id}
          onSave={(patch) => save(g.id, patch)}
          onDelete={() => remove(g.id)}
        />
      ))}

      <div className="flex items-center gap-3 py-4">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={addGroup}
          disabled={!userId || atCap || adding || groups === null}
        >
          Add group
        </Button>
        {atCap && (
          <span className="text-[12px] text-ink-3">
            {MAX_GROUPS} groups at most
          </span>
        )}
      </div>
    </SettingsSection>
  )
}

function SwitchRow({
  label,
  checked,
  onChange,
}: {
  label: string
  checked: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <label className="flex items-center justify-between gap-3 py-1.5 text-[13px] text-ink">
      <span>{label}</span>
      <Switch aria-label={label} checked={checked} onCheckedChange={onChange} />
    </label>
  )
}

function GroupBlock({
  group,
  autoFocusName,
  onSave,
  onDelete,
}: {
  group: BlockGroup
  autoFocusName: boolean
  onSave: (patch: BlockGroupPatch) => Promise<void>
  onDelete: () => Promise<void>
}) {
  // Draft-or-null (prompts/README "State patterns").
  const [nameDraft, setNameDraft] = useState<string | null>(null)
  const [site, setSite] = useState('')
  const [siteError, setSiteError] = useState<string | null>(null)
  const [minutesDraft, setMinutesDraft] = useState<string | null>(null)
  const nameRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (autoFocusName) {
      nameRef.current?.focus()
      nameRef.current?.select()
    }
  }, [autoFocusName])

  const nameValue = nameDraft ?? group.name
  const nameValid = nameValue.trim().length >= 1 && nameValue.trim().length <= MAX_NAME

  function commitName() {
    if (nameDraft === null) return
    const trimmed = nameDraft.trim()
    setNameDraft(null)
    if (!nameValid || trimmed === group.name) return
    void onSave({ name: trimmed })
  }

  function addSite() {
    const raw = site.trim()
    if (!raw) return
    const domain = normalizeDomain(raw)
    if (!domain) {
      setSiteError('Not a site address')
      return
    }
    if (group.domains.includes(domain)) {
      setSite('')
      setSiteError(null)
      return
    }
    if (group.domains.length >= MAX_DOMAINS) {
      setSiteError(`${MAX_DOMAINS} sites at most`)
      return
    }
    setSite('')
    setSiteError(null)
    void onSave({ domains: [...group.domains, domain] })
  }

  function toggleDay(d: number) {
    const on = group.scheduleDays.includes(d)
    if (on && group.scheduleDays.length <= 1) return
    const next = on
      ? group.scheduleDays.filter((x) => x !== d)
      : [...group.scheduleDays, d].sort((a, b) => a - b)
    void onSave({ scheduleDays: next })
  }

  const pastMidnight = group.scheduleTo <= group.scheduleFrom

  // A row cached before chunk 100 has neither field.
  const limitOn = group.dailyLimitOn === true
  const savedMinutes = group.dailyLimitMinutes ?? 30
  const minutesValue = minutesDraft ?? String(savedMinutes)
  const minutes = parseDailyMinutes(minutesValue)

  /** Blur and Enter: a valid value saves; an invalid one is not saved. */
  function commitMinutes() {
    if (minutesDraft === null) return
    setMinutesDraft(null)
    if (minutes === null || minutes === savedMinutes) return
    void onSave({ dailyLimitMinutes: minutes })
  }

  return (
    <div role="group" aria-label={group.name}>
      <SettingsRow
        title={
          <Input
            ref={nameRef}
            aria-label="Group name"
            value={nameValue}
            maxLength={MAX_NAME}
            aria-invalid={!nameValid}
            className={nameValid ? undefined : INVALID_SHADOW}
            onChange={(e) => setNameDraft(e.target.value)}
            onBlur={commitName}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                if (nameValid) commitName()
              } else if (e.key === 'Escape') {
                setNameDraft(null)
              }
            }}
          />
        }
        hint={
          <div className="mt-2 space-y-2">
            <SwitchRow
              label="On"
              checked={group.enabled}
              onChange={(v) => void onSave({ enabled: v })}
            />
            <DeleteConfirm
              trigger={
                <Button type="button" variant="outline" size="sm">
                  Delete
                </Button>
              }
              title={`Delete "${group.name}"?`}
              description="Its sites stop being blocked on your Mac."
              onConfirm={onDelete}
            />
          </div>
        }
      >
        <div className="space-y-3">
          <div>
            {group.domains.length > 0 && (
              <ul className="mb-2 flex flex-wrap gap-1.5" aria-label="Sites">
                {group.domains.map((d) => (
                  <li
                    key={d}
                    className="inline-flex items-center gap-1 rounded-full border border-line bg-bg-alt py-0.5 pl-3 pr-1 text-[12px] text-ink"
                  >
                    <span className="mono">{d}</span>
                    <button
                      type="button"
                      aria-label={`Remove ${d}`}
                      className="rounded-full p-0.5 text-ink-3 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      onClick={() =>
                        void onSave({
                          domains: group.domains.filter((x) => x !== d),
                        })
                      }
                    >
                      <X className="size-3" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <Input
              aria-label="Add a site"
              placeholder="Add a site"
              value={site}
              aria-invalid={siteError !== null}
              className={`max-w-xs ${siteError ? INVALID_SHADOW : ''}`}
              onChange={(e) => {
                setSite(e.target.value)
                setSiteError(null)
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ',') {
                  e.preventDefault()
                  addSite()
                }
              }}
            />
            {siteError && (
              <p className="mt-1 text-[12px] text-destructive" role="status">
                {siteError}
              </p>
            )}
          </div>

          <SwitchRow
            label="Block during focus"
            checked={group.blockInFocus}
            onChange={(v) => void onSave({ blockInFocus: v })}
          />
          <SwitchRow
            label="Block on a schedule"
            checked={group.blockOnSchedule}
            onChange={(v) => void onSave({ blockOnSchedule: v })}
          />

          {group.blockOnSchedule && (
            <div className="space-y-2" data-testid="schedule-row">
              <div
                className="inline-flex flex-wrap rounded-full border border-line bg-bg-alt p-0.5"
                role="group"
                aria-label="Days"
              >
                {DAY_LETTERS.map((letter, d) => {
                  const on = group.scheduleDays.includes(d)
                  const last = on && group.scheduleDays.length <= 1
                  return (
                    <button
                      key={d}
                      type="button"
                      aria-pressed={on}
                      aria-label={DAY_NAMES[d]}
                      disabled={last}
                      onClick={() => toggleDay(d)}
                      className={`w-8 rounded-full py-1.5 text-[13px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                        on
                          ? 'bg-surface font-semibold text-ink shadow-[0_1px_0_var(--line)]'
                          : 'font-medium text-ink-3 hover:text-ink'
                      }`}
                    >
                      {letter}
                    </button>
                  )
                })}
              </div>
              <div className="flex flex-wrap items-center gap-2 text-[13px] text-ink">
                <label className="flex items-center gap-1.5">
                  From
                  <Input
                    type="time"
                    aria-label="From"
                    className="w-32"
                    value={group.scheduleFrom}
                    onChange={(e) => {
                      if (e.target.value) void onSave({ scheduleFrom: e.target.value })
                    }}
                  />
                </label>
                <label className="flex items-center gap-1.5">
                  To
                  <Input
                    type="time"
                    aria-label="To"
                    className="w-32"
                    value={group.scheduleTo}
                    onChange={(e) => {
                      if (e.target.value) void onSave({ scheduleTo: e.target.value })
                    }}
                  />
                </label>
              </div>
              <p className="text-[12px] leading-relaxed text-ink-3">
                Times follow your Mac's clock.
                {pastMidnight && ' Runs past midnight.'}
              </p>
            </div>
          )}

          <SwitchRow
            label="Daily allowance"
            checked={limitOn}
            onChange={(v) => void onSave({ dailyLimitOn: v })}
          />

          {limitOn && (
            <div className="space-y-2" data-testid="allowance-row">
              <label className="flex items-center gap-1.5 text-[13px] text-ink">
                Minutes a day
                <Input
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={1440}
                  step={1}
                  aria-label="Minutes a day"
                  value={minutesValue}
                  aria-invalid={minutes === null}
                  className={`w-24 ${minutes === null ? INVALID_SHADOW : ''}`}
                  onChange={(e) => setMinutesDraft(e.target.value)}
                  onBlur={commitMinutes}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      if (minutes !== null) commitMinutes()
                    } else if (e.key === 'Escape') {
                      setMinutesDraft(null)
                    }
                  }}
                />
              </label>
              {minutes === null && (
                <p className="text-[12px] text-destructive" role="status">
                  1 to 1440 minutes
                </p>
              )}
              <p className="text-[12px] leading-relaxed text-ink-3">
                Counted on your Mac while the site is the tab in front. Resets
                at midnight.
              </p>
            </div>
          )}
        </div>
      </SettingsRow>
    </div>
  )
}
