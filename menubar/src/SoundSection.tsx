/*
 * The Sound section (chunk 95, D12): Spotify on this Mac. A now-playing row
 * with transport, the four presets, and the "play on focus" switch.
 *
 * The shell owns Spotify (`sound.rs`); this draws its last answer and sends
 * commands. It reads on mount, on every show, 300 ms after each control, and
 * every 3 s only while the popover is shown — hidden, nothing runs here. The
 * focus edge itself (play on focus, pause on break) is the shell's.
 */
import { useCallback, useEffect, useRef, useState } from 'react'

import {
  openAutomationSettings,
  soundConfigure,
  spotifyNext,
  spotifyPlayPause,
  spotifyPlayPreset,
  spotifyPrevious,
  spotifyState,
  watchPopover,
} from './native'
import { presetById, PRESETS, type Preset, type SpotifyState } from './sound'
import { readSoundPrefs, saveSoundPrefs, type SoundPrefs } from './soundPrefs'

/** While shown. */
const POLL_MS = 3_000
/** After a control: Spotify needs a moment to report the new track. */
const AFTER_MS = 300

/** The shell's side. Injected so a browser can stand in for it. */
export type SoundBackend = {
  state: () => Promise<SpotifyState | null>
  playPause: () => Promise<SpotifyState | null>
  next: () => Promise<SpotifyState | null>
  previous: () => Promise<SpotifyState | null>
  playPreset: (uri: string) => Promise<SpotifyState | null>
  configure: (auto: boolean, uri: string | null) => Promise<void>
  openSettings: () => void
}

const NATIVE: SoundBackend = {
  state: spotifyState,
  playPause: spotifyPlayPause,
  next: spotifyNext,
  previous: spotifyPrevious,
  playPreset: spotifyPlayPreset,
  configure: soundConfigure,
  openSettings: openAutomationSettings,
}

type View = {
  title: string
  /** `false`: a message, which may wrap; `true`: a track, one line. */
  isTrack: boolean
  subtitle: string | null
  transport: boolean
  presets: boolean
  denied: boolean
}

function describe(sp: SpotifyState | null, preset: Preset): View {
  const base = {
    isTrack: false,
    subtitle: preset.label as string | null,
    transport: false,
    presets: true,
    denied: false,
  }
  switch (sp?.status) {
    case 'ok':
      return {
        ...base,
        title: sp.track ?? 'Nothing playing',
        isTrack: sp.track !== null,
        subtitle: sp.artist ?? preset.label,
        transport: true,
      }
    case 'not_installed':
      return {
        ...base,
        title: "Spotify isn't installed on this Mac",
        subtitle: null,
        presets: false,
      }
    case 'not_running':
      return { ...base, title: 'Spotify is closed' }
    case 'denied':
      return {
        ...base,
        title: 'Allow Hupomnemata to control Spotify',
        subtitle: null,
        denied: true,
      }
    case 'timeout':
    case 'error':
      // The next read retries; so does a press.
      return { ...base, title: "Spotify didn't respond", transport: true }
    default:
      // Not read yet, or no shell (a browser).
      return { ...base, title: 'Nothing playing' }
  }
}

export default function SoundSection({
  backend = NATIVE,
}: {
  backend?: SoundBackend
}) {
  const [sp, setSp] = useState<SpotifyState | null>(null)
  const [prefs, setPrefs] = useState<SoundPrefs>(readSoundPrefs)
  // One read at a time: a slow Spotify is not asked again by the poll.
  const reading = useRef(false)
  const afterTimer = useRef<number | null>(null)

  const read = useCallback(async () => {
    if (reading.current) return
    reading.current = true
    try {
      const state = await backend.state()
      if (state) setSp(state)
    } catch (e) {
      console.error('menubar: spotify state not read', e)
    } finally {
      reading.current = false
    }
  }, [backend])

  // On mount, on every show, and every 3 s while shown; cleared on hide.
  useEffect(() => {
    let poll: number | null = null
    const stop = () => {
      if (poll !== null) window.clearInterval(poll)
      poll = null
    }
    // The mount read, a microtask later: an effect sets no state itself.
    void Promise.resolve().then(read)
    const unwatch = watchPopover((shown) => {
      stop()
      if (!shown) return
      void read()
      poll = window.setInterval(() => void read(), POLL_MS)
    })
    return () => {
      unwatch()
      stop()
      if (afterTimer.current !== null) window.clearTimeout(afterTimer.current)
      afterTimer.current = null
    }
  }, [read])

  /** Send one control, show its answer, and read again 300 ms later. */
  async function control(run: () => Promise<SpotifyState | null>) {
    try {
      const state = await run()
      if (state) setSp(state)
    } catch (e) {
      console.error('menubar: spotify control failed', e)
    }
    if (afterTimer.current !== null) window.clearTimeout(afterTimer.current)
    afterTimer.current = window.setTimeout(() => {
      afterTimer.current = null
      void read()
    }, AFTER_MS)
  }

  function save(next: SoundPrefs) {
    saveSoundPrefs(next)
    setPrefs(next)
    return backend.configure(next.auto, presetById(next.preset).uri)
  }

  async function pick(p: Preset) {
    await save({ ...prefs, preset: p.id })
    const uri = p.uri
    if (uri) {
      // A playlist plays now (this may launch Spotify).
      await control(() => backend.playPreset(uri))
      return
    }
    // Silence pauses Spotify if it is playing — decided on its state now,
    // since the toggle would start a Spotify that was paused by hand.
    await control(async () => {
      const now = await backend.state()
      return now?.status === 'ok' && now.playing ? backend.playPause() : now
    })
  }

  const preset = presetById(prefs.preset)
  const view = describe(sp, preset)
  const playing = sp?.status === 'ok' && sp.playing
  const installed = sp?.status !== 'not_installed'

  return (
    <section className="mb-sec mb-sound" aria-label="Sound">
      <span className="mb-lab">Sound · Spotify on this Mac</span>
      <div className="mb-now">
        <div className="mb-art" aria-hidden="true" />
        <div className={view.isTrack ? 'mb-np' : 'mb-np mb-np-msg'}>
          <b>{view.title}</b>
          {view.subtitle ? <small>{view.subtitle}</small> : null}
          {view.denied ? (
            <button
              type="button"
              className="mb-np-link"
              onClick={backend.openSettings}
            >
              Open settings
            </button>
          ) : null}
        </div>
        <div className="mb-tp">
          <button
            type="button"
            className="mb-ib"
            aria-label="Previous"
            disabled={!view.transport}
            onClick={() => void control(backend.previous)}
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor" aria-hidden="true">
              <path d="M1 1h1.8v10H1zM11 1v10L3.6 6z" />
            </svg>
          </button>
          <button
            type="button"
            className="mb-ib mb-ib-big"
            aria-label={playing ? 'Pause music' : 'Play music'}
            disabled={!view.transport}
            onClick={() => void control(backend.playPause)}
          >
            <svg width="11" height="11" viewBox="0 0 12 12" fill="currentColor" aria-hidden="true">
              {playing ? (
                <path d="M2 1h3v10H2zM7 1h3v10H7z" />
              ) : (
                <path d="M2.5 1v10l8-5z" />
              )}
            </svg>
          </button>
          <button
            type="button"
            className="mb-ib"
            aria-label="Next"
            disabled={!view.transport}
            onClick={() => void control(backend.next)}
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor" aria-hidden="true">
              <path d="M9.2 1H11v10H9.2zM1 1v10l7.4-5z" />
            </svg>
          </button>
        </div>
      </div>
      <div className="mb-presets">
        {PRESETS.map((p) => (
          <button
            key={p.id}
            type="button"
            className="mb-pre"
            aria-pressed={p.id === preset.id}
            disabled={!view.presets}
            onClick={() => void pick(p)}
          >
            {p.label}
          </button>
        ))}
      </div>
      <button
        type="button"
        role="switch"
        className="mb-auto"
        aria-checked={prefs.auto}
        disabled={!installed}
        onClick={() => void save({ ...prefs, auto: !prefs.auto })}
      >
        <span className="mb-sw" aria-hidden="true" />
        Play on focus, pause on break
      </button>
    </section>
  )
}
