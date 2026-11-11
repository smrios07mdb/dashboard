/*
 * Site blocking, the web view's half (chunk 99, D19). Pure core with the
 * repo and the shell injected.
 *
 * `sync()` reads the block groups (the repo's online read with its Dexie
 * fallback), keeps the ones that can block anything — `enabled`, at least
 * one domain, at least one trigger on — turns each schedule into epoch-ms
 * windows (`blockSchedule.ts`) and sends the lot to the shell with
 * `blocker_configure`. The shell does the rest, with the web view
 * suspended. At most one sync runs at a time; one asked for meanwhile runs
 * once more after it. A failed read sends nothing, so the shell keeps its
 * last configuration.
 */
import type { BlockGroup } from '@/db/types'

import { windowsFor } from './blockSchedule'

export type BrowserStatus =
  | 'ok'
  | 'not_installed'
  | 'not_running'
  | 'denied'
  | 'timeout'
  | 'error'
  | 'unknown'

export type BlockerState = {
  enabled: boolean
  active: boolean
  browsers: { name: string; status: BrowserStatus }[]
}

/** `blocker_configure`'s arguments: parallel lists, one entry per group. */
export type BlockerConfig = {
  enabled: boolean
  names: string[]
  domains: string[][]
  focus: boolean[]
  starts: number[][]
  ends: number[][]
}

export const DISABLED_CONFIG: BlockerConfig = {
  enabled: false,
  names: [],
  domains: [],
  focus: [],
  starts: [],
  ends: [],
}

/** Groups that can block something now or later. */
export function blocking(groups: BlockGroup[]): BlockGroup[] {
  return groups.filter(
    (g) => g.enabled && g.domains.length > 0 && (g.blockInFocus || g.blockOnSchedule),
  )
}

export function buildConfig(
  enabled: boolean,
  groups: BlockGroup[],
  now: Date,
): BlockerConfig {
  const config: BlockerConfig = {
    enabled,
    names: [],
    domains: [],
    focus: [],
    starts: [],
    ends: [],
  }
  for (const g of blocking(groups)) {
    const windows = windowsFor(g, now)
    config.names.push(g.name)
    config.domains.push([...g.domains])
    config.focus.push(g.blockInFocus)
    config.starts.push(windows.map((w) => w[0]))
    config.ends.push(windows.map((w) => w[1]))
  }
  return config
}

export type BlockerDeps = {
  listGroups: () => Promise<BlockGroup[]>
  configure: (config: BlockerConfig) => Promise<unknown>
  /** `Block sites on this Mac`. */
  enabled: () => boolean
  now?: () => Date
}

export type BlockerSync = {
  sync: () => Promise<void>
  /** Signed out: a sync still in flight sends nothing more. */
  stop: () => void
}

export function createBlockerSync(deps: BlockerDeps): BlockerSync {
  let running: Promise<void> | null = null
  let again = false
  let stopped = false

  async function once(): Promise<void> {
    let groups: BlockGroup[]
    try {
      groups = await deps.listGroups()
    } catch (e) {
      console.error('menubar: block groups read failed', e)
      return
    }
    if (stopped) return
    const now = deps.now?.() ?? new Date()
    try {
      await deps.configure(buildConfig(deps.enabled(), groups, now))
    } catch (e) {
      console.error('menubar: blocker_configure failed', e)
    }
  }

  function sync(): Promise<void> {
    if (stopped) return Promise.resolve()
    if (running) {
      again = true
      return running
    }
    running = (async () => {
      try {
        do {
          again = false
          await once()
        } while (again)
      } finally {
        running = null
      }
    })()
    return running
  }

  return {
    sync,
    stop() {
      stopped = true
    },
  }
}
