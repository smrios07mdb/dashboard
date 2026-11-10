import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import type { Task } from '@/db/types'

import type { PomodoroPhase } from './pomodoro'
import TodayList from './TodayList'
import type { TodayView, TodayViewRow } from './todayView'

function row(id: string, title: string, done = false): TodayViewRow {
  return {
    id,
    task: { id, title } as Task,
    title,
    catName: 'Work',
    priority: null,
    when: null,
    minutes: 25,
    done,
  }
}

const VIEW: TodayView = {
  rows: [row('a', 'Draft Q&A'), row('b', 'Reply to counsel'), row('c', 'Sent list', true)],
  done: 1,
  total: 3,
  open: 2,
  trayTitle: '2',
}

function list(
  phase: PomodoroPhase,
  focusTaskId: string | null = null,
  paused = false,
) {
  const onFocus = vi.fn()
  const onToggle = vi.fn()
  render(
    <TodayList
      view={VIEW}
      offline={false}
      failed={false}
      saveFailed={false}
      onToggle={onToggle}
      focus={{ phase, paused, taskId: focusTaskId }}
      onFocus={onFocus}
    />,
  )
  return { onFocus, onToggle }
}

const playButtons = () =>
  screen.queryAllByRole('button', { name: /^Focus on / }).map((b) => b.getAttribute('aria-label'))

describe('menubar TodayList — focus (chunk 94)', () => {
  it('idle: every not-done row has a play button', async () => {
    const user = userEvent.setup()
    const { onFocus } = list('idle')
    expect(playButtons()).toEqual(['Focus on Draft Q&A', 'Focus on Reply to counsel'])
    await user.click(screen.getByRole('button', { name: 'Focus on Reply to counsel' }))
    expect(onFocus).toHaveBeenCalledTimes(1)
    expect(onFocus.mock.calls[0][0].id).toBe('b')
    expect(screen.queryByRole('img', { name: 'Focusing' })).toBeNull()
  })

  it('in a break: play buttons are shown, no bars', () => {
    list('short_break', 'a')
    expect(playButtons()).toHaveLength(2)
    expect(screen.queryByRole('img', { name: 'Focusing' })).toBeNull()
    document.body.innerHTML = ''
    list('long_break')
    expect(playButtons()).toHaveLength(2)
  })

  it('focus running: no play buttons; the focused row shows the bars', () => {
    list('focus', 'a')
    expect(playButtons()).toEqual([])
    const bars = screen.getByRole('img', { name: 'Focusing' })
    const li = bars.closest('li')!
    expect(within(li).getByText('Draft Q&A')).toBeInTheDocument()
    expect(li).toHaveClass('mb-cur')
    expect(bars).toHaveClass('mb-eq')
    expect(bars).not.toHaveClass('mb-eq-still')
    expect(bars.querySelectorAll('i')).toHaveLength(3)
  })

  it('focus paused: still no play buttons; the bars stand still', () => {
    list('focus', 'a', true)
    expect(playButtons()).toEqual([])
    expect(screen.getByRole('img', { name: 'Focusing' })).toHaveClass('mb-eq-still')
  })

  it('a bare focus: no play buttons and no bars', () => {
    list('focus', null)
    expect(playButtons()).toEqual([])
    expect(screen.queryByRole('img', { name: 'Focusing' })).toBeNull()
  })

  it('checking off the focused task keeps the bars on its row', async () => {
    const user = userEvent.setup()
    const onToggle = vi.fn()
    const view = { ...VIEW, rows: [row('a', 'Draft Q&A', true)] }
    render(
      <TodayList
        view={view}
        offline={false}
        failed={false}
        saveFailed={false}
        onToggle={onToggle}
        focus={{ phase: 'focus', paused: false, taskId: 'a' }}
        onFocus={vi.fn()}
      />,
    )
    expect(screen.getByRole('img', { name: 'Focusing' })).toBeInTheDocument()
    await user.click(screen.getByRole('checkbox'))
    expect(onToggle).toHaveBeenCalledTimes(1)
  })
})
