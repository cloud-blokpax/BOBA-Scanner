
-- Block the old harvester fallback bug from ever recurring.
-- Lowercase 'paper' was the legacy default written when the harvester couldn't
-- determine the actual parallel. Canonical is 'Paper'. Block the lowercase form.
ALTER TABLE price_cache
  ADD CONSTRAINT price_cache_no_lowercase_paper
  CHECK (parallel IS NULL OR parallel != 'paper');

ALTER TABLE price_history
  ADD CONSTRAINT price_history_no_lowercase_paper
  CHECK (parallel IS NULL OR parallel != 'paper');
