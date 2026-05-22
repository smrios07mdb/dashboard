import { defineConfig } from 'vitest/config'
import dotenv from 'dotenv'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))

// Load supabase/.env.test (sibling of this tests/ folder).
// .env.test is gitignored; copy supabase/.env.test.example to start.
// quiet: true suppresses dotenv v17's promotional stdout tip.
dotenv.config({ path: path.resolve(here, '../.env.test'), quiet: true })

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['**/*.test.ts'],
    root: here,
    testTimeout: 30_000,
  },
})
