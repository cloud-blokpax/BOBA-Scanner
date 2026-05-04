-- Phase 1 Doc 1.2 — drop legacy client error tables.
-- Data was backfilled into app_events in 051.
-- Client-side write path now goes to /api/events.
DROP TABLE IF EXISTS error_logs;
DROP TABLE IF EXISTS client_errors;
DROP TABLE IF EXISTS api_call_logs; -- never written, drop while we're here
