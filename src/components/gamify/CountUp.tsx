import { useEffect, useRef, useState, type CSSProperties } from 'react'

/*
 * Interval-based count-up tween — 24 steps, cubic ease-out, rendered through
 * `toLocaleString()`. Interval (not rAF) so it always converges to the target
 * even if frames are dropped. Re-runs whenever `value` changes, animating from
 * the previous value to the new one. Ported from gamify.jsx (chunk 26).
 */

type CountUpProps = {
  value: number
  /** Total tween duration in ms. */
  dur?: number
  className?: string
  style?: CSSProperties
}

export default function CountUp({
  value,
  dur = 700,
  className,
  style,
}: CountUpProps) {
  const [n, setN] = useState(value)
  const prev = useRef(value)

  useEffect(() => {
    const from = prev.current
    const to = value
    prev.current = value
    if (from === to) {
      setN(to)
      return
    }
    const steps = 24
    let i = 0
    const id = setInterval(() => {
      i++
      const k = i / steps
      const e = 1 - Math.pow(1 - k, 3)
      setN(Math.round(from + (to - from) * e))
      if (i >= steps) {
        clearInterval(id)
        setN(to)
      }
    }, dur / steps)
    return () => {
      clearInterval(id)
      setN(to)
    }
  }, [value, dur])

  return (
    <span className={className} style={style}>
      {n.toLocaleString()}
    </span>
  )
}
