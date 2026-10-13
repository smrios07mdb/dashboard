import { describe, expect, it } from 'vitest'

/*
 * iOS focus-zoom guard (chunk 65, Day-7 #9; ARCH §13).
 *
 * iOS Safari zooms the viewport when a text-entry field under 16px takes
 * focus. Every <input>, <textarea> and <select> (and the shadcn <Input> /
 * <Textarea>) in src/ must therefore render at >= 16px on touch.
 *
 * Source scan, not a render: the size lives in Tailwind classes, which jsdom
 * cannot compute. For each field's opening tag:
 *   - an UNPREFIXED font-size token under 16px (`text-xs`, `text-sm`,
 *     `text-[Npx]` with N < 16) passes only if the same tag also carries an
 *     unprefixed >= 16px token (`text-base`, `text-[Npx]` with N >= 16).
 *     That covers `text-base sm:text-[13px]` (the prefixed compact size is
 *     ignored) and `touch ? 'text-[16px]' : 'text-[13px]'`.
 *   - an inline `fontSize: N` with N < 16 fails.
 * Checkbox / radio / range / color / file / hidden inputs are exempt.
 * Sources come in through Vite's raw glob, so no Node types are needed.
 */

const SOURCES = import.meta.glob<string>(
  ['/src/**/*.tsx', '!/src/**/*.test.tsx', '!/src/components/ui/**'],
  { query: '?raw', import: 'default', eager: true },
)
const EXEMPT_TYPES = new Set(['checkbox', 'radio', 'range', 'color', 'file', 'hidden'])
const FIELD = /<(input|textarea|select|Input|Textarea)\b/g

/** Index of the `>` closing a JSX opening tag, skipping `{…}` and strings. */
function tagEnd(s: string, i: number): number {
  let depth = 0
  let quote: string | null = null
  for (; i < s.length; i++) {
    const c = s[i]
    if (quote) {
      if (c === quote) quote = null
    } else if (c === '"' || c === "'" || c === '`') quote = c
    else if (c === '{') depth++
    else if (c === '}') depth--
    else if (c === '>' && depth === 0) return i
  }
  return s.length
}

function px(token: string): number {
  if (token === 'text-xs') return 12
  if (token === 'text-sm') return 14
  if (token === 'text-base') return 16
  return Number(token.slice('text-['.length, -'px]'.length))
}

function offenders(): string[] {
  const out: string[] = []
  for (const [file, s] of Object.entries(SOURCES)) {
    for (const m of s.matchAll(FIELD)) {
      const start = m.index ?? 0
      // Skip matches inside comments (e.g. "Native `<input type=…>`").
      const lead = s.slice(s.lastIndexOf('\n', start) + 1, start).trimStart()
      if (lead.startsWith('*') || lead.startsWith('//') || lead.endsWith('`')) continue
      const tag = s.slice(start, tagEnd(s, start + m[0].length))
      const type = /\btype=["'](\w[\w-]*)/.exec(tag)?.[1]
      if (type && EXEMPT_TYPES.has(type)) continue
      const sizes = [...tag.matchAll(/(?<![\w:-])text-(?:xs|sm|base|\[\d+px\])(?![\w-])/g)].map(
        (x) => px(x[0]),
      )
      const inline = [...tag.matchAll(/\bfontSize:\s*(\d+)/g)].map((x) => Number(x[1]))
      const small = sizes.some((n) => n < 16) && !sizes.some((n) => n >= 16)
      if (small || inline.some((n) => n < 16)) {
        out.push(`${file}:${s.slice(0, start).split('\n').length}`)
      }
    }
  }
  return out.sort()
}

describe('iOS focus-zoom guard', () => {
  it('every text-entry field renders at >= 16px on touch', () => {
    expect(offenders()).toEqual([])
  })

  it('the scan finds the fields (sanity)', () => {
    const withFields = Object.values(SOURCES).filter((s) =>
      /<(input|textarea|select|Input|Textarea)\b/.test(s),
    )
    expect(withFields.length).toBeGreaterThan(10)
  })
})
