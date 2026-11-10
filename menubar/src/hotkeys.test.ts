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

describe('hotkeys', () => {
  beforeEach(() => localStorage.clear())

  it('defaults to ⌥H for the scratchpad', () => {
    expect(DEFAULT_HOTKEYS).toEqual({ scratchpad: 'Alt+H' })
    expect(readHotkeys()).toEqual({ scratchpad: 'Alt+H' })
    expect(hotkeyLabel('Alt+H')).toBe('⌥H')
    expect(hotkeyLabel('CommandOrControl+Shift+Space')).toBe('⌘⇧Space')
  })

  it('uses a stored override and ignores junk', () => {
    localStorage.setItem(HOTKEYS_KEY, JSON.stringify({ scratchpad: 'Alt+J', x: 1 }))
    expect(readHotkeys()).toEqual({ scratchpad: 'Alt+J' })
    localStorage.setItem(HOTKEYS_KEY, '{not json')
    expect(readHotkeys()).toEqual({ scratchpad: 'Alt+H' })
    localStorage.setItem(HOTKEYS_KEY, JSON.stringify({ scratchpad: 3 }))
    expect(readHotkeys()).toEqual({ scratchpad: 'Alt+H' })
  })

  it('registers the stored binding and calls the handler on press', async () => {
    localStorage.setItem(HOTKEYS_KEY, JSON.stringify({ scratchpad: 'Alt+J' }))
    const b = backend()
    const scratchpad = vi.fn()
    const h = createHotkeys(b, { scratchpad })
    await h.start()
    expect(b.register).toHaveBeenCalledWith('Alt+J', expect.any(Function))
    b.presses.get('Alt+J')!()
    expect(scratchpad).toHaveBeenCalledTimes(1)
    expect(h.getState().failed).toEqual({})
  })

  it('surfaces a failed registration', async () => {
    const h = createHotkeys(backend(['Alt+H']), { scratchpad: vi.fn() })
    const listener = vi.fn()
    h.subscribe(listener)
    await h.start()
    expect(h.getState().failed.scratchpad).toBe('⌥H is taken by another app')
    expect(listener).toHaveBeenCalled()
  })

  it('stop unregisters; a stop during registration gives the key back', async () => {
    const b = backend()
    const h = createHotkeys(b, { scratchpad: vi.fn() })
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
    const h = createHotkeys(b, { scratchpad: vi.fn() })
    await h.start()
    await h.rebind('scratchpad', 'Alt+K')
    expect(b.unregister).toHaveBeenCalledWith('Alt+H')
    expect([...b.presses.keys()]).toEqual(['Alt+K'])
    expect(readHotkeys()).toEqual({ scratchpad: 'Alt+K' })
  })
})
