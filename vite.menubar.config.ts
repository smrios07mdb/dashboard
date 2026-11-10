import { fileURLToPath, URL } from 'node:url'

import react from '@vitejs/plugin-react'
import autoprefixer from 'autoprefixer'
import tailwindcss from 'tailwindcss'
import { defineConfig } from 'vite'

import menubarTailwind from './menubar/tailwind.config'

/*
 * Second entry of the one package (chunk 91, D2): the macOS menu bar
 * companion's web view. Same `@` → `./src` alias and the same `.env.local`
 * as the PWA; no PWA plugin, no service worker, no `/dashboard/` base.
 * The Tauri shell (`menubar/src-tauri`) loads `menubar/dist`.
 */
export default defineConfig({
  root: 'menubar',
  envDir: fileURLToPath(new URL('.', import.meta.url)),
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  css: {
    postcss: {
      plugins: [tailwindcss(menubarTailwind), autoprefixer()],
    },
  },
  // Tauri's dev URL (`tauri.conf.json` → build.devUrl) expects this port.
  server: { port: 1421, strictPort: true },
  clearScreen: false,
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    // WKWebView on the bundle's minimum macOS (see tauri.conf.json).
    target: 'safari15',
  },
})
