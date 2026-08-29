import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'

import type { Task } from '@/db/types'
import type { WeekBusyBlock } from '@/lib/plannerGeometry'
import ScheduleSheet, { type ScheduleSheetProps } from './ScheduleSheet'

/*
 * Schedule sheet (chunk 37) — slot list from busy + scheduled, selection →
 * `onAdd(day, startMin)`, the custom-time path, and the zero-slot copy.
 */

const week = [4, 5, 6, 7, 8, 9, 10].map((n) => new Date(2026, 4, n))

const task: Task = {
  id: 't-1',
  userId: 'u-1',
  subcategoryId: 'sub-1',
  title: 'Renew car insurance',
  notes: null,
  estimateMinutes: 45,
  dueAt: null,
  remindAt: null,
  notified: false,
  priority: 1,
  completedAt: null,
  createdAt: '2026-05-01T00:00:00.000Z',
  updatedAt: '2026-05-01T00:00:00.000Z',
}

const busy: WeekBusyBlock[] = [
  { day: 2, startMin: 540, endMin: 570, source: 'outlook', title: 'Standup' },
]

function renderSheet(overrides: Partial<ScheduleSheetProps> = {}) {
  const onAdd = vi.fn()
  const onClose = vi.fn()
  render(
    <ScheduleSheet
      open
      task={task}
      catName="Personal"
      overdue={false}
      days={week}
      todayIdx={2}
      initialDay={2}
      nowMin={680}
      busy={busy}
      scheduled={[{ id: 'b', taskId: 'x', day: 2, startMin: 780, endMin: 840, done: false }]}
      showDaySelector={false}
      onClose={onClose}
      onAdd={onAdd}
      {...overrides}
    />,
  )
  return { onAdd, onClose }
}

describe('ScheduleSheet (chunk 37)', () => {
  it('renders three open slots around busy + scheduled for today from now+10', () => {
    renderSheet()
    expect(screen.getByText('Schedule')).toBeInTheDocument()
    expect(screen.getByText('Renew car insurance')).toBeInTheDocument()
    expect(screen.getByText('45m estimate')).toBeInTheDocument()
    expect(screen.getByText(/Open slots — WED 6/)).toBeInTheDocument()
    // now 11:20 → 11:30; scheduled 13:00–14:00 → slot until 13:00.
    expect(screen.getByText('11:30–12:15')).toBeInTheDocument()
    expect(screen.getByText('free until 13:00')).toBeInTheDocument()
    expect(screen.getByText('14:00–14:45')).toBeInTheDocument()
    expect(screen.getAllByText(/free until/)).toHaveLength(3)
    expect(screen.getByText('Selected')).toBeInTheDocument()
  })

  it('selecting the second slot and pressing Add calls onAdd with its start', () => {
    const { onAdd } = renderSheet()
    fireEvent.click(screen.getByText('14:00–14:45'))
    fireEvent.click(screen.getByRole('button', { name: 'Add to Wednesday' }))
    expect(onAdd).toHaveBeenCalledWith(2, 840)
  })

  it('custom time path: typing a time deselects slots and adds at that time', () => {
    const { onAdd } = renderSheet()
    const input = screen.getByLabelText('Custom start time') as HTMLInputElement
    fireEvent.change(input, { target: { value: '16:15' } })
    expect(screen.queryByText('Selected')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Add to Wednesday' }))
    expect(onAdd).toHaveBeenCalledWith(2, 16 * 60 + 15)
  })

  it('zero slots: shows the fallback copy for today and for another day', () => {
    // Fully booked 08:00–20:00.
    const full: WeekBusyBlock[] = [
      { day: 2, startMin: 480, endMin: 1200, source: 'icloud' },
      { day: 3, startMin: 480, endMin: 1200, source: 'icloud' },
    ]
    renderSheet({ busy: full, scheduled: [] })
    expect(
      screen.getByText(/No open slot fits 45m today\. Pick a time below\./),
    ).toBeInTheDocument()
  })

  it('zero slots on another day says "that day"', () => {
    renderSheet({
      busy: [{ day: 3, startMin: 480, endMin: 1200, source: 'icloud' }],
      scheduled: [],
      initialDay: 3,
    })
    expect(screen.getByText(/No open slot fits 45m that day/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add to Thursday' })).toBeInTheDocument()
  })

  it('desktop day selector switches the day and its slots', () => {
    const { onAdd } = renderSheet({ showDaySelector: true })
    fireEvent.click(screen.getByRole('button', { name: 'THU 7' }))
    expect(screen.getByText(/Open slots — THU 7/)).toBeInTheDocument()
    // Not today → slots start at 08:00.
    expect(screen.getByText('08:00–08:45')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Add to Thursday' }))
    expect(onAdd).toHaveBeenCalledWith(3, 480)
  })
})
