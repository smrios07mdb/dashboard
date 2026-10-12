import { render } from '@testing-library/react'
import { isValidElement, type ReactNode } from 'react'
import { describe, expect, it } from 'vitest'

import { renderNoteMarkdown, safeHref } from './noteMarkdown'

function mount(body: string) {
  return render(<div data-testid="md">{renderNoteMarkdown(body)}</div>).container
    .firstElementChild as HTMLElement
}

/** Every element in a rendered tree, depth-first. */
function elements(nodes: ReactNode): { props: Record<string, unknown> }[] {
  const out: { props: Record<string, unknown> }[] = []
  const walk = (n: ReactNode) => {
    if (Array.isArray(n)) return n.forEach(walk)
    if (!isValidElement(n)) return
    const el = n as { props: Record<string, unknown> }
    out.push(el)
    walk(el.props.children as ReactNode)
  }
  walk(nodes)
  return out
}

const EVERYTHING = [
  '# Heading one',
  '## Heading two',
  'A paragraph with [a link](https://example.com/a) and a bare',
  'https://example.com/b url.',
  '',
  '- first',
  '- second [mail](mailto:a@b.co)',
  '',
  'Last paragraph.',
].join('\n')

describe('renderNoteMarkdown', () => {
  it('renders `# ` as an h2 with the 22px title style', () => {
    const h = mount('# Plan').querySelector('h2')!
    expect(h).toHaveTextContent('Plan')
    expect(h).toHaveClass('title', 'text-[22px]')
  })

  it('renders `## ` as an h3 at 15/600', () => {
    const h = mount('## Details').querySelector('h3')!
    expect(h).toHaveTextContent('Details')
    expect(h).toHaveClass('text-[15px]', 'font-semibold')
  })

  it('groups consecutive `- ` lines into one list', () => {
    const root = mount('- a\n- b\n\n- c')
    const lists = root.querySelectorAll('ul')
    expect(lists).toHaveLength(2)
    expect(
      Array.from(lists[0].querySelectorAll('li')).map((l) => l.textContent),
    ).toEqual(['a', 'b'])
    expect(lists[1].querySelectorAll('li')).toHaveLength(1)
  })

  it('splits paragraphs on blank lines and joins wrapped lines', () => {
    const ps = mount('one\ntwo\n\nthree').querySelectorAll('p')
    expect(Array.from(ps).map((p) => p.textContent)).toEqual([
      'one two',
      'three',
    ])
  })

  it('links [text](url), bare URLs and mailto, opening in a new tab safely', () => {
    const links = mount(EVERYTHING).querySelectorAll('a')
    expect(Array.from(links).map((a) => [a.textContent, a.getAttribute('href')])).toEqual([
      ['a link', 'https://example.com/a'],
      ['https://example.com/b', 'https://example.com/b'],
      ['mail', 'mailto:a@b.co'],
    ])
    for (const a of links) {
      expect(a).toHaveAttribute('target', '_blank')
      expect(a).toHaveAttribute('rel', 'noopener noreferrer')
    }
  })

  it('a bare URL stops before a closing parenthesis', () => {
    const a = mount('(see https://example.com/x)').querySelector('a')!
    expect(a).toHaveAttribute('href', 'https://example.com/x')
  })

  it('renders every supported construct together, in order', () => {
    const root = mount(EVERYTHING)
    expect(Array.from(root.children).map((c) => c.tagName)).toEqual([
      'H2',
      'H3',
      'P',
      'UL',
      'P',
    ])
  })

  it('passes plain text through untouched', () => {
    const root = mount('Just words, 2 < 3 & <b>not bold</b>.')
    expect(root.querySelectorAll('p')).toHaveLength(1)
    expect(root.querySelector('b')).toBeNull()
    expect(root).toHaveTextContent('Just words, 2 < 3 & <b>not bold</b>.')
  })

  it('renders nothing for an empty body', () => {
    expect(renderNoteMarkdown('')).toEqual([])
    expect(renderNoteMarkdown('\n\n  \n')).toEqual([])
  })

  it.each([
    ['javascript:', '[click](javascript:alert(1))'],
    ['data:', '[click](data:text/html;base64,PHNjcmlwdD4=)'],
    ['vbscript:', '[click](vbscript:msgbox)'],
    ['file:', '[click](file:///etc/passwd)'],
    ['relative', '[click](/settings)'],
    ['mixed-case javascript:', '[click](JaVaScRiPt:alert(1))'],
  ])('a %s link renders as text, not an anchor', (_name, source) => {
    const root = mount(`before ${source} after`)
    expect(root.querySelector('a')).toBeNull()
    expect(root).toHaveTextContent(`before ${source} after`)
  })

  it('a bare javascript: or data: URL is never linked', () => {
    const root = mount('javascript:alert(1) and data:text/html,<script>x</script>')
    expect(root.querySelector('a')).toBeNull()
    expect(root.querySelector('script')).toBeNull()
  })

  it('no element carries dangerouslySetInnerHTML', () => {
    const hostile = `${EVERYTHING}\n<img src=x onerror=alert(1)>\n[x](javascript:alert(1))`
    const all = elements(renderNoteMarkdown(hostile))
    expect(all.length).toBeGreaterThan(5)
    for (const el of all) {
      expect(el.props).not.toHaveProperty('dangerouslySetInnerHTML')
    }
    expect(mount(hostile).querySelector('img')).toBeNull()
  })
})

describe('safeHref', () => {
  it('allows http, https and mailto only', () => {
    expect(safeHref('https://a.b')).toBe('https://a.b')
    expect(safeHref('http://a.b')).toBe('http://a.b')
    expect(safeHref('mailto:a@b.co')).toBe('mailto:a@b.co')
    expect(safeHref('javascript:alert(1)')).toBeNull()
    expect(safeHref(' javascript:alert(1)')).toBeNull()
    expect(safeHref('data:text/html,x')).toBeNull()
    expect(safeHref('not a url')).toBeNull()
  })
})

describe('links with parentheses in the URL (chunk 59, D9)', () => {
  it('renders a URL holding balanced parentheses as one link', () => {
    const root = mount('[x](https://en.wikipedia.org/wiki/Foo_(bar)) after')
    const links = root.querySelectorAll('a')
    expect(links).toHaveLength(1)
    expect(links[0]).toHaveAttribute(
      'href',
      'https://en.wikipedia.org/wiki/Foo_(bar)',
    )
    expect(links[0]).toHaveTextContent('x')
    expect(root.textContent).toBe('x after')
  })

  it('still renders a javascript: link as the text that was typed', () => {
    const root = mount('[bad](javascript:alert(1))')
    expect(root.querySelector('a')).toBeNull()
    expect(root.textContent).toBe('[bad](javascript:alert(1))')
  })
})
