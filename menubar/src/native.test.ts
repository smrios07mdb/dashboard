import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  listeners: [] as { event: string; handler: () => void }[],
  invoke: vi.fn<(command: string, args?: unknown) => Promise<unknown>>(
    async () => null,
  ),
}))

vi.mock('@tauri-apps/api/core', () => ({ invoke: h.invoke }))
vi.mock('@tauri-apps/api/event', () => ({
  listen: async (event: string, handler: () => void) => {
    h.listeners.push({ event, handler })
    return () => {}
  },
}))
vi.mock('@tauri-apps/plugin-global-shortcut', () => ({
  register: async () => {},
  unregister: async () => {},
}))

import {
  blockerCheck,
  blockerConfigure,
  blockerState,
  watchBlocker,
  loginItemSet,
  loginItemState,
  meditationConfigure,
  meditationEnd,
  meditationSkip,
  meditationSnooze,
  meditationStart,
  meditationState,
  openAutomationSettings,
  sessionsAck,
  sessionsClear,
  sessionsPending,
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

describe('native.ts — saved sessions (chunk 98)', () => {
  const SESSIONS = readFileSync(
    resolve(process.cwd(), 'menubar/src-tauri/src/sessions.rs'),
    'utf8',
  )

  /** The argument names of a `sessions.rs` command, minus the handle. */
  function sessionArgs(command: string): string[] {
    const m = new RegExp(
      `#\\[tauri::command\\]\\s*pub fn ${command}\\(([^)]*)\\)`,
    ).exec(SESSIONS)
    if (!m) throw new Error(`no command ${command} in sessions.rs`)
    return m[1]
      .split(',')
      .map((a) => a.trim().split(':')[0].trim())
      .filter((name) => name && name !== 'app')
  }

  beforeEach(() => {
    h.invoke.mockClear()
    h.invoke.mockImplementation(async () => null)
    h.listeners.length = 0
    vi.stubGlobal('__TAURI_INTERNALS__', {})
  })

  it('names the three commands as the shell does, with the `seqs` argument', async () => {
    await sessionsPending()
    await sessionsAck([3, 4])
    await sessionsClear()
    expect(h.invoke.mock.calls).toEqual([
      ['sessions_pending'],
      ['sessions_ack', { seqs: [3, 4] }],
      ['sessions_clear'],
    ])
    expect(sessionArgs('sessions_pending')).toEqual([])
    expect(sessionArgs('sessions_ack')).toEqual(['seqs'])
    expect(sessionArgs('sessions_clear')).toEqual([])
    expect(LIB).toContain('sessions::sessions_pending')
    expect(LIB).toContain('sessions::sessions_ack')
    expect(LIB).toContain('sessions::sessions_clear')
  })

  it('answers the ledger the shell sends', async () => {
    const ledger = [
      {
        seq: 1,
        kind: 'focus',
        startedAt: 1,
        endedAt: 2,
        plannedMs: 3,
        activeMs: 4,
        outcome: 'completed',
        taskId: null,
        taskTitle: null,
      },
    ]
    h.invoke.mockResolvedValueOnce(ledger)
    expect(await sessionsPending()).toEqual(ledger)
  })

  it('the keys of an entry are the ones the shell writes', () => {
    for (const key of [
      'seq',
      'kind',
      'startedAt',
      'endedAt',
      'plannedMs',
      'activeMs',
      'outcome',
      'taskId',
      'taskTitle',
    ]) {
      expect(SESSIONS).toContain(`\\"${key}\\":`)
    }
  })

  it('watchSessions listens for the shell\'s `sessions` event', async () => {
    const { watchSessions } = await import('./native')
    const onAdded = vi.fn()
    const off = watchSessions(onAdded)
    await vi.waitFor(() => expect(h.listeners).toHaveLength(1))
    expect(h.listeners[0].event).toBe('sessions')
    expect(SESSIONS).toContain('app.emit("sessions"')
    h.listeners[0].handler()
    expect(onAdded).toHaveBeenCalledTimes(1)
    off()
  })

  it('outside Tauri nothing is sent', async () => {
    vi.unstubAllGlobals()
    const { watchSessions } = await import('./native')
    expect(await sessionsPending()).toBeNull()
    expect(await sessionsAck([1])).toBeNull()
    await sessionsClear()
    watchSessions(() => {})()
    expect(h.invoke).not.toHaveBeenCalled()
    expect(h.listeners).toHaveLength(0)
  })
})

describe('native.ts — site blocking (chunk 99, D22)', () => {
  const BLOCKER = readFileSync(
    resolve(process.cwd(), 'menubar/src-tauri/src/blocker.rs'),
    'utf8',
  )

  /** The argument names of a `blocker.rs` command, minus the handle. */
  function blockerArgs(command: string): string[] {
    const m = new RegExp(
      `#\\[tauri::command\\][\\s\\S]*?pub (?:async )?fn ${command}\\(([^)]*)\\)`,
    ).exec(BLOCKER)
    if (!m) throw new Error(`no command ${command} in blocker.rs`)
    return m[1]
      .split(',')
      .map((a) => a.trim().split(':')[0].trim())
      .filter((name) => name && name !== 'app')
  }

  const config = {
    enabled: true,
    names: ['Social'],
    domains: [['x.com']],
    focus: [true],
    starts: [[1]],
    ends: [[2]],
  }

  beforeEach(() => {
    h.invoke.mockClear()
    h.invoke.mockImplementation(async () => null)
    h.listeners.length = 0
    vi.stubGlobal('__TAURI_INTERNALS__', {})
  })

  it('names the three commands and every argument as the shell does', async () => {
    await blockerConfigure(config)
    await blockerState()
    await blockerCheck()
    expect(h.invoke.mock.calls).toEqual([
      ['blocker_configure', config],
      ['blocker_state'],
      ['blocker_check'],
    ])
    expect(blockerArgs('blocker_configure')).toEqual([
      'enabled',
      'names',
      'domains',
      'focus',
      'starts',
      'ends',
    ])
    expect(Object.keys(h.invoke.mock.calls[0][1] as object)).toEqual(
      blockerArgs('blocker_configure'),
    )
    expect(blockerArgs('blocker_state')).toEqual([])
    expect(blockerArgs('blocker_check')).toEqual([])
    expect(LIB).toContain('blocker::blocker_configure')
    expect(LIB).toContain('blocker::blocker_state')
    expect(LIB).toContain('blocker::blocker_check')
  })

  it('listens to the shell\'s `blocker` event', () => {
    const seen: unknown[] = []
    watchBlocker((s) => seen.push(s))
    expect(h.listeners.map((l) => l.event)).toEqual(['blocker'])
    expect(BLOCKER).toContain('emit_str("blocker"')
  })

  it('outside Tauri nothing is sent', async () => {
    vi.unstubAllGlobals()
    expect(await blockerConfigure(config)).toBeNull()
    expect(await blockerState()).toBeNull()
    expect(await blockerCheck()).toBeNull()
    watchBlocker(() => {})()
    expect(h.invoke).not.toHaveBeenCalled()
    expect(h.listeners).toHaveLength(0)
  })
})
