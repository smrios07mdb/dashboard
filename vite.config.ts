/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath, URL } from 'node:url'

// https://vite.dev/config/
export default defineConfig({
  base: '/dashboard/',
  plugins: [react()],
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
