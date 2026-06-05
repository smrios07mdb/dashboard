import { render, screen, cleanup } from '@testing-library/react'
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
  notes: null,
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

function renderHero(categories: Category[]) {
  // WhatsNextSheet (inside the hero's action) calls useNavigate, so a router
  // context is required — mirror Dashboard.test.tsx's MemoryRouter wrapper.
  return render(
    <MemoryRouter>
      <DailyHero
        user={null}
        tasks={TASKS}
        subcategories={SUBS}
        categories={categories}
        streak={0}
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
