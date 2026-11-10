import type { Config } from 'tailwindcss'

import base from '../tailwind.config'

/*
 * The app's Tailwind theme with the content list pointed at the menubar
 * (chunk 91). `src/index.css` needs Tailwind to build (`@tailwind`, `@apply`);
 * scanning only what the popover renders keeps the PWA's utilities out of its
 * stylesheet. Shared components the popover imports are listed by file.
 * Paths are relative to the repo root, where the npm scripts run.
 */
export default {
  ...base,
  content: [
    './menubar/index.html',
    './menubar/src/**/*.{ts,tsx}',
    './src/components/PriorityChip.tsx',
  ],
} satisfies Config
