-- Chunk 51 (ARCHITECTURE.md §7) — multi-calendar iCloud read.
-- `caldav_calendar_url` stays the single WRITE target (chunk 39 mirrors).
-- `caldav_read_calendars` is the READ set: [{ url, name, enabled }].
-- null = not initialized → proxy falls back to reading the write target only
-- (legacy behavior). The app initializes it to all-enabled on first Planner
-- mount, and Settings clears it back to null on credential re-save/disconnect.
--
-- No RLS / publication / replica-identity changes: settings is already
-- covered (migrations 03/05). Applied out-of-band to the dev project via raw
-- SQL (MCP `execute_sql`, chunk-33/35/37/39 precedent). Idempotent.
alter table public.settings
  add column if not exists caldav_read_calendars jsonb;
