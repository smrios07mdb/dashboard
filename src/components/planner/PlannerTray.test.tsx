import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'

import type { Task } from '@/db/types'
import PlannerTray, { type TrayItem } from './PlannerTray'

/*
 * Chunk 38 — tray card proposal label (D12) + the chunk-37 closeout style
 * rule (ghost border via class, `borderLeft` the only inline border key).
 */

const aTask = (overrides: Partial<Task> = {}): Task => ({
  id: 't-1',
  userId: 'u-1',
  subcategoryId: 'sub-1',
  title: 'Write API changelog',
  notes: null,
  estimateMinutes: 30,
  dueAt: '2026-05-05T00:00:00.000Z',
  remindAt: null,
  notified: false,
  priority: 2,
  completedAt: null,
  createdAt: '2026-05-01T00:00:00.000Z',
  updatedAt: '2026-05-01T00:00:00.000Z',
  ...overrides,
})

const anItem = (overrides: Partial<TrayItem> = {}): TrayItem => ({
  task: aTask(),
  catName: 'Work',
  overdue: false,
  dueToday: false,
  dueText: 'Tue 5',
  ...overrides,
})

function renderTray(props: Partial<React.ComponentProps<typeof PlannerTray>> = {}) {
  return render(
    <PlannerTray
      items={[anItem()]}
      sortKey="priority"
      onChangeSortKey={() => {}}
      {...props}
    />,
  )
}

const card = () =>
  screen.getByRole('button', { name: 'Write API changelog — schedule' })

describe('PlannerTray (chunk 38)', () => {
  it('shows the due text and full opacity by default', () => {
    renderTray()
    expect(screen.getByText('Due Tue 5')).toBeInTheDocument()
    expect(card().style.opacity).toBe('1')
  })

  it('proposedByTask → "→ WED 11:45" replaces the due text at 60% opacity', () => {
    renderTray({ proposedByTask: new Map([['t-1', 'WED 11:45']]) })
    expect(screen.getByTestId('tray-proposed')).toHaveTextContent('→ WED 11:45')
    expect(screen.queryByText('Due Tue 5')).not.toBeInTheDocument()
    expect(card().style.opacity).toBe('0.6')
  })

  it('ghost source card: dashed class, 45% (beats proposed), no inline border shorthand', () => {
    renderTray({
      draggingTaskId: 't-1',
      proposedByTask: new Map([['t-1', 'WED 11:45']]),
    })
    const el = card()
    expect(el.className).toContain('border-dashed')
    expect(el.className).not.toContain('shadow-sm')
    expect(el.style.opacity).toBe('0.45')
    expect(el.style.boxShadow).toBe('none')
    expect(el.style.border).toBe('')
  })

  it('overdue card keeps the 3px destructive left edge as the only inline border key', () => {
    renderTray({ items: [anItem({ overdue: true, dueText: 'Apr 30' })] })
    const el = card()
    expect(el.style.borderLeft).toBe('3px solid hsl(var(--destructive))')
    expect(el.className).toContain('border-line')
    expect(screen.getByText('Overdue · Apr 30')).toBeInTheDocument()
  })
})
