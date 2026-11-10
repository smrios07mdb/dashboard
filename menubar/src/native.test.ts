import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  invoke: vi.fn<(command: string, args?: unknown) => Promise<unknown>>(
    async () => null,
  ),
}))

vi.mock('@tauri-apps/api/core', () => ({ invoke: h.invoke }))
vi.mock('@tauri-apps/api/event', () => ({ listen: async () => () => {} }))
vi.mock('@tauri-apps/plugin-global-shortcut', () => ({
  register: async () => {},
  unregister: async () => {},
}))

import {
  openAutomationSettings,
  soundConfigure,
  spotifyNext,
  spotifyPause,
  spotifyPlayPause,
  spotifyPlayPreset,
  spotifyPrevious,
  spotifyState,
} from './native'

const URI = 'spotify:playlist:37i9dQZF1DX7EF8wVxBVhG'
const RUST = readFileSync(
  resolve(process.cwd(), 'menubar/src-tauri/src/sound.rs'),
  'utf8',
)
const LIB = readFileSync(
  resolve(process.cwd(), 'menubar/src-tauri/src/lib.rs'),
  'utf8',
)

/** The argument names of a `#[tauri::command]`, minus the injected handle. */
function rustArgs(command: string): string[] {
  const m = new RegExp(
    `#\\[tauri::command\\]\\s*pub (?:async )?fn ${command}\\(([^)]*)\\)`,
  ).exec(RUST)
  if (!m) throw new Error(`no command ${command} in sound.rs`)
  return m[1]
    .split(',')
    .map((a) => a.trim().split(':')[0].trim())
    .filter((name) => name && name !== 'app')
}

describe('native.ts — sound commands (chunk 95)', () => {
  beforeEach(() => {
    h.invoke.mockClear()
    vi.stubGlobal('__TAURI_INTERNALS__', {})
    return () => vi.unstubAllGlobals()
  })

  it('names each command as the shell does, with its exact arguments', async () => {
    await spotifyState()
    await spotifyPlayPause()
    await spotifyPause()
    await spotifyNext()
    await spotifyPrevious()
    await spotifyPlayPreset(URI)
    await soundConfigure(true, URI)
    await soundConfigure(false, null)
    openAutomationSettings()
    expect(h.invoke.mock.calls).toEqual([
      ['spotify_state', undefined],
      ['spotify_play_pause', undefined],
      ['spotify_pause', undefined],
      ['spotify_next', undefined],
      ['spotify_previous', undefined],
      ['spotify_play_preset', { uri: URI }],
      ['sound_configure', { auto: true, uri: URI }],
      ['sound_configure', { auto: false, uri: null }],
      ['open_automation_settings', undefined],
    ])
  })

  it('the argument names are the Rust signatures', async () => {
    await spotifyPlayPreset(URI)
    await soundConfigure(true, URI)
    const sent = (command: string) =>
      Object.keys(
        (h.invoke.mock.calls.find((c) => c[0] === command)?.[1] ?? {}) as object,
      )
    expect(rustArgs('spotify_play_preset')).toEqual(['uri'])
    expect(sent('spotify_play_preset')).toEqual(rustArgs('spotify_play_preset'))
    expect(rustArgs('sound_configure')).toEqual(['auto', 'uri'])
    expect(sent('sound_configure')).toEqual(rustArgs('sound_configure'))
    for (const bare of [
      'spotify_state',
      'spotify_play_pause',
      'spotify_pause',
      'spotify_next',
      'spotify_previous',
      'open_automation_settings',
    ]) {
      expect(rustArgs(bare)).toEqual([])
    }
  })

  it('every sound command is in the shell handler list', () => {
    for (const command of [
      'spotify_state',
      'spotify_play_pause',
      'spotify_pause',
      'spotify_next',
      'spotify_previous',
      'spotify_play_preset',
      'sound_configure',
      'open_automation_settings',
    ]) {
      expect(LIB).toContain(`sound::${command}`)
    }
  })

  it('answers the state the shell sends', async () => {
    const state = { status: 'ok', playing: true, track: 'Aria', artist: 'Bach' }
    h.invoke.mockResolvedValueOnce(state)
    expect(await spotifyState()).toEqual(state)
  })

  it('a rejected configure is logged, not thrown', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    h.invoke.mockRejectedValueOnce('not a playlist uri')
    await expect(soundConfigure(true, 'nope')).resolves.toBeUndefined()
    expect(error).toHaveBeenCalled()
    error.mockRestore()
  })

  it('outside Tauri nothing is sent', async () => {
    vi.unstubAllGlobals()
    expect(await spotifyState()).toBeNull()
    expect(await spotifyPlayPreset(URI)).toBeNull()
    await soundConfigure(true, URI)
    openAutomationSettings()
    expect(h.invoke).not.toHaveBeenCalled()
  })
})
