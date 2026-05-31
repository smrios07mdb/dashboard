/// <reference types="vitest/config" />
import { execFileSync } from 'node:child_process'
import { defineConfig, type PluginOption } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { fileURLToPath, URL } from 'node:url'

/**
 * Emit `version.json` (git short SHA + build timestamp) into the build output
 * so Settings → About can surface the deployed version (chunk-16 R9). Not
 * matched by the PWA precache glob (json), so it's fetched fresh at runtime.
 */
function versionJsonPlugin(): PluginOption {
  return {
    name: 'write-version-json',
    apply: 'build',
    generateBundle() {
      let sha = 'unknown'
      try {
        sha = execFileSync('git', ['rev-parse', '--short', 'HEAD'])
          .toString()
          .trim()
      } catch {
        // not a git checkout (e.g. tarball build) — leave as 'unknown'
      }
      this.emitFile({
        type: 'asset',
        fileName: 'version.json',
        source: JSON.stringify({ sha, builtAt: new Date().toISOString() }),
      })
    },
  }
}

/**
 * Inject a Content-Security-Policy <meta> into index.html AT BUILD TIME only
 * (SRV-01). GitHub Pages serves static files and can't set response headers, so
 * a meta CSP is the only available mechanism. `apply: 'build'` means it does NOT
 * constrain `npm run dev` — the Vite dev server injects inline HMR scripts and a
 * ws://localhost socket that `script-src 'self'` / this `connect-src` would
 * otherwise block. Validate against the PRODUCTION build (`npm run build &&
 * npm run preview`) and the deployed GH Pages URL.
 *
 * connect-src MUST list `wss://*.supabase.co`: Supabase Realtime
 * (src/db/realtime.ts) opens a WebSocket, and a CSP `https:` source does NOT
 * authorize a `wss:` socket (the scheme-upgrade allowance is ws->wss / http->
 * https, not https->wss; only same-origin `'self'` implies its own ws/wss). Omit
 * it and cross-device live sync silently breaks.
 *
 * style-src keeps `'unsafe-inline'` for recharts' inline style attributes
 * (ARCHITECTURE §12 Insights); revisit once the deployed console confirms zero
 * style-src violations. `frame-ancestors` is inert in a <meta> CSP (header-only
 * per spec) but kept to document intent; real clickjacking defense would need a
 * response header GH Pages can't set.
 */
function cspMetaPlugin(): PluginOption {
  const csp = [
    "default-src 'self'",
    "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://api.anthropic.com https://dashboard-caldav-proxy.vercel.app",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self'",
    "worker-src 'self'",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "frame-ancestors 'none'",
  ].join('; ')
  return {
    name: 'inject-csp-meta',
    apply: 'build',
    transformIndexHtml() {
      return [
        {
          tag: 'meta',
          attrs: { 'http-equiv': 'Content-Security-Policy', content: csp },
          injectTo: 'head-prepend',
        },
      ]
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  base: '/dashboard/',
  plugins: [
    react(),
    VitePWA({
      // injectManifest (chunk 14): the SW is now src/sw.ts so we can own the
      // push + notificationclick handlers. The precache, navigateFallback,
      // Supabase NetworkOnly route, cleanupOutdatedCaches, and the autoUpdate
      // skipWaiting/clientsClaim that chunk 4 expressed declaratively here now
      // live in src/sw.ts and MUST stay equivalent (see that file).
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      registerType: 'autoUpdate',
      injectRegister: 'auto',
      includeAssets: ['favicon.svg', 'icons/icon.svg'],
      manifest: {
        name: 'Dashboard',
        short_name: 'Dashboard',
        description: 'Personal productivity dashboard',
        // Obsidian palette tokens resolved from src/index.css.
        // --accent (ice) for chrome tint; --background for splash.
        theme_color: '#c8d2e2',
        background_color: '#0a0b0e',
        display: 'standalone',
        start_url: '/dashboard/',
        scope: '/dashboard/',
        icons: [
          {
            src: 'icons/icon-192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: 'icons/icon-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: 'icons/icon-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
          {
            src: 'icons/apple-touch-icon.png',
            sizes: '180x180',
            type: 'image/png',
          },
        ],
      },
      injectManifest: {
        // Precache the app shell + bundled @fontsource woff2 files — the same
        // glob the chunk-4 generateSW config used. The runtime routes that
        // used to sit under `workbox` are now code in src/sw.ts.
        globPatterns: ['**/*.{js,css,html,ico,png,svg,webmanifest,woff2}'],
      },
      devOptions: {
        enabled: false,
      },
    }),
    versionJsonPlugin(),
    cspMetaPlugin(),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: './src/setupTests.ts',
    css: true,
    // Supabase tests run separately via `npm run test:supabase` against a
    // hosted project — they need node env + real network and shouldn't
    // get pulled into the default `npm test` discovery.
    exclude: ['**/node_modules/**', '**/dist/**', 'supabase/**'],
  },
})
