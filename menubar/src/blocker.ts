/*
 * Site blocking, the web view's half (chunk 99, D19). Pure core with the
 * repo and the shell injected.
 *
 * `sync()` reads the block groups (the repo's online read with its Dexie
 * fallback), keeps the ones that can block anything — `enabled`, at least
 * one domain, at least one trigger on (focus, a schedule or, since chunk
 * 100, a daily allowance) — turns each schedule into epoch-ms windows
 * (`blockSchedule.ts`) and sends the lot to the shell with
 * `blocker_configure`, with each group's id and allowance and the Mac's
 * local midnights (the shell counts an allowance by day and never works out
 * a date). The shell does the rest, with the web view
 * suspended. At most one sync runs at a time; one asked for meanwhile runs
 * once more after it. A failed read sends nothing, so the shell keeps its
 * last configuration.
 */
import type { BlockGroup } from '@/db/types'

import { midnightsFrom, windowsFor } from './blockSchedule'

export type BrowserStatus =
  | 'ok'
  | 'not_installed'
  | 'not_running'
  | 'denied'
  | 'timeout'
  | 'error'
  | 'unknown'

/** Today's count for one group with an allowance, in whole minutes. */
export type BlockerUsage = { id: string; usedMinutes: number; limitMinutes: number }

/** The five-minute warning (chunk 100, D5). */
export type BlockerWarning = { id: string; name: string; minutesLeft: number }

export type BlockerState = {
  enabled: boolean
  active: boolean
  browsers: { name: string; status: BrowserStatus }[]
  /** Groups with a daily allowance (chunk 100). */
  usage: BlockerUsage[]
  warning: BlockerWarning | null
}

/**
 * `blocker_configure`'s arguments: parallel lists, one entry per group, and
 * the local midnights.
 */
export type BlockerConfig = {
  enabled: boolean
  ids: string[]
  names: string[]
  domains: string[][]
  focus: boolean[]
  starts: number[][]
  ends: number[][]
  /** Minutes a day; 0 = no allowance. */
  limits: number[]
  midnights: number[]
}

/** Signed out: nothing blocks. The shell still wants the midnights. */
export function disabledConfig(now: Date = new Date()): BlockerConfig {
  return {
    enabled: false,
    ids: [],
    names: [],
    domains: [],
    focus: [],
    starts: [],
    ends: [],
    limits: [],
    midnights: midnightsFrom(now),
  }
}

/** Groups that can block something now or later. */
export function blocking(groups: BlockGroup[]): BlockGroup[] {
  return groups.filter(
    (g) =>
      g.enabled &&
      g.domains.length > 0 &&
      (g.blockInFocus || g.blockOnSchedule || g.dailyLimitOn),
  )
}

export function buildConfig(
  enabled: boolean,
  groups: BlockGroup[],
  now: Date,
): BlockerConfig {
  const config: BlockerConfig = {
    enabled,
    ids: [],
    names: [],
    domains: [],
    focus: [],
    starts: [],
    ends: [],
    limits: [],
    midnights: midnightsFrom(now),
  }
  for (const g of blocking(groups)) {
    const windows = windowsFor(g, now)
    config.ids.push(g.id)
    config.limits.push(g.dailyLimitOn ? g.dailyLimitMinutes : 0)
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
