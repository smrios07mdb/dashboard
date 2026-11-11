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
  loginItemSet,
  loginItemState,
  meditationConfigure,
  meditationEnd,
  meditationSkip,
  meditationSnooze,
  meditationStart,
  meditationState,
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

const MEDITATION = readFileSync(
  resolve(process.cwd(), 'menubar/src-tauri/src/meditation.rs'),
  'utf8',
)

/** A command's argument names as the web view must send them (camelCase). */
function meditationArgs(command: string): string[] {
  const m = new RegExp(
    `#\\[tauri::command\\]\\s*pub fn ${command}\\(([^)]*)\\)`,
  ).exec(MEDITATION)
  if (!m) throw new Error(`no command ${command} in meditation.rs`)
  return m[1]
    .split(',')
    .map((a) => a.trim().split(':')[0].trim())
    .filter((name) => name && name !== 'app')
    .map((name) => name.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase()))
}

describe('native.ts — meditation commands (chunk 96)', () => {
  const CONFIG = {
    due: [1_800_000_000_000, 1_800_005_400_000],
    headsUp: 5,
    length: 5,
    pauseSpotify: true,
    utcOffset: -300,
  }

  beforeEach(() => {
    h.invoke.mockClear()
    vi.stubGlobal('__TAURI_INTERNALS__', {})
    return () => vi.unstubAllGlobals()
  })

  it('names each command as the shell does, with its exact arguments', async () => {
    await meditationState()
    await meditationConfigure(CONFIG)
    await meditationStart()
    await meditationSnooze(5)
    await meditationSnooze(15)
    await meditationSkip()
    await meditationEnd()
    expect(h.invoke.mock.calls).toEqual([
      ['meditation_state', undefined],
      ['meditation_configure', CONFIG],
      ['meditation_start', undefined],
      ['meditation_snooze', { minutes: 5 }],
      ['meditation_snooze', { minutes: 15 }],
      ['meditation_skip', undefined],
      ['meditation_end', undefined],
    ])
  })

  it('the argument names are the Rust signatures', async () => {
    await meditationConfigure(CONFIG)
    await meditationSnooze(5)
    const sent = (command: string) =>
      Object.keys(
        (h.invoke.mock.calls.find((c) => c[0] === command)?.[1] ?? {}) as object,
      )
    expect(meditationArgs('meditation_configure')).toEqual([
      'due',
      'headsUp',
      'length',
      'pauseSpotify',
      'utcOffset',
    ])
    expect(sent('meditation_configure')).toEqual(
      meditationArgs('meditation_configure'),
    )
    expect(meditationArgs('meditation_snooze')).toEqual(['minutes'])
    expect(sent('meditation_snooze')).toEqual(meditationArgs('meditation_snooze'))
    for (const bare of [
      'meditation_state',
      'meditation_start',
      'meditation_skip',
      'meditation_end',
    ]) {
      expect(meditationArgs(bare)).toEqual([])
    }
  })

  it('every meditation command is in the shell handler list', () => {
    for (const command of [
      'meditation_state',
      'meditation_configure',
      'meditation_start',
      'meditation_snooze',
      'meditation_skip',
      'meditation_end',
    ]) {
      expect(LIB).toContain(`meditation::${command}`)
    }
  })

  it('answers the snapshot the shell sends', async () => {
    const snapshot = {
      status: 'due',
      dueAt: 1_800_000_000_000,
      startedAt: null,
      endsAt: null,
      length: 5,
      pauseSpotify: true,
      nextDueAt: null,
    }
    h.invoke.mockResolvedValueOnce(snapshot)
    expect(await meditationState()).toEqual(snapshot)
  })

  it('outside Tauri nothing is sent', async () => {
    vi.unstubAllGlobals()
    expect(await meditationState()).toBeNull()
    expect(await meditationConfigure(CONFIG)).toBeNull()
    expect(await meditationStart()).toBeNull()
    expect(await meditationEnd()).toBeNull()
    expect(h.invoke).not.toHaveBeenCalled()
  })
})

const LOGIN = readFileSync(
  resolve(process.cwd(), 'menubar/src-tauri/src/login.rs'),
  'utf8',
)

function loginArgs(command: string): string[] {
  const m = new RegExp(
    `#\\[tauri::command\\]\\s*pub fn ${command}\\(([^)]*)\\)`,
  ).exec(LOGIN)
  if (!m) throw new Error(`no command ${command} in login.rs`)
  return m[1]
    .split(',')
    .map((a) => a.trim().split(':')[0].trim())
    .filter((name) => name && name !== 'app')
}

describe('native.ts — open at login (chunk 97, D12)', () => {
  beforeEach(() => {
    h.invoke.mockClear()
    vi.stubGlobal('__TAURI_INTERNALS__', {})
    return () => vi.unstubAllGlobals()
  })

  it('names both commands as the shell does, with the `on` argument', async () => {
    await loginItemState()
    await loginItemSet(true)
    await loginItemSet(false)
    expect(h.invoke.mock.calls).toEqual([
      ['login_item_state'],
      ['login_item_set', { on: true }],
      ['login_item_set', { on: false }],
    ])
    expect(loginArgs('login_item_state')).toEqual([])
    expect(loginArgs('login_item_set')).toEqual(['on'])
    expect(LIB).toContain('login::login_item_state')
    expect(LIB).toContain('login::login_item_set')
  })

  it('answers the state the shell sends', async () => {
    const state = { status: 'other', path: '/Applications/Hupomnemata.app' }
    h.invoke.mockResolvedValueOnce(state)
    expect(await loginItemState()).toEqual(state)
  })

  it('outside Tauri nothing is sent', async () => {
    vi.unstubAllGlobals()
    expect(await loginItemState()).toBeNull()
    expect(await loginItemSet(true)).toBeNull()
    expect(h.invoke).not.toHaveBeenCalled()
  })
})
