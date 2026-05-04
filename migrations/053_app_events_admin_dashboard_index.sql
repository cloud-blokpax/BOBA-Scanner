-- Phase 1 Doc 1.2 — index to support "what's broken in the last hour"
-- admin queries. Filters by level + recency and groups by fingerprint.
CREATE INDEX IF NOT EXISTS idx_app_events_level_created_fingerprint
  ON app_events (level, created_at DESC, fingerprint_hash)
  WHERE level IN ('error', 'fatal', 'warn');
