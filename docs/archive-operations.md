# Archive Operations

Operational reference for the card-scanner R2 archive system. See
`docs/observation-schema-v1.md` for the canonical row schema.

## Architecture (one paragraph)

Two-tier storage. Hot data lives in Postgres (`ebay_listing_observations`,
`price_harvest_log`, `external_pricing_history`); cold data lives in
Cloudflare R2 (`tcg-archive` bucket). Daily QStash cron at 04:30 UTC
triggers `/api/cron/archive-to-r2`, which exports yesterday's rows from
each source table as gzipped JSONL to R2 and bumps `archive_watermark`
on success. Daily QStash cron at 04:00 UTC triggers
`/api/cron/daily-maintenance`, which deletes Postgres rows older than
`last_archived_date - safety_buffer_days` — gated on `is_archive_fresh()`
so a broken archive cron pauses pruning rather than risking data loss.

## Safety buffers

| Source table | Buffer days | Rationale |
|---|---|---|
| `ebay_listing_observations` | 7 | High volume, mostly transactional. Most reads target <7 days. |
| `price_harvest_log` | 7 | Operational/diagnostic data, rarely queried beyond last week. |
| `external_pricing_history` | 30 | Strategic sales-history asset; kept hot longer for ad-hoc analysis. |

Adjust buffers in the prune RPCs (`v_safety_buffer_days` constant).
Changing a buffer is a migration; ship it via standard PR workflow.

## Bucket layout

```
tcg-archive/
├─ card-scanner/                  (app prefix)
│  └─ YYYY/MM/DD/                 (Hive-partitioned by archive date)
│     ├─ ebay_listing_observations.jsonl.gz
│     ├─ price_harvest_log.jsonl.gz
│     └─ external_pricing_history.jsonl.gz
└─ thevault/                      (reserved, not yet writing)
```

Each archive file contains gzipped JSONL where every row has enrichment
fields (`app_id`, `source_table`, `archive_version`) prepended. See
`observation-schema-v1.md` for the canonical row shape.

## Cost protection

The archive cron checks bucket size before writing. If R2 is over 8 GB
(80% of free tier), the cron aborts with `archive.bucket_size_ceiling_exceeded`
in `app_events` and returns HTTP 503. Operator must intervene before
archive resumes.

R2 free tier: 10 GB storage, 1M Class A operations/month, 10M Class B,
zero egress. Current usage: ~36 MB. We are far from any free-tier limit.

## Manual operations

### Trigger an archive run manually

```bash
# Dry-run (no R2 writes, no watermark bump)
curl -X GET 'https://boba.cards/api/cron/archive-to-r2?dry=1' \
  -H "Authorization: Bearer $CRON_SECRET"

# Real run
curl -X GET 'https://boba.cards/api/cron/archive-to-r2' \
  -H "Authorization: Bearer $CRON_SECRET"
```

### Trigger a maintenance (prune) run manually

```bash
curl -X GET 'https://boba.cards/api/cron/daily-maintenance' \
  -H "Authorization: Bearer $CRON_SECRET"
```

### Inspect watermarks

```sql
SELECT app_id, source_table, last_archived_date, last_run_at,
       last_run_rows, last_run_bytes
FROM archive_watermark
ORDER BY source_table;
```

### Inspect an archive file

```bash
aws s3 cp s3://tcg-archive/card-scanner/2026/05/10/external_pricing_history.jsonl.gz . \
  --endpoint-url https://2ce502d6569639a4eb92093079340a98.r2.cloudflarestorage.com
gunzip external_pricing_history.jsonl.gz
head -1 external_pricing_history.jsonl | jq .
```

### Mine archive history with DuckDB

```sql
INSTALL httpfs;
LOAD httpfs;
SET s3_endpoint='2ce502d6569639a4eb92093079340a98.r2.cloudflarestorage.com';
SET s3_access_key_id='<key>';
SET s3_secret_access_key='<secret>';
SET s3_url_style='path';

-- Median price by source over time
SELECT
  DATE(observed_at) AS day,
  source,
  COUNT(*) AS n,
  PERCENTILE_CONT(price_value, 0.5) AS median
FROM read_json_auto(
  's3://tcg-archive/card-scanner/2026/*/*/ebay_listing_observations.jsonl.gz',
  hive_partitioning = 1
)
GROUP BY 1, 2 ORDER BY day DESC, source;
```

## Failure modes & recovery

### Archive cron silently failing

Symptom: `archive_watermark.last_run_at` not advancing.

Recovery:

1. Check Vercel runtime logs for the failure mode (auth, R2 SDK, DB query)
2. Check `app_events WHERE event_name LIKE 'archive.%'` for structured error
3. Fix the root cause, manually re-trigger via curl, verify watermarks advance

While archive is broken, daily-maintenance refuses to prune (correct behavior).
Postgres usage will grow until archive is restored.

### Watermark inconsistency

If `last_archived_date` is wrong (manual surgery, partial run, etc.),
fix via direct UPDATE. The archive cron is idempotent and will re-upload
days even if R2 already has them, so:

```sql
-- Force re-archive from some earlier date
UPDATE archive_watermark
SET last_archived_date = '2026-05-01'
WHERE app_id = 'card-scanner' AND source_table = 'ebay_listing_observations';
```

Then trigger the cron manually; it will catch up.

### Pruning ran when archive was broken

This shouldn't happen (`is_archive_fresh()` gates it) but if it does:
the archive should still have the deleted rows. Restore from R2 via
DuckDB → JSON → INSERT INTO.

## Verification history

Append entries here whenever a non-trivial verification or recovery happens.

### 2026-05-11 — Initial Phase 1 verification

- **What:** First end-to-end archive verification, full backlog catch-up
- **Result:** 347,518 rows, 35.66 MB written to R2, watermarks all advanced to 2026-05-10
- **Notable:** R2_ACCOUNT_ID was initially set to a URL; first attempt
  logged `getaddrinfo ENOTFOUND tcg-archive.https`. Fixed env var to
  bare 32-char hex string, re-deployed, re-fired QStash, clean.
- **Follow-up:** Added R2_ACCOUNT_ID format validation in `r2-client.ts`
  via Phase 2 (migration 069).

### 2026-05-11 — Phase 2 watermark-gated pruning landed

- **What:** Migration 069 applied, daily-maintenance rewired to use the
  three new gated RPCs (`prune_archived_observations`,
  `prune_archived_harvest_log`, `prune_archived_external_pricing_history`)
  with `is_archive_fresh()` predicate gating.
- **Trial-fire results** (watermark date 2026-05-10):
  - `ebay_listing_observations`: 93,547 rows deleted, safe_cutoff 2026-05-03
    (221,925 → 128,378)
  - `price_harvest_log`: 98,706 rows deleted, safe_cutoff 2026-05-03
    (122,913 → 24,207)
  - `external_pricing_history`: 0 rows deleted, safe_cutoff 2026-04-10
    (17,083 unchanged — table is too young for the 30-day buffer)
- **Disk usage:** Unchanged immediately (Postgres holds the bloat until
  VACUUM FULL). Plan a one-time VACUUM FULL on
  `ebay_listing_observations` and `price_harvest_log` after steady-state
  is confirmed.
- **R2 env validation:** Added `R2_ACCOUNT_ID_REGEX` check in
  `readR2Config()` so misconfiguration fails loud at config read instead
  of producing the cryptic `getaddrinfo` DNS error.
