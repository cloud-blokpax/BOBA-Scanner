-- Track the last-seen deck builder cards.json version for the weekly drift check.
-- Cron at /api/cron/qstash-check-deck-builder-version reads/writes this row.

INSERT INTO public.app_config (key, value, description)
VALUES (
  'deck_builder_version_last_seen',
  '"0.1.5"'::jsonb,
  'Last cards.json version seen by /api/cron/qstash-check-deck-builder-version. Updated when new version detected. Synced manually 2026-04-27 to match current state.'
)
ON CONFLICT (key) DO UPDATE SET
  value = excluded.value,
  description = excluded.description,
  updated_at = now();
