# Phase 2 Pipeline Telemetry — SQL Reference

Canonical read queries for the Phase 2 scan pipeline. Used by the
`/api/admin/phase-2-telemetry` endpoint and the `AdminPhase2Tab`
component, and copy-pasteable for ad hoc drill-down via Supabase MCP
or the SQL Editor.

All queries read from `public.scans`. None write.

## Columns this doc relies on

| Column                      | Type    | Written by                                      |
|----------------------------|---------|------------------------------------------------|
| `winning_tier`             | text    | scan-writer, set on outcome finalize           |
| `live_consensus_reached`   | boolean | live OCR coordinator (camera_live only)        |
| `live_vs_canonical_agreed` | boolean | compared post-shutter in canonical resolution  |
| `fallback_tier_used`       | text    | `'none' \| 'haiku' \| 'sonnet' \| 'manual'`    |
| `capture_source`           | text    | scan-writer at scan open                       |
| `game_id`                  | text    | `'boba' \| 'wonders'` (default `'boba'`)       |
| `outcome`                  | enum    | scan_outcome; terminal states resolve/confirm  |
| `user_overrode`            | boolean | TRUE if user corrected the winning card        |
| `corrected_card_id`        | uuid    | what they corrected to                         |
| `total_latency_ms`         | integer | end-to-end from open to finalize               |
| `total_cost_usd`           | numeric | sum of per-tier costs                          |

`winning_tier` values in the current codebase (see `winningTierFromResult`
in `src/lib/services/recognition.ts`):

- `tier1_local_ocr` — Phase 2 canonical PaddleOCR win
- `tier1_upload_tta` — Phase 2 upload TTA fallback win
- `tier1_hash` — pre-2.5 legacy (shouldn't appear on new scans)
- `tier2_ocr` — pre-2.5 Tesseract (shouldn't appear on new scans)
- `tier3_claude` — Haiku fallback
- `manual` — user manual search
- `NULL` — scan abandoned before finalize (outcome `pending`/`abandoned`)

---

## Headline pipeline mix — last 7 days

Overall tier distribution. The healthy post-flag-flip state is
`tier1_local_ocr` dominant (ideally >70%), `tier3_claude` residual
(<15%), everything else in the long tail.

```sql
SELECT
  COALESCE(winning_tier, 'null_abandoned') AS tier,
  COUNT(*) AS n,
  ROUND(100.0 * COUNT(*) / SUM(COUNT(*)) OVER (), 1) AS pct
FROM public.scans
WHERE created_at > NOW() - INTERVAL '7 days'
GROUP BY winning_tier
ORDER BY n DESC;
```

## Pipeline mix by game × capture_source

Slices the headline number by the two persona-relevant axes. BoBA
camera_live should look different from Wonders binder_live_cell.

```sql
SELECT
  game_id,
  COALESCE(capture_source, 'null') AS capture_source,
  COALESCE(winning_tier, 'null_abandoned') AS tier,
  COUNT(*) AS n
FROM public.scans
WHERE created_at > NOW() - INTERVAL '7 days'
GROUP BY game_id, capture_source, winning_tier
ORDER BY game_id, capture_source, n DESC;
```

## Gating signal 1 — OCR region tuning

`live_vs_canonical_agreed = TRUE` rate among scans where live consensus
was reached. Only meaningful on `capture_source = 'camera_live'` since
that's the only source that runs live OCR at all.

**Threshold:** <90% agreed over a week = tune coords in
`src/lib/services/ocr-regions.ts`.

```sql
SELECT
  game_id,
  COUNT(*) FILTER (WHERE live_consensus_reached IS TRUE) AS n_live_reached,
  COUNT(*) FILTER (WHERE live_consensus_reached IS TRUE
                   AND live_vs_canonical_agreed IS TRUE) AS n_agreed,
  CASE
    WHEN COUNT(*) FILTER (WHERE live_consensus_reached IS TRUE) > 0 THEN
      ROUND(100.0
            * COUNT(*) FILTER (WHERE live_consensus_reached IS TRUE
                               AND live_vs_canonical_agreed IS TRUE)
            / COUNT(*) FILTER (WHERE live_consensus_reached IS TRUE), 1)
  END AS agreed_pct
FROM public.scans
WHERE created_at > NOW() - INTERVAL '7 days'
  AND capture_source = 'camera_live'
GROUP BY game_id;
```

## Gating signal 2 — Binder per-cell TTA

Haiku fallback rate among binder cells. The whole point of binder mode
is bulk throughput without per-card cost; if cells are routinely
falling to Haiku, the persona cost model is broken.

**Threshold:** >25% haiku fallback = build per-cell TTA (roadmap 2.2.1).

```sql
SELECT
  COUNT(*) AS n_binder_cells,
  COUNT(*) FILTER (WHERE fallback_tier_used = 'haiku') AS n_haiku,
  COUNT(*) FILTER (WHERE winning_tier LIKE 'tier1%') AS n_tier1,
  CASE WHEN COUNT(*) > 0 THEN
    ROUND(100.0 * COUNT(*) FILTER (WHERE fallback_tier_used = 'haiku')
                / COUNT(*), 1)
  END AS haiku_pct
FROM public.scans
WHERE created_at > NOW() - INTERVAL '7 days'
  AND capture_source = 'binder_live_cell';
```

## Gating signal 3 — User override rate by tier

"Confidently wrong" detector. If `tier1_local_ocr` scans get overridden
at a high rate, the confidence gate is too loose. If `tier3_claude`
scans get overridden a lot, Haiku is hallucinating cards.

**Threshold:** override rate by tier — healthy is <5% for any tier.

```sql
SELECT
  COALESCE(winning_tier, 'null_abandoned') AS tier,
  COUNT(*) AS n,
  COUNT(*) FILTER (WHERE user_overrode IS TRUE) AS n_overridden,
  CASE WHEN COUNT(*) > 0 THEN
    ROUND(100.0 * COUNT(*) FILTER (WHERE user_overrode IS TRUE)
                / COUNT(*), 1)
  END AS override_pct
FROM public.scans
WHERE created_at > NOW() - INTERVAL '7 days'
  AND outcome IN ('auto_confirmed', 'user_confirmed',
                  'user_corrected', 'resolved')
GROUP BY winning_tier
ORDER BY n DESC;
```

## Cost by tier

```sql
SELECT
  COALESCE(winning_tier, 'null_abandoned') AS tier,
  COUNT(*) AS n,
  ROUND(COALESCE(SUM(total_cost_usd), 0)::numeric, 4) AS total_usd,
  ROUND(COALESCE(AVG(total_cost_usd), 0)::numeric, 6) AS avg_per_scan_usd
FROM public.scans
WHERE created_at > NOW() - INTERVAL '7 days'
GROUP BY winning_tier
ORDER BY total_usd DESC NULLS LAST;
```

## Latency by tier (p50 / p95 / p99)

```sql
SELECT
  COALESCE(winning_tier, 'null_abandoned') AS tier,
  COUNT(*) AS n,
  percentile_cont(0.5)  WITHIN GROUP (ORDER BY total_latency_ms) AS p50_ms,
  percentile_cont(0.95) WITHIN GROUP (ORDER BY total_latency_ms) AS p95_ms,
  percentile_cont(0.99) WITHIN GROUP (ORDER BY total_latency_ms) AS p99_ms
FROM public.scans
WHERE created_at > NOW() - INTERVAL '7 days'
  AND total_latency_ms IS NOT NULL
GROUP BY winning_tier
ORDER BY n DESC;
```

## Quality gate fail reasons

Which upstream photo problems are blocking scans before they hit any
tier? Shape of the tail here informs whether user-facing guidance
(e.g. "too blurry, try again") is well targeted.

```sql
SELECT
  COALESCE(quality_gate_fail_reason, 'null') AS reason,
  COUNT(*) AS n
FROM public.scans
WHERE created_at > NOW() - INTERVAL '7 days'
  AND quality_gate_passed IS FALSE
GROUP BY quality_gate_fail_reason
ORDER BY n DESC;
```

## Outcome distribution

```sql
SELECT
  outcome,
  COUNT(*) AS n
FROM public.scans
WHERE created_at > NOW() - INTERVAL '7 days'
GROUP BY outcome
ORDER BY n DESC;
```

## Recent user overrides — drill-down

Raw rows, not aggregated. Use this to eyeball which cards are getting
corrected to which — often reveals OCR confusables (`Stongboy` vs
`Strongboy`, `Cruze Control` vs `Cruze-Control`) or catalog typos.

```sql
SELECT
  s.created_at,
  s.winning_tier,
  s.game_id,
  s.capture_source,
  s.final_card_id,
  orig.name AS originally_matched,
  s.corrected_card_id,
  corr.name AS corrected_to,
  s.final_confidence
FROM public.scans s
LEFT JOIN public.cards orig ON orig.id = s.final_card_id
LEFT JOIN public.cards corr ON corr.id = s.corrected_card_id
WHERE s.created_at > NOW() - INTERVAL '7 days'
  AND s.user_overrode IS TRUE
ORDER BY s.created_at DESC
LIMIT 20;
```

## Notes on window parameters

The dashboard component supports toggling the window among `24h`,
`7d`, `30d`. Replace `NOW() - INTERVAL '7 days'` with one of:

- `NOW() - INTERVAL '24 hours'`
- `NOW() - INTERVAL '7 days'`
- `NOW() - INTERVAL '30 days'`

Do not accept arbitrary window strings from the client. The endpoint
maps an allow-listed key (`'24h' | '7d' | '30d'`) to a fixed SQL
literal.
