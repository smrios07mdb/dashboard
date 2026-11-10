import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { Category, Subcategory } from '@/db/types'

import PopoverTabs from './PopoverTabs'
import { DRAFT_KEY, TAB_KEY } from './prefs'
import type { ScratchLists } from './scratchpad'
import Scratchpad from './ScratchpadTab'

const WORK: Category = { id: 'cw', userId: 'u1', name: 'Work' }
const W_GENERAL: Subcategory = {
  id: 'wg',
  userId: 'u1',
  categoryId: 'cw',
  name: 'General',
  sortOrder: 0,
  archivedAt: null,
}
const LISTS: ScratchLists = {
  categories: [WORK],
  subcategories: [W_GENERAL],
  timeZone: 'America/New_York',
}

function pad(over: Partial<Parameters<typeof Scratchpad>[0]> = {}) {
  const props = {
    lists: LISTS,
    userId: 'u1',
    send: vi.fn().mockResolvedValue({
      leftover: '',
      sent: 1,
      result: 'Sent 1 task to Work › General',
    }),
    hotkeyError: null,
    focusSeq: 0,
    onHide: vi.fn(),
    ...over,
  }
  return { props, el: <Scratchpad {...props} /> }
}

describe('menubar Scratchpad', () => {
  beforeEach(() => localStorage.clear())

  it('restores the draft from storage', () => {
    localStorage.setItem(DRAFT_KEY, 'Call the bank\nRenew passport')
    render(pad().el)
    expect(screen.getByLabelText('Scratchpad')).toHaveValue(
      'Call the bank\nRenew passport',
    )
    expect(screen.getByRole('status')).toHaveTextContent(
      '2 lines → 2 tasks in Work › General',
    )
  })

  it('persists every input', async () => {
    const user = userEvent.setup()
    render(pad().el)
    await user.type(screen.getByLabelText('Scratchpad'), 'Hi')
    expect(localStorage.getItem(DRAFT_KEY)).toBe('Hi')
  })

  it('counts singular, plural and empty; Send disabled when empty', async () => {
    const user = userEvent.setup()
    render(pad().el)
    const send = screen.getByRole('button', { name: 'Send' })
    expect(screen.getByRole('status')).toHaveTextContent('Nothing to send')
    expect(send).toBeDisabled()
    await user.type(screen.getByLabelText('Scratchpad'), 'A')
    expect(screen.getByRole('status')).toHaveTextContent(
      '1 line → 1 task in Work › General',
    )
    expect(send).toBeEnabled()
    await user.type(screen.getByLabelText('Scratchpad'), '{Enter}B')
    expect(screen.getByRole('status')).toHaveTextContent(
      '2 lines → 2 tasks in Work › General',
    )
  })

  it('⌘↵ sends, keeps the leftover and shows the result line', async () => {
    const user = userEvent.setup()
    const send = vi.fn().mockResolvedValue({
      leftover: 'p1',
      sent: 1,
      result: 'Sent 1 · 1 not sent, still here',
    })
    render(pad({ send }).el)
    await user.type(screen.getByLabelText('Scratchpad'), 'A{Enter}p1')
    await user.keyboard('{Meta>}{Enter}{/Meta}')
    expect(send).toHaveBeenCalledWith('A\np1')
    expect(await screen.findByText('Sent 1 · 1 not sent, still here')).toBeVisible()
    expect(screen.getByLabelText('Scratchpad')).toHaveValue('p1')
    expect(localStorage.getItem(DRAFT_KEY)).toBe('p1')
  })

  it('plain ↵ is a new line, not a send', async () => {
    const user = userEvent.setup()
    const { props, el } = pad()
    render(el)
    await user.type(screen.getByLabelText('Scratchpad'), 'A{Enter}')
    expect(props.send).not.toHaveBeenCalled()
    expect(screen.getByLabelText('Scratchpad')).toHaveValue('A\n')
  })

  it('Esc calls hide', async () => {
    const user = userEvent.setup()
    const { props, el } = pad()
    render(el)
    await user.click(screen.getByLabelText('Scratchpad'))
    await user.keyboard('{Escape}')
    expect(props.onHide).toHaveBeenCalledTimes(1)
  })

  it('shows a taken hotkey in the footer', () => {
    render(pad({ hotkeyError: '⌥H is taken by another app' }).el)
    expect(screen.getByText('⌥H is taken by another app')).toBeVisible()
  })
})

describe('menubar PopoverTabs', () => {
  beforeEach(() => localStorage.clear())

  const tabs = (force = 0) => (
    <PopoverTabs
      todayCount="1/5"
      forceScratch={force}
      today={<p>today list</p>}
      scratchpad={pad({ focusSeq: force }).el}
    />
  )

  it('opens on Today by default and shows done/total', () => {
    render(tabs())
    const today = screen.getByRole('tab', { name: 'Today 1/5' })
    expect(today).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByText('today list')).toBeVisible()
    expect(screen.getByRole('textbox', { name: 'Scratchpad', hidden: true })).not.toBeVisible()
  })

  it('reopens on the tab last used', async () => {
    const user = userEvent.setup()
    const { unmount } = render(tabs())
    await user.click(screen.getByRole('tab', { name: 'Scratchpad' }))
    expect(localStorage.getItem(TAB_KEY)).toBe('scratchpad')
    unmount()
    render(tabs())
    expect(screen.getByRole('tab', { name: 'Scratchpad' })).toHaveAttribute(
      'aria-selected',
      'true',
    )
  })

  it('moves between tabs with ← and →', async () => {
    const user = userEvent.setup()
    render(tabs())
    screen.getByRole('tab', { name: 'Today 1/5' }).focus()
    await user.keyboard('{ArrowRight}')
    const scratch = screen.getByRole('tab', { name: 'Scratchpad' })
    expect(scratch).toHaveAttribute('aria-selected', 'true')
    expect(scratch).toHaveFocus()
    await user.keyboard('{ArrowLeft}')
    expect(screen.getByRole('tab', { name: 'Today 1/5' })).toHaveFocus()
  })

  it('the hotkey forces Scratchpad and focuses the pad, caret at the end', () => {
    localStorage.setItem(DRAFT_KEY, 'Call the bank')
    const { rerender } = render(tabs())
    expect(screen.getByRole('textbox', { name: 'Scratchpad', hidden: true })).not.toBeVisible()
    rerender(tabs(1))
    const ta = screen.getByRole<HTMLTextAreaElement>('textbox', { name: 'Scratchpad' })
    expect(ta).toBeVisible()
    expect(ta).toHaveFocus()
    expect(ta.selectionStart).toBe('Call the bank'.length)
  })
})
