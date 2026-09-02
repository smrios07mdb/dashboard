import { useEffect, useRef } from 'react'
import { Check, RotateCcw, X } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  type ShellMargins,
  useShellMarginsStore,
} from '@/state/shellMargins'

type Edge = 'left' | 'right' | 'top' | 'bottom'

const EDGE_LABEL: Record<Edge, string> = {
  left: 'Left margin',
  right: 'Right margin',
  top: 'Top margin',
  bottom: 'Bottom margin',
}

/**
 * Draggable margin guides + a Save / Reset / Cancel bar. Rendered by AppShell
 * inside its (relative) content wrapper while `draft` is non-null, so the
 * guides sit exactly on the padding edges: left/right guides at `side`, the
 * top guide at `top`, the bottom guide at `bottom` from the wrapper's bottom.
 *
 * Dragging a side guide moves both sides together (margins stay symmetric).
 * Guides are keyboard-adjustable too: arrow keys move 4px, Shift+arrow 16px.
 * Esc cancels.
 */
export default function MarginEditor() {
  const draft = useShellMarginsStore((s) => s.draft)
  const setDraft = useShellMarginsStore((s) => s.setDraft)
  const resetDraft = useShellMarginsStore((s) => s.resetDraft)
  const save = useShellMarginsStore((s) => s.save)
  const cancel = useShellMarginsStore((s) => s.cancel)

  useEffect(() => {
    if (!draft) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') cancel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [draft, cancel])

  if (!draft) return null

  return (
    <>
      <Guide edge="left" draft={draft} setDraft={setDraft} />
      <Guide edge="right" draft={draft} setDraft={setDraft} />
      <Guide edge="top" draft={draft} setDraft={setDraft} />
      <Guide edge="bottom" draft={draft} setDraft={setDraft} />

      <div
        role="toolbar"
        aria-label="Page margins"
        data-testid="margin-editor-bar"
        className="fixed inset-x-0 bottom-[calc(4rem+env(safe-area-inset-bottom))] z-50 flex justify-center px-4 sm:bottom-6"
      >
        <div className="flex items-center gap-3 rounded-full border border-line bg-surface px-4 py-2 shadow-lg">
          <span className="text-[12px] font-medium tabular-nums text-ink-2">
            Sides {draft.side}px · Top {draft.top}px · Bottom {draft.bottom}px
          </span>
          <Button size="sm" variant="ghost" onClick={resetDraft}>
            <RotateCcw className="mr-1 h-3.5 w-3.5" aria-hidden />
            Reset
          </Button>
          <Button size="sm" variant="ghost" onClick={cancel}>
            <X className="mr-1 h-3.5 w-3.5" aria-hidden />
            Cancel
          </Button>
          <Button size="sm" onClick={save}>
            <Check className="mr-1 h-3.5 w-3.5" aria-hidden />
            Save
          </Button>
        </div>
      </div>
    </>
  )
}

function Guide({
  edge,
  draft,
  setDraft,
}: {
  edge: Edge
  draft: ShellMargins
  setDraft: (patch: Partial<ShellMargins>) => void
}) {
  const horizontal = edge === 'left' || edge === 'right'
  const key: keyof ShellMargins = horizontal ? 'side' : edge
  const value = draft[key]
  const startRef = useRef<{ pointer: number; value: number } | null>(null)

  const onPointerDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    e.preventDefault()
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {
      // Synthetic / already-released pointer ids throw; the drag still works
      // as long as the pointer stays over the handle.
    }
    startRef.current = {
      pointer: horizontal ? e.clientX : e.clientY,
      value,
    }
  }
  const onPointerMove = (e: React.PointerEvent<HTMLButtonElement>) => {
    const start = startRef.current
    if (!start) return
    const now = horizontal ? e.clientX : e.clientY
    // Dragging the guide *inward* grows the margin on left/top and shrinks it
    // on right/bottom — the sign flips per edge.
    const sign = edge === 'left' || edge === 'top' ? 1 : -1
    setDraft({ [key]: start.value + sign * (now - start.pointer) })
  }
  const onPointerUp = (e: React.PointerEvent<HTMLButtonElement>) => {
    startRef.current = null
    try {
      e.currentTarget.releasePointerCapture(e.pointerId)
    } catch {
      // Capture may already be gone (pointercancel); nothing to release.
    }
  }
  const onKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    const step = e.shiftKey ? 16 : 4
    const grow = horizontal
      ? edge === 'left'
        ? 'ArrowRight'
        : 'ArrowLeft'
      : edge === 'top'
        ? 'ArrowDown'
        : 'ArrowUp'
    const shrink = horizontal
      ? edge === 'left'
        ? 'ArrowLeft'
        : 'ArrowRight'
      : edge === 'top'
        ? 'ArrowUp'
        : 'ArrowDown'
    if (e.key === grow) setDraft({ [key]: value + step })
    else if (e.key === shrink) setDraft({ [key]: value - step })
    else return
    e.preventDefault()
  }

  const pos: React.CSSProperties =
    edge === 'left'
      ? { left: value, top: 0, bottom: 0 }
      : edge === 'right'
        ? { right: value, top: 0, bottom: 0 }
        : edge === 'top'
          ? { top: value, left: 0, right: 0 }
          : { bottom: value, left: 0, right: 0 }

  // Side handles stick to the viewport's vertical middle so they are reachable
  // without scrolling on long pages; top/bottom handles sit at a third of the
  // width so they never hide under the centered Save bar.
  const handleClass = `pointer-events-auto flex h-9 w-9 items-center justify-center rounded-full border border-line bg-surface text-[11px] font-semibold tabular-nums text-ink shadow-md touch-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
    horizontal
      ? 'sticky top-[calc(50svh-1.125rem)] -translate-x-1/2 cursor-ew-resize'
      : 'absolute left-1/3 -translate-x-1/2 -translate-y-1/2 cursor-ns-resize'
  }`

  return (
    <div
      data-testid={`margin-guide-${edge}`}
      className={`pointer-events-none absolute z-40 ${
        horizontal ? 'w-0 border-l-2' : 'h-0 border-t-2'
      } border-dashed border-accent-ink/60`}
      style={pos}
    >
      <button
        type="button"
        aria-label={EDGE_LABEL[edge]}
        aria-valuenow={value}
        title={`${EDGE_LABEL[edge]}: ${value}px — drag or use arrow keys`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onKeyDown={onKeyDown}
        className={handleClass}
        style={horizontal ? { marginLeft: -1 } : { marginTop: -1 }}
      >
        {value}
      </button>
    </div>
  )
}
