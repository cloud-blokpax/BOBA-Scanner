-- ============================================================
-- BOBA Scanner — Full Supabase Setup (Idempotent)
-- Run this entire script in Supabase SQL Editor.
-- Safe to re-run: uses IF NOT EXISTS, ON CONFLICT DO NOTHING,
-- and DROP POLICY IF EXISTS throughout.
-- ============================================================

-- ── Extensions ──────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ============================================================
-- 1. BASE TABLES (legacy app)
-- ============================================================

-- ── users ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.users (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  google_id       TEXT UNIQUE NOT NULL,
  email           TEXT NOT NULL,
  name            TEXT,
  picture         TEXT,
  card_limit      INT DEFAULT 25,
  api_calls_limit INT DEFAULT 50,
  api_calls_used  INT DEFAULT 0,
  cards_in_collection INT DEFAULT 0,
  is_admin        BOOLEAN DEFAULT false,
  is_member       BOOLEAN DEFAULT false,
  member_until    TIMESTAMPTZ,
  last_reset_date DATE,
  active_theme_id UUID,
  custom_theme    JSONB,
  discord_id      TEXT,
  created_at      TIMESTAMPTZ DEFAULT now()
);

-- Bridge column linking custom users table to Supabase Auth
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS auth_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_users_auth_user_id ON users(auth_user_id);

-- ── system_settings ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.system_settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

INSERT INTO system_settings (key, value) VALUES
  ('guest_max_cards',  '5'),
  ('guest_max_api',    '1'),
  ('auth_max_cards',   '25'),
  ('auth_max_api',     '50'),
  ('member_max_cards', '250'),
  ('member_max_api',   '250')
ON CONFLICT (key) DO NOTHING;

-- ── api_call_logs ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.api_call_logs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID REFERENCES users(id) ON DELETE SET NULL,
  call_type       TEXT NOT NULL,
  success         BOOLEAN DEFAULT true,
  cost            NUMERIC(10,6) DEFAULT 0,
  cards_processed INT DEFAULT 0,
  error_message   TEXT,
  created_at      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_api_logs_user    ON api_call_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_api_logs_created ON api_call_logs(created_at);

-- ── feature_flags ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.feature_flags (
  feature_key              TEXT PRIMARY KEY,
  display_name             TEXT NOT NULL,
  description              TEXT,
  enabled_globally         BOOLEAN DEFAULT false,
  enabled_for_guest        BOOLEAN DEFAULT false,
  enabled_for_authenticated BOOLEAN DEFAULT false,
  enabled_for_member       BOOLEAN DEFAULT true,
  enabled_for_admin        BOOLEAN DEFAULT true,
  updated_at               TIMESTAMPTZ DEFAULT now()
);

-- ── user_feature_overrides ──────────────────────────────────
CREATE TABLE IF NOT EXISTS public.user_feature_overrides (
  user_id     UUID REFERENCES users(id) ON DELETE CASCADE,
  feature_key TEXT NOT NULL,
  enabled     BOOLEAN NOT NULL,
  PRIMARY KEY (user_id, feature_key)
);

-- ── themes ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.themes (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  description TEXT,
  config      JSONB NOT NULL DEFAULT '{}',
  is_public   BOOLEAN DEFAULT false,
  created_by  UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ DEFAULT now()
);

-- ── collections (legacy JSONB pattern) ──────────────────────
CREATE TABLE IF NOT EXISTS public.collections (
  user_id         UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  data            JSONB DEFAULT '[]',
  deleted_cards   JSONB DEFAULT '[]',
  user_tags       JSONB DEFAULT '[]',
  export_templates JSONB DEFAULT '[]',
  updated_at      TIMESTAMPTZ DEFAULT now()
);

-- ── tournaments ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.tournaments (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_id  UUID REFERENCES users(id) NOT NULL,
  code        TEXT UNIQUE NOT NULL,
  name        TEXT NOT NULL,
  max_heroes  INT DEFAULT 0,
  max_plays   INT DEFAULT 30,
  max_bonus   INT DEFAULT 15,
  usage_count INT DEFAULT 0,
  is_active   BOOLEAN DEFAULT true,
  created_at  TIMESTAMPTZ DEFAULT now()
);

-- ── admin_templates ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.admin_templates (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  fields      JSONB NOT NULL DEFAULT '[]',
  description TEXT,
  created_by  UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ DEFAULT now()
);

-- ── user_admin_template_assignments ─────────────────────────
CREATE TABLE IF NOT EXISTS public.user_admin_template_assignments (
  user_id           UUID REFERENCES users(id) ON DELETE CASCADE,
  admin_template_id UUID REFERENCES admin_templates(id) ON DELETE CASCADE,
  assigned_by       UUID REFERENCES users(id) ON DELETE SET NULL,
  PRIMARY KEY (user_id, admin_template_id)
);

-- ── system_stats ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.system_stats (
  date             DATE PRIMARY KEY,
  total_users      INT DEFAULT 0,
  active_users     INT DEFAULT 0,
  total_api_calls  INT DEFAULT 0,
  total_cost       NUMERIC(10,4) DEFAULT 0
);

-- ── admin_actions ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.admin_actions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id        UUID REFERENCES users(id) ON DELETE SET NULL,
  action_type     TEXT NOT NULL,
  target_user_id  UUID REFERENCES users(id) ON DELETE SET NULL,
  old_value       TEXT,
  new_value       TEXT,
  created_at      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_admin_actions_created ON admin_actions(created_at);

-- ============================================================
-- 2. NEW TABLES (SvelteKit migration)
-- ============================================================

-- ── cards (master card database) ────────────────────────────
CREATE TABLE IF NOT EXISTS public.cards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  card_id_legacy INTEGER UNIQUE,
  name TEXT NOT NULL,
  hero_name TEXT,
  athlete_name TEXT,
  set_code TEXT NOT NULL,
  card_number TEXT,
  year INTEGER,
  parallel TEXT,
  power INTEGER,
  rarity TEXT,
  weapon_type TEXT,
  battle_zone TEXT,
  image_url TEXT,
  search_vector tsvector GENERATED ALWAYS AS (
    to_tsvector('english', coalesce(name, '') || ' ' ||
    coalesce(hero_name, '') || ' ' || coalesce(athlete_name, '') || ' ' ||
    coalesce(set_code, '') || ' ' || coalesce(card_number, ''))
  ) STORED,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ── collections_v2 (normalized) ─────────────────────────────
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

-- ── scans ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.scans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  card_id UUID REFERENCES cards(id),
  image_path TEXT,
  scan_method TEXT DEFAULT 'claude',
  confidence FLOAT,
  processing_ms INTEGER,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ── price_cache ─────────────────────────────────────────────
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

-- ── hash_cache (perceptual hash -> card mapping) ────────────
CREATE TABLE IF NOT EXISTS public.hash_cache (
  phash TEXT PRIMARY KEY,
  card_id UUID NOT NULL REFERENCES cards(id),
  confidence FLOAT NOT NULL,
  scan_count INTEGER DEFAULT 1,
  last_seen TIMESTAMPTZ DEFAULT now()
);

-- ── scan_metrics ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.scan_metrics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scan_method TEXT NOT NULL,
  processing_time_ms INTEGER,
  confidence FLOAT,
  cache_hit BOOLEAN DEFAULT false,
  cache_layer TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================================
-- 3. INDEXES
-- ============================================================

-- Cards indexes
CREATE INDEX IF NOT EXISTS idx_cards_search ON cards USING GIN(search_vector);
CREATE INDEX IF NOT EXISTS idx_cards_name_trgm ON cards USING GIN(name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_cards_hero_trgm ON cards USING GIN(hero_name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_cards_set_code ON cards(set_code);
CREATE INDEX IF NOT EXISTS idx_cards_power ON cards(power);
CREATE INDEX IF NOT EXISTS idx_cards_card_number ON cards(card_number);
CREATE INDEX IF NOT EXISTS idx_cards_year ON cards(year);
CREATE INDEX IF NOT EXISTS idx_cards_parallel ON cards(parallel);

-- Collections v2 indexes
CREATE INDEX IF NOT EXISTS idx_collections_v2_user ON collections_v2(user_id);
CREATE INDEX IF NOT EXISTS idx_collections_v2_card ON collections_v2(card_id);

-- Scans indexes
CREATE INDEX IF NOT EXISTS idx_scans_user_date ON scans(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_scans_card ON scans(card_id);
CREATE INDEX IF NOT EXISTS idx_scans_method ON scans(scan_method);

-- Price cache indexes
CREATE INDEX IF NOT EXISTS idx_prices_freshness ON price_cache(fetched_at);

-- Scan metrics indexes
CREATE INDEX IF NOT EXISTS idx_metrics_created ON scan_metrics(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_metrics_method ON scan_metrics(scan_method);

-- ============================================================
-- 4. ROW LEVEL SECURITY
-- ============================================================
-- The app uses a hybrid auth approach:
--   - SvelteKit routes use Supabase Auth (auth.uid() works)
--   - Legacy vanilla JS uses Google OAuth directly (no auth.uid())
--
-- For new tables (cards, collections_v2, scans, etc.) we enable
-- RLS with auth.uid() policies for the SvelteKit layer.
--
-- For legacy tables (users, collections, etc.) we disable RLS
-- since the vanilla JS client uses the anon key without Supabase Auth.
-- ============================================================

-- ── Drop ALL existing policies (safe re-run) ────────────────
DO $$ BEGIN
  -- Legacy policies
  DROP POLICY IF EXISTS users_select_own ON users;
  DROP POLICY IF EXISTS users_insert_self ON users;
  DROP POLICY IF EXISTS users_update_own ON users;
  DROP POLICY IF EXISTS users_manage_service ON users;
  DROP POLICY IF EXISTS settings_select ON system_settings;
  DROP POLICY IF EXISTS settings_upsert ON system_settings;
  DROP POLICY IF EXISTS settings_select_authenticated ON system_settings;
  DROP POLICY IF EXISTS settings_manage_service ON system_settings;
  DROP POLICY IF EXISTS logs_insert_own ON api_call_logs;
  DROP POLICY IF EXISTS logs_select_admin ON api_call_logs;
  DROP POLICY IF EXISTS logs_select_own ON api_call_logs;
  DROP POLICY IF EXISTS logs_insert_authenticated ON api_call_logs;
  DROP POLICY IF EXISTS logs_manage_service ON api_call_logs;
  DROP POLICY IF EXISTS flags_select ON feature_flags;
  DROP POLICY IF EXISTS flags_modify_admin ON feature_flags;
  DROP POLICY IF EXISTS flags_select_authenticated ON feature_flags;
  DROP POLICY IF EXISTS flags_manage_service ON feature_flags;
  DROP POLICY IF EXISTS overrides_select_own ON user_feature_overrides;
  DROP POLICY IF EXISTS overrides_modify_admin ON user_feature_overrides;
  DROP POLICY IF EXISTS overrides_manage_service ON user_feature_overrides;
  DROP POLICY IF EXISTS themes_select_public ON themes;
  DROP POLICY IF EXISTS themes_modify_admin ON themes;
  DROP POLICY IF EXISTS themes_manage_service ON themes;
  DROP POLICY IF EXISTS collections_own ON collections;
  DROP POLICY IF EXISTS collections_legacy_own ON collections;
  DROP POLICY IF EXISTS collections_legacy_service ON collections;
  DROP POLICY IF EXISTS tournaments_select ON tournaments;
  DROP POLICY IF EXISTS tournaments_insert ON tournaments;
  DROP POLICY IF EXISTS tournaments_update ON tournaments;
  DROP POLICY IF EXISTS tournaments_select_all ON tournaments;
  DROP POLICY IF EXISTS tournaments_manage_creator ON tournaments;
  DROP POLICY IF EXISTS tournaments_manage_service ON tournaments;
  DROP POLICY IF EXISTS templates_select ON admin_templates;
  DROP POLICY IF EXISTS templates_modify_admin ON admin_templates;
  DROP POLICY IF EXISTS templates_select_authenticated ON admin_templates;
  DROP POLICY IF EXISTS templates_manage_service ON admin_templates;
  DROP POLICY IF EXISTS assignments_select ON user_admin_template_assignments;
  DROP POLICY IF EXISTS assignments_modify ON user_admin_template_assignments;
  DROP POLICY IF EXISTS assignments_select_own ON user_admin_template_assignments;
  DROP POLICY IF EXISTS assignments_manage_service ON user_admin_template_assignments;
  DROP POLICY IF EXISTS stats_admin ON system_stats;
  DROP POLICY IF EXISTS stats_manage_service ON system_stats;
  DROP POLICY IF EXISTS actions_admin ON admin_actions;
  DROP POLICY IF EXISTS admin_actions_service ON admin_actions;
  -- New table policies
  DROP POLICY IF EXISTS cards_select_authenticated ON cards;
  DROP POLICY IF EXISTS cards_select_anon ON cards;
  DROP POLICY IF EXISTS cards_manage_service ON cards;
  DROP POLICY IF EXISTS collections_v2_own ON collections_v2;
  DROP POLICY IF EXISTS scans_own ON scans;
  DROP POLICY IF EXISTS prices_select_authenticated ON price_cache;
  DROP POLICY IF EXISTS prices_select_anon ON price_cache;
  DROP POLICY IF EXISTS prices_manage_service ON price_cache;
  DROP POLICY IF EXISTS hash_select_authenticated ON hash_cache;
  DROP POLICY IF EXISTS hash_select_anon ON hash_cache;
  DROP POLICY IF EXISTS hash_manage_service ON hash_cache;
  DROP POLICY IF EXISTS metrics_insert_authenticated ON scan_metrics;
  DROP POLICY IF EXISTS metrics_manage_service ON scan_metrics;
END $$;

-- ── Legacy tables: DISABLE RLS (vanilla JS + anon key) ──────
ALTER TABLE users                          DISABLE ROW LEVEL SECURITY;
ALTER TABLE system_settings                DISABLE ROW LEVEL SECURITY;
ALTER TABLE api_call_logs                  DISABLE ROW LEVEL SECURITY;
ALTER TABLE feature_flags                  DISABLE ROW LEVEL SECURITY;
ALTER TABLE user_feature_overrides         DISABLE ROW LEVEL SECURITY;
ALTER TABLE themes                         DISABLE ROW LEVEL SECURITY;
ALTER TABLE collections                    DISABLE ROW LEVEL SECURITY;
ALTER TABLE tournaments                    DISABLE ROW LEVEL SECURITY;
ALTER TABLE admin_templates                DISABLE ROW LEVEL SECURITY;
ALTER TABLE user_admin_template_assignments DISABLE ROW LEVEL SECURITY;
ALTER TABLE system_stats                   DISABLE ROW LEVEL SECURITY;
ALTER TABLE admin_actions                  DISABLE ROW LEVEL SECURITY;

-- ── New tables: ENABLE RLS (SvelteKit + Supabase Auth) ──────

-- Cards: readable by anyone (anon + authenticated), managed by service role
ALTER TABLE cards ENABLE ROW LEVEL SECURITY;

CREATE POLICY "cards_select_anon" ON cards
  FOR SELECT TO anon USING (true);

CREATE POLICY "cards_select_authenticated" ON cards
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "cards_manage_service" ON cards
  FOR ALL TO service_role USING (true);

-- Collections v2: users own their collections
ALTER TABLE collections_v2 ENABLE ROW LEVEL SECURITY;

CREATE POLICY "collections_v2_own" ON collections_v2
  FOR ALL TO authenticated
  USING ((SELECT auth.uid()) = user_id)
  WITH CHECK ((SELECT auth.uid()) = user_id);

-- Scans: users see their own scans
ALTER TABLE scans ENABLE ROW LEVEL SECURITY;

CREATE POLICY "scans_own" ON scans
  FOR ALL TO authenticated
  USING ((SELECT auth.uid()) = user_id)
  WITH CHECK ((SELECT auth.uid()) = user_id);

-- Price cache: readable by anyone, managed by service role
ALTER TABLE price_cache ENABLE ROW LEVEL SECURITY;

CREATE POLICY "prices_select_anon" ON price_cache
  FOR SELECT TO anon USING (true);

CREATE POLICY "prices_select_authenticated" ON price_cache
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "prices_manage_service" ON price_cache
  FOR ALL TO service_role USING (true);

-- Hash cache: readable by anyone, managed by service role
ALTER TABLE hash_cache ENABLE ROW LEVEL SECURITY;

CREATE POLICY "hash_select_anon" ON hash_cache
  FOR SELECT TO anon USING (true);

CREATE POLICY "hash_select_authenticated" ON hash_cache
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "hash_manage_service" ON hash_cache
  FOR ALL TO service_role USING (true);

-- Scan metrics: insert by authenticated, managed by service role
ALTER TABLE scan_metrics ENABLE ROW LEVEL SECURITY;

CREATE POLICY "metrics_insert_authenticated" ON scan_metrics
  FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "metrics_manage_service" ON scan_metrics
  FOR ALL TO service_role USING (true);

-- ============================================================
-- 5. KEEP-ALIVE CRON (prevents Supabase project pausing)
-- ============================================================
-- pg_cron must be enabled in Supabase Dashboard first.
-- This runs a lightweight query every 6 days.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.schedule('keep-alive', '0 0 */6 * *', 'SELECT 1');
  END IF;
END
$$;

-- ============================================================
-- DONE! All tables, indexes, RLS policies, and seed data are
-- set up. This script is safe to re-run at any time.
-- ============================================================
