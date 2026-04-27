-- Migration 24 — pick_harvest_probe_sample RPC
--
-- Curates ~22 representative cards for the harvest probe to exercise.
-- Coverage requirements (from the Phase 1 investigation plan):
--   - At least one card per BoBA parallel family
--   - The four BoBA embedded-typo heroes (Stongboy, Crosbow, Cameleon, Laviathan)
--     — these probe whether the filter's hero/name path tolerates source-of-truth
--     typos, which OCR must match exactly per CLAUDE.md.
--   - Four athlete-mapped heroes (Gambler, Gigawitt, Ant Hill, Sensei) — these
--     probe whether the athlete-name fallback (Tier 2 of filterRelevantListings)
--     is doing useful work.
--   - One card per Wonders parallel (Paper, Classic Foil, Formless Foil,
--     Orbital Color Match, Stonefoil) — these probe the separate Wonders
--     query/filter path.
--
-- STABLE volatility: re-running the function on the same database returns
-- the same set as long as the cards table hasn't changed (random() is
-- evaluated once per call; subsequent calls within a single statement are
-- consistent — but across separate transactions the picks may shift, which
-- is why the probe endpoint persists run_id and reuses the chosen IDs).
--
-- Idempotent on re-run via CREATE OR REPLACE.

CREATE OR REPLACE FUNCTION public.pick_harvest_probe_sample()
RETURNS TABLE (card_id uuid, bucket text)
LANGUAGE sql
STABLE
AS $$
	WITH boba_buckets AS (
		SELECT DISTINCT ON (parallel) id, parallel
		FROM public.cards
		WHERE game_id = 'boba'
		  AND parallel IS NOT NULL
		ORDER BY parallel, random()
	),
	embedded_typos AS (
		SELECT id, 'embedded_typo' AS bucket
		FROM public.cards
		WHERE game_id = 'boba'
		  AND name IN ('Stongboy', 'Cameleon', 'Crosbow', 'Laviathan')
		LIMIT 4
	),
	athlete_mapped AS (
		SELECT id, 'athlete_mapped' AS bucket
		FROM public.cards
		WHERE game_id = 'boba'
		  AND name IN ('Gambler', 'Gigawitt', 'Ant Hill', 'Sensei')
		LIMIT 4
	),
	wonders AS (
		SELECT DISTINCT ON (parallel) id, parallel
		FROM public.cards
		WHERE game_id = 'wonders'
		  AND parallel IS NOT NULL
		ORDER BY parallel, random()
	)
	SELECT id AS card_id, 'boba_' || parallel AS bucket FROM boba_buckets
	UNION ALL
	SELECT id AS card_id, bucket FROM embedded_typos
	UNION ALL
	SELECT id AS card_id, bucket FROM athlete_mapped
	UNION ALL
	SELECT id AS card_id, 'wonders_' || parallel AS bucket FROM wonders;
$$;

-- Service-role only — admin diagnostic infrastructure.
REVOKE ALL ON FUNCTION public.pick_harvest_probe_sample() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.pick_harvest_probe_sample() TO service_role;

-- Verification — should return ~22 rows when run against a populated cards table
SELECT bucket, COUNT(*) AS picks
FROM public.pick_harvest_probe_sample()
GROUP BY bucket
ORDER BY bucket;
