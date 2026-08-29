import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from 'react'

import type { Task } from '@/db/types'
import { PLANNER } from '@/lib/plannerGeometry'
import {
  gridPointToSlot,
  MIN_BLOCK_MIN,
  type WeekScheduledBlock,
} from '@/lib/plannerSchedule'

/*
 * Desktop drag state for the week grid (chunk 37, D7) — native pointer
 * events, not `@dnd-kit`: the grid is a continuous time axis with
 * pixel→minute hit-testing (`gridPointToSlot`, the prototype's
 * `posFromEvent`) and a resize strip, neither of which fits a droppable
 * model.
 *
 * Three kinds: `tray` (card → grid), `move` (block body), `resize` (7px
 * bottom strip). `pointerdown` captures the pointer and records a pending
 * gesture; the drag activates only after ≥5px of travel — before that a
 * `pointerup` is a plain click (the tray card's click opens the Schedule
 * sheet). While live: window-level `pointermove`/`pointerup`, `Escape`
 * cancels, and `document.body` gets `user-select: none` + a grabbing /
 * ns-resize cursor. A click that follows an activated drag is swallowed
 * once at the capture phase so the sheet doesn't open on drop.
 *
 * The hook does no I/O — `onDrop` receives the snapped result and the
 * screen writes through the repo.
 */

export type DragOver = { day: number; startMin: number; endMin: number }

export type DragState =
  | {
      kind: 'tray'
      task: Task
      catName: string
      durationMin: number
      /** Pointer position for the floating card. */
      px: number
      py: number
      over: DragOver | null
    }
  | { kind: 'move'; block: WeekScheduledBlock; catName: string; over: DragOver }
  | { kind: 'resize'; block: WeekScheduledBlock; over: DragOver }

export type DropResult =
  | { kind: 'tray'; task: Task; over: DragOver }
  | { kind: 'move'; block: WeekScheduledBlock; over: DragOver }
  | { kind: 'resize'; block: WeekScheduledBlock; endMin: number }

type Pending =
  | { kind: 'tray'; task: Task; catName: string; durationMin: number }
  | { kind: 'move'; block: WeekScheduledBlock; catName: string; offsetMin: number }
  | { kind: 'resize'; block: WeekScheduledBlock }

const ACTIVATION_PX = 5

export type UsePlannerDragArgs = {
  gridRef: RefObject<HTMLElement | null>
  /** Current visible window bounds (minutes). */
  getWindow: () => { h0: number; h1: number }
  /** False on touch devices — no drag ever starts. */
  enabled: boolean
  onDrop: (result: DropResult) => void
}

export function usePlannerDrag({
  gridRef,
  getWindow,
  enabled,
  onDrop,
}: UsePlannerDragArgs) {
  const [drag, setDrag] = useState<DragState | null>(null)
  const dragRef = useRef<DragState | null>(null)
  const onDropRef = useRef(onDrop)
  const getWindowRef = useRef(getWindow)
  useEffect(() => {
    dragRef.current = drag
    onDropRef.current = onDrop
    getWindowRef.current = getWindow
  })

  // Pending gesture (pointer down, not yet activated) + the listeners to
  // tear down when the gesture ends however it ends.
  const pendingRef = useRef<{
    pending: Pending
    startX: number
    startY: number
    cleanup: () => void
  } | null>(null)

  const slotAt = useCallback(
    (clientX: number, clientY: number) => {
      const el = gridRef.current
      if (!el) return null
      const r = el.getBoundingClientRect()
      const { h0, h1 } = getWindowRef.current()
      return gridPointToSlot({
        x: clientX - r.left,
        y: clientY - r.top,
        width: r.width,
        gutter: PLANNER.gutter,
        hourH: PLANNER.hourH,
        h0,
        h1,
      })
    },
    [gridRef],
  )

  const begin = useCallback(
    (e: ReactPointerEvent<HTMLElement>, pending: Pending) => {
      if (!enabled || e.button !== 0 || pendingRef.current) return
      e.preventDefault()
      const target = e.currentTarget
      try {
        target.setPointerCapture(e.pointerId)
      } catch {
        // jsdom / unsupported — the window listeners still work.
      }
      const startX = e.clientX
      const startY = e.clientY
      let active = false

      const swallowClick = (ev: Event) => {
        ev.stopPropagation()
        ev.preventDefault()
      }

      const finish = () => {
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', onUp)
        window.removeEventListener('pointercancel', onCancel)
        window.removeEventListener('keydown', onKey)
        document.body.style.userSelect = ''
        document.body.style.cursor = ''
        try {
          target.releasePointerCapture(e.pointerId)
        } catch {
          // already released
        }
        pendingRef.current = null
      }

      const activate = () => {
        active = true
        document.body.style.userSelect = 'none'
        document.body.style.cursor =
          pending.kind === 'resize' ? 'ns-resize' : 'grabbing'
        // The click that follows this pointerup must not open the sheet.
        window.addEventListener('click', swallowClick, { capture: true })
        if (pending.kind === 'tray') {
          setDrag({
            kind: 'tray',
            task: pending.task,
            catName: pending.catName,
            durationMin: pending.durationMin,
            px: startX,
            py: startY,
            over: null,
          })
        } else if (pending.kind === 'move') {
          const b = pending.block
          setDrag({
            kind: 'move',
            block: b,
            catName: pending.catName,
            over: { day: b.day, startMin: b.startMin, endMin: b.endMin },
          })
        } else {
          const b = pending.block
          setDrag({
            kind: 'resize',
            block: b,
            over: { day: b.day, startMin: b.startMin, endMin: b.endMin },
          })
        }
      }

      const onMove = (ev: PointerEvent) => {
        if (!active) {
          const dx = ev.clientX - startX
          const dy = ev.clientY - startY
          if (Math.hypot(dx, dy) < ACTIVATION_PX) return
          activate()
        }
        const p = slotAt(ev.clientX, ev.clientY)
        const { h0, h1 } = getWindowRef.current()
        setDrag((st) => {
          if (!st) return st
          if (st.kind === 'tray') {
            const dur = st.durationMin
            const over = p
              ? (() => {
                  const s = Math.max(h0, Math.min(p.minute, h1 - dur))
                  return { day: p.day, startMin: s, endMin: s + dur }
                })()
              : null
            return { ...st, px: ev.clientX, py: ev.clientY, over }
          }
          if (!p) return st
          if (st.kind === 'move') {
            const dur = st.block.endMin - st.block.startMin
            const offset = pending.kind === 'move' ? pending.offsetMin : 0
            const s = Math.max(h0, Math.min(p.minute - offset, h1 - dur))
            return { ...st, over: { day: p.day, startMin: s, endMin: s + dur } }
          }
          const endMin = Math.max(
            st.block.startMin + MIN_BLOCK_MIN,
            Math.min(p.minute, h1),
          )
          return {
            ...st,
            over: { day: st.block.day, startMin: st.block.startMin, endMin },
          }
        })
      }

      const onUp = () => {
        const st = dragRef.current
        finish()
        if (!active) return // plain click — the element's onClick runs
        // Let the trailing click (same task) hit the swallow, then detach.
        window.setTimeout(
          () =>
            window.removeEventListener('click', swallowClick, {
              capture: true,
            }),
          0,
        )
        setDrag(null)
        if (!st || !st.over) return
        if (st.kind === 'tray') {
          onDropRef.current({ kind: 'tray', task: st.task, over: st.over })
        } else if (st.kind === 'move') {
          const b = st.block
          if (
            st.over.day !== b.day ||
            st.over.startMin !== b.startMin ||
            st.over.endMin !== b.endMin
          ) {
            onDropRef.current({ kind: 'move', block: b, over: st.over })
          }
        } else if (st.over.endMin !== st.block.endMin) {
          onDropRef.current({
            kind: 'resize',
            block: st.block,
            endMin: st.over.endMin,
          })
        }
      }

      const cancel = () => {
        finish()
        if (active) {
          window.removeEventListener('click', swallowClick, { capture: true })
          setDrag(null)
        }
      }
      const onCancel = () => cancel()
      const onKey = (ev: KeyboardEvent) => {
        if (ev.key === 'Escape') cancel()
      }

      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onUp)
      window.addEventListener('pointercancel', onCancel)
      window.addEventListener('keydown', onKey)
      pendingRef.current = { pending, startX, startY, cleanup: finish }
    },
    [enabled, slotAt],
  )

  // Unmount safety: never leave window listeners or body styles behind.
  useEffect(() => () => pendingRef.current?.cleanup(), [])

  const startTray = useCallback(
    (
      e: ReactPointerEvent<HTMLElement>,
      task: Task,
      catName: string,
      durationMin: number,
    ) => begin(e, { kind: 'tray', task, catName, durationMin }),
    [begin],
  )

  const startMove = useCallback(
    (e: ReactPointerEvent<HTMLElement>, block: WeekScheduledBlock, catName: string) => {
      const p = slotAt(e.clientX, e.clientY)
      begin(e, {
        kind: 'move',
        block,
        catName,
        offsetMin: p ? p.minute - block.startMin : 0,
      })
    },
    [begin, slotAt],
  )

  const startResize = useCallback(
    (e: ReactPointerEvent<HTMLElement>, block: WeekScheduledBlock) =>
      begin(e, { kind: 'resize', block }),
    [begin],
  )

  return { drag, startTray, startMove, startResize }
}
