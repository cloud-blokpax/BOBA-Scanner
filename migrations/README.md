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
| 4 | `004_add_new_scan_pipeline_flag.sql` | Register the `new_scan_pipeline` feature flag (Phase 0.3) so the new client-side scan-writer can be rolled out admin-first. |

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
