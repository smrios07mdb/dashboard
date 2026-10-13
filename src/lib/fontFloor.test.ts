import { describe, expect, it } from 'vitest'

/*
 * 11px text floor (chunk 75, UX audit #14; ARCH §13).
 *
 * No text in src/ is set under 11px, as a Tailwind `text-[Npx]` (with or
 * without a variant prefix) or an inline numeric `fontSize: N`. The planner
 * time grid is exempt: its blocks and axis are sized in fixed pixels.
 *
 * Source scan, not a render, for the reason iosFocusZoom.test.ts gives: the
 * size lives in Tailwind classes, which jsdom cannot compute.
 */

const SOURCES = import.meta.glob<string>(['/src/**/*.tsx', '!/src/**/*.test.tsx'], {
  query: '?raw',
  import: 'default',
  eager: true,
})

const EXEMPT = [
  '/src/components/planner/TaskBlock.tsx',
  '/src/components/planner/BusyBlock.tsx',
  '/src/components/planner/ProposalBlock.tsx',
  '/src/components/planner/DropSlot.tsx',
  '/src/components/planner/WeekGrid.tsx',
  '/src/components/planner/DayTimeline.tsx',
  '/src/components/planner/DayStrip.tsx',
]

const FLOOR = 11
const SIZE = /text-\[(\d+(?:\.\d+)?)px\]|\bfontSize:\s*(\d+(?:\.\d+)?)/g

function offenders(): string[] {
  const out: string[] = []
  for (const [file, s] of Object.entries(SOURCES)) {
    if (EXEMPT.includes(file)) continue
    for (const m of s.matchAll(SIZE)) {
      if (Number(m[1] ?? m[2]) >= FLOOR) continue
      const line = s.slice(0, m.index ?? 0).split('\n').length
      out.push(`${file}:${line} ${m[0]}`)
    }
  }
  return out.sort()
}

describe('11px text floor', () => {
  it('no text outside the planner time grid is under 11px', () => {
    expect(offenders()).toEqual([])
  })

  it('every exempt file exists, so a rename cannot widen the exemption', () => {
    expect(EXEMPT.filter((file) => !(file in SOURCES))).toEqual([])
  })

  it('the scan finds sized text (sanity)', () => {
    const sized = Object.values(SOURCES).filter((s) => s.search(SIZE) >= 0)
    expect(sized.length).toBeGreaterThan(30)
  })
})
