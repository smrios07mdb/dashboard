import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import AddTaskInline from './AddTaskInline'

/*
 * UX-03: inline inputs must be >=16px on touch or iOS Safari auto-zooms on
 * focus. Use text-base (16px) on mobile, compact at >=sm. Asserting the
 * class pair guards against a regression to a sub-16px mobile size.
 */
describe('AddTaskInline — touch-safe input sizing (UX-03)', () => {
  it('uses text-base (16px) on mobile, compact at sm+, for both inputs', async () => {
    const user = userEvent.setup()
    render(<AddTaskInline onCreate={vi.fn()} />)
    await user.click(screen.getByRole('button', { name: /new task/i }))

    const title = screen.getByLabelText(/new task title/i)
    const minutes = screen.getByLabelText(/estimate minutes/i)

    expect(title.className).toContain('text-base')
    expect(title.className).toContain('sm:text-[13px]')
    expect(minutes.className).toContain('text-base')
    expect(minutes.className).toContain('sm:text-[12px]')
  })
})
