import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'

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
})
