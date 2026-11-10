import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  createHotkeys,
  DEFAULT_HOTKEYS,
  hotkeyLabel,
  HOTKEYS_KEY,
  readHotkeys,
  type HotkeyBackend,
} from './hotkeys'

function backend(fail: string[] = []) {
  const presses = new Map<string, () => void>()
  const b: HotkeyBackend & { presses: typeof presses } = {
    presses,
    register: vi.fn(async (accel: string, onPress: () => void) => {
      if (fail.includes(accel)) throw new Error('HotKey already registered')
      presses.set(accel, onPress)
    }),
    unregister: vi.fn(async (accel: string) => {
      presses.delete(accel)
    }),
  }
  return b
}

const HANDLERS = () => ({ scratchpad: vi.fn(), focus: vi.fn(), meditate: vi.fn() })
const DEFAULTS = {
  scratchpad: 'Alt+H',
  focus: 'Alt+Shift+F',
  meditate: 'Alt+Shift+M',
}

describe('hotkeys', () => {
  beforeEach(() => localStorage.clear())

  it('defaults to ⌥H for the scratchpad, ⌥⇧F for focus and ⌥⇧M to meditate', () => {
    expect(DEFAULT_HOTKEYS).toEqual({
      scratchpad: 'Alt+H',
      focus: 'Alt+Shift+F',
      meditate: 'Alt+Shift+M',
    })
    expect(readHotkeys()).toEqual(DEFAULTS)
    expect(hotkeyLabel('Alt+Shift+M')).toBe('⌥⇧M')
    expect(hotkeyLabel('Alt+H')).toBe('⌥H')
    expect(hotkeyLabel('Alt+Shift+F')).toBe('⌥⇧F')
    expect(hotkeyLabel('CommandOrControl+Shift+Space')).toBe('⌘⇧Space')
  })

  it('uses a stored override and ignores junk', () => {
    localStorage.setItem(HOTKEYS_KEY, JSON.stringify({ scratchpad: 'Alt+J', x: 1 }))
    expect(readHotkeys()).toEqual({ ...DEFAULTS, scratchpad: 'Alt+J' })
    localStorage.setItem(HOTKEYS_KEY, '{not json')
    expect(readHotkeys()).toEqual(DEFAULTS)
    localStorage.setItem(HOTKEYS_KEY, JSON.stringify({ scratchpad: 3, focus: 'Alt+G' }))
    expect(readHotkeys()).toEqual({ ...DEFAULTS, focus: 'Alt+G' })
  })

  it('registers the stored binding and calls the handler on press', async () => {
    localStorage.setItem(HOTKEYS_KEY, JSON.stringify({ scratchpad: 'Alt+J' }))
    const b = backend()
    const scratchpad = vi.fn()
    const focus = vi.fn()
    const meditate = vi.fn()
    const h = createHotkeys(b, { scratchpad, focus, meditate })
    await h.start()
    // ⌥⇧M (chunk 96, D8) registers with the rest and calls its own handler.
    expect(b.register).toHaveBeenCalledWith('Alt+Shift+M', expect.any(Function))
    b.presses.get('Alt+Shift+M')!()
    expect(meditate).toHaveBeenCalledTimes(1)
    expect(focus).not.toHaveBeenCalled()
    expect(b.register).toHaveBeenCalledWith('Alt+J', expect.any(Function))
    expect(b.register).toHaveBeenCalledWith('Alt+Shift+F', expect.any(Function))
    b.presses.get('Alt+J')!()
    expect(scratchpad).toHaveBeenCalledTimes(1)
    expect(focus).not.toHaveBeenCalled()
    b.presses.get('Alt+Shift+F')!()
    expect(focus).toHaveBeenCalledTimes(1)
    expect(h.getState().failed).toEqual({})
  })

  it('surfaces a failed registration', async () => {
    const h = createHotkeys(backend(['Alt+H']), HANDLERS())
    const listener = vi.fn()
    h.subscribe(listener)
    await h.start()
    expect(h.getState().failed).toEqual({ scratchpad: '⌥H is taken by another app' })
    expect(listener).toHaveBeenCalled()

    const f = createHotkeys(backend(['Alt+Shift+F']), HANDLERS())
    await f.start()
    expect(f.getState().failed).toEqual({ focus: '⌥⇧F is taken by another app' })

    const m = createHotkeys(backend(['Alt+Shift+M']), HANDLERS())
    await m.start()
    expect(m.getState().failed).toEqual({ meditate: '⌥⇧M is taken by another app' })
  })

  it('stop unregisters; a stop during registration gives the key back', async () => {
    const b = backend()
    const h = createHotkeys(b, HANDLERS())
    await h.start()
    await h.stop()
    expect(b.unregister).toHaveBeenCalledWith('Alt+H')
    expect(b.presses.size).toBe(0)

    const started = h.start()
    void h.stop()
    await started
    expect(b.presses.size).toBe(0)
  })

  it('rebind moves the key and remembers it', async () => {
    const b = backend()
    const h = createHotkeys(b, HANDLERS())
    await h.start()
    await h.rebind('scratchpad', 'Alt+K')
    expect(b.unregister).toHaveBeenCalledWith('Alt+H')
    expect([...b.presses.keys()].sort()).toEqual(['Alt+K', 'Alt+Shift+F', 'Alt+Shift+M'])
    expect(readHotkeys()).toEqual({ ...DEFAULTS, scratchpad: 'Alt+K' })
  })
})
