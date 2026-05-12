
-- Block lowercase 'paper' from entering collections or listing_templates.
-- A single such row caused the harvester to burn budget re-fetching the same Wonders card
-- ~288 times/day for 10 days while non-Paper parallels sat unharvested. The bug:
-- get_harvest_candidates UNION includes collections.parallel, and case-sensitive comparison
-- against the canonical 'Paper' in price_cache and price_harvest_log bypasses both dedup
-- and freshness gates, returning the card on every invocation.
ALTER TABLE collections
  ADD CONSTRAINT collections_no_lowercase_paper
  CHECK (parallel IS NULL OR parallel != 'paper');

ALTER TABLE listing_templates
  ADD CONSTRAINT listing_templates_no_lowercase_paper
  CHECK (parallel IS NULL OR parallel != 'paper');
