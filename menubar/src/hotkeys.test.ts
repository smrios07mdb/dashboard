import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  accelFromEvent,
  ACTION_LABEL,
  createHotkeys,
  DEFAULT_HOTKEYS,
  hotkeyLabel,
  HOTKEYS_KEY,
  readHotkeys,
  usedBy,
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

  it('rebind moves the key, remembers it and says it took', async () => {
    const b = backend()
    const h = createHotkeys(b, HANDLERS())
    await h.start()
    expect(await h.rebind('scratchpad', 'Alt+K')).toBe(true)
    expect(b.unregister).toHaveBeenCalledWith('Alt+H')
    expect([...b.presses.keys()].sort()).toEqual(['Alt+K', 'Alt+Shift+F', 'Alt+Shift+M'])
    expect(readHotkeys()).toEqual({ ...DEFAULTS, scratchpad: 'Alt+K' })
    expect(h.getState().bound.scratchpad).toBe('Alt+K')
    expect(h.getState().failed).toEqual({})
  })

  // Chunk 97, D10: a failed rebind keeps the old key.
  it('rebind failure keeps the old key registered and the map unchanged', async () => {
    const b = backend(['Alt+K'])
    const scratchpad = vi.fn()
    const h = createHotkeys(b, { ...HANDLERS(), scratchpad })
    await h.start()
    expect(await h.rebind('scratchpad', 'Alt+K')).toBe(false)
    expect([...b.presses.keys()].sort()).toEqual(['Alt+H', 'Alt+Shift+F', 'Alt+Shift+M'])
    b.presses.get('Alt+H')!()
    expect(scratchpad).toHaveBeenCalledTimes(1)
    expect(h.getState().bound).toEqual(DEFAULTS)
    expect(localStorage.getItem(HOTKEYS_KEY)).toBeNull()
    expect(h.getState().failed).toEqual({
      scratchpad: '⌥K is taken by another app — kept ⌥H',
    })
    // A later rebind that takes clears the message.
    expect(await h.rebind('scratchpad', 'Alt+J')).toBe(true)
    expect(h.getState().failed).toEqual({})
  })

  it('resetDefaults puts every action back, even swapped keys', async () => {
    localStorage.setItem(
      HOTKEYS_KEY,
      JSON.stringify({ scratchpad: 'Alt+Shift+F', focus: 'Alt+J', meditate: 'Alt+Shift+M' }),
    )
    const b = backend()
    const focus = vi.fn()
    const scratchpad = vi.fn()
    const h = createHotkeys(b, { ...HANDLERS(), focus, scratchpad })
    await h.start()
    await h.resetDefaults()
    expect([...b.presses.keys()].sort()).toEqual(['Alt+H', 'Alt+Shift+F', 'Alt+Shift+M'])
    b.presses.get('Alt+Shift+F')!()
    expect(focus).toHaveBeenCalledTimes(1)
    expect(scratchpad).not.toHaveBeenCalled()
    expect(readHotkeys()).toEqual(DEFAULTS)
    expect(h.getState().bound).toEqual(DEFAULTS)
  })

  it('resetDefaults keeps the old key of an action whose default is taken', async () => {
    localStorage.setItem(HOTKEYS_KEY, JSON.stringify({ scratchpad: 'Alt+J', focus: 'Alt+G' }))
    const b = backend(['Alt+H'])
    const h = createHotkeys(b, HANDLERS())
    await h.start()
    await h.resetDefaults()
    expect([...b.presses.keys()].sort()).toEqual(['Alt+J', 'Alt+Shift+F', 'Alt+Shift+M'])
    expect(h.getState().bound).toEqual({ ...DEFAULTS, scratchpad: 'Alt+J' })
    expect(readHotkeys()).toEqual({ ...DEFAULTS, scratchpad: 'Alt+J' })
    expect(h.getState().failed).toEqual({
      scratchpad: '⌥H is taken by another app — kept ⌥J',
    })
  })

  it('stop and start around a recording release and restore every key', async () => {
    const b = backend()
    const h = createHotkeys(b, HANDLERS())
    await h.start()
    expect(b.presses.size).toBe(3)
    await h.stop()
    expect(b.presses.size).toBe(0)
    expect(b.unregister).toHaveBeenCalledTimes(3)
    await h.start()
    expect([...b.presses.keys()].sort()).toEqual(['Alt+H', 'Alt+Shift+F', 'Alt+Shift+M'])
  })
})

describe('accelFromEvent (chunk 97, D9)', () => {
  const ev = (code: string, mods: Partial<Record<'ctrl' | 'alt' | 'shift' | 'meta', boolean>> = {}) => ({
    code,
    ctrlKey: !!mods.ctrl,
    altKey: !!mods.alt,
    shiftKey: !!mods.shift,
    metaKey: !!mods.meta,
  })

  it('builds the plugin accelerator from e.code', () => {
    expect(accelFromEvent(ev('KeyH', { alt: true }))).toBe('Alt+H')
    expect(accelFromEvent(ev('KeyK', { ctrl: true, alt: true, shift: true, meta: true }))).toBe(
      'Control+Alt+Shift+Command+K',
    )
    expect(accelFromEvent(ev('Digit5', { meta: true }))).toBe('Command+5')
    expect(accelFromEvent(ev('Space', { alt: true }))).toBe('Alt+Space')
    expect(accelFromEvent(ev('F5', { ctrl: true }))).toBe('Control+F5')
    expect(accelFromEvent(ev('F12', { alt: true, shift: true }))).toBe('Alt+Shift+F12')
    expect(accelFromEvent(ev('KeyJ', { shift: true, alt: true }))).toBe('Alt+Shift+J')
  })

  it('needs one of ⌃ ⌥ ⌘; ⇧ alone is not enough', () => {
    expect(accelFromEvent(ev('KeyH'))).toBeNull()
    expect(accelFromEvent(ev('KeyH', { shift: true }))).toBeNull()
  })

  it('ignores any other key', () => {
    for (const code of ['AltLeft', 'ShiftLeft', 'MetaLeft', 'Escape', 'Enter', 'Tab', 'Minus', 'ArrowUp', 'F13', 'Numpad1', 'KeyHH', 'Digit10']) {
      expect(accelFromEvent(ev(code, { alt: true })), code).toBeNull()
    }
  })
})

describe('usedBy', () => {
  it('names the other action holding a combo, whatever the modifier order', () => {
    expect(ACTION_LABEL).toEqual({
      scratchpad: 'Open scratchpad',
      focus: 'Start or pause focus',
      meditate: 'Start meditation',
    })
    expect(usedBy(DEFAULTS, 'scratchpad', 'Alt+Shift+F')).toBe('focus')
    expect(usedBy(DEFAULTS, 'scratchpad', 'Shift+Alt+F')).toBe('focus')
    expect(usedBy(DEFAULTS, 'scratchpad', 'Alt+Shift+M')).toBe('meditate')
    expect(usedBy(DEFAULTS, 'scratchpad', 'Alt+H')).toBeNull()
    expect(usedBy(DEFAULTS, 'scratchpad', 'Alt+J')).toBeNull()
    expect(usedBy({ ...DEFAULTS, focus: 'Option+Shift+KeyF' }, 'meditate', 'Alt+Shift+F')).toBe('focus')
  })
})
