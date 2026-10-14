import { render, screen, cleanup, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it } from 'vitest'

import type { Category, Subcategory, Task } from '@/db/types'

import DailyHero from './DailyHero'

/*
 * Regression guard for the crossed-bars bug: the hero hardcoded Work-first while
 * the dashboard columns are data-driven from `repo.categories.list()` (which
 * returns [Personal, Work]), so each bar sat over the opposite column. The fix
 * drives the bar order from the same `categories` prop the columns iterate. The
 * two-case flip below proves the order is data-driven, not a swapped hardcode.
 *
 * DailyHero is prop-driven and reads only the zustand uiStore — no repo mock,
 * and calcStats / catProgress run for real.
 */

const cat = (id: string, name: 'Work' | 'Personal'): Category => ({
  id,
  userId: 'u1',
  name,
})
const sub = (id: string, categoryId: string): Subcategory => ({
  id,
  userId: 'u1',
  categoryId,
  name: `${categoryId}-sub`,
  sortOrder: 0,
  archivedAt: null,
})
const doneTask = (id: string, subcategoryId: string): Task => ({
  id,
  userId: 'u1',
  subcategoryId,
  title: 't',
  estimateMinutes: 30,
  dueAt: null,
  remindAt: null,
  notified: false,
  priority: null,
  completedAt: '2026-01-01T12:00:00.000Z',
  createdAt: '2020-01-01T00:00:00.000Z',
  updatedAt: '2020-01-01T00:00:00.000Z',
})

const WORK = cat('c-work', 'Work')
const PERSONAL = cat('c-personal', 'Personal')
const SUBS = [sub('s-w', 'c-work'), sub('s-p', 'c-personal')]
const TASKS = [doneTask('t-w', 's-w'), doneTask('t-p', 's-p')]

const openTask = (id: string, subcategoryId: string): Task => ({
  ...doneTask(id, subcategoryId),
  completedAt: null,
})

function renderHero(
  categories: Category[],
  opts: {
    today?: { done: number; total: number }
    streak?: number
    tasks?: Task[]
  } = {},
) {
  // WhatsNextSheet (inside the hero's action) calls useNavigate, so a router
  // context is required — mirror Dashboard.test.tsx's MemoryRouter wrapper.
  return render(
    <MemoryRouter>
      <DailyHero
        user={null}
        tasks={opts.tasks ?? TASKS}
        subcategories={SUBS}
        categories={categories}
        streak={opts.streak ?? 0}
        // Chunk 74: a planned day by default — with nothing planned the hero
        // is one line and has no bars for the cases below to read.
        today={opts.today ?? { done: 0, total: 1 }}
      />
    </MemoryRouter>,
  )
}

describe('DailyHero category bars', () => {
  afterEach(cleanup)

  it('orders the bars to match the categories prop ([Personal, Work])', () => {
    renderHero([PERSONAL, WORK])
    const personal = screen.getByText('Personal')
    const work = screen.getByText('Work')
    // Personal should appear before Work in the DOM.
    expect(
      personal.compareDocumentPosition(work) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
  })

  it('follows the prop when flipped ([Work, Personal])', () => {
    renderHero([WORK, PERSONAL])
    const work = screen.getByText('Work')
    const personal = screen.getByText('Personal')
    // Work should now appear before Personal — order is data-driven, not hardcoded.
    expect(
      work.compareDocumentPosition(personal) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
  })
})

// Chunk 70: the ring is the Today plan, and chips that read zero are hidden.
describe('DailyHero today ring and chips (chunk 70)', () => {
  afterEach(cleanup)

  it('shows the plan as done ÷ planned, not all-time completion', () => {
    renderHero([WORK, PERSONAL], { today: { done: 1, total: 3 } })
    const ring = screen.getByRole('img', {
      name: 'Today: 1 of 3 planned tasks done',
    })
    expect(within(ring).getByText('33')).toBeInTheDocument()
    expect(within(ring).getByText('%')).toBeInTheDocument()
    expect(screen.getByText('· 1/3 today')).toBeInTheDocument()
    // TASKS is 2 of 2 done all-time — that figure is gone.
    expect(screen.queryByText(/\/\d+ done$/)).not.toBeInTheDocument()
  })

  // Chunk 74: with nothing planned the hero is one line.
  it('collapses to one line when nothing is planned', () => {
    renderHero([WORK, PERSONAL], { today: { done: 0, total: 0 } })
    expect(screen.queryByRole('img', { name: /^Today: / })).not.toBeInTheDocument()
    expect(
      screen.queryByText('Nothing planned yet — pick a few for today.'),
    ).not.toBeInTheDocument()
    expect(screen.queryByText(/\d+\/\d+ today/)).not.toBeInTheDocument()
    // No category bars.
    expect(screen.queryByText('Work')).not.toBeInTheDocument()
    expect(screen.queryByText('Personal')).not.toBeInTheDocument()

    const h1 = screen.getByRole('heading', { level: 1 })
    expect(h1).toHaveStyle({ fontSize: '20px' })
    const pill = screen.getByRole('button', { name: /what.s next/i })
    // One row: the greeting and the pill share the card's single flex line.
    expect(h1.parentElement).toHaveStyle({ display: 'flex', flexWrap: 'wrap' })
    expect(h1.parentElement).toContainElement(pill)
    expect(screen.getByLabelText('Available minutes')).toBeInTheDocument()
  })

  it('keeps the streak and level chips when nothing is planned', () => {
    renderHero([WORK, PERSONAL], { today: { done: 0, total: 0 }, streak: 2 })
    const chip = screen.getByTitle('Task streak')
    expect(chip).toHaveTextContent('2')
    // TASKS has completions, so there is XP and the level chip shows too.
    expect(screen.getByText('LVL')).toBeInTheDocument()
    expect(chip.parentElement).toBe(
      screen.getByRole('heading', { level: 1 }).parentElement,
    )
  })

  it('keeps the full hero once anything is planned', () => {
    renderHero([WORK, PERSONAL], { today: { done: 0, total: 1 } })
    expect(
      screen.getByRole('img', { name: 'Today: 0 of 1 planned tasks done' }),
    ).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 1 })).toHaveStyle({
      fontSize: '28px',
    })
    expect(screen.getByText('Work')).toBeInTheDocument()
  })

  it('says the plan is cleared when every planned task is done', () => {
    renderHero([WORK, PERSONAL], { today: { done: 3, total: 3 } })
    expect(
      screen.getByText("Today's plan is cleared. Beautifully done."),
    ).toBeInTheDocument()
  })

  it('hides the streak chip at zero and shows it otherwise', () => {
    renderHero([WORK, PERSONAL], { streak: 0 })
    expect(screen.queryByTitle('Task streak')).not.toBeInTheDocument()
    cleanup()
    renderHero([WORK, PERSONAL], { streak: 2 })
    expect(screen.getByTitle('Task streak')).toHaveTextContent('2')
    expect(screen.getByTitle('Task streak')).toHaveAttribute(
      'aria-label',
      '2-day task streak',
    )
  })

  it('hides the level chip until there is XP', () => {
    renderHero([WORK, PERSONAL], { tasks: [openTask('t-o', 's-w')] })
    expect(screen.queryByText('LVL')).not.toBeInTheDocument()
    cleanup()
    renderHero([WORK, PERSONAL], { tasks: [doneTask('t-d', 's-w')] })
    expect(screen.getByText('LVL')).toBeInTheDocument()
  })
})
