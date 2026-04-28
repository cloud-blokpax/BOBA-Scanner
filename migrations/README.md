# Migrations

Schema changes applied manually via the Supabase SQL Editor (no CLI, no
automated runner). Files in this directory are the canonical text of each
migration — check them in with the code change that depends on them.

## Current set: Wonders variant pricing structural seed

> **Migrations 1, 2, 3 (Wonders variant_harvest_seed) are superseded by
> migration 30.** The original structural seed concept assumed
> card-number prefixes encoded parallel: `A1-` = OCM, `P-` = FF, plain
> numeric = Paper+CF. They don't. `A1-` indicates "alternate art"
> series, `P-` indicates "promo" series — both ORTHOGONAL to the
> physical parallel treatment. Holding cards confirmed that ~99% of
> Wonders cards exist in five physical printings (Paper, Classic Foil,
> Formless Foil, Orbital Color Match, Stonefoil) sharing one collector
> number. Migration 30 expands the catalog 5x; migration 31 rewrites
> the RPC to no longer reference the dropped seed; migration 33 makes
> `(game_id, card_number, parallel)` uniqueness explicit. Migrations
> 1–3 stay on disk as historical record.

| # | File | Purpose |
|---|------|---------|
| 1 | `001_variant_harvest_seed.sql` | (Superseded by 30) Create `variant_harvest_seed` table and populate CF / FF / OCM rows from Wonders card collector-number patterns (~892 rows). |
| 2 | `002_get_harvest_candidates_rpc.sql` | (Superseded by 31) Replace the harvester RPC so it UNIONs the seed table and excludes paper for A1-/P- Wonders cards. |
| 3 | `003_cleanup_polluted_paper_rows.sql` | Delete the ~83 polluted `paper` rows in `price_cache` for A1-/P- Wonders cards. |
| 4 | `004_add_new_scan_pipeline_flag.sql` | Register the `new_scan_pipeline` feature flag (Phase 0.3). Flag row was DELETED in session 2.4 — migration kept in history for idempotent re-runs. |
| 5 | `005_upsert_hash_cache_v2.sql` | Source-aware hash_cache upsert RPC with `ON CONFLICT (phash) DO NOTHING`. Used by the harvester image piggyback and backfill. |
| 6 | `006_phase2_scan_telemetry.sql` | Session 2.1a. Add `live_consensus_reached`, `live_vs_canonical_agreed`, `fallback_tier_used` columns to `scans`. Applied via MCP pre-deploy. |
| 7 | `007_listing_templates_scan_id.sql` | Session 2.1a. Add `scan_id uuid REFERENCES scans(id) ON DELETE SET NULL` + partial index to `listing_templates`. |
| 8 | `008_binder_parent_scan_id.sql` | Session 2.2. Add `parent_scan_id` self-reference to `scans` + extend `capture_source` CHECK to include `binder_live_cell`. |
| 9 | `009_phase2_feature_flag_seeds.sql` | Session 2.1a / 2.1b / 2.2. Seed `live_ocr_tier1_v1`, `upload_tta_v1`, `binder_mode_v1` rows in `feature_flags`. |
| 10 | `010_retire_legacy_tier_results.sql` | Session 2.5 followup. Tag pre-2.5 `scan_tier_results` rows with retirement metadata in the `extras` jsonb column + create `scan_tier_results_live` filtering view. Column name corrected in session 2.8. |
| 11 | `011_sunset_legacy_flag_rows.sql` | Session 2.8. Drop `scan_pipeline_trace`, delete zombie `embedding_tier1` / `new_scan_pipeline` rows from `feature_flags` + `user_feature_overrides`, delete orphaned `system_settings.app_name` row. Captures the 2.4 + 2.6 post-deploy SQL that was MCP-only. |
| 12 | `012_phase_2_telemetry_rpc.sql` | Session 2.9. Aggregate read-only RPC `phase_2_telemetry(window_interval)` returning all admin dashboard sections as jsonb. Consumed by `/api/admin/phase-2-telemetry`. |
| 25 | `025_ebay_listing_observations.sql` | Per-listing observation table populated by the price-harvest cron. Stores every (listing × cycle) snapshot with the filter decision tagged. Admin-only RLS, 30-day retention. |
| 26 | `026_ebay_card_images.sql` | Image dedupe table keyed on `(card_id, ebay_item_id)`. One row per unique listing ever observed; `last_seen_at` + `observation_count` updated on re-observation. Authenticated users can read active rows. |
| 27 | `027_listing_observations_maintenance.sql` | `mark_stale_ebay_listings()` flips inactive after 7 days; `prune_old_observations()` deletes rows older than 30 days. Both called from `/api/cron/mark-stale-listings`. |
| 30 | `030_wonders_parallel_5x_expansion.sql` | Wonders catalog 5x expansion. Materializes Classic Foil / Formless Foil / Orbital Color Match / Stonefoil rows for every Paper card not on the per-set exception list. Drops the obsolete `variant_harvest_seed` table. Clears Wonders `price_cache` / `price_history` / `ebay_listing_observations` / `ebay_card_images` for re-harvest. Pre-launch only — assumes no user collections exist. |
| 31 | `031_get_harvest_candidates_no_seed.sql` | Replace migration 002's `get_harvest_candidates` RPC with one that no longer UNIONs the dropped seed table or `collections`/`listing_templates`. Output shape unchanged — consumer code in `$lib/server/harvester/candidates.ts` and `/api/cron/price-harvest` needs no edit. |
| 32 | `032_drop_wotf_cards.sql` | Drop unused `wotf_cards` table and `wonders_cards_full` view. Code reads orbital / dragon-points / card-class data from `cards.metadata` JSONB; both objects had no application consumers. `DROP IF EXISTS` makes this a no-op if either is already absent. |
| 33 | `033_cards_per_game_parallel_unique.sql` | Add `UNIQUE (game_id, card_number, parallel)` constraint on `cards`. Lets new-set imports use `ON CONFLICT DO NOTHING` and makes catalog-mirror lookups assert-safe. Run after 30. |

### Phase 2 deploy ordering (applied via Supabase MCP pre-deploy)

Migrations 6–9 were applied *before* their respective code deploys
(sessions 2.1a, 2.1a, 2.2, 2.1a/b/2.2) so the columns existed before the
writer referenced them. Migrations 10 and 11 were applied directly to prod
via MCP during sessions 2.4 / 2.5 / 2.6; a fresh branch applying
`/migrations/` in order lands them during bootstrap. On the shared prod DB
both are no-ops after the hand-apply.

### Deploy order

Run in numerical order. After Migration 1, verify the seed count is 892
(30 ocm + 53 ff + 809 cf). After Migration 2, dry-run the RPC with a fresh
`run_id` and confirm candidates include `cf`, `ff`, and `ocm`. Only then run
Migration 3.

Each file is a single atomic transaction and idempotent on re-run.

### Wonders 5x expansion (migrations 30–33)

Apply 30 → 31 → 32 → 33 in order via Supabase MCP. Order matters:

- **30 before 31** — 31 references `cards` rows that don't exist until 30
  expands the catalog, and 30 drops `variant_harvest_seed` which 31's
  RPC no longer needs to UNION.
- **30 before 33** — 33 adds a `UNIQUE (game_id, card_number, parallel)`
  constraint that would fail constraint creation if any partial 5x rows
  existed without 30 having run cleanly.
- **32 is a no-op** if `wotf_cards` and `wonders_cards_full` are already
  absent. Apply unconditionally on a fresh branch.

Pre-flight discovery (run BEFORE migration 30):

```sql
-- Confirm catalog state. Expected: single row, parallel='Paper', ~1,007.
SELECT parallel, count(*) FROM cards
WHERE game_id = 'wonders' GROUP BY parallel ORDER BY parallel;

-- Look for paper-only candidates. If a definitive list exists, paste
-- it into the wonders_paper_only_exceptions INSERT in migration 30.
SELECT card_number, name, metadata
FROM cards
WHERE game_id = 'wonders'
  AND (metadata->>'type_line' ILIKE '%token%'
       OR metadata->>'card_class' ILIKE '%token%'
       OR metadata->>'rarity' = 'token')
ORDER BY card_number;
```

Post-deploy verification (Phase 4 in the implementation doc):

```sql
-- Per-parallel counts. CF/FF/OCM/SF should each be paper_count - exceptions.
SELECT parallel, count(*) FROM cards
WHERE game_id = 'wonders' GROUP BY parallel ORDER BY parallel;

-- Drift check (should return 0/0 across both unions).
SELECT 'pc_drift', COUNT(*) FROM price_cache pc
  JOIN cards c ON c.id = pc.card_id
  WHERE c.game_id <> pc.game_id
UNION ALL
SELECT 'lt_drift', COUNT(*) FROM listing_templates lt
  JOIN cards c ON c.id = lt.card_id
  WHERE c.game_id <> lt.game_id;

-- variant_harvest_seed should be gone.
SELECT count(*) FROM information_schema.tables
WHERE table_schema='public' AND table_name='variant_harvest_seed';
```

### Rollback

- Migration 3 is not reversible — deleted price rows will be re-populated by
  the harvester under the correct variant within 2-3 days.
- Migration 2 can be reverted by restoring the previous RPC definition (see
  the `git log` for this file).
- Migration 1 is reverted with `DROP TABLE public.variant_harvest_seed;`.
- Migration 30 is not cleanly reversible — the new CF/FF/OCM/SF UUIDs would
  have to be enumerated and deleted, and the deleted price rows re-harvested.
  Don't roll back; fix forward.
- Migration 31 reverts to migration 002's RPC body (see git log) plus a
  fresh `CREATE TABLE variant_harvest_seed` if the seed is also being
  resurrected — but the seed concept is invalid, so this isn't recommended.
- Migration 32 reverts only if the dropped objects can be recreated from a
  schema backup; the JSONB metadata on `cards` is the source of truth.
- Migration 33 reverts with `ALTER TABLE cards DROP CONSTRAINT cards_game_card_parallel_unique;`.
