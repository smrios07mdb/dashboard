import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'

import { useShellMarginsStore } from '@/state/shellMargins'

import MarginEditor from './MarginEditor'

describe('MarginEditor', () => {
  beforeEach(() => {
    localStorage.clear()
    useShellMarginsStore.setState({ margins: null, draft: null })
  })

  it('renders nothing while not editing', () => {
    render(<MarginEditor />)
    expect(screen.queryByTestId('margin-editor-bar')).toBeNull()
  })

  it('dragging the left guide inward grows the side margin; Save persists it', async () => {
    useShellMarginsStore.setState({
      draft: { side: 20, top: 24, bottom: 32 },
    })
    render(<MarginEditor />)
    const left = screen.getByRole('button', { name: 'Left margin' })
    // jsdom has no pointer capture; stub the two calls the handler makes.
    left.setPointerCapture = () => {}
    left.releasePointerCapture = () => {}

    fireEvent.pointerDown(left, { clientX: 100, clientY: 300, pointerId: 1 })
    fireEvent.pointerMove(left, { clientX: 130, clientY: 300, pointerId: 1 })
    fireEvent.pointerUp(left, { clientX: 130, clientY: 300, pointerId: 1 })
    expect(useShellMarginsStore.getState().draft?.side).toBe(50)

    // Right guide: dragging left (inward) also grows the shared side margin.
    const right = screen.getByRole('button', { name: 'Right margin' })
    right.setPointerCapture = () => {}
    right.releasePointerCapture = () => {}
    fireEvent.pointerDown(right, { clientX: 900, clientY: 300, pointerId: 2 })
    fireEvent.pointerMove(right, { clientX: 890, clientY: 300, pointerId: 2 })
    fireEvent.pointerUp(right, { clientX: 890, clientY: 300, pointerId: 2 })
    expect(useShellMarginsStore.getState().draft?.side).toBe(60)

    await userEvent.click(screen.getByRole('button', { name: /save/i }))
    expect(useShellMarginsStore.getState().draft).toBeNull()
    expect(useShellMarginsStore.getState().margins).toEqual({
      side: 60,
      top: 24,
      bottom: 32,
    })
    expect(JSON.parse(localStorage.getItem('hup:shellMargins')!).side).toBe(60)
  })

  it('arrow keys nudge the top margin; Escape cancels without saving', async () => {
    useShellMarginsStore.setState({
      draft: { side: 20, top: 24, bottom: 32 },
    })
    render(<MarginEditor />)
    const top = screen.getByRole('button', { name: 'Top margin' })
    top.focus()
    fireEvent.keyDown(top, { key: 'ArrowDown' })
    fireEvent.keyDown(top, { key: 'ArrowDown', shiftKey: true })
    expect(useShellMarginsStore.getState().draft?.top).toBe(44)

    await userEvent.keyboard('{Escape}')
    expect(useShellMarginsStore.getState().draft).toBeNull()
    expect(useShellMarginsStore.getState().margins).toBeNull()
    expect(localStorage.getItem('hup:shellMargins')).toBeNull()
  })
})
