-- ============================================================
-- BOBA Scanner — Schema Migration 002: Performance Indexes
-- ============================================================

-- ── Cards indexes ───────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_cards_search ON cards USING GIN(search_vector);
CREATE INDEX IF NOT EXISTS idx_cards_name_trgm ON cards USING GIN(name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_cards_hero_trgm ON cards USING GIN(hero_name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_cards_set_code ON cards(set_code);
CREATE INDEX IF NOT EXISTS idx_cards_power ON cards(power);
CREATE INDEX IF NOT EXISTS idx_cards_card_number ON cards(card_number);
CREATE INDEX IF NOT EXISTS idx_cards_year ON cards(year);
CREATE INDEX IF NOT EXISTS idx_cards_parallel ON cards(parallel);

-- ── Collections v2 indexes ──────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_collections_v2_user ON collections_v2(user_id);
CREATE INDEX IF NOT EXISTS idx_collections_v2_card ON collections_v2(card_id);

-- ── Scans indexes ───────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_scans_user_date ON scans(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_scans_card ON scans(card_id);
CREATE INDEX IF NOT EXISTS idx_scans_method ON scans(scan_method);

-- ── Price cache indexes ─────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_prices_freshness ON price_cache(fetched_at);

-- ── Hash cache indexes ──────────────────────────────────────
-- phash is already the PK (B-tree), no additional index needed

-- ── Scan metrics indexes ────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_metrics_created ON scan_metrics(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_metrics_method ON scan_metrics(scan_method);
