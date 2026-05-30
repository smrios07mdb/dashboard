# Dashboard

A single-user personal productivity PWA that unifies Work and Personal tasks across iPhone, iPad, and Mac. Tracks daily morning and night routines with streaks, integrates Apple Calendar via a CalDAV proxy, runs AI triage to recommend what to do next, and syncs across devices through Supabase.

See [`ARCHITECTURE.md`](./ARCHITECTURE.md) for the canonical system reference (stack, data model, sync, calendar, security). Build sequence lives in [`ORCHESTRATION.md`](./ORCHESTRATION.md); progress tracking in [`PROGRESS.md`](./PROGRESS.md).

## Local development

```sh
cp .env.example .env.local   # fill in Supabase + proxy + VAPID keys
npm install
npm run dev                  # http://localhost:5173/dashboard/
npm test                     # run Vitest once
npm run build                # production bundle into dist/
```

## Deploy

Pushing to `main` triggers `.github/workflows/deploy.yml`, which builds with `VITE_*` repository secrets and publishes `dist/` to the `gh-pages` branch. Each build also emits a `version.json` (git short SHA + timestamp) surfaced in **Settings → About**.

## Tech stack

React + Vite + TypeScript, Tailwind CSS + shadcn/ui, Supabase (Postgres + Auth + Realtime + Edge Functions), Dexie (offline cache + replay outbox), recharts (Insights), `vite-plugin-pwa` (installable PWA + Web Push). Deployed to GitHub Pages under `/dashboard/`.

## Related repositories

- [`dashboard-caldav-proxy`](https://github.com/smrios07mdb/dashboard-caldav-proxy) — brokers Apple Calendar over CalDAV: stores the app-specific password AES-GCM-encrypted, returns busy ranges, and creates events. See [`ARCHITECTURE.md`](./ARCHITECTURE.md) §7.
