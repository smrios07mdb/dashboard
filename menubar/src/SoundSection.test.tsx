import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { SpotifyState } from './sound'

const h = vi.hoisted(() => ({
  setShown: (() => {}) as (shown: boolean) => void,
  watchers: 0,
  current: null as unknown,
  native: {} as Record<string, ReturnType<typeof vi.fn>>,
}))

vi.mock('./native', () => {
  const answer = async () => h.current
  for (const name of [
    'spotifyState',
    'spotifyPlayPause',
    'spotifyNext',
    'spotifyPrevious',
    'spotifyPlayPreset',
  ]) {
    h.native[name] = vi.fn(answer)
  }
  h.native.soundConfigure = vi.fn(async () => {})
  h.native.openAutomationSettings = vi.fn()
  return {
    ...h.native,
    watchPopover: (onChange: (shown: boolean) => void) => {
      h.setShown = onChange
      h.watchers++
      return () => {
        h.watchers--
      }
    },
  }
})

import { PRESETS, presetById } from './sound'
import SoundSection from './SoundSection'
import { readSoundPrefs, saveSoundPrefs, SOUND_KEY } from './soundPrefs'

const BINAURAL = presetById('binaural').uri!
const CLASSICAL = presetById('classical').uri!

function sp(over: Partial<SpotifyState> = {}): SpotifyState {
  return { status: 'ok', playing: false, track: null, artist: null, ...over }
}
const PLAYING = sp({ playing: true, track: 'Alpha Waves, 10 Hz', artist: 'Binaural Mind' })

/** Render with the shell answering `state`; the mount read has landed. */
async function setup(state: SpotifyState | null) {
  h.current = state
  const view = render(<SoundSection />)
  await act(async () => {})
  return view
}

const show = (shown: boolean) =>
  act(async () => {
    h.setShown(shown)
  })
/**
 * Click, then let the handler's awaits and React's update land. The state is
 * set after an awaited shell call, outside the click's own `act`, so without
 * this an assertion can run before the render (seen under a loaded machine).
 * Advancing by 0 fires no timer: the 300 ms re-read stays pending.
 */
async function press(user: ReturnType<typeof userEvent.setup>, el: Element) {
  await user.click(el)
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0)
  })
}
const pressed = () =>
  PRESETS.filter(
    (p) =>
      screen.getByRole('button', { name: p.label }).getAttribute('aria-pressed') ===
      'true',
  ).map((p) => p.id)
const transport = () =>
  ['Previous', /^(Play|Pause) music$/, 'Next'].map(
    (name) => screen.getByRole('button', { name }) as HTMLButtonElement,
  )
const presetButtons = () =>
  PRESETS.map((p) => screen.getByRole('button', { name: p.label }) as HTMLButtonElement)

describe('menubar SoundSection', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    localStorage.clear()
    for (const f of Object.values(h.native)) f.mockClear()
    h.current = null
  })
  afterEach(() => vi.useRealTimers())

  // ---- states (D12) ----

  it('playing: the track, the artist, and Pause music', async () => {
    await setup(PLAYING)
    expect(screen.getByText('Sound · Spotify on this Mac')).toBeInTheDocument()
    expect(screen.getByText('Alpha Waves, 10 Hz')).toBeInTheDocument()
    expect(screen.getByText('Binaural Mind')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Pause music' })).toBeEnabled()
    expect(screen.queryByRole('button', { name: 'Play music' })).toBeNull()
    for (const b of [...transport(), ...presetButtons()]) expect(b).toBeEnabled()
    expect(pressed()).toEqual(['binaural'])
    expect(document.querySelector('.mb-art img')).toBeNull()
  })

  it('paused: Play music; with no track the subtitle is the preset', async () => {
    saveSoundPrefs({ auto: true, preset: 'classical' })
    await setup(sp())
    expect(screen.getByRole('button', { name: 'Play music' })).toBeEnabled()
    expect(screen.getByText('Nothing playing')).toBeInTheDocument()
    expect(document.querySelector('.mb-np small')?.textContent).toBe('Classical')
    expect(pressed()).toEqual(['classical'])
  })

  it('a track without an artist shows the preset under it', async () => {
    await setup(sp({ track: 'Aria' }))
    expect(screen.getByText('Aria')).toBeInTheDocument()
    expect(document.querySelector('.mb-np small')?.textContent).toBe('Binaural')
  })

  it('not installed: says so, every control disabled', async () => {
    await setup(sp({ status: 'not_installed' }))
    expect(
      screen.getByText("Spotify isn't installed on this Mac"),
    ).toBeInTheDocument()
    for (const b of [...transport(), ...presetButtons()]) expect(b).toBeDisabled()
    expect(screen.getByRole('switch')).toBeDisabled()
  })

  it('not running: Spotify is closed; presets enabled, transport disabled', async () => {
    await setup(sp({ status: 'not_running' }))
    expect(screen.getByText('Spotify is closed')).toBeInTheDocument()
    for (const b of transport()) expect(b).toBeDisabled()
    for (const b of presetButtons()) expect(b).toBeEnabled()
    expect(screen.getByRole('switch')).toBeEnabled()
  })

  it('denied: asks for the permission and opens Automation settings', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    await setup(sp({ status: 'denied' }))
    expect(
      screen.getByText('Allow Hupomnemata to control Spotify'),
    ).toBeInTheDocument()
    await press(user, screen.getByRole('button', { name: 'Open settings' }))
    expect(h.native.openAutomationSettings).toHaveBeenCalledTimes(1)
  })

  it('no Open settings button in any other state', async () => {
    await setup(PLAYING)
    expect(screen.queryByRole('button', { name: 'Open settings' })).toBeNull()
  })

  it.each(['timeout', 'error'] as const)(
    '%s: Spotify didn’t respond, and the next read retries',
    async (status) => {
      await setup(sp({ status }))
      expect(screen.getByText("Spotify didn't respond")).toBeInTheDocument()
      h.current = PLAYING
      await show(true)
      expect(screen.getByText('Alpha Waves, 10 Hz')).toBeInTheDocument()
      expect(screen.queryByText("Spotify didn't respond")).toBeNull()
    },
  )

  // ---- controls ----

  it('transport sends its command and shows the answer', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    await setup(PLAYING)
    h.current = sp({ track: 'Alpha Waves, 10 Hz', artist: 'Binaural Mind' })
    await press(user, screen.getByRole('button', { name: 'Pause music' }))
    expect(h.native.spotifyPlayPause).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: 'Play music' })).toBeInTheDocument()
    await press(user, screen.getByRole('button', { name: 'Next' }))
    expect(h.native.spotifyNext).toHaveBeenCalledTimes(1)
    await press(user, screen.getByRole('button', { name: 'Previous' }))
    expect(h.native.spotifyPrevious).toHaveBeenCalledTimes(1)
  })

  it('a control is followed by one read 300 ms later', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    await setup(PLAYING)
    h.native.spotifyState.mockClear()
    await press(user, screen.getByRole('button', { name: 'Next' }))
    // `shouldAdvanceTime` lets real time move the clock too, so leave a margin.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200)
    })
    expect(h.native.spotifyState).not.toHaveBeenCalled()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100)
    })
    expect(h.native.spotifyState).toHaveBeenCalledTimes(1)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000)
    })
    expect(h.native.spotifyState).toHaveBeenCalledTimes(1)
  })

  it('a playlist preset is saved, configured and played now', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    await setup(sp({ status: 'not_running' }))
    h.current = PLAYING
    await press(user, screen.getByRole('button', { name: 'Classical' }))
    expect(readSoundPrefs()).toEqual({ auto: true, preset: 'classical' })
    expect(h.native.soundConfigure).toHaveBeenCalledWith(true, CLASSICAL)
    expect(h.native.spotifyPlayPreset).toHaveBeenCalledWith(CLASSICAL)
    expect(h.native.spotifyPlayPause).not.toHaveBeenCalled()
    expect(pressed()).toEqual(['classical'])
    expect(screen.getByText('Alpha Waves, 10 Hz')).toBeInTheDocument()
  })

  it('Silence is saved and pauses a playing Spotify', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    await setup(PLAYING)
    await press(user, screen.getByRole('button', { name: 'Silence' }))
    expect(readSoundPrefs()).toEqual({ auto: true, preset: 'silence' })
    expect(h.native.soundConfigure).toHaveBeenCalledWith(true, null)
    expect(h.native.spotifyPlayPause).toHaveBeenCalledTimes(1)
    expect(h.native.spotifyPlayPreset).not.toHaveBeenCalled()
    expect(pressed()).toEqual(['silence'])
  })

  it('Silence leaves a paused or closed Spotify alone', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    for (const state of [sp({ track: 'Aria' }), sp({ status: 'not_running' })]) {
      localStorage.clear()
      const view = await setup(state)
      await press(user, screen.getByRole('button', { name: 'Silence' }))
      expect(h.native.soundConfigure).toHaveBeenLastCalledWith(true, null)
      expect(h.native.spotifyPlayPause).not.toHaveBeenCalled()
      view.unmount()
    }
  })

  it('Silence decides on the state read now, not the one on screen', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    // On screen: playing. Meanwhile Spotify was paused by hand.
    await setup(PLAYING)
    h.current = sp({ track: 'Alpha Waves, 10 Hz' })
    await press(user, screen.getByRole('button', { name: 'Silence' }))
    expect(h.native.spotifyPlayPause).not.toHaveBeenCalled()
  })

  it('the auto switch saves and configures', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    await setup(PLAYING)
    const sw = screen.getByRole('switch', { name: 'Play on focus, pause on break' })
    expect(sw).toHaveAttribute('aria-checked', 'true')
    await press(user, sw)
    expect(sw).toHaveAttribute('aria-checked', 'false')
    expect(readSoundPrefs()).toEqual({ auto: false, preset: 'binaural' })
    expect(h.native.soundConfigure).toHaveBeenLastCalledWith(false, BINAURAL)
    await press(user, sw)
    expect(sw).toHaveAttribute('aria-checked', 'true')
    expect(h.native.soundConfigure).toHaveBeenLastCalledWith(true, BINAURAL)
    // The switch plays nothing by itself.
    expect(h.native.spotifyPlayPreset).not.toHaveBeenCalled()
    expect(h.native.spotifyPlayPause).not.toHaveBeenCalled()
  })

  it('starts from the stored prefs', async () => {
    localStorage.setItem(SOUND_KEY, JSON.stringify({ auto: false, preset: 'deep' }))
    await setup(PLAYING)
    expect(pressed()).toEqual(['deep'])
    expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'false')
  })

  // ---- reads ----

  it('reads on mount, on every show, every 3 s while shown, never while hidden', async () => {
    await setup(PLAYING)
    const reads = () => h.native.spotifyState.mock.calls.length
    expect(reads()).toBe(1) // mount
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000)
    })
    expect(reads()).toBe(1) // hidden: no timer

    await show(true)
    expect(reads()).toBe(2) // on show
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_500)
    })
    expect(reads()).toBe(2)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000) // 3.5 s
    })
    expect(reads()).toBe(3)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(6_000) // 9.5 s
    })
    expect(reads()).toBe(5)

    await show(false)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000)
    })
    expect(reads()).toBe(5) // cleared on hide

    await show(true)
    expect(reads()).toBe(6) // re-read on show
  })

  it('never overlaps reads: a slow one is not joined by the poll', async () => {
    let finish: (s: SpotifyState) => void = () => {}
    await setup(PLAYING)
    h.native.spotifyState.mockClear()
    h.native.spotifyState.mockImplementationOnce(
      () => new Promise<SpotifyState>((resolve) => (finish = resolve)),
    )
    await show(true)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(9_500)
    })
    expect(h.native.spotifyState).toHaveBeenCalledTimes(1)
    await act(async () => finish(PLAYING))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_000) // 12.5 s: the tick at 12 s
    })
    expect(h.native.spotifyState).toHaveBeenCalledTimes(2)
  })

  it('unmounting stops the watcher and the timers', async () => {
    const view = await setup(PLAYING)
    await show(true)
    expect(h.watchers).toBe(1)
    view.unmount()
    expect(h.watchers).toBe(0)
    h.native.spotifyState.mockClear()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000)
    })
    expect(h.native.spotifyState).not.toHaveBeenCalled()
  })

  it('without a shell (a browser) it still renders the presets', async () => {
    await setup(null)
    expect(screen.getByText('Nothing playing')).toBeInTheDocument()
    expect(pressed()).toEqual(['binaural'])
    for (const b of transport()) expect(b).toBeDisabled()
  })
})
