import { useEffect, useState } from 'react'

/*
 * Category progress bar — a colour-dot + name + done/total figure above a
 * `--bg-alt` track whose fill animates its width to `ratio` on mount, painted
 * with the category colour gradient and a soft glow. Ported from gamify.jsx
 * (chunk 26). `color` is a CSS colour string (a `var(--work)` / `var(--personal)`
 * token from the caller).
 */

type CatBarProps = {
  name: string
  done: number
  total: number
  /** 0–1 completion fraction. */
  ratio: number
  color: string
}

export default function CatBar({ name, done, total, ratio, color }: CatBarProps) {
  const [w, setW] = useState(0)

  useEffect(() => {
    const t = setTimeout(() => setW(ratio), 120)
    return () => clearTimeout(t)
  }, [ratio])

  return (
    <div style={{ flex: 1, minWidth: 0 }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          justifyContent: 'space-between',
          marginBottom: 6,
        }}
      >
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}>
          <span
            style={{ width: 8, height: 8, borderRadius: 3, background: color }}
          />
          <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--ink)' }}>
            {name}
          </span>
        </span>
        <span className="num" style={{ fontSize: 11, color: 'var(--ink-3)' }}>
          {done}/{total}
        </span>
      </div>
      <div
        style={{
          height: 7,
          borderRadius: 999,
          background: 'var(--bg-alt)',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            height: '100%',
            width: `${w * 100}%`,
            borderRadius: 999,
            background: `linear-gradient(90deg, ${color}, color-mix(in srgb, ${color} 60%, white))`,
            transition: 'width 1s cubic-bezier(.2,.7,.2,1)',
            boxShadow: `0 0 10px -2px ${color}`,
          }}
        />
      </div>
    </div>
  )
}
