
-- Bug D resolution, final step: rewrite price_cache from canonical attributions.
--
-- The shadow canonical_price_cache materialized view has been live and
-- validated for the session. It exposes:
--   - 2,825 BoBA cards with truly-attributable listings (was: 6,234 with
--     contamination-inflated counts)
--   - 132 Wonders cards similarly de-contaminated
--   - Cards like Cupid BLBF-84 reveal as $650 instead of $14.37 — the
--     contamination was dragging high-value rares down via same-name commons
--
-- The rewrite is atomic: DELETE current hero-card rows, INSERT canonical
-- rows. play_price_cache (TEXT card_id, no parallel column) is NOT
-- affected — that's a separate table used by play cards (bonus plays,
-- hot dogs) and has different contamination characteristics.
--
-- Expected impact:
--   - ~3,400 BoBA cards that had inflated listings will drop to zero
--     listings_count (their cache was 100% contamination — Bug D recovery)
--   - 257 price_cache rows with >20% drift get corrected
--   - The harvester will continue running and overwrite any specific row
--     when its parallel comes up in the next cycle for that card
--
-- The price_cache_parallel_consistency trigger validates each insert:
-- canonical rows always pass because they're derived from cards INNER JOIN
-- ebay_listing_observations, so cards.parallel = canonical.parallel by
-- construction.

begin;

-- 1. Clear contaminated hero card rows (both games, source='ebay')
delete from public.price_cache
where source = 'ebay'
  and game_id in ('boba', 'wonders');

-- 2. Insert from canonical, mapping source 'ebay-canonical' → 'ebay'
insert into public.price_cache (
  card_id, source, parallel, game_id,
  price_low, price_mid, price_high,
  listings_count, filtered_count,
  buy_now_low, buy_now_mid, buy_now_count,
  confidence_score, confidence_cold_start,
  fetched_at
)
select
  card_id,
  'ebay'::text as source,
  parallel,
  game_id,
  price_low,
  price_mid::numeric,
  price_high,
  listings_count::integer,
  0 as filtered_count,  -- canonical_price_cache doesn't track filter outcomes
  buy_now_low,
  buy_now_mid::numeric,
  buy_now_count::integer,
  confidence_score::real,
  confidence_cold_start,
  fetched_at
from public.canonical_price_cache;

commit;
