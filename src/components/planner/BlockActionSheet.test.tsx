import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

import BlockActionSheet from './BlockActionSheet'

describe('BlockActionSheet (chunk 37)', () => {
  it('renders "Mark done" for an open block and fires both callbacks', () => {
    const onToggleDone = vi.fn()
    const onUnschedule = vi.fn()
    render(
      <BlockActionSheet
        open
        title="Draft launch brief"
        rangeText="10:00–10:45"
        done={false}
        onToggleDone={onToggleDone}
        onUnschedule={onUnschedule}
        onClose={() => {}}
      />,
    )
    expect(screen.getByText('Draft launch brief')).toBeInTheDocument()
    expect(screen.getByText('10:00–10:45')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Mark done' }))
    expect(onToggleDone).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: 'Unschedule' }))
    expect(onUnschedule).toHaveBeenCalledTimes(1)
  })

  it('renders "Mark not done" for a done block; Cancel closes', () => {
    const onClose = vi.fn()
    render(
      <BlockActionSheet
        open
        title="Migration plan review"
        rangeText="09:00–10:30"
        done
        onToggleDone={() => {}}
        onUnschedule={() => {}}
        onClose={onClose}
      />,
    )
    expect(screen.getByRole('button', { name: 'Mark not done' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('carry: "Move to next open slot" renders first and fires onCarryMove (chunk 38)', () => {
    const onCarryMove = vi.fn()
    render(
      <BlockActionSheet
        open
        title="Draft launch brief"
        rangeText="10:00–10:45"
        done={false}
        carry
        onCarryMove={onCarryMove}
        onToggleDone={() => {}}
        onUnschedule={() => {}}
        onClose={() => {}}
      />,
    )
    const names = screen.getAllByRole('button').map((b) => b.textContent)
    expect(names.indexOf('Move to next open slot')).toBeLessThan(names.indexOf('Mark done'))
    fireEvent.click(screen.getByRole('button', { name: 'Move to next open slot' }))
    expect(onCarryMove).toHaveBeenCalledTimes(1)
  })

  it('no carry: no move button', () => {
    render(
      <BlockActionSheet
        open
        title="x"
        rangeText="10:00–10:45"
        done={false}
        onCarryMove={() => {}}
        onToggleDone={() => {}}
        onUnschedule={() => {}}
        onClose={() => {}}
      />,
    )
    expect(
      screen.queryByRole('button', { name: 'Move to next open slot' }),
    ).not.toBeInTheDocument()
  })

  // Chunk 82: the Planner decides where focus goes when the sheet closes.
  it('passes onCloseAutoFocus to the sheet content', async () => {
    const onCloseAutoFocus = vi.fn()
    const props = {
      title: 'Draft launch brief',
      rangeText: '10:00–10:45',
      done: false,
      onToggleDone: () => {},
      onUnschedule: () => {},
      onClose: () => {},
      onCloseAutoFocus,
    }
    const { rerender } = render(<BlockActionSheet open {...props} />)
    rerender(<BlockActionSheet open={false} {...props} />)
    // Radix dispatches the unmount auto-focus on the next tick.
    await waitFor(() => expect(onCloseAutoFocus).toHaveBeenCalledTimes(1))
    expect(onCloseAutoFocus.mock.calls[0][0]).toBeInstanceOf(Event)
  })
})
