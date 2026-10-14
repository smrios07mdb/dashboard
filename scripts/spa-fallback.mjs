#!/usr/bin/env node
/*
 * SPA 404 fallback for GitHub Pages. Zero deps.
 *
 * Copies dist/index.html to dist/404.html byte for byte. Pages serves a
 * project site's 404.html for any unknown path under it, so a hard reload or
 * first visit on a deep route (/dashboard/settings, /dashboard/planner, …)
 * boots the app instead of Pages' own 404 page. index.html references every
 * asset by an absolute /dashboard/... URL, so the same file works at any
 * depth; BrowserRouter then renders the real path. The document status stays
 * 404 — Pages cannot answer 200 there. See prompts/chunk-80-spa-404-fallback.md.
 *
 * Runs after `vite build` (chained in package.json's build script) rather than
 * as a Vite plugin: by then the injectManifest service worker is generated,
 * so 404.html never enters the precache, and vite.config.ts stays untouched.
 *
 * Run: `node scripts/spa-fallback.mjs` (part of `npm run build`)
 */
import { copyFileSync, existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export function writeSpaFallback(distDir) {
  const src = join(distDir, 'index.html')
  if (!existsSync(src)) throw new Error(`spa-fallback: ${src} not found`)
  const out = join(distDir, '404.html')
  copyFileSync(src, out)
  return out
}

const self = fileURLToPath(import.meta.url)
if (process.argv[1] && resolve(process.argv[1]) === self) {
  try {
    const out = writeSpaFallback(join(dirname(self), '..', 'dist'))
    console.log(`spa-fallback: wrote ${out}`)
  } catch (err) {
    console.error(err instanceof Error ? err.message : err)
    process.exit(1)
  }
}
