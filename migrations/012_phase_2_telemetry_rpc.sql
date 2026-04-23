-- Migration 12 — Phase 2 telemetry aggregate RPC (session 2.9)
--
-- Read-only aggregate function used by /api/admin/phase-2-telemetry
-- and the AdminPhase2Tab component. Returns all ten Phase 2 dashboard
-- sections as one jsonb. SECURITY DEFINER with explicit search_path
-- pinning; window_interval is allow-listed inside the function.
--
-- The HAVING clause on ocrRegionAgreement omits games with zero
-- live-consensus rows so the dashboard's length === 0 empty-state
-- guard trips correctly on pre-flag-flip state.
--
-- Idempotent via CREATE OR REPLACE. Prod is already at this version
-- (applied via MCP during session 2.9, patched in session 2.10).

BEGIN;

CREATE OR REPLACE FUNCTION public.phase_2_telemetry(window_interval text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  since_ts timestamptz;
  result jsonb;
BEGIN
  -- Allow-list the interval input as a defense-in-depth guard. The
  -- endpoint already allow-lists the window string, but this keeps
  -- the RPC safe against direct calls. Run BEFORE since_ts assignment
  -- so a bogus input raises our message, not a raw cast error.
  IF window_interval NOT IN ('24 hours', '7 days', '30 days') THEN
    RAISE EXCEPTION 'invalid window_interval: %', window_interval;
  END IF;

  since_ts := NOW() - window_interval::interval;

  SELECT jsonb_build_object(
    'pipelineMix', (
      SELECT COALESCE(jsonb_agg(row_to_json(t)), '[]'::jsonb) FROM (
        SELECT
          COALESCE(winning_tier, 'null_abandoned') AS tier,
          COUNT(*)::int AS n,
          ROUND(100.0 * COUNT(*) / SUM(COUNT(*)) OVER (), 1)::float AS pct
        FROM public.scans
        WHERE created_at > since_ts
        GROUP BY winning_tier
        ORDER BY COUNT(*) DESC
      ) t
    ),
    'sliceByGameAndSource', (
      SELECT COALESCE(jsonb_agg(row_to_json(t)), '[]'::jsonb) FROM (
        SELECT
          game_id,
          COALESCE(capture_source, 'null') AS capture_source,
          COALESCE(winning_tier, 'null_abandoned') AS tier,
          COUNT(*)::int AS n
        FROM public.scans
        WHERE created_at > since_ts
        GROUP BY game_id, capture_source, winning_tier
        ORDER BY game_id, capture_source, COUNT(*) DESC
      ) t
    ),
    'ocrRegionAgreement', (
      SELECT COALESCE(jsonb_agg(row_to_json(t)), '[]'::jsonb) FROM (
        SELECT
          game_id,
          COUNT(*) FILTER (WHERE live_consensus_reached IS TRUE)::int AS n_live_reached,
          COUNT(*) FILTER (WHERE live_consensus_reached IS TRUE
                           AND live_vs_canonical_agreed IS TRUE)::int AS n_agreed,
          CASE WHEN COUNT(*) FILTER (WHERE live_consensus_reached IS TRUE) > 0 THEN
            ROUND(100.0
                  * COUNT(*) FILTER (WHERE live_consensus_reached IS TRUE
                                     AND live_vs_canonical_agreed IS TRUE)
                  / COUNT(*) FILTER (WHERE live_consensus_reached IS TRUE), 1)::float
          END AS agreed_pct
        FROM public.scans
        WHERE created_at > since_ts
          AND capture_source = 'camera_live'
        GROUP BY game_id
        HAVING COUNT(*) FILTER (WHERE live_consensus_reached IS TRUE) > 0
      ) t
    ),
    'binderCellFallback', (
      SELECT row_to_json(t) FROM (
        SELECT
          COUNT(*)::int AS n_binder_cells,
          COUNT(*) FILTER (WHERE fallback_tier_used = 'haiku')::int AS n_haiku,
          COUNT(*) FILTER (WHERE winning_tier LIKE 'tier1%')::int AS n_tier1,
          CASE WHEN COUNT(*) > 0 THEN
            ROUND(100.0 * COUNT(*) FILTER (WHERE fallback_tier_used = 'haiku')
                        / COUNT(*), 1)::float
          END AS haiku_pct
        FROM public.scans
        WHERE created_at > since_ts
          AND capture_source = 'binder_live_cell'
      ) t
    ),
    'overrideRateByTier', (
      SELECT COALESCE(jsonb_agg(row_to_json(t)), '[]'::jsonb) FROM (
        SELECT
          COALESCE(winning_tier, 'null_abandoned') AS tier,
          COUNT(*)::int AS n,
          COUNT(*) FILTER (WHERE user_overrode IS TRUE)::int AS n_overridden,
          CASE WHEN COUNT(*) > 0 THEN
            ROUND(100.0 * COUNT(*) FILTER (WHERE user_overrode IS TRUE)
                        / COUNT(*), 1)::float
          END AS override_pct
        FROM public.scans
        WHERE created_at > since_ts
          AND outcome IN ('auto_confirmed', 'user_confirmed',
                          'user_corrected', 'resolved')
        GROUP BY winning_tier
        ORDER BY COUNT(*) DESC
      ) t
    ),
    'costByTier', (
      SELECT COALESCE(jsonb_agg(row_to_json(t)), '[]'::jsonb) FROM (
        SELECT
          COALESCE(winning_tier, 'null_abandoned') AS tier,
          COUNT(*)::int AS n,
          ROUND(COALESCE(SUM(total_cost_usd), 0)::numeric, 4)::float AS total_usd,
          ROUND(COALESCE(AVG(total_cost_usd), 0)::numeric, 6)::float AS avg_per_scan_usd
        FROM public.scans
        WHERE created_at > since_ts
        GROUP BY winning_tier
        ORDER BY COALESCE(SUM(total_cost_usd), 0) DESC NULLS LAST
      ) t
    ),
    'latencyByTier', (
      SELECT COALESCE(jsonb_agg(row_to_json(t)), '[]'::jsonb) FROM (
        SELECT
          COALESCE(winning_tier, 'null_abandoned') AS tier,
          COUNT(*)::int AS n,
          percentile_cont(0.5)  WITHIN GROUP (ORDER BY total_latency_ms)::float AS p50_ms,
          percentile_cont(0.95) WITHIN GROUP (ORDER BY total_latency_ms)::float AS p95_ms,
          percentile_cont(0.99) WITHIN GROUP (ORDER BY total_latency_ms)::float AS p99_ms
        FROM public.scans
        WHERE created_at > since_ts
          AND total_latency_ms IS NOT NULL
        GROUP BY winning_tier
        ORDER BY COUNT(*) DESC
      ) t
    ),
    'qualityGateFails', (
      SELECT COALESCE(jsonb_agg(row_to_json(t)), '[]'::jsonb) FROM (
        SELECT
          COALESCE(quality_gate_fail_reason, 'null') AS reason,
          COUNT(*)::int AS n
        FROM public.scans
        WHERE created_at > since_ts
          AND quality_gate_passed IS FALSE
        GROUP BY quality_gate_fail_reason
        ORDER BY COUNT(*) DESC
      ) t
    ),
    'outcomeDistribution', (
      SELECT COALESCE(jsonb_agg(row_to_json(t)), '[]'::jsonb) FROM (
        SELECT
          outcome::text AS outcome,
          COUNT(*)::int AS n
        FROM public.scans
        WHERE created_at > since_ts
        GROUP BY outcome
        ORDER BY COUNT(*) DESC
      ) t
    ),
    'recentOverrides', (
      SELECT COALESCE(jsonb_agg(row_to_json(t)), '[]'::jsonb) FROM (
        SELECT
          s.created_at,
          s.winning_tier,
          s.game_id,
          s.capture_source,
          orig.name AS originally_matched,
          corr.name AS corrected_to,
          s.final_confidence
        FROM public.scans s
        LEFT JOIN public.cards orig ON orig.id = s.final_card_id
        LEFT JOIN public.cards corr ON corr.id = s.corrected_card_id
        WHERE s.created_at > since_ts
          AND s.user_overrode IS TRUE
        ORDER BY s.created_at DESC
        LIMIT 20
      ) t
    )
  ) INTO result;

  RETURN result;
END;
$$;

REVOKE ALL ON FUNCTION public.phase_2_telemetry(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.phase_2_telemetry(text) TO service_role;

COMMIT;
