/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { fileURLToPath, URL } from 'node:url'

// https://vite.dev/config/
export default defineConfig({
  base: '/dashboard/',
  plugins: [
    react(),
    VitePWA({
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
      workbox: {
        // Precache the app shell + bundled @fontsource woff2 files.
        globPatterns: ['**/*.{js,css,html,ico,png,svg,webmanifest,woff2}'],
        navigateFallback: '/dashboard/index.html',
        cleanupOutdatedCaches: true,
        runtimeCaching: [
          {
            // Supabase REST + GraphQL: NetworkFirst with 30s timeout, 5min freshness.
            urlPattern: ({ url }) =>
              url.hostname.endsWith('.supabase.co') &&
              (url.pathname.startsWith('/rest/v1') ||
                url.pathname.startsWith('/graphql/v1')),
            handler: 'NetworkFirst',
            options: {
              cacheName: 'supabase-api',
              networkTimeoutSeconds: 30,
              expiration: {
                maxEntries: 200,
                maxAgeSeconds: 60 * 5,
              },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
      devOptions: {
        enabled: false,
      },
    }),
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
