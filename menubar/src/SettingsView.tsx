/*
 * The Settings view (chunk 97). It takes the popover body's place under the
 * meditation panel while open, signed in only, and edits the per-Mac
 * settings already stored under `hup:mb:*` plus the two that have no key:
 * hotkey bindings and open at login. Every change saves at once.
 *
 * Sections, in order (D2): Focus, Sound, Meditation, Hotkeys, General. The
 * body scrolls inside the popover's 852 pt cap.
 *
 * Esc closes the view (and is marked handled, so the popover stays) — unless
 * a hotkey row is recording, where it cancels the recording.
 */
import {
  type MutableRefObject,
  type ReactNode,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react'

import {
  accelFromEvent,
  ACTION_LABEL,
  hotkeyLabel,
  type HotkeyAction,
  type Hotkeys,
  usedBy,
} from './hotkeys'
import type { Meditation } from './meditation'
import {
  clockMinutes,
  isClockTime,
  readMeditationPrefs,
  type MeditationLength,
  type MeditationPrefs,
} from './meditationPrefs'
import {
  loginItemSet,
  loginItemState,
  soundConfigure,
  type LoginItemState,
} from './native'
import type { Pomodoro } from './pomodoro'
import {
  POMODORO_RANGE,
  readPomodoroPrefs,
  type PomodoroConfig,
} from './pomodoroPrefs'
import {
  normalizePlaylist,
  PLAYLIST_SLOTS,
  presetById,
  presetFor,
  type PlaylistSlot,
} from './sound'
import {
  readSoundPrefs,
  saveSoundPrefs,
  validLabel,
  type SoundPrefs,
} from './soundPrefs'
import { THEME_LABEL, type ThemeChoice } from './theme'

/** The shell's side. Injected so a test or a browser can stand in for it. */
export type SettingsBackend = {
  soundConfigure: (auto: boolean, uri: string | null) => Promise<void>
  loginState: () => Promise<LoginItemState | null>
  loginSet: (on: boolean) => Promise<LoginItemState | null>
}

const NATIVE: SettingsBackend = {
  soundConfigure,
  loginState: loginItemState,
  loginSet: loginItemSet,
}

/** A key handler a section lends the view; true when it took the key. */
type KeyGrab = MutableRefObject<((e: KeyboardEvent) => boolean) | null>

export default function SettingsView({
  pomodoro,
  meditation,
  hotkeys,
  theme,
  onTheme,
  onDone,
  backend = NATIVE,
}: {
  pomodoro: Pomodoro
  meditation: Meditation
  hotkeys: Hotkeys
  theme: ThemeChoice
  onTheme: (choice: ThemeChoice) => void
  onDone: () => void
  backend?: SettingsBackend
}) {
  const grabRef: KeyGrab = useRef(null)

  // Capture phase on the window: ahead of App's Esc-to-hide listener, and
  // wherever focus is (WebKit does not focus a clicked button).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (grabRef.current?.(e)) return
      if (e.key === 'Escape' && !e.defaultPrevented) {
        e.preventDefault()
        onDone()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onDone])

  return (
    <section className="mb-settings" aria-label="Settings">
      <div className="mb-set-head">
        <h2 className="mb-set-title">Settings</h2>
        <button type="button" className="mb-fbtn mb-fbtn-pri" onClick={onDone}>
          Done
        </button>
      </div>
      <div className="mb-set-body">
        <FocusSettings pomodoro={pomodoro} />
        <SoundSettings configure={backend.soundConfigure} />
        <MeditationSettings meditation={meditation} />
        <HotkeySettings hotkeys={hotkeys} grabRef={grabRef} />
        <GeneralSettings theme={theme} onTheme={onTheme} backend={backend} />
      </div>
    </section>
  )
}

function Section({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="mb-sec mb-set-sec" role="group" aria-label={label}>
      <span className="mb-lab">{label}</span>
      <div className="mb-setlist">{children}</div>
    </div>
  )
}

function Switch({
  label,
  on,
  disabled,
  onChange,
}: {
  label: string
  on: boolean
  disabled?: boolean
  onChange: (on: boolean) => void
}) {
  return (
    <button
      type="button"
      role="switch"
      className="mb-set mb-swrow"
      aria-checked={on}
      disabled={disabled}
      onClick={() => onChange(!on)}
    >
      <span>{label}</span>
      <span className="mb-sw" aria-hidden="true" />
    </button>
  )
}

function Seg<T extends string | number>({
  label,
  options,
  value,
  disabled,
  onChange,
}: {
  label: string
  options: ReadonlyArray<{ value: T; text: string }>
  value: T
  disabled?: boolean
  onChange: (v: T) => void
}) {
  return (
    <div className="mb-seg" role="group" aria-label={label}>
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          aria-pressed={o.value === value}
          disabled={disabled}
          onClick={() => onChange(o.value)}
        >
          {o.text}
        </button>
      ))}
    </div>
  )
}

/* ---- Focus (D4) ---- */

const STEPPERS: ReadonlyArray<{
  key: keyof typeof POMODORO_RANGE
  label: string
  unit: string
}> = [
  { key: 'focus', label: 'Focus', unit: 'min' },
  { key: 'short', label: 'Short break', unit: 'min' },
  { key: 'long', label: 'Long break', unit: 'min' },
  { key: 'every', label: 'Long break after', unit: 'sessions' },
]

function FocusSettings({ pomodoro }: { pomodoro: Pomodoro }) {
  const [cfg, setCfg] = useState<PomodoroConfig>(readPomodoroPrefs)

  function save(next: PomodoroConfig) {
    setCfg(next)
    void pomodoro.saveConfig(next)
  }

  return (
    <Section label="Focus">
      {STEPPERS.map(({ key, label, unit }) => {
        const [min, max] = POMODORO_RANGE[key]
        const v = cfg[key]
        return (
          <div className="mb-set" key={key}>
            <span>{label}</span>
            <div className="mb-step">
              <button
                type="button"
                aria-label={`Less ${label.toLowerCase()}`}
                disabled={v <= min}
                onClick={() => save({ ...cfg, [key]: v - 1 })}
              >
                −
              </button>
              <span className="mb-val" aria-label={label}>
                {key === 'every' ? `${v} ${v === 1 ? 'session' : unit}` : `${v} ${unit}`}
              </span>
              <button
                type="button"
                aria-label={`More ${label.toLowerCase()}`}
                disabled={v >= max}
                onClick={() => save({ ...cfg, [key]: v + 1 })}
              >
                +
              </button>
            </div>
          </div>
        )
      })}
      <Switch
        label="Compact menu bar timer"
        on={cfg.compact}
        onChange={(compact) => save({ ...cfg, compact })}
      />
      <p className="mb-hint">
        New lengths apply from the next phase. Compact changes the menu bar at once.
      </p>
    </Section>
  )
}

/* ---- Sound (D5) ---- */

type SlotDraft = { label: string; link: string }

function draftFor(prefs: SoundPrefs, slot: PlaylistSlot): SlotDraft {
  const p = presetFor(prefs, slot)
  return { label: p.label, link: p.uri ?? '' }
}

function SoundSettings({
  configure,
}: {
  configure: SettingsBackend['soundConfigure']
}) {
  const [prefs, setPrefs] = useState<SoundPrefs>(readSoundPrefs)
  const [drafts, setDrafts] = useState(() => {
    const out = {} as Record<PlaylistSlot, SlotDraft>
    for (const slot of PLAYLIST_SLOTS) out[slot] = draftFor(prefs, slot)
    return out
  })

  /** Store, and tell the shell if the playing preset's playlist moved. */
  function commit(next: SoundPrefs, slot: PlaylistSlot) {
    const before = presetFor(prefs, slot).uri
    saveSoundPrefs(next)
    setPrefs(next)
    const after = presetFor(next, slot).uri
    if (next.preset === slot && after !== before) void configure(next.auto, after)
  }

  function edit(slot: PlaylistSlot, change: Partial<SlotDraft>) {
    const d = { ...drafts[slot], ...change }
    setDrafts({ ...drafts, [slot]: d })
    const label = validLabel(d.label)
    const uri = normalizePlaylist(d.link)
    if (!label || !uri) return
    const builtIn = presetById(slot)
    const playlists = { ...prefs.playlists }
    if (label === builtIn.label && uri === builtIn.uri) delete playlists[slot]
    else playlists[slot] = { label, uri }
    commit({ ...prefs, playlists }, slot)
  }

  function reset(slot: PlaylistSlot) {
    const playlists = { ...prefs.playlists }
    delete playlists[slot]
    const next = { ...prefs, playlists }
    setDrafts({ ...drafts, [slot]: draftFor(next, slot) })
    commit(next, slot)
  }

  return (
    <Section label="Sound">
      {PLAYLIST_SLOTS.map((slot) => {
        const d = drafts[slot]
        const builtIn = presetById(slot).label
        const labelBad = validLabel(d.label) === null
        const linkBad = normalizePlaylist(d.link) === null
        return (
          <div className="mb-pl" key={slot}>
            <div className="mb-pl-row">
              <input
                className="mb-in mb-pl-name"
                aria-label={`${builtIn} name`}
                value={d.label}
                maxLength={40}
                aria-invalid={labelBad}
                spellCheck={false}
                onChange={(e) => edit(slot, { label: e.target.value })}
              />
              <input
                className="mb-in mb-pl-link"
                aria-label={`${builtIn} playlist link`}
                placeholder="open.spotify.com/playlist/…"
                value={d.link}
                aria-invalid={linkBad}
                spellCheck={false}
                onChange={(e) => edit(slot, { link: e.target.value })}
              />
              <button
                type="button"
                className="mb-mini"
                aria-label={`Reset ${builtIn}`}
                disabled={!prefs.playlists[slot] && !labelBad && !linkBad &&
                  d.label === builtIn && d.link === (presetById(slot).uri ?? '')}
                onClick={() => reset(slot)}
              >
                Reset
              </button>
            </div>
            {linkBad && d.link.trim() ? (
              <span className="mb-set-err">Not a Spotify playlist link</span>
            ) : null}
          </div>
        )
      })}
      <p className="mb-hint">
        Paste a playlist link from Spotify. Silence stays silent.
      </p>
    </Section>
  )
}

/* ---- Meditation (D6, D7) ---- */

const EVERY = [15, 30, 45, 60, 90, 120, 180, 240]
const HEADS_UP = [0, 2, 5, 10, 15]
const MAX_TIMES = 12
const DAYS = [
  ['S', 'Sunday'],
  ['M', 'Monday'],
  ['T', 'Tuesday'],
  ['W', 'Wednesday'],
  ['T', 'Thursday'],
  ['F', 'Friday'],
  ['S', 'Saturday'],
] as const

/** A stored value outside the list is shown as one more option, not changed. */
function withValue(list: number[], v: number): number[] {
  return list.includes(v) ? list : [...list, v].sort((a, b) => a - b)
}

function hhmm(minutes: number): string {
  const two = (n: number) => String(n).padStart(2, '0')
  return `${two(Math.floor(minutes / 60))}:${two(minutes % 60)}`
}

function MeditationSettings({ meditation }: { meditation: Meditation }) {
  const [prefs, setPrefs] = useState<MeditationPrefs>(readMeditationPrefs)
  // Drafts, so an invalid entry stays on screen without being saved.
  const [win, setWin] = useState({ from: prefs.from, to: prefs.to })
  const [times, setTimes] = useState<string[]>(prefs.times)

  function save(next: MeditationPrefs) {
    setPrefs(next)
    void meditation.savePrefs(next)
  }

  const winBad =
    isClockTime(win.from) &&
    isClockTime(win.to) &&
    clockMinutes(win.from) >= clockMinutes(win.to)

  function editWindow(change: Partial<typeof win>) {
    const w = { ...win, ...change }
    setWin(w)
    if (!isClockTime(w.from) || !isClockTime(w.to)) return
    if (clockMinutes(w.from) >= clockMinutes(w.to)) return
    save({ ...prefs, from: w.from, to: w.to })
  }

  /** The list as drawn stays in its order; what is stored is sorted, once each. */
  function editTimes(list: string[]) {
    setTimes(list)
    const valid = [...new Set(list.filter(isClockTime))].sort()
    if (valid.length >= 1 && valid.length <= MAX_TIMES) save({ ...prefs, times: valid })
  }

  function addTime() {
    const valid = times.filter(isClockTime).map(clockMinutes)
    const last = valid.length ? Math.max(...valid) : clockMinutes('09:00')
    editTimes([...times, hhmm(Math.min(last + 60, 23 * 60))])
  }

  function toggleDay(day: number) {
    const on = prefs.days.includes(day)
    if (on && prefs.days.length === 1) return
    const days = on
      ? prefs.days.filter((d) => d !== day)
      : [...prefs.days, day].sort((a, b) => a - b)
    save({ ...prefs, days })
  }

  const everyMode = prefs.mode === 'every'

  return (
    <Section label="Meditation">
      <Switch
        label="Reminders"
        on={prefs.enabled}
        onChange={(enabled) => save({ ...prefs, enabled })}
      />
      <div className="mb-set">
        <span>Length</span>
        <Seg<MeditationLength>
          label="Length"
          options={[
            { value: 3, text: '3 min' },
            { value: 5, text: '5 min' },
            { value: 10, text: '10 min' },
          ]}
          value={prefs.length}
          onChange={(length) => save({ ...prefs, length })}
        />
      </div>
      <div className="mb-set">
        <span>Schedule</span>
        <Seg
          label="Schedule"
          options={[
            { value: 'every', text: 'Every' },
            { value: 'times', text: 'Set times' },
          ]}
          value={prefs.mode}
          onChange={(mode) => save({ ...prefs, mode })}
        />
      </div>
      <div
        className={everyMode ? 'mb-set' : 'mb-set mb-dim'}
        data-row="every"
      >
        <span>Every</span>
        <select
          className="mb-in mb-sel"
          aria-label="Every"
          value={prefs.every}
          disabled={!everyMode}
          onChange={(e) => save({ ...prefs, every: Number(e.target.value) })}
        >
          {withValue(EVERY, prefs.every).map((m) => (
            <option key={m} value={m}>
              {m} min
            </option>
          ))}
        </select>
        <span className="mb-set-wrap">
          <input
            type="time"
            className="mb-in mb-time-in"
            aria-label="From"
            value={win.from}
            aria-invalid={winBad}
            disabled={!everyMode}
            onChange={(e) => editWindow({ from: e.target.value })}
          />
          to
          <input
            type="time"
            className="mb-in mb-time-in"
            aria-label="To"
            value={win.to}
            aria-invalid={winBad}
            disabled={!everyMode}
            onChange={(e) => editWindow({ to: e.target.value })}
          />
        </span>
        {winBad ? (
          <span className="mb-set-err">Start must be before end</span>
        ) : null}
      </div>
      <div
        className={everyMode ? 'mb-set mb-dim' : 'mb-set'}
        data-row="times"
      >
        <span>At</span>
        <span className="mb-set-wrap mb-times">
          {times.map((t, i) => (
            <span className="mb-time" key={i}>
              <input
                type="time"
                className="mb-in mb-time-in"
                aria-label={`Time ${i + 1}`}
                value={t}
                disabled={everyMode}
                onChange={(e) =>
                  editTimes(times.map((x, j) => (j === i ? e.target.value : x)))
                }
              />
              {times.length > 1 ? (
                <button
                  type="button"
                  className="mb-x"
                  aria-label={`Remove time ${i + 1}`}
                  disabled={everyMode}
                  onClick={() => editTimes(times.filter((_, j) => j !== i))}
                >
                  ×
                </button>
              ) : null}
            </span>
          ))}
          <button
            type="button"
            className="mb-val mb-add"
            disabled={everyMode || times.length >= MAX_TIMES}
            onClick={addTime}
          >
            + Add
          </button>
        </span>
      </div>
      <div className="mb-set">
        <span>Days</span>
        <div className="mb-days" role="group" aria-label="Days">
          {DAYS.map(([letter, name], day) => {
            const on = prefs.days.includes(day)
            return (
              <button
                key={name}
                type="button"
                className="mb-day"
                aria-label={name}
                aria-pressed={on}
                disabled={on && prefs.days.length === 1}
                onClick={() => toggleDay(day)}
              >
                {letter}
              </button>
            )
          })}
        </div>
      </div>
      <div className="mb-set">
        <span>Heads-up</span>
        <select
          className="mb-in mb-sel"
          aria-label="Heads-up"
          value={prefs.headsUp}
          onChange={(e) => save({ ...prefs, headsUp: Number(e.target.value) })}
        >
          {withValue(HEADS_UP, prefs.headsUp).map((m) => (
            <option key={m} value={m}>
              {m === 0 ? 'None' : `${m} min before`}
            </option>
          ))}
        </select>
      </div>
      <Switch
        label="Pause Spotify during a session"
        on={prefs.pauseSpotify}
        onChange={(pauseSpotify) => save({ ...prefs, pauseSpotify })}
      />
      <p className="mb-hint">Sessions never start on their own. You press Start.</p>
    </Section>
  )
}

/* ---- Hotkeys (D8–D10) ---- */

const HOTKEY_ROWS: HotkeyAction[] = ['scratchpad', 'focus', 'meditate']

function HotkeySettings({ hotkeys, grabRef }: { hotkeys: Hotkeys; grabRef: KeyGrab }) {
  const hk = useSyncExternalStore(hotkeys.subscribe, hotkeys.getState)
  const [recording, setRecording] = useState<HotkeyAction | null>(null)
  const [taken, setTaken] = useState<Partial<Record<HotkeyAction, string>>>({})
  const rec = useRef<HotkeyAction | null>(null)
  // Stop, start and rebind run one after another, never interleaved.
  const chain = useRef<Promise<unknown>>(Promise.resolve())
  const buttons = useRef<Partial<Record<HotkeyAction, HTMLButtonElement | null>>>({})

  const queue = (f: () => Promise<unknown>) => {
    chain.current = chain.current.then(f).catch((e: unknown) => {
      console.error('menubar: hotkey settings failed', e)
    })
  }

  // The recorder's state and handlers live in refs, so the key handler lent
  // to the view and the unmount cleanup always see the latest.
  const api = useRef({
    /** Release every global shortcut so the combo reaches the web view (D9). */
    begin(action: HotkeyAction) {
      rec.current = action
      setRecording(action)
      setTaken({})
      queue(() => hotkeys.stop())
    },
    /** Register again, whatever the outcome; then move the key if one came. */
    end(accel: string | null) {
      const action = rec.current
      if (!action) return
      rec.current = null
      setRecording(null)
      queue(async () => {
        await hotkeys.start()
        if (accel) await hotkeys.rebind(action, accel)
      })
    },
  })

  useEffect(() => {
    const { end } = api.current
    grabRef.current = (e: KeyboardEvent) => {
      const action = rec.current
      if (!action) return false
      // Every key goes to the recorder: none moves focus or clicks.
      e.preventDefault()
      e.stopPropagation()
      if (e.key === 'Escape') {
        end(null)
        return true
      }
      const accel = accelFromEvent(e)
      if (!accel) return true
      const other = usedBy(hotkeys.getState().bound, action, accel)
      if (other) {
        setTaken({ [action]: `Already used for ${ACTION_LABEL[other]}` })
        end(null)
        return true
      }
      end(accel)
      return true
    }
    return () => {
      grabRef.current = null
      // Closed while recording (Done, Esc, the popover hiding): keys back.
      end(null)
    }
  }, [grabRef, hotkeys])

  return (
    <Section label="Hotkeys">
      {HOTKEY_ROWS.map((action) => {
        const on = recording === action
        const note = taken[action] ?? hk.failed[action]
        return (
          <div className="mb-set" key={action}>
            <span>{ACTION_LABEL[action]}</span>
            <button
              type="button"
              ref={(el) => {
                buttons.current[action] = el
              }}
              className={on ? 'mb-key mb-rec' : 'mb-key'}
              aria-label={`${ACTION_LABEL[action]}: ${
                on ? 'press keys' : hotkeyLabel(hk.bound[action])
              }`}
              onClick={() => {
                if (rec.current === action) return
                if (rec.current) api.current.end(null)
                api.current.begin(action)
                // WebKit does not focus a clicked button; blur must reach it.
                buttons.current[action]?.focus()
              }}
              onBlur={() => {
                if (rec.current === action) api.current.end(null)
              }}
              onKeyUp={(e) => {
                // The Space that finished a recording must not click again.
                if (e.code === 'Space') e.preventDefault()
              }}
            >
              {on ? 'Press keys…' : hotkeyLabel(hk.bound[action])}
            </button>
            {note ? <span className="mb-set-err">{note}</span> : null}
          </div>
        )
      })}
      <div className="mb-set">
        <span />
        <button
          type="button"
          className="mb-mini"
          onClick={() => {
            if (rec.current) api.current.end(null)
            setTaken({})
            queue(() => hotkeys.resetDefaults())
          }}
        >
          Reset to defaults
        </button>
      </div>
    </Section>
  )
}

/* ---- General (D11, D12) ---- */

const THEMES: ThemeChoice[] = ['auto', 'light', 'dark']

function GeneralSettings({
  theme,
  onTheme,
  backend,
}: {
  theme: ThemeChoice
  onTheme: (choice: ThemeChoice) => void
  backend: SettingsBackend
}) {
  const [login, setLogin] = useState<LoginItemState | null | undefined>(undefined)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let live = true
    backend
      .loginState()
      .then((s) => {
        if (live) setLogin(s)
      })
      .catch((e: unknown) => {
        console.error('menubar: login item state not read', e)
        if (live) setLogin(null)
      })
    return () => {
      live = false
    }
  }, [backend])

  async function setOn(on: boolean) {
    setBusy(true)
    try {
      setLogin(await backend.loginSet(on))
    } catch (e) {
      console.error('menubar: login item not changed', e)
      setLogin(await backend.loginState().catch(() => null))
    } finally {
      setBusy(false)
    }
  }

  // Not read yet: the switch waits. No shell (a browser) reads as a dev run.
  const status = login === undefined ? null : (login?.status ?? 'unavailable')

  return (
    <Section label="General">
      <div className="mb-set">
        <span>Theme</span>
        <Seg
          label="Theme"
          options={THEMES.map((t) => ({ value: t, text: THEME_LABEL[t] }))}
          value={theme}
          onChange={onTheme}
        />
      </div>
      <Switch
        label="Open at login"
        on={status === 'on'}
        disabled={status === null || status === 'unavailable' || busy}
        onChange={(on) => void setOn(on)}
      />
      {status === 'unavailable' ? (
        <span className="mb-set-note">Only in the installed app</span>
      ) : null}
      {status === 'other' ? (
        <span className="mb-set-note">
          Set for another copy{login?.path ? `: ${login.path}` : ''}
        </span>
      ) : null}
      <p className="mb-hint">
        Takes effect at your next login. macOS may list it under Login Items ›
        Allow in the Background.
      </p>
    </Section>
  )
}
