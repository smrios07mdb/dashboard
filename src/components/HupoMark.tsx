/**
 * HupoMark — the Hupomnemata logomark (codename "Quiet").
 *
 * A humanist monoline lowercase "h" followed by a filled point sitting on the
 * baseline — the period of the wordmark rendered as a symbol. Canonical geometry
 * from `hupomnemata_handoff/brand/README.md`: 100-unit grid, stroke 11, round
 * caps/joins, point at (76, 74.5) r5.6 (same diameter as the stroke).
 *
 * Rules (enforced):
 *  - The glyph is ALWAYS ink (`var(--ink)` on light; pass `glyph="#eceaef"` on
 *    dark surfaces). Never recolor / gradient / outline / rotate / skew the h.
 *  - ONLY the point carries color. Default `point="var(--work)"` so it tracks the
 *    live category-work token (emerald `#059669` under the default palette).
 *  - Below ~16px the point is dropped so the h stays clean (favicon floor).
 */
type HupoMarkProps = {
  /** Rendered width/height in px (square). Default 24. */
  size?: number
  /** Stroke color of the "h". Pass `#eceaef` on dark surfaces. */
  glyph?: string
  /** Fill color of the point. Defaults to the live `--work` token. */
  point?: string
  className?: string
}

export function HupoMark({
  size = 24,
  glyph = 'var(--ink)',
  point = 'var(--work)',
  className,
}: HupoMarkProps) {
  const showPoint = size >= 16
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      role="img"
      aria-label="Hupomnemata"
      className={className}
      style={{ display: 'block' }}
    >
      <g
        fill="none"
        stroke={glyph}
        strokeWidth="11"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M24 21 L24 79" />
        <path d="M24 53 Q24 36.5 42 36.5 Q60 36.5 60 53 L60 79" />
      </g>
      {showPoint && <circle cx="76" cy="74.5" r="5.6" fill={point} />}
    </svg>
  )
}

export default HupoMark
