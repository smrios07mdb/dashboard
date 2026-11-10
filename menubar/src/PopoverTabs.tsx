/*
 * The popover's two tabs (chunk 93, D1): Today and Scratchpad. Both panels
 * stay mounted (the inactive one is `hidden`), so a send in flight or a
 * draft survives a switch. The tab last used is remembered
 * (`hup:mb:tab`); the hotkey forces Scratchpad by bumping `forceScratch`.
 */
import { type KeyboardEvent, type ReactNode, useState } from 'react'

import { readTab, saveTab, type PopoverTab } from './prefs'

const TABS: PopoverTab[] = ['today', 'scratchpad']

export default function PopoverTabs({
  todayCount,
  today,
  scratchpad,
  forceScratch,
}: {
  /** `done/total` beside the Today label; null hides it. */
  todayCount: string | null
  today: ReactNode
  scratchpad: ReactNode
  /** Bumped by the hotkey: show Scratchpad. */
  forceScratch: number
}) {
  const [tab, setTab] = useState<PopoverTab>(readTab)
  const [seenForce, setSeenForce] = useState(forceScratch)
  if (forceScratch !== seenForce) {
    setSeenForce(forceScratch)
    setTab('scratchpad')
  }
  function select(next: PopoverTab) {
    setTab(next)
    saveTab(next)
  }

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
    e.preventDefault()
    const step = e.key === 'ArrowRight' ? 1 : -1
    const next = TABS[(TABS.indexOf(tab) + step + TABS.length) % TABS.length]
    select(next)
    e.currentTarget
      .querySelector<HTMLButtonElement>(`#mb-tab-${next}`)
      ?.focus()
  }

  const tabProps = (id: PopoverTab) => ({
    type: 'button' as const,
    role: 'tab',
    id: `mb-tab-${id}`,
    'aria-selected': tab === id,
    'aria-controls': `mb-panel-${id}`,
    tabIndex: tab === id ? 0 : -1,
    className: tab === id ? 'mb-tab mb-tab-on' : 'mb-tab',
    onClick: () => select(id),
  })

  return (
    <>
      <div
        className="mb-tabs"
        role="tablist"
        aria-label="Popover"
        onKeyDown={onKeyDown}
      >
        <button {...tabProps('today')}>
          {'Today '}
          {todayCount ? <small>{todayCount}</small> : null}
        </button>
        <button {...tabProps('scratchpad')}>Scratchpad</button>
      </div>
      <div
        role="tabpanel"
        id="mb-panel-today"
        aria-labelledby="mb-tab-today"
        className="mb-panel"
        hidden={tab !== 'today'}
      >
        {today}
      </div>
      <div
        role="tabpanel"
        id="mb-panel-scratchpad"
        aria-labelledby="mb-tab-scratchpad"
        className="mb-panel"
        hidden={tab !== 'scratchpad'}
      >
        {scratchpad}
      </div>
    </>
  )
}
