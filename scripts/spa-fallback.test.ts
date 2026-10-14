import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'

// Imported per case, through a variable so Vite does not resolve it at
// transform time: a missing script then fails each case on its own rather
// than failing the whole file at collection.
const SCRIPT = './spa-fallback.mjs'
const load = async (): Promise<(distDir: string) => string> =>
  (await import(/* @vite-ignore */ SCRIPT)).writeSpaFallback

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

describe('writeSpaFallback (chunk 80)', () => {
  const dirs: string[] = []
  const tmp = () => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'spa-fallback-'))
    dirs.push(d)
    return d
  }
  afterEach(() => {
    for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true })
  })

  it('copies index.html to 404.html byte for byte', async () => {
    const writeSpaFallback = await load()
    const dir = tmp()
    const html = '<!doctype html><html><head><script type="module" src="/dashboard/assets/index-x.js"></script></head><body>é</body></html>\n'
    fs.writeFileSync(path.join(dir, 'index.html'), html)
    const out = writeSpaFallback(dir)
    expect(out).toBe(path.join(dir, '404.html'))
    expect(fs.readFileSync(out).equals(fs.readFileSync(path.join(dir, 'index.html')))).toBe(true)
  })

  it('throws and writes nothing when index.html is missing', async () => {
    const writeSpaFallback = await load()
    const dir = tmp()
    expect(() => writeSpaFallback(dir)).toThrow()
    expect(fs.readdirSync(dir)).toEqual([])
  })

  it('runs as the last step of npm run build', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'))
    expect(pkg.scripts.build.endsWith('&& node scripts/spa-fallback.mjs')).toBe(true)
  })
})
