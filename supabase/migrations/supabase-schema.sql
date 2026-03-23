-- ============================================================
-- BOBA Scanner — Complete Supabase Schema
-- Run this in your Supabase SQL Editor (Dashboard → SQL Editor)
-- ============================================================

-- ── 1. users ─────────────────────────────────────────────────
-- Core user table — stores OAuth identity, limits, and preferences.
CREATE TABLE IF NOT EXISTS users (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  google_id       TEXT UNIQUE,  -- Legacy: from pre-Supabase-Auth era. Nullable for non-Google providers.
  auth_user_id    UUID UNIQUE,  -- Links to auth.users(id) from Supabase Auth
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

-- ── 2. system_settings ───────────────────────────────────────
-- Key/value store for admin-configurable limits and global settings.
-- Keys used: guest_max_cards, guest_max_api, auth_max_cards, auth_max_api,
--            member_max_cards, member_max_api
CREATE TABLE IF NOT EXISTS system_settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Seed default limits (safe to re-run — conflicts are ignored)
INSERT INTO system_settings (key, value) VALUES
  ('guest_max_cards',  '5'),
  ('guest_max_api',    '1'),
  ('auth_max_cards',   '25'),
  ('auth_max_api',     '50'),
  ('member_max_cards', '250'),
  ('member_max_api',   '250')
ON CONFLICT (key) DO NOTHING;

-- ── 3. api_call_logs ─────────────────────────────────────────
-- Tracks every API call (scan, grade, eBay lookup, etc.) for billing and analytics.
CREATE TABLE IF NOT EXISTS api_call_logs (
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

-- ── 4. feature_flags ─────────────────────────────────────────
-- Global feature toggles with per-role enable/disable.
CREATE TABLE IF NOT EXISTS feature_flags (
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

-- ── 5. user_feature_overrides ────────────────────────────────
-- Per-user overrides for feature flags (admin can enable/disable features for specific users).
CREATE TABLE IF NOT EXISTS user_feature_overrides (
  user_id     UUID REFERENCES users(id) ON DELETE CASCADE,
  feature_key TEXT NOT NULL,
  enabled     BOOLEAN NOT NULL,
  PRIMARY KEY (user_id, feature_key)
);

-- ── 6. themes ────────────────────────────────────────────────
-- Custom UI themes created by admins; users can activate one.
CREATE TABLE IF NOT EXISTS themes (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  description TEXT,
  config      JSONB NOT NULL DEFAULT '{}',
  is_public   BOOLEAN DEFAULT false,
  created_by  UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ DEFAULT now()
);

-- ── 7. collections (DEPRECATED) ──────────────────────────────
-- Legacy JSONB-blob collection storage. Replaced by collections_v2.
-- Retained only for data migration purposes. Will be dropped after
-- all users have been migrated to collections_v2.
-- DO NOT use in new application code.
CREATE TABLE IF NOT EXISTS collections (
  user_id         UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  data            JSONB DEFAULT '[]',
  deleted_cards   JSONB DEFAULT '[]',
  user_tags       JSONB DEFAULT '[]',
  export_templates JSONB DEFAULT '[]',
  updated_at      TIMESTAMPTZ DEFAULT now()
);

-- ── 7b. collections_v2 ──────────────────────────────────────
-- Normalized card collection (one row per user+card+condition).
-- This is the active collection table used by all application code.
-- The legacy `collections` table (JSONB) is retained for data migration only.
CREATE TABLE IF NOT EXISTS collections_v2 (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  card_id         TEXT NOT NULL,
  quantity        INT DEFAULT 1,
  condition       TEXT DEFAULT 'near_mint',
  notes           TEXT,
  added_at        TIMESTAMPTZ DEFAULT now(),
  UNIQUE (user_id, card_id, condition)
);

CREATE INDEX IF NOT EXISTS idx_collections_v2_user ON collections_v2(user_id);
CREATE INDEX IF NOT EXISTS idx_collections_v2_card ON collections_v2(card_id);

-- ── 8. tournaments ───────────────────────────────────────────
-- Tournament definitions with unique join codes.
CREATE TABLE IF NOT EXISTS tournaments (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_id  UUID REFERENCES users(id) NOT NULL,
  code        TEXT UNIQUE NOT NULL,
  name        TEXT NOT NULL,
  max_heroes  INT DEFAULT 0,
  max_plays   INT DEFAULT 30,
  max_bonus   INT DEFAULT 15,
  usage_count INT DEFAULT 0,
  is_active   BOOLEAN DEFAULT true,
  require_email   BOOLEAN DEFAULT true,
  require_name    BOOLEAN DEFAULT false,
  require_discord BOOLEAN DEFAULT false,
  created_at  TIMESTAMPTZ DEFAULT now()
);

-- ── 8b. tournament_registrations ────────────────────────────────
-- Participant registrations with contact info and deck CSV.
CREATE TABLE IF NOT EXISTS tournament_registrations (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id   UUID REFERENCES tournaments(id) ON DELETE CASCADE NOT NULL,
  user_id         UUID REFERENCES users(id) ON DELETE SET NULL,
  email           TEXT NOT NULL,
  name            TEXT,
  discord_id      TEXT,
  deck_csv        TEXT,
  created_at      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tournament_reg_tournament ON tournament_registrations(tournament_id);
CREATE INDEX IF NOT EXISTS idx_tournament_reg_user       ON tournament_registrations(user_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_tournament_reg_unique
  ON tournament_registrations(tournament_id, email);

-- ── 9. admin_templates ───────────────────────────────────────
-- Export templates created by admins and assignable to users.
CREATE TABLE IF NOT EXISTS admin_templates (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  fields      JSONB NOT NULL DEFAULT '[]',
  description TEXT,
  created_by  UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ DEFAULT now()
);

-- ── 10. user_admin_template_assignments ──────────────────────
-- Maps which admin templates are assigned to which users.
CREATE TABLE IF NOT EXISTS user_admin_template_assignments (
  user_id           UUID REFERENCES users(id) ON DELETE CASCADE,
  admin_template_id UUID REFERENCES admin_templates(id) ON DELETE CASCADE,
  assigned_by       UUID REFERENCES users(id) ON DELETE SET NULL,
  PRIMARY KEY (user_id, admin_template_id)
);

-- ── 11. system_stats ─────────────────────────────────────────
-- Daily aggregate stats (auto-populated or calculated on the fly by admin dashboard).
CREATE TABLE IF NOT EXISTS system_stats (
  date             DATE PRIMARY KEY,
  total_users      INT DEFAULT 0,
  active_users     INT DEFAULT 0,
  total_api_calls  INT DEFAULT 0,
  total_cost       NUMERIC(10,4) DEFAULT 0
);

-- ── 12. admin_actions ────────────────────────────────────────
-- Audit log for admin operations (editing users, toggling features, etc.).
CREATE TABLE IF NOT EXISTS admin_actions (
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
-- Row Level Security (RLS)
-- ============================================================
-- This app uses Supabase Auth (Google OAuth via PKCE flow).
-- RLS is enabled on all tables. The service_role key is used for
-- privileged server-side operations. The anon key provides limited
-- public read access where needed (feature flags, settings, etc.).
--
-- Detailed per-table RLS policies are in enable-rls-legacy-tables.sql.
-- That migration MUST be run after this schema file.
-- ============================================================

-- Enable RLS on all tables (policies defined in enable-rls-legacy-tables.sql)
ALTER TABLE users                          ENABLE ROW LEVEL SECURITY;
ALTER TABLE system_settings                ENABLE ROW LEVEL SECURITY;
ALTER TABLE api_call_logs                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE feature_flags                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_feature_overrides         ENABLE ROW LEVEL SECURITY;
ALTER TABLE themes                         ENABLE ROW LEVEL SECURITY;
ALTER TABLE collections                    ENABLE ROW LEVEL SECURITY;
ALTER TABLE collections_v2                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE tournaments                    ENABLE ROW LEVEL SECURITY;
ALTER TABLE tournament_registrations       ENABLE ROW LEVEL SECURITY;
ALTER TABLE admin_templates                ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_admin_template_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE system_stats                   ENABLE ROW LEVEL SECURITY;
ALTER TABLE admin_actions                  ENABLE ROW LEVEL SECURITY;
