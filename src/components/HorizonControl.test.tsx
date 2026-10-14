import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import HorizonControl from './HorizonControl'
import type { HorizonFilter } from '@/lib/horizon'

/* Chunk 76: Near · Long · All radiogroup with roving tabindex. */

function setup(value: HorizonFilter = 'near') {
  const onChange = vi.fn()
  render(<HorizonControl value={value} onChange={onChange} />)
  return { onChange }
}

describe('HorizonControl', () => {
  it('renders three radios; only the checked one is in the tab order', () => {
    setup('long')
    expect(screen.getByRole('radiogroup', { name: 'Horizon' })).toBeInTheDocument()
    const radios = screen.getAllByRole('radio')
    expect(radios.map((r) => r.textContent)).toEqual(['Near', 'Long', 'All'])
    expect(radios.map((r) => r.getAttribute('aria-checked'))).toEqual([
      'false',
      'true',
      'false',
    ])
    expect(radios.map((r) => r.tabIndex)).toEqual([-1, 0, -1])
  })

  it('a click selects', () => {
    const { onChange } = setup()
    fireEvent.click(screen.getByRole('radio', { name: 'Long' }))
    expect(onChange).toHaveBeenCalledWith('long')
  })

  it('arrows move, End goes last, ArrowLeft from the first wraps to the last', () => {
    const { onChange } = setup('near')
    const near = screen.getByRole('radio', { name: 'Near' })
    fireEvent.keyDown(near, { key: 'ArrowRight' })
    expect(onChange).toHaveBeenLastCalledWith('long')
    fireEvent.keyDown(near, { key: 'End' })
    expect(onChange).toHaveBeenLastCalledWith('all')
    fireEvent.keyDown(near, { key: 'ArrowLeft' })
    expect(onChange).toHaveBeenLastCalledWith('all')
    fireEvent.keyDown(near, { key: 'Home' })
    expect(onChange).toHaveBeenLastCalledWith('near')
  })

  it('keeps clicks and keys from reaching a parent', () => {
    const onClick = vi.fn()
    const onDoubleClick = vi.fn()
    const onKeyDown = vi.fn()
    render(
      <div onClick={onClick} onDoubleClick={onDoubleClick} onKeyDown={onKeyDown}>
        <HorizonControl value="all" onChange={vi.fn()} />
      </div>,
    )
    const long = screen.getByRole('radio', { name: 'Long' })
    fireEvent.click(long)
    fireEvent.doubleClick(long)
    fireEvent.keyDown(long, { key: 'Enter' })
    expect(onClick).not.toHaveBeenCalled()
    expect(onDoubleClick).not.toHaveBeenCalled()
    expect(onKeyDown).not.toHaveBeenCalled()
  })
})
