// marks.jsx — Hupomnemata logomark, take 2: the lowercase "h" + the emerald
// point, echoing the wordmark "hupomnemata.". Four letter treatments.
//
// Shared 100×100 grid. Baseline ~y70, ascender top ~y24.
// Props: size, ink, accent, point (the brand dot), paper (knockout), detail.

function Svg({ size = 120, children, title }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100"
         role="img" aria-label={title} style={{ display: 'block', overflow: 'visible' }}>
      {children}
    </svg>
  );
}

const EMERALD = '#11a06e';

/* ── 1 · POINT ──────────────────────────────────────────────
   The wordmark's own initial: a serif lowercase h closed by the
   emerald point. The most direct, most literary. */
function PointH({ size, ink = 'var(--ink)', accent, point = EMERALD, detail = true, title = 'Point' }) {
  const glyph = accent || ink;
  return (
    <Svg size={size} title={title}>
      <text x="40" y="72" textAnchor="middle"
            fontFamily="Newsreader, Georgia, serif" fontSize="74" fontWeight="500"
            fill={glyph} style={{ letterSpacing: '-0.01em' }}>h</text>
      <circle cx="69" cy="67" r="5.4" fill={point} />
    </Svg>
  );
}

/* ── 2 · SEAL ───────────────────────────────────────────────
   The serif h struck inside a hairline ring — a small private
   seal. Intimate, classical. */
function SealH({ size, ink = 'var(--ink)', accent, point = EMERALD, detail = true, title = 'Seal' }) {
  const glyph = accent || ink;
  return (
    <Svg size={size} title={title}>
      <circle cx="50" cy="50" r="47" fill="none" stroke={ink} strokeWidth="2" />
      {detail && <circle cx="50" cy="50" r="40.5" fill="none" stroke={ink} strokeWidth="1" opacity="0.4" />}
      <text x="46.5" y="68" textAnchor="middle"
            fontFamily="Newsreader, Georgia, serif" fontSize="52" fontWeight="500"
            fill={glyph} style={{ letterSpacing: '-0.01em' }}>h</text>
      <circle cx="66" cy="64" r="3.6" fill={point} />
    </Svg>
  );
}

/* ── QUIET — the chosen mark ─────────────────────────────────
   A humanist monoline lowercase h: soft rounded terminals, an
   open shoulder. The emerald point sits to its right, on the
   baseline — the period of "hupomnemata." made into a mark.
   Pure geometry, no font dependency. Centred on the 100 grid. */
function QuietH({ size, ink = 'var(--ink)', accent, point = EMERALD, weight = 11, detail = true, title = 'Quiet' }) {
  const stroke = accent || ink;
  return (
    <Svg size={size} title={title}>
      <g fill="none" stroke={stroke} strokeWidth={weight} strokeLinecap="round" strokeLinejoin="round">
        {/* stem: ascender → baseline */}
        <path d="M24 21 L24 79" />
        {/* shoulder + leg */}
        <path d="M24 53 Q24 36.5 42 36.5 Q60 36.5 60 53 L60 79" />
      </g>
      {/* the point — period on the baseline */}
      <circle cx="76" cy="74.5" r="5.6" fill={point} />
    </Svg>
  );
}

/* ── 4 · INDEX ──────────────────────────────────────────────
   The lowercase h set in IBM Plex Mono — the family that does
   the labels and figures. Technical, archival, ledger-quiet.
   The point is squared to match the monospace grid. */
function IndexH({ size, ink = 'var(--ink)', accent, point = EMERALD, detail = true, title = 'Index' }) {
  const glyph = accent || ink;
  return (
    <Svg size={size} title={title}>
      <text x="41" y="73" textAnchor="middle"
            fontFamily="'IBM Plex Mono', monospace" fontSize="66" fontWeight="500"
            fill={glyph}>h</text>
      <rect x="64" y="62.5" width="9.5" height="9.5" rx="2" fill={point} />
    </Svg>
  );
}

Object.assign(window, { PointH, SealH, QuietH, IndexH, EMERALD });
