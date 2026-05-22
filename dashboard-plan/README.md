# Personal Productivity Dashboard — Project Plan

This package is everything you need to orchestrate the build. Drop it into the root of your `dashboard` repo (the `prompts/` folder included).

## What's in here

| File | Purpose | Read it when |
|---|---|---|
| `ARCHITECTURE.md` | Canonical reference for the entire system — stack, data model, sync, calendar, security. Single source of truth. | **First.** Also linked from every chunk prompt. |
| `DESIGN_BRIEF.md` | Paste-ready prompt for Claude in Design mode. Generates the visual components. | Right after Chunk 1 ships. |
| `PROGRESS.md` | Project tracker template. Lives in the repo and mirrors a GitHub Project board. | Throughout — update after every chunk. |
| `ORCHESTRATION.md` | Step-by-step sequence: which prompt where, in what order, how to handle handoffs. | Before starting; reference throughout. |
| `prompts/chunk-NN-name.md` | 16 self-contained prompts for Claude Code, one per build chunk. | One at a time, in order. |

## Quick start

1. Read `ARCHITECTURE.md` end-to-end.
2. Create two GitHub repos: `dashboard` and `dashboard-caldav-proxy`.
3. Drop this whole package into the `dashboard` repo and commit.
4. Open `ORCHESTRATION.md` and follow it from step 1.

## What this builds

A single-user installable PWA running on iPhone, iPad, and Mac. Triages tasks across Work and Personal categories with user-defined subcategories, tracks daily morning and night routines with streaks, integrates with Apple Calendar (read busy ranges, create events) via a CalDAV proxy, runs AI triage to recommend what to do next, and syncs across devices via Supabase.

Hosting: GitHub Pages (app) + Vercel (proxy) + Supabase free tier (data). Recurring cost: $0.
