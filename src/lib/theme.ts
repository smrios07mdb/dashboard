/**
 * Focal-accent presets (the Tweaks "accent" axis; default `forest`).
 *
 * Values are expressed in THIS codebase's token conventions, not the design's
 * raw hex — see `src/index.css` header:
 *   --accent      : HSL triplet  (consumed via `hsl(var(--accent))` and Tailwind
 *                                 opacity utils like `bg-accent/40`)
 *   --accent-soft : rgba()       (consumed as bare `var(--accent-soft)`)
 *   --accent-ink  : hex          (consumed as bare `var(--accent-ink)`)
 *
 * Writing `--accent` as a hex (as the chunk spec's literal "#1f5142" suggests)
 * would break `hsl(var(--accent))` consumers and opacity modifiers — so the
 * focal hex is pre-converted to its HSL triplet here.
 */
export type AccentName = 'forest' | 'terracotta' | 'plum' | 'ink'

interface AccentTokens {
  /** `--accent` — HSL triplet (space-separated). */
  accent: string
  /** `--accent-soft` — rgba wash. */
  soft: string
  /** `--accent-ink` — hex. */
  ink: string
}

export const ACCENTS: Record<AccentName, AccentTokens> = {
  forest: { accent: '162 45% 22%', soft: 'rgba(31, 81, 66, 0.10)', ink: '#1f5142' },
  terracotta: { accent: '15 62% 45%', soft: 'rgba(187, 79, 44, 0.10)', ink: '#bb4f2c' },
  plum: { accent: '322 30% 36%', soft: 'rgba(119, 64, 99, 0.10)', ink: '#774063' },
  ink: { accent: '30 16% 15%', soft: 'rgba(44, 38, 32, 0.10)', ink: '#2c2620' },
}

export const DEFAULT_ACCENT: AccentName = 'forest'

/** Write the focal-accent CSS vars onto the document root. */
export function applyAccent(name: AccentName = DEFAULT_ACCENT): void {
  const tokens = ACCENTS[name] ?? ACCENTS[DEFAULT_ACCENT]
  const root = document.documentElement
  root.style.setProperty('--accent', tokens.accent)
  root.style.setProperty('--accent-soft', tokens.soft)
  root.style.setProperty('--accent-ink', tokens.ink)
}
