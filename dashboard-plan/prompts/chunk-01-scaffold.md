# Chunk 1 — Scaffold + GitHub Pages

**Goal:** Working Vite + React + TS + Tailwind + shadcn/ui app deployed to GitHub Pages.
**Dependencies:** None.
**Effort:** ~2h.

> Reference `ARCHITECTURE.md` §2 (Stack) and §3 (Hosting).

## What to build

Initialize a Vite + React + TypeScript project in the current directory. Install and configure:

**Runtime deps:**
- `tailwindcss`, `postcss`, `autoprefixer`
- shadcn/ui CLI; install components: `button`, `input`, `dialog`, `checkbox`, `dropdown-menu`, `tabs`, `card`, `sheet`, `tooltip`, `toast`, `skeleton`
- `zustand`
- `dexie`
- `date-fns`
- `recharts`
- `@dnd-kit/core`
- `react-router-dom`
- `@supabase/supabase-js`
- `lucide-react` (icons)
- `vite-plugin-pwa` (install but DO NOT enable; that's chunk 4)

**Dev deps:**
- `vitest`, `@testing-library/react`, `@testing-library/jest-dom`, `@testing-library/user-event`, `jsdom`

**Configuration:**
- `vite.config.ts` with `base: '/dashboard/'`
- Tailwind configured with shadcn-compatible theme tokens
- Define CSS variables for the brand palette (see ARCHITECTURE §13): `--background: #faf8f3`, `--foreground: #1f1d1a`, `--primary: #3a5a40`, `--destructive: #a85a3c`
- Inter font from Google Fonts in `index.html`
- Vitest configured with `jsdom` and `@testing-library` setup

**Landing page:**
- `src/App.tsx` renders a centered `<h1>Dashboard</h1>` with brand-quiet styling. That's the only UI for now.

**Env scaffolding:**
- `.env.example` with these keys (no values):
  ```
  VITE_SUPABASE_URL=
  VITE_SUPABASE_ANON_KEY=
  VITE_CALDAV_PROXY_URL=
  VITE_VAPID_PUBLIC_KEY=
  ```
- `.gitignore` ignores `.env.local`, `node_modules`, `dist`.

**Deploy pipeline:**
- `.github/workflows/deploy.yml`:
  - Triggers on push to `main`
  - Installs Node 20, runs `npm ci`, then `npm run build`
  - Reads the four `VITE_*` env vars from repository secrets and injects them into the build step
  - Publishes `dist/` to `gh-pages` branch using `peaceiris/actions-gh-pages@v3`

**One smoke test:**
- `src/App.test.tsx` renders `<App />` and asserts the heading exists. `npm test` must pass.

## Files to create/modify

```
package.json              (via Vite init)
vite.config.ts
tailwind.config.ts
postcss.config.js
tsconfig.json
components.json           (shadcn config)
index.html
src/main.tsx
src/App.tsx
src/App.test.tsx
src/index.css
src/components/ui/*       (shadcn primitives)
src/lib/utils.ts          (shadcn `cn` helper)
.github/workflows/deploy.yml
.env.example
.gitignore
README.md                 (one-paragraph project description, link to ARCHITECTURE.md)
```

## Acceptance criteria

- `npm run dev` serves the heading at `http://localhost:5173/dashboard/`
- `npm run build` completes with zero errors
- `npm test` passes
- After pushing to `main`, GitHub Actions runs and the GitHub Pages URL serves the heading
- All four `VITE_*` env vars present in `.env.example`

## Do NOT

- Enable PWA features (chunk 4)
- Add Supabase or any backend calls
- Build any other UI
- Create the `design/` folder (it'll be populated by the Design brief output after this chunk)

## How to test

1. `npm run dev` → browser shows "Dashboard"
2. `npm run build && ls dist/` → bundle exists
3. `npm test` → green
4. Push to GitHub → Actions tab shows green run → visit Pages URL → heading visible
