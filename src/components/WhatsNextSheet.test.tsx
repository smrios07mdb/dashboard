import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import type { Category, Subcategory, Task } from '@/db/types'

const { listIncompleteMock, subsListMock, catsListMock, triageMock, navigateMock } =
  vi.hoisted(() => ({
    listIncompleteMock: vi.fn(),
    subsListMock: vi.fn(),
    catsListMock: vi.fn(),
    triageMock: vi.fn(),
    navigateMock: vi.fn(),
  }))

vi.mock('@/db/repo', () => ({
  repo: {
    tasks: { listIncomplete: listIncompleteMock },
    subcategories: { list: subsListMock },
    categories: { list: catsListMock },
  },
}))

// Keep the real pure helpers (buildTriageTasks, AiError); only stub the
// network-touching triage().
vi.mock('@/lib/ai', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/ai')>()
  return { ...actual, triage: triageMock }
})

// Hermetic: ai.ts imports the supabase client at module top (env-gated).
// triage() is mocked, so the real client is never exercised here.
vi.mock('@/lib/supabase', () => ({
  supabase: { auth: { getSession: vi.fn() } },
}))

vi.mock('react-router-dom', () => ({ useNavigate: () => navigateMock }))

import { AiError } from '@/lib/ai'

import WhatsNextSheet from './WhatsNextSheet'

function task(over: Partial<Task> = {}): Task {
  return {
    id: 't1',
    userId: 'u1',
    subcategoryId: 'sub-1',
    title: 'Write report',
    notes: null,
    estimateMinutes: 25,
    dueAt: null,
    remindAt: null,
    notified: false,
    priority: null,
    completedAt: null,
    createdAt: '2026-05-28T00:00:00.000Z',
    updatedAt: '2026-05-28T00:00:00.000Z',
    ...over,
  }
}
const sub: Subcategory = {
  id: 'sub-1',
  userId: 'u1',
  categoryId: 'cat-1',
  name: 'Reports',
  sortOrder: 0,
  archivedAt: null,
}
const cat: Category = { id: 'cat-1', userId: 'u1', name: 'Work' }

async function openAndRun() {
  const user = userEvent.setup()
  render(<WhatsNextSheet />)
  await user.click(screen.getByRole('button', { name: /what.s next/i }))
  await user.click(
    await screen.findByRole('button', { name: /get recommendations/i }),
  )
  return user
}

describe('WhatsNextSheet', () => {
  beforeEach(() => {
    listIncompleteMock.mockResolvedValue([task()])
    subsListMock.mockResolvedValue([sub])
    catsListMock.mockResolvedValue([cat])
  })
  afterEach(() => vi.clearAllMocks())

  it('renders recommendation cards with title, context, reason and a Start button', async () => {
    triageMock.mockResolvedValue({
      recommendations: [{ taskId: 't1', reason: 'Fits your 30 minutes' }],
      note: 'Good window',
    })
    await openAndRun()

    expect(await screen.findByText('Write report')).toBeInTheDocument()
    expect(screen.getByText(/Reports/)).toBeInTheDocument()
    expect(screen.getByText(/Fits your 30 minutes/)).toBeInTheDocument()
    expect(screen.getByText(/Good window/)).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /start/i }),
    ).toBeInTheDocument()
  })

  it('navigates to the subcategory with the task highlight when Start is clicked', async () => {
    triageMock.mockResolvedValue({
      recommendations: [{ taskId: 't1', reason: 'Do it' }],
    })
    const user = await openAndRun()
    await user.click(await screen.findByRole('button', { name: /start/i }))
    expect(navigateMock).toHaveBeenCalledWith('/subcategory/sub-1?task=t1')
  })

  it('shows a Settings CTA on a missing-key error', async () => {
    triageMock.mockRejectedValue(new AiError('missing-key'))
    await openAndRun()
    expect(
      await screen.findByRole('button', { name: /api key in settings/i }),
    ).toBeInTheDocument()
  })

  it('shows the raw response expander on a malformed error', async () => {
    triageMock.mockRejectedValue(
      new AiError('malformed', undefined, 'I will not comply.'),
    )
    await openAndRun()
    expect(await screen.findByText(/show raw response/i)).toBeInTheDocument()
    expect(screen.getByText(/I will not comply\./)).toBeInTheDocument()
  })

  it('shows a retry affordance on a network error', async () => {
    triageMock.mockRejectedValue(new AiError('network'))
    await openAndRun()
    expect(
      await screen.findByText(/couldn.t reach the ai/i),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument()
  })
})
