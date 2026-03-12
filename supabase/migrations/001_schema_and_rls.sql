-- ============================================================
-- BOBA Scanner — Schema Migration 001: New Tables + RLS
-- Adds cards, scans, price_cache, hash_cache tables.
-- Normalizes collections. Enables RLS on all tables.
-- ============================================================

-- ── Extensions ──────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ── Add auth_user_id to existing users table ────────────────
-- Bridge column linking custom users table to Supabase Auth
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS auth_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_users_auth_user_id ON users(auth_user_id);

-- ── Cards master table ──────────────────────────────────────
-- Canonical card database (seeded from card-database.json)
CREATE TABLE IF NOT EXISTS public.cards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  card_id_legacy INTEGER UNIQUE,      -- Original "Card ID" from JSON
  name TEXT NOT NULL,
  hero_name TEXT,                       -- BoBA hero name (same as name for hero cards)
  athlete_name TEXT,                    -- Real athlete mapping
  set_code TEXT NOT NULL,               -- "Alpha Edition", "Alpha Blast", etc.
  card_number TEXT,                     -- Card number (string, e.g., "BF-108", "76")
  year INTEGER,                         -- Release year
  parallel TEXT,                        -- Paper, Battlefoil, Blue Battlefoil, Play, etc.
  power INTEGER,                        -- BoBA power level
  rarity TEXT,                          -- common/uncommon/rare/ultra_rare/legendary
  weapon_type TEXT,                     -- Fire, Ice, Steel, Hex, Glow, etc.
  battle_zone TEXT,                     -- BoBA battle zone
  image_url TEXT,
  search_vector tsvector GENERATED ALWAYS AS (
    to_tsvector('english', coalesce(name, '') || ' ' ||
    coalesce(hero_name, '') || ' ' || coalesce(athlete_name, '') || ' ' ||
    coalesce(set_code, '') || ' ' || coalesce(card_number, ''))
  ) STORED,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ── Normalized collections ──────────────────────────────────
-- Replaces the single-JSONB-row pattern with proper normalized rows
CREATE TABLE IF NOT EXISTS public.collections_v2 (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  card_id UUID NOT NULL REFERENCES cards(id),
  quantity INTEGER DEFAULT 1,
  condition TEXT DEFAULT 'near_mint',
  notes TEXT,
  added_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, card_id, condition)
);

-- ── Scan history ────────────────────────────────────────────
-- Append-only log of all scan operations
CREATE TABLE IF NOT EXISTS public.scans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  card_id UUID REFERENCES cards(id),
  image_path TEXT,
  scan_method TEXT DEFAULT 'claude',   -- 'hash_cache', 'tesseract', 'claude'
  confidence FLOAT,
  processing_ms INTEGER,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ── Price cache ─────────────────────────────────────────────
-- Caches eBay price lookups to reduce API calls
CREATE TABLE IF NOT EXISTS public.price_cache (
  card_id UUID NOT NULL REFERENCES cards(id),
  source TEXT NOT NULL DEFAULT 'ebay',
  price_low DECIMAL(10,2),
  price_mid DECIMAL(10,2),
  price_high DECIMAL(10,2),
  listings_count INTEGER,
  fetched_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (card_id, source)
);

-- ── Perceptual hash cache ───────────────────────────────────
-- Maps image perceptual hashes to card IDs (shared across all users)
CREATE TABLE IF NOT EXISTS public.hash_cache (
  phash TEXT PRIMARY KEY,              -- 16-char hex perceptual hash
  card_id UUID NOT NULL REFERENCES cards(id),
  confidence FLOAT NOT NULL,
  scan_count INTEGER DEFAULT 1,
  last_seen TIMESTAMPTZ DEFAULT now()
);

-- ── Scan metrics ────────────────────────────────────────────
-- Custom monitoring table (free alternative to paid analytics)
CREATE TABLE IF NOT EXISTS public.scan_metrics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scan_method TEXT NOT NULL,           -- 'hash_cache', 'tesseract', 'claude'
  processing_time_ms INTEGER,
  confidence FLOAT,
  cache_hit BOOLEAN DEFAULT false,
  cache_layer TEXT,                    -- 'idb', 'redis', 'supabase', null
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================================
-- Row Level Security (RLS) — Enable on ALL tables
-- ============================================================

-- ── Cards: read-only for authenticated users ────────────────
ALTER TABLE cards ENABLE ROW LEVEL SECURITY;

CREATE POLICY "cards_select_authenticated" ON cards
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "cards_manage_service" ON cards
  FOR ALL TO service_role USING (true);

-- ── Collections v2: users own their collections ─────────────
ALTER TABLE collections_v2 ENABLE ROW LEVEL SECURITY;

CREATE POLICY "collections_v2_own" ON collections_v2
  FOR ALL TO authenticated
  USING ((select auth.uid()) = user_id)
  WITH CHECK ((select auth.uid()) = user_id);

-- ── Scans: users see their own scans ────────────────────────
ALTER TABLE scans ENABLE ROW LEVEL SECURITY;

CREATE POLICY "scans_own" ON scans
  FOR ALL TO authenticated
  USING ((select auth.uid()) = user_id)
  WITH CHECK ((select auth.uid()) = user_id);

-- ── Price cache: read by all, managed by service role ───────
ALTER TABLE price_cache ENABLE ROW LEVEL SECURITY;

CREATE POLICY "prices_select_authenticated" ON price_cache
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "prices_manage_service" ON price_cache
  FOR ALL TO service_role USING (true);

-- ── Hash cache: read by all, managed by service role ────────
ALTER TABLE hash_cache ENABLE ROW LEVEL SECURITY;

CREATE POLICY "hash_select_authenticated" ON hash_cache
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "hash_manage_service" ON hash_cache
  FOR ALL TO service_role USING (true);

-- ── Scan metrics: insert by authenticated, read by service ──
ALTER TABLE scan_metrics ENABLE ROW LEVEL SECURITY;

CREATE POLICY "metrics_insert_authenticated" ON scan_metrics
  FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "metrics_manage_service" ON scan_metrics
  FOR ALL TO service_role USING (true);

-- ── Existing tables: enable RLS ─────────────────────────────
-- Users table: users can read their own row, service manages
ALTER TABLE users ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users_select_own" ON users
  FOR SELECT TO authenticated
  USING ((select auth.uid()) = auth_user_id);

CREATE POLICY "users_update_own" ON users
  FOR UPDATE TO authenticated
  USING ((select auth.uid()) = auth_user_id)
  WITH CHECK ((select auth.uid()) = auth_user_id);

CREATE POLICY "users_manage_service" ON users
  FOR ALL TO service_role USING (true);

-- System settings: readable by all authenticated
ALTER TABLE system_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "settings_select_authenticated" ON system_settings
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "settings_manage_service" ON system_settings
  FOR ALL TO service_role USING (true);

-- Feature flags: readable by all authenticated
ALTER TABLE feature_flags ENABLE ROW LEVEL SECURITY;

CREATE POLICY "flags_select_authenticated" ON feature_flags
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "flags_manage_service" ON feature_flags
  FOR ALL TO service_role USING (true);

-- User feature overrides: users see their own
ALTER TABLE user_feature_overrides ENABLE ROW LEVEL SECURITY;

CREATE POLICY "overrides_select_own" ON user_feature_overrides
  FOR SELECT TO authenticated
  USING (user_id IN (SELECT id FROM users WHERE auth_user_id = (select auth.uid())));

CREATE POLICY "overrides_manage_service" ON user_feature_overrides
  FOR ALL TO service_role USING (true);

-- Themes: public themes readable by all
ALTER TABLE themes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "themes_select_public" ON themes
  FOR SELECT TO authenticated USING (is_public = true);

CREATE POLICY "themes_manage_service" ON themes
  FOR ALL TO service_role USING (true);

-- Existing collections (JSONB): users see their own via user_id
ALTER TABLE collections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "collections_legacy_own" ON collections
  FOR ALL TO authenticated
  USING (user_id IN (SELECT id FROM users WHERE auth_user_id = (select auth.uid())))
  WITH CHECK (user_id IN (SELECT id FROM users WHERE auth_user_id = (select auth.uid())));

CREATE POLICY "collections_legacy_service" ON collections
  FOR ALL TO service_role USING (true);

-- Tournaments: readable by all, managed by creator
ALTER TABLE tournaments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tournaments_select_all" ON tournaments
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "tournaments_manage_creator" ON tournaments
  FOR ALL TO authenticated
  USING (creator_id IN (SELECT id FROM users WHERE auth_user_id = (select auth.uid())));

CREATE POLICY "tournaments_manage_service" ON tournaments
  FOR ALL TO service_role USING (true);

-- API call logs: users see their own
ALTER TABLE api_call_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "logs_select_own" ON api_call_logs
  FOR SELECT TO authenticated
  USING (user_id IN (SELECT id FROM users WHERE auth_user_id = (select auth.uid())));

CREATE POLICY "logs_insert_authenticated" ON api_call_logs
  FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "logs_manage_service" ON api_call_logs
  FOR ALL TO service_role USING (true);

-- Admin templates: readable by assigned users
ALTER TABLE admin_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "templates_select_authenticated" ON admin_templates
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "templates_manage_service" ON admin_templates
  FOR ALL TO service_role USING (true);

-- User admin template assignments
ALTER TABLE user_admin_template_assignments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "assignments_select_own" ON user_admin_template_assignments
  FOR SELECT TO authenticated
  USING (user_id IN (SELECT id FROM users WHERE auth_user_id = (select auth.uid())));

CREATE POLICY "assignments_manage_service" ON user_admin_template_assignments
  FOR ALL TO service_role USING (true);

-- System stats: readable by admins via service role only
ALTER TABLE system_stats ENABLE ROW LEVEL SECURITY;

CREATE POLICY "stats_manage_service" ON system_stats
  FOR ALL TO service_role USING (true);

-- Admin actions audit log
ALTER TABLE admin_actions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin_actions_service" ON admin_actions
  FOR ALL TO service_role USING (true);

-- ── Prevent Supabase project pausing ────────────────────────
-- Run a lightweight query every 6 days
-- Note: pg_cron may need to be enabled in Supabase dashboard first
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.schedule('keep-alive', '0 0 */6 * *', 'SELECT 1');
  END IF;
END
$$;
