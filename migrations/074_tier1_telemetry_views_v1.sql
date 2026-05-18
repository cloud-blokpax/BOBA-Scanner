-- Phase 2 Tier 1 telemetry: expand tier1_hit_rate_v1 to cover the new
-- 'tier1_paddle_ocr' rows (previously hardcoded to 'tier1_hash') and add a
-- forensic per-scan view (tier1_diagnostic_v1) that lifts the six required
-- extras sub-objects to top-level JSON for ad-hoc queries.
--
-- Both views use security_invoker so RLS on scan_tier_results / scans / cards
-- is enforced against the querying user, not the view creator.

DROP VIEW IF EXISTS public.tier1_hit_rate_v1;

CREATE VIEW public.tier1_hit_rate_v1
WITH (security_invoker = true) AS
WITH scan_windows AS (
  SELECT
    s.id,
    s.captured_at,
    s.game_id,
    s.pipeline_version,
    s.winning_tier,
    s.final_card_id,
    s.capture_source,
    (s.capture_context ->> 'alignment_state_at_capture') AS alignment_state,
    row_number() OVER (
      PARTITION BY s.session_id, s.final_card_id ORDER BY s.captured_at
    ) AS scan_attempt_num
  FROM scans s
  WHERE s.outcome = 'resolved'::scan_outcome AND s.final_card_id IS NOT NULL
),
tier1_detail AS (
  SELECT
    sw.id AS scan_id,
    sw.captured_at,
    sw.game_id,
    sw.pipeline_version,
    sw.capture_source,
    sw.alignment_state,
    sw.scan_attempt_num,
    (sw.winning_tier IN ('tier1_hash','tier1_paddle_ocr','tier1_embedding','tier1_local_ocr','tier1_upload_tta')) AS tier1_won,
    str.tier::text AS tier1_tier,
    str.engine::text AS tier1_engine,
    str.engine_version AS tier1_engine_version,
    str.outcome AS tier1_outcome,
    str.skip_reason,
    str.error_code,
    str.idb_cache_hit,
    str.sb_exact_hit,
    str.sb_fuzzy_hit,
    str.ocr_mean_confidence,
    str.ocr_detected_card_number,
    (str.extras -> 'frames' ->> 'live_consensus_reached')::boolean AS live_consensus_reached,
    (str.extras -> 'decision' ->> 'miss_category') AS miss_category,
    str.parsed_confidence AS tier1_top_similarity
  FROM scan_windows sw
  LEFT JOIN scan_tier_results str
    ON str.scan_id = sw.id
   AND str.tier IN ('tier1_hash'::scan_tier, 'tier1_paddle_ocr'::scan_tier, 'tier1_embedding'::scan_tier)
)
SELECT
  (date_trunc('day', captured_at))::date AS scan_day,
  game_id,
  pipeline_version,
  capture_source,
  tier1_tier,
  tier1_engine,
  alignment_state,
  count(*) AS total_scans,
  count(*) FILTER (WHERE scan_attempt_num = 1) AS cold_scans,
  count(*) FILTER (WHERE tier1_won) AS tier1_hits,
  count(*) FILTER (WHERE tier1_won AND scan_attempt_num = 1) AS tier1_cold_hits,
  round(100.0 * count(*) FILTER (WHERE tier1_won)::numeric
        / NULLIF(count(*), 0)::numeric, 1) AS tier1_hit_rate_pct,
  count(*) FILTER (WHERE live_consensus_reached) AS live_consensus_reached_count,
  count(*) FILTER (WHERE miss_category IS NOT NULL) AS miss_with_category,
  round(avg(ocr_mean_confidence)::numeric, 3) AS avg_ocr_confidence,
  round(avg(ocr_mean_confidence) FILTER (WHERE tier1_won)::numeric, 3) AS avg_ocr_conf_when_hit,
  round(avg(ocr_mean_confidence) FILTER (WHERE NOT tier1_won)::numeric, 3) AS avg_ocr_conf_when_miss
FROM tier1_detail
GROUP BY 1,2,3,4,5,6,7
ORDER BY 1 DESC, 2, 5;

GRANT SELECT ON public.tier1_hit_rate_v1 TO authenticated;

-- Diagnostic view: per-scan forensic row. Lifts the six required extras
-- sub-objects (frames/canonical/detection/consensus/catalog_lookup/decision)
-- to top-level JSON so operators can query with SELECT * without unwrapping.
CREATE OR REPLACE VIEW public.tier1_diagnostic_v1
WITH (security_invoker = true) AS
SELECT
  str.created_at,
  str.scan_id,
  s.capture_source,
  s.game_id,
  str.tier,
  str.engine,
  str.engine_version,
  str.outcome,
  str.skip_reason,
  str.error_code,
  str.latency_ms,
  str.ocr_text_raw,
  str.ocr_mean_confidence,
  str.ocr_detected_card_number,
  str.parsed_card_id,
  str.parsed_parallel,
  str.parsed_confidence,
  str.topn_candidates,
  (str.extras -> 'frames')         AS frames_extras,
  (str.extras -> 'canonical')      AS canonical_extras,
  (str.extras -> 'detection')      AS detection_extras,
  (str.extras -> 'consensus')      AS consensus_extras,
  (str.extras -> 'catalog_lookup') AS catalog_lookup_extras,
  (str.extras -> 'decision')       AS decision_extras,
  s.final_card_id      AS scan_final_card_id,
  s.winning_tier       AS scan_winning_tier,
  s.final_confidence   AS scan_final_confidence,
  s.user_overrode,
  c.name               AS final_card_name,
  c.card_number        AS final_card_number
FROM scan_tier_results str
JOIN scans s ON s.id = str.scan_id
LEFT JOIN cards c ON c.id = s.final_card_id
WHERE str.tier = 'tier1_paddle_ocr'::scan_tier;

GRANT SELECT ON public.tier1_diagnostic_v1 TO authenticated;
