import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import AllowancePanel from './AllowancePanel'

/*
 * Chunk 100 (D5 / D16) — the five-minute warning of a daily allowance.
 */

describe('AllowancePanel (chunk 100, D16)', () => {
  it('shows nothing without a warning', () => {
    const { container } = render(<AllowancePanel warning={null} onDismiss={() => {}} />)
    expect(container).toBeEmptyDOMElement()
    expect(screen.queryByRole('region', { name: 'Allowance warning' })).toBeNull()
  })

  it('reads "5 minutes left for <name> today" with OK', () => {
    render(
      <AllowancePanel
        warning={{ id: 'g-1', name: 'Social', minutesLeft: 5 }}
        onDismiss={() => {}}
      />,
    )
    const panel = screen.getByRole('region', { name: 'Allowance warning' })
    expect(panel).toHaveTextContent('5 minutes left for Social today')
    expect(screen.getByRole('button', { name: 'OK' })).toBeInTheDocument()
    // The meditation panel's classes: no new visual language.
    expect(panel).toHaveClass('mb-med')
  })

  it('is singular at one minute', () => {
    render(
      <AllowancePanel
        warning={{ id: 'g-1', name: 'Social', minutesLeft: 1 }}
        onDismiss={() => {}}
      />,
    )
    expect(screen.getByText('1 minute left for Social today')).toBeInTheDocument()
  })

  it('OK calls dismiss', () => {
    const onDismiss = vi.fn()
    render(
      <AllowancePanel
        warning={{ id: 'g-1', name: 'Social', minutesLeft: 5 }}
        onDismiss={onDismiss}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'OK' }))
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })
})
