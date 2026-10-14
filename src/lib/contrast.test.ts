import { describe, expect, it } from 'vitest'

import css from '../index.css?raw'
import { CALENDAR_PALETTE } from './calendarColors'

/*
 * Small-text contrast guard (chunk 75, UX audit #14; ARCH §13).
 *
 * Reads the tokens out of index.css and checks them with the WCAG 2.x
 * relative-luminance formula. `--work` / `--personal` come from the default
 * `[data-catpalette='emerald']` block (what ships); everything else from
 * `:root`. The `-ink` tokens are `color-mix(in srgb, var(--X) P%, black)`,
 * which in sRGB is each channel multiplied by P/100.
 */

type RGB = [number, number, number]

/** Body of the first `selector { … }` block in index.css. */
function block(selector: string): string {
  const start = css.indexOf(`${selector} {`)
  if (start < 0) throw new Error(`no ${selector} block in index.css`)
  const open = css.indexOf('{', start)
  return css.slice(open + 1, css.indexOf('}', open))
}

const ROOT = block(':root')
const EMERALD = block("[data-catpalette='emerald']")

function raw(name: string): string {
  const from = name === '--work' || name === '--personal' ? EMERALD : ROOT
  const m = new RegExp(`${name}:\\s*([^;]+);`).exec(from)
  if (!m) throw new Error(`${name} is not defined`)
  return m[1].trim()
}

function hex(value: string): RGB {
  const m = /^#([0-9a-f]{6})$/i.exec(value)
  if (!m) throw new Error(`not a 6-digit hex: ${value}`)
  const n = parseInt(m[1], 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

/** A token's colour: a hex, or `color-mix(in srgb, var(--X) P%, black)`. */
function token(name: string): RGB {
  const value = raw(name)
  const mix = /^color-mix\(in srgb, var\((--[\w-]+)\) (\d+)%, black\)$/.exec(value)
  if (!mix) return hex(value)
  const p = Number(mix[2]) / 100
  return token(mix[1]).map((c) => c * p) as RGB
}

/** `fg` at `alpha` over `bg`. */
function over(fg: RGB, alpha: number, bg: RGB): RGB {
  return fg.map((c, i) => c * alpha + bg[i] * (1 - alpha)) as RGB
}

function luminance([r, g, b]: RGB): number {
  const lin = (c: number) => {
    const s = c / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
}

function contrast(a: RGB, b: RGB): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

const WHITE: RGB = [255, 255, 255]
const AA = 4.5

const INK_TOKENS = [
  ['--work-ink', '--work'],
  ['--personal-ink', '--personal'],
  ['--jewel-amethyst-ink', '--jewel-amethyst'],
  ['--jewel-jade-ink', '--jewel-jade'],
  ['--jewel-coral-ink', '--jewel-coral'],
  ['--jewel-gold-ink', '--jewel-gold'],
] as const

describe('small-text contrast (chunk 75)', () => {
  it.each(['--surface', '--surface-2', '--bg', '--bg-alt'])(
    '--ink-3 is >= 4.5:1 on %s',
    (surface) => {
      expect(contrast(token('--ink-3'), token(surface))).toBeGreaterThanOrEqual(AA)
    },
  )

  it.each(INK_TOKENS)(
    '%s is >= 4.5:1 on white, on --bg and on its own 15% wash',
    (ink, base) => {
      const c = token(ink)
      expect(contrast(c, WHITE)).toBeGreaterThanOrEqual(AA)
      expect(contrast(c, token('--bg'))).toBeGreaterThanOrEqual(AA)
      expect(contrast(c, over(token(base), 0.15, WHITE))).toBeGreaterThanOrEqual(AA)
    },
  )

  it.each(['--work-ink', '--personal-ink'])(
    'white is >= 4.5:1 on %s (the "N open" pill)',
    (ink) => {
      expect(contrast(WHITE, token(ink))).toBeGreaterThanOrEqual(AA)
    },
  )

  it('.label is 11px and no font-size in index.css is under 11px', () => {
    expect(/\.label\s*\{[^}]*font-size:\s*([\d.]+)px/.exec(css)?.[1]).toBe('11')
    const sizes = [...css.matchAll(/font-size:\s*([\d.]+)px/g)].map((m) => Number(m[1]))
    expect(sizes.length).toBeGreaterThan(0)
    expect(sizes.filter((n) => n < 11)).toEqual([])
  })
})

/** `--name: rgba(r, g, b, a)` out of a block: its colour and its alpha. */
function rgba(name: string, from: string): { rgb: RGB; alpha: number } {
  const m = new RegExp(
    `${name}:\\s*rgba\\((\\d+), (\\d+), (\\d+), ([\\d.]+)\\);`,
  ).exec(from)
  if (!m) throw new Error(`${name} is not an rgba() token`)
  return { rgb: [Number(m[1]), Number(m[2]), Number(m[3])], alpha: Number(m[4]) }
}

/** BusyBlock's calendar tint: 16% of the calendar colour over the base. */
const WASH = 0.16

describe('contrast on washes (chunk 75a)', () => {
  it.each([...CALENDAR_PALETTE, '#000000'])(
    '--busy-ink is >= 4.5:1 on the wash of %s, with and without the Outlook hatch',
    (colour) => {
      const ink = token('--busy-ink')
      const hatch = rgba('--busy-outlook-hatch', ROOT)
      for (const base of ['--bg', '--surface']) {
        const wash = over(hex(colour), WASH, token(base))
        expect(
          contrast(ink, wash),
          `${colour} over ${base}, no hatch`,
        ).toBeGreaterThanOrEqual(AA)
        expect(
          contrast(ink, over(hatch.rgb, hatch.alpha, wash)),
          `${colour} over ${base}, hatch`,
        ).toBeGreaterThanOrEqual(AA)
      }
    },
  )

  it('--ink-2 is >= 4.5:1 on the emerald --work-soft over --bg', () => {
    const soft = rgba('--work-soft', EMERALD)
    const chip = over(soft.rgb, soft.alpha, token('--bg'))
    expect(contrast(token('--ink-2'), chip)).toBeGreaterThanOrEqual(AA)
  })

  it.each(['--bg', '--surface'])('--ink-3 is >= 4.5:1 on %s', (base) => {
    expect(contrast(token('--ink-3'), token(base))).toBeGreaterThanOrEqual(AA)
  })
})
