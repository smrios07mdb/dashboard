import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { fireEvent, render } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

import { useUIStore } from '@/state/uiStore'

import { useCaptureShortcuts } from './useCaptureShortcuts'

/*
 * Chunk 73 (UX audit #7): N / "/" / ⌘K. The hook is mounted bare, with no
 * dialogs, so `uiStore.capture` is the only thing a keystroke can change.
 */

function Harness() {
  useCaptureShortcuts()
  return null
}

function mount(path = '/') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Harness />
      <input aria-label="field" />
    </MemoryRouter>,
  )
}

const capture = () => useUIStore.getState().capture
const press = (init: KeyboardEventInit, target: Element | Window = document.body) =>
  fireEvent.keyDown(target, init)

describe('useCaptureShortcuts (chunk 73)', () => {
  beforeEach(() => {
    useUIStore.setState({ capture: null })
  })
  afterEach(() => {
    document.body.querySelectorAll('[data-fixture]').forEach((n) => n.remove())
  })

  it('n opens capture', () => {
    mount()
    press({ key: 'n' })
    expect(capture()).toEqual({ mode: 'add', text: '' })
  })

  it('N (shift) opens capture too', () => {
    mount()
    press({ key: 'N', shiftKey: true })
    expect(capture()).toEqual({ mode: 'add', text: '' })
  })

  it('/ opens search', () => {
    mount()
    press({ key: '/' })
    expect(capture()).toEqual({ mode: 'search', text: '' })
  })

  it('prevents the default when it fires, so the key is not typed into the dialog', () => {
    mount()
    // fireEvent returns false when preventDefault was called.
    expect(press({ key: '/' })).toBe(false)
  })

  it('n typed in an input does nothing', () => {
    const { getByLabelText } = mount()
    press({ key: 'n' }, getByLabelText('field'))
    expect(capture()).toBeNull()
  })

  it('n in a contenteditable does nothing', () => {
    mount()
    const editable = document.createElement('div')
    editable.setAttribute('contenteditable', 'true')
    editable.setAttribute('data-fixture', '')
    document.body.appendChild(editable)
    press({ key: 'n' }, editable)
    expect(capture()).toBeNull()
  })

  it('n with a modifier does nothing', () => {
    mount()
    press({ key: 'n', metaKey: true })
    press({ key: 'n', ctrlKey: true })
    press({ key: 'n', altKey: true })
    expect(capture()).toBeNull()
  })

  it('an auto-repeated n does nothing', () => {
    mount()
    press({ key: 'n', repeat: true })
    expect(capture()).toBeNull()
  })

  it.each(['dialog', 'alertdialog', 'menu'])(
    'n while a %s is in the DOM does nothing',
    (role) => {
      mount()
      const layer = document.createElement('div')
      layer.setAttribute('role', role)
      layer.setAttribute('data-fixture', '')
      document.body.appendChild(layer)
      press({ key: 'n' })
      expect(capture()).toBeNull()
    },
  )

  it('a closed layer still in the DOM does not block n', () => {
    mount()
    const layer = document.createElement('div')
    layer.setAttribute('role', 'dialog')
    layer.setAttribute('data-state', 'closed')
    layer.setAttribute('data-fixture', '')
    document.body.appendChild(layer)
    press({ key: 'n' })
    expect(capture()).toEqual({ mode: 'add', text: '' })
  })

  it('Ctrl+K and ⌘K open capture from inside an input', () => {
    const { getByLabelText } = mount()
    press({ key: 'k', ctrlKey: true }, getByLabelText('field'))
    expect(capture()).toEqual({ mode: 'add', text: '' })

    useUIStore.setState({ capture: null })
    press({ key: 'k', metaKey: true }, getByLabelText('field'))
    expect(capture()).toEqual({ mode: 'add', text: '' })
  })

  it('⌘K leaves an open search dialog alone', () => {
    mount()
    useUIStore.setState({ capture: { mode: 'search', text: 'bob' } })
    press({ key: 'k', metaKey: true })
    expect(capture()).toEqual({ mode: 'search', text: 'bob' })
  })

  it('on a Notebook editor path n and / do nothing, ⌘K still opens', () => {
    mount('/notebook/abc123')
    press({ key: 'n' })
    press({ key: '/' })
    expect(capture()).toBeNull()
    press({ key: 'k', metaKey: true })
    expect(capture()).toEqual({ mode: 'add', text: '' })
  })

  it('on the Notebook list n opens capture', () => {
    mount('/notebook')
    press({ key: 'n' })
    expect(capture()).toEqual({ mode: 'add', text: '' })
  })

  it('removes its listener on unmount', () => {
    const { unmount } = mount()
    unmount()
    press({ key: 'n' })
    expect(capture()).toBeNull()
  })
})
