import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import RoutinePanel, { type RoutinePanelProps } from './RoutinePanel'
import type { RoutineItem, RoutineLog } from '@/db/types'

/*
 * Behavioral guard for the RoutinePanel tree (check-off + edit mode).
 *
 * There was no component-level test for this tree before Chunk 28 — the same
 * gap that let the Chunk 27 completion FX ship dead. These tests pin the wiring
 * (the callbacks the modes invoke) so the Daylight re-skin can repaint freely
 * without silently severing a handler. They assert callbacks/roles, NOT colors:
 * the accent/banner/grid visuals are the on-device pass, not unit tests.
 *
 * jsdom has no `matchMedia`, so `useIsTouchDevice` resolves to false and the
 * desktop affordances (grip handle, direct X) render — that's the path here.
 */

function mkItem(
  id: string,
  routine: 'morning' | 'night',
  label: string,
  sortOrder: number,
): RoutineItem {
  return {
    id,
    userId: 'u1',
    routine,
    label,
    sortOrder,
    archivedAt: null,
    // Created long ago so calcStreak treats it as "required"; irrelevant to
    // these wiring assertions but keeps fixtures realistic.
    createdAt: '2020-01-01T00:00:00.000Z',
  }
}

const TODAY = '2026-06-05'

function renderPanel(overrides: Partial<RoutinePanelProps> = {}) {
  const onToggle = vi.fn()
  const onCreate = vi.fn().mockResolvedValue(true)
  const onRename = vi.fn()
  const onArchive = vi.fn()
  const onReorder = vi.fn()
  const onMove = vi.fn()

  const items: RoutineItem[] = overrides.items ?? [
    mkItem('m1', 'morning', 'Make the bed', 0),
    mkItem('m2', 'morning', 'Drink a glass of water', 1),
    // A night item proves the panel filters by `routine` — it must not appear.
    mkItem('n1', 'night', 'Tidy the kitchen', 0),
  ]
  const logs: RoutineLog[] = overrides.logs ?? []

  const props: RoutinePanelProps = {
    routine: 'morning',
    items,
    logs,
    todayKey: TODAY,
    timezone: 'America/New_York',
    onToggle,
    onCreate,
    onRename,
    onArchive,
    onReorder,
    onMove,
    ...overrides,
  }

  render(<RoutinePanel {...props} />)
  return { onToggle, onCreate, onRename, onArchive, onReorder, onMove }
}

describe('RoutinePanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('only renders items for its own routine', () => {
    renderPanel()
    expect(
      screen.getByRole('checkbox', { name: /make the bed/i }),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('checkbox', { name: /tidy the kitchen/i }),
    ).not.toBeInTheDocument()
  })

  it('(a) toggling a check-off row calls onToggle(id, true)', async () => {
    const user = userEvent.setup()
    const { onToggle } = renderPanel()

    await user.click(screen.getByRole('checkbox', { name: /check make the bed/i }))

    expect(onToggle).toHaveBeenCalledWith('m1', true)
  })

  it('(b) "Edit list" reveals the edit rows (grip / rename / remove) and the add form', async () => {
    const user = userEvent.setup()
    renderPanel()

    // Check-off mode first: no edit affordances.
    expect(
      screen.queryByRole('textbox', { name: /new morning item/i }),
    ).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /edit list/i }))

    // Edit mode: check-off checkboxes gone, edit affordances present.
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /drag to reorder make the bed/i }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Make the bed' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /remove make the bed/i }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('textbox', { name: /new morning item/i }),
    ).toBeInTheDocument()
  })

  it('(c) the add form calls onCreate with the trimmed label', async () => {
    const user = userEvent.setup()
    const { onCreate } = renderPanel()

    await user.click(screen.getByRole('button', { name: /edit list/i }))
    const input = screen.getByRole('textbox', { name: /new morning item/i })
    await user.type(input, '  Floss  {Enter}')

    expect(onCreate).toHaveBeenCalledWith('Floss')
  })

  it('(d) committing an inline rename calls onRename(id, newLabel)', async () => {
    const user = userEvent.setup()
    const { onRename } = renderPanel()

    await user.click(screen.getByRole('button', { name: /edit list/i }))
    await user.click(screen.getByRole('button', { name: 'Make the bed' }))

    const input = screen.getByRole('textbox', { name: /routine item label/i })
    await user.clear(input)
    await user.type(input, 'Make the bed tidy{Enter}')

    expect(onRename).toHaveBeenCalledWith('m1', 'Make the bed tidy')
  })

  it('(e) confirming the remove dialog calls onArchive(id)', async () => {
    const user = userEvent.setup()
    const { onArchive } = renderPanel()

    await user.click(screen.getByRole('button', { name: /edit list/i }))
    await user.click(screen.getByRole('button', { name: /remove make the bed/i }))

    const dialog = await screen.findByRole('alertdialog')
    await user.click(within(dialog).getByRole('button', { name: 'Remove' }))

    expect(onArchive).toHaveBeenCalledWith('m1')
  })
})
