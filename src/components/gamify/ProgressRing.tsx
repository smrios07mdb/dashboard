import { useEffect, useId, useState, type ReactNode } from 'react'

/*
 * Progress ring — two stacked arcs over a `--bg-alt` track: a faint
 * full-circle gradient tint (so the ring reads as colourful even near-empty)
 * and the value arc, both a work→personal linear gradient, rotated −90° with
 * round caps and a soft drop-shadow glow. The arc sweeps in from empty on
 * mount via a `useState` + ~80ms delay. Ported from gamify.jsx (chunk 26).
 *
 * The gradient id is per-instance (`useId`) so two rings on one page can't
 * collide on a shared `<defs>` id — the prototype only ever rendered one.
 */

type ProgressRingProps = {
  /** 0–1 fill fraction. */
  value?: number
  size?: number
  stroke?: number
  children?: ReactNode
}

export default function ProgressRing({
  value = 0,
  size = 88,
  stroke = 9,
  children,
}: ProgressRingProps) {
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  // useId can contain colons; strip them so the SVG url(#id) ref is clean.
  const gradientId = `ring-grad-${useId().replace(/:/g, '')}`
  const [shown, setShown] = useState(0)

  useEffect(() => {
    const t = setTimeout(() => setShown(value), 80)
    return () => clearTimeout(t)
  }, [value])

  return (
    <div
      style={{ position: 'relative', width: size, height: size, flexShrink: 0 }}
    >
      <svg
        width={size}
        height={size}
        style={{ transform: 'rotate(-90deg)', overflow: 'visible' }}
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="var(--work)" />
            <stop offset="100%" stopColor="var(--personal)" />
          </linearGradient>
        </defs>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="var(--bg-alt)"
          strokeWidth={stroke}
        />
        {/* faint full-circle tint so the ring reads as colourful even when near-empty */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={`url(#${gradientId})`}
          strokeWidth={stroke}
          strokeLinecap="round"
          opacity={0.16}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={`url(#${gradientId})`}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - shown)}
          style={{
            transition: 'stroke-dashoffset 1.1s cubic-bezier(.2,.7,.2,1)',
            filter:
              'drop-shadow(0 2px 6px color-mix(in srgb, var(--work) 45%, transparent))',
          }}
        />
      </svg>
      <div
        style={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          textAlign: 'center',
          lineHeight: 1,
        }}
      >
        {children}
      </div>
    </div>
  )
}
