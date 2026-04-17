-- Migration 3 — Clean up polluted paper rows
--
-- Drops the 83 Wonders paper price_cache rows for A1-/P- collector numbers that
-- imply non-paper variants. The new get_harvest_candidates RPC (Migration 2) no
-- longer schedules these, so they would otherwise linger as stale junk.
--
-- Verified zero collections or listing_templates reference these rows. 15 of
-- the 83 have a non-null price_mid — those prices are variant-misattributed
-- (harvested with a variant-agnostic query) and will be correctly re-populated
-- under 'ocm' or 'ff' by the harvester within 2-3 days.

DELETE FROM public.price_cache pc
USING public.cards c
WHERE pc.card_id = c.id
  AND c.game_id = 'wonders'
  AND pc.variant = 'paper'
  AND pc.source = 'ebay'
  AND (c.card_number LIKE 'A1-%' OR c.card_number LIKE 'P-%');

-- Verification — should return zero rows after the delete
SELECT count(*) AS residual_polluted_rows
FROM public.price_cache pc
JOIN public.cards c ON c.id = pc.card_id
WHERE c.game_id='wonders'
  AND pc.variant='paper'
  AND (c.card_number LIKE 'A1-%' OR c.card_number LIKE 'P-%');
