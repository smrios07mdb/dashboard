import { describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'

import type { WeekBusyBlock } from '@/lib/plannerGeometry'
import BusyBlock from './BusyBlock'

/*
 * Chunk 75a — busy-block text is `--busy-ink` (>= 4.5:1 on any 16% calendar
 * wash; see lib/contrast.test.ts). The stale Outlook 55% fade is the one
 * accepted contrast exception and stays.
 */

// 09:00–10:00 at 52px/hour = 50px tall: title and source tag both render.
const aBlock = (overrides: Partial<WeekBusyBlock> = {}): WeekBusyBlock => ({
  day: 0,
  startMin: 540,
  endMin: 600,
  source: 'icloud',
  title: 'Standup',
  color: '#1badf8',
  ...overrides,
})

function renderBlock(
  block: WeekBusyBlock,
  props: Partial<React.ComponentProps<typeof BusyBlock>> = {},
) {
  render(
    <BusyBlock
      block={block}
      hourH={52}
      windowStartMin={420}
      windowEndMin={1260}
      stale={false}
      staleTime={null}
      onOpen={() => {}}
      {...props}
    />,
  )
  return screen.getByRole('button')
}

describe('BusyBlock (chunk 75a)', () => {
  it.each([
    ['icloud', aBlock(), {}, 'ICLOUD'],
    [
      'stale outlook',
      aBlock({ source: 'outlook' }),
      { stale: true, staleTime: '09:15' },
      'OUTLOOK · 09:15',
    ],
  ] as const)(
    '%s: the title and the source tag use --busy-ink, the tag at full opacity',
    (_name, block, props, tagText) => {
      renderBlock(block, props)
      const title = screen.getByText('Standup')
      const tag = screen.getByText(tagText)
      expect(title.style.color).toBe('var(--busy-ink)')
      expect(tag.style.color).toBe('var(--busy-ink)')
      expect(tag.style.opacity).toBe('')
    },
  )

  it('only the stale Outlook block is faded to 55%', () => {
    const fresh = renderBlock(aBlock())
    expect(fresh.style.opacity).toBe('1')
    cleanup()
    const stale = renderBlock(aBlock({ source: 'outlook' }), {
      stale: true,
      staleTime: '09:15',
    })
    expect(stale.style.opacity).toBe('0.55')
  })
})
