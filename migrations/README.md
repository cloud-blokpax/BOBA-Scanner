# Migrations

Schema changes applied manually via the Supabase SQL Editor (no CLI, no
automated runner). Files in this directory are the canonical text of each
migration — check them in with the code change that depends on them.

## Current set: Wonders variant pricing structural seed

| # | File | Purpose |
|---|------|---------|
| 1 | `001_variant_harvest_seed.sql` | Create `variant_harvest_seed` table and populate CF / FF / OCM rows from Wonders card collector-number patterns (~892 rows). |
| 2 | `002_get_harvest_candidates_rpc.sql` | Replace the harvester RPC so it UNIONs the seed table and excludes paper for A1-/P- Wonders cards. |
| 3 | `003_cleanup_polluted_paper_rows.sql` | Delete the ~83 polluted `paper` rows in `price_cache` for A1-/P- Wonders cards. |
| 4 | `004_add_new_scan_pipeline_flag.sql` | Register the `new_scan_pipeline` feature flag (Phase 0.3). Flag row was DELETED in session 2.4 — migration kept in history for idempotent re-runs. |
| 5 | `005_upsert_hash_cache_v2.sql` | Source-aware hash_cache upsert RPC with `ON CONFLICT (phash) DO NOTHING`. Used by the harvester image piggyback and backfill. |
| 6 | `006_phase2_scan_telemetry.sql` | Session 2.1a. Add `live_consensus_reached`, `live_vs_canonical_agreed`, `fallback_tier_used` columns to `scans`. Applied via MCP pre-deploy. |
| 7 | `007_listing_templates_scan_id.sql` | Session 2.1a. Add `scan_id uuid REFERENCES scans(id) ON DELETE SET NULL` + partial index to `listing_templates`. |
| 8 | `008_binder_parent_scan_id.sql` | Session 2.2. Add `parent_scan_id` self-reference to `scans` + extend `capture_source` CHECK to include `binder_live_cell`. |
| 9 | `009_phase2_feature_flag_seeds.sql` | Session 2.1a / 2.1b / 2.2. Seed `live_ocr_tier1_v1`, `upload_tta_v1`, `binder_mode_v1` rows in `feature_flags`. |
| 10 | `010_retire_legacy_tier_results.sql` | Session 2.5 followup. Tag pre-2.5 `scan_tier_results` rows with retirement metadata + create `scan_tier_results_live` filtering view. |

### Phase 2 deploy ordering (applied via Supabase MCP pre-deploy)

Migrations 6–9 were applied *before* their respective code deploys
(sessions 2.1a, 2.1a, 2.2, 2.1a/b/2.2) so the columns existed before the
writer referenced them. Migration 10 was spec'd in 2.5 but not executed
there; a fresh branch applying `/migrations/` in order lands it during
bootstrap. On the shared prod DB it's a no-op after the hand-apply.

### Deploy order

Run in numerical order. After Migration 1, verify the seed count is 892
(30 ocm + 53 ff + 809 cf). After Migration 2, dry-run the RPC with a fresh
`run_id` and confirm candidates include `cf`, `ff`, and `ocm`. Only then run
Migration 3.

Each file is a single atomic transaction and idempotent on re-run.

### Rollback

- Migration 3 is not reversible — deleted price rows will be re-populated by
  the harvester under the correct variant within 2-3 days.
- Migration 2 can be reverted by restoring the previous RPC definition (see
  the `git log` for this file).
- Migration 1 is reverted with `DROP TABLE public.variant_harvest_seed;`.
