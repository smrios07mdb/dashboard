import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from '@testing-library/react'

vi.mock('./AccountMenu', () => ({ default: () => null }))

import { useShellMarginsStore } from '@/state/shellMargins'

import AppShell from './AppShell'

/*
 * Chunk 69 (UX audit #1): a saved margin reaches the shell as `--shell-*-saved`
 * and `.shell` in index.css decides what to do with it (cap the side, ignore
 * it on phones). Setting `--shell-side` inline would bypass both.
 */
describe('AppShell page margins', () => {
  beforeEach(() => {
    useShellMarginsStore.setState({ margins: null, draft: null })
  })

  const shell = (c: HTMLElement) => c.querySelector<HTMLElement>('.shell')!

  it('sets no inline variables without a saved preference', () => {
    const { container } = render(<AppShell>content</AppShell>)
    expect(shell(container).getAttribute('style')).toBeNull()
  })

  it('passes saved margins as -saved variables, never as the resolved ones', () => {
    useShellMarginsStore.setState({
      margins: { side: 250, top: 12, bottom: 8 },
    })
    const { container } = render(<AppShell>content</AppShell>)
    const style = shell(container).style
    expect(style.getPropertyValue('--shell-side-saved')).toBe('250px')
    expect(style.getPropertyValue('--shell-top-saved')).toBe('12px')
    expect(style.getPropertyValue('--shell-bottom-saved')).toBe('8px')
    expect(style.getPropertyValue('--shell-side')).toBe('')
    expect(style.getPropertyValue('--shell-top')).toBe('')
    expect(style.getPropertyValue('--shell-bottom')).toBe('')
  })

  it('the in-edit draft wins over the saved set', () => {
    useShellMarginsStore.setState({
      margins: { side: 250, top: 12, bottom: 8 },
      draft: { side: 60, top: 12, bottom: 8 },
    })
    const { container } = render(<AppShell>content</AppShell>)
    expect(shell(container).style.getPropertyValue('--shell-side-saved')).toBe(
      '60px',
    )
  })
})
