/*
 * The Notebook's Markdown renderer (chunk 58, D7): a pure function from a
 * note's body to React nodes. Everything is built from text nodes and
 * elements — nothing is ever parsed as HTML.
 *
 * Supported, and nothing else:
 *   `# `  → h2, `.title` 22px        `## ` → h3, 15/600
 *   `- `  → <ul> items               blank line → paragraph break
 *   `[text](url)` and bare `https?://` URLs → links
 *
 * Only `http:`, `https:` and `mailto:` become links. Any other scheme
 * (`javascript:`, `data:`, …) is rendered as the text the user typed.
 */
import type { ReactNode } from 'react'

const SAFE_PROTOCOLS = new Set(['http:', 'https:', 'mailto:'])

/** The URL as an href when its scheme is allowed, else `null`. */
export function safeHref(raw: string): string | null {
  const url = raw.trim()
  let protocol: string
  try {
    protocol = new URL(url).protocol
  } catch {
    return null
  }
  return SAFE_PROTOCOLS.has(protocol) ? url : null
}

// `[text](target)` — or a bare http(s) URL, which stops at whitespace and at a
// closing parenthesis so "(see https://x.y)" does not swallow the bracket.
const INLINE = /\[([^\]]+)\]\(([^)\s]+)\)|(https?:\/\/[^\s)]+)/g

function link(href: string, text: string, key: string): ReactNode {
  return (
    <a
      key={key}
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-accent-ink underline underline-offset-2"
    >
      {text}
    </a>
  )
}

function inline(text: string, keyPrefix: string): ReactNode[] {
  const out: ReactNode[] = []
  let last = 0
  for (const m of text.matchAll(INLINE)) {
    const at = m.index
    if (at > last) out.push(text.slice(last, at))
    const key = `${keyPrefix}-${at}`
    if (m[3] !== undefined) {
      out.push(link(m[3], m[3], key))
    } else {
      const href = safeHref(m[2])
      // A disallowed scheme stays exactly as typed, brackets and all.
      out.push(href ? link(href, m[1], key) : m[0])
    }
    last = at + m[0].length
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}

const isH1 = (l: string) => /^#\s/.test(l)
const isH2 = (l: string) => /^##\s/.test(l)
const isItem = (l: string) => /^-\s/.test(l)

export function renderNoteMarkdown(body: string): ReactNode[] {
  const lines = body.split('\n')
  const blocks: ReactNode[] = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    if (!line.trim()) {
      i += 1
      continue
    }
    if (isH2(line)) {
      blocks.push(
        <h3
          key={i}
          className="mb-1.5 mt-[18px] text-[15px] font-semibold tracking-[-0.01em] text-ink first:mt-0"
        >
          {inline(line.replace(/^##\s*/, ''), `h${i}`)}
        </h3>,
      )
      i += 1
      continue
    }
    if (isH1(line)) {
      blocks.push(
        <h2 key={i} className="title mb-2 mt-5 text-[22px] first:mt-0">
          {inline(line.replace(/^#\s*/, ''), `h${i}`)}
        </h2>,
      )
      i += 1
      continue
    }
    if (isItem(line)) {
      const start = i
      const items: ReactNode[] = []
      while (i < lines.length && isItem(lines[i])) {
        items.push(
          <li key={i} className="my-[3px]">
            {inline(lines[i].replace(/^-\s*/, ''), `l${i}`)}
          </li>,
        )
        i += 1
      }
      blocks.push(
        <ul key={`u${start}`} className="mb-2.5 mt-1.5 list-disc pl-[22px]">
          {items}
        </ul>,
      )
      continue
    }
    const start = i
    const para: string[] = []
    while (
      i < lines.length &&
      lines[i].trim() &&
      !isH1(lines[i]) &&
      !isH2(lines[i]) &&
      !isItem(lines[i])
    ) {
      para.push(lines[i])
      i += 1
    }
    blocks.push(
      <p key={`p${start}`} className="mb-3">
        {inline(para.join(' '), `p${start}`)}
      </p>,
    )
  }
  return blocks
}
