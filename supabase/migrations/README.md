# Supabase Migrations

## Canonical Schema

`supabase-full-setup.sql` is the canonical, idempotent schema definition.
Run it in the Supabase SQL Editor for fresh database setup. It is safe to
re-run — all statements use IF NOT EXISTS and ON CONFLICT DO NOTHING.

## Incremental Migrations (Historical)

The following files are incremental changes that have already been applied
to production. They are retained as historical documentation. Do NOT run
them independently — their content is incorporated into `supabase-full-setup.sql`.

- `add-fuzzy-hash-lookup.sql` — find_similar_hash RPC for Tier 1 fuzzy matching
- `add-upsert-hash-cache-rpc.sql` — Atomic hash cache upsert with scan_count increment
- `add-community-corrections.sql` — Community OCR correction sharing (3-confirmation threshold)
- `add-card-reference-images.sql` — Gamified reference image competition
- `add-user-decks.sql` — Multi-deck storage with format configuration
- `add-ebay-seller-tokens-rls.sql` — RLS lockdown on sensitive seller OAuth tokens
- `add-cards-updated-at.sql` — Incremental card database sync support
- `add-is-member-column.sql` — Premium membership flag for monetization
- `add-tournament-registrations.sql` — Tournament registration with deck CSV
- `add-increment-tournament-usage-rpc.sql` — Atomic tournament usage counter
- `enable-rls-legacy-tables.sql` — RLS enabled on all pre-migration tables
- `fix-community-corrections-rls.sql` — SECURITY DEFINER fix for correction RPCs

## Deleted

- `supabase-schema.sql` — Original legacy-only schema. Fully superseded by
  `supabase-full-setup.sql`. Deleted in Phase 2 hardening.
