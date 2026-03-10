-- ============================================================
-- BOBA Scanner — Complete Supabase Schema
-- Run this in your Supabase SQL Editor (Dashboard → SQL Editor)
-- ============================================================

-- ── 1. users ─────────────────────────────────────────────────
-- Core user table — stores Google OAuth identity, limits, and preferences.
CREATE TABLE IF NOT EXISTS users (
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

-- ── 7. collections ───────────────────────────────────────────
-- Cloud-synced card collections (one row per user). Stores all collections,
-- deleted-card tombstones, and user-defined tags as JSON.
CREATE TABLE IF NOT EXISTS collections (
  user_id         UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  data            JSONB DEFAULT '[]',
  deleted_cards   JSONB DEFAULT '[]',
  user_tags       JSONB DEFAULT '[]',
  export_templates JSONB DEFAULT '[]',
  updated_at      TIMESTAMPTZ DEFAULT now()
);

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
  created_at  TIMESTAMPTZ DEFAULT now()
);

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
-- Row Level Security (RLS) Policies
-- Drop existing policies first so this script is fully re-runnable.
-- ============================================================

-- Enable RLS on all tables
ALTER TABLE users                          ENABLE ROW LEVEL SECURITY;
ALTER TABLE system_settings                ENABLE ROW LEVEL SECURITY;
ALTER TABLE api_call_logs                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE feature_flags                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_feature_overrides         ENABLE ROW LEVEL SECURITY;
ALTER TABLE themes                         ENABLE ROW LEVEL SECURITY;
ALTER TABLE collections                    ENABLE ROW LEVEL SECURITY;
ALTER TABLE tournaments                    ENABLE ROW LEVEL SECURITY;
ALTER TABLE admin_templates                ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_admin_template_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE system_stats                   ENABLE ROW LEVEL SECURITY;
ALTER TABLE admin_actions                  ENABLE ROW LEVEL SECURITY;

-- Drop all policies (safe if they don't exist yet)
DO $$ BEGIN
  -- users
  DROP POLICY IF EXISTS users_select_own   ON users;
  DROP POLICY IF EXISTS users_insert_self  ON users;
  DROP POLICY IF EXISTS users_update_own   ON users;
  -- system_settings
  DROP POLICY IF EXISTS settings_select    ON system_settings;
  DROP POLICY IF EXISTS settings_upsert    ON system_settings;
  -- api_call_logs
  DROP POLICY IF EXISTS logs_insert_own    ON api_call_logs;
  DROP POLICY IF EXISTS logs_select_admin  ON api_call_logs;
  -- feature_flags
  DROP POLICY IF EXISTS flags_select       ON feature_flags;
  DROP POLICY IF EXISTS flags_modify_admin ON feature_flags;
  -- user_feature_overrides
  DROP POLICY IF EXISTS overrides_select_own   ON user_feature_overrides;
  DROP POLICY IF EXISTS overrides_modify_admin ON user_feature_overrides;
  -- themes
  DROP POLICY IF EXISTS themes_select_public ON themes;
  DROP POLICY IF EXISTS themes_modify_admin  ON themes;
  -- collections
  DROP POLICY IF EXISTS collections_own ON collections;
  -- tournaments
  DROP POLICY IF EXISTS tournaments_select ON tournaments;
  DROP POLICY IF EXISTS tournaments_insert ON tournaments;
  DROP POLICY IF EXISTS tournaments_update ON tournaments;
  -- admin_templates
  DROP POLICY IF EXISTS templates_select       ON admin_templates;
  DROP POLICY IF EXISTS templates_modify_admin ON admin_templates;
  -- user_admin_template_assignments
  DROP POLICY IF EXISTS assignments_select ON user_admin_template_assignments;
  DROP POLICY IF EXISTS assignments_modify ON user_admin_template_assignments;
  -- system_stats
  DROP POLICY IF EXISTS stats_admin ON system_stats;
  -- admin_actions
  DROP POLICY IF EXISTS actions_admin ON admin_actions;
END $$;

-- Helper: cast BOTH sides to text so comparisons work regardless of
-- whether auth.uid() returns uuid or text on this Supabase version.

-- ── users ──
-- Users can read/update their own row; admins can read/update all.
CREATE POLICY users_select_own   ON users FOR SELECT USING (id::text = auth.uid()::text OR (SELECT is_admin FROM users WHERE id::text = auth.uid()::text));
CREATE POLICY users_insert_self  ON users FOR INSERT WITH CHECK (true);  -- signup
CREATE POLICY users_update_own   ON users FOR UPDATE USING (id::text = auth.uid()::text OR (SELECT is_admin FROM users WHERE id::text = auth.uid()::text));

-- ── system_settings ──
-- Anyone can read; only admins can write.
CREATE POLICY settings_select    ON system_settings FOR SELECT USING (true);
CREATE POLICY settings_upsert    ON system_settings FOR ALL    USING ((SELECT is_admin FROM users WHERE id::text = auth.uid()::text));

-- ── api_call_logs ──
-- Users can insert their own logs; admins can read all.
CREATE POLICY logs_insert_own    ON api_call_logs FOR INSERT WITH CHECK (user_id::text = auth.uid()::text);
CREATE POLICY logs_select_admin  ON api_call_logs FOR SELECT USING ((SELECT is_admin FROM users WHERE id::text = auth.uid()::text));

-- ── feature_flags ──
-- Anyone can read; only admins can modify.
CREATE POLICY flags_select       ON feature_flags FOR SELECT USING (true);
CREATE POLICY flags_modify_admin ON feature_flags FOR ALL    USING ((SELECT is_admin FROM users WHERE id::text = auth.uid()::text));

-- ── user_feature_overrides ──
-- Users can read their own overrides; admins can manage all.
CREATE POLICY overrides_select_own   ON user_feature_overrides FOR SELECT USING (user_id::text = auth.uid()::text OR (SELECT is_admin FROM users WHERE id::text = auth.uid()::text));
CREATE POLICY overrides_modify_admin ON user_feature_overrides FOR ALL    USING ((SELECT is_admin FROM users WHERE id::text = auth.uid()::text));

-- ── themes ──
-- Anyone can read public themes; admins can manage all.
CREATE POLICY themes_select_public ON themes FOR SELECT USING (is_public = true OR (SELECT is_admin FROM users WHERE id::text = auth.uid()::text));
CREATE POLICY themes_modify_admin  ON themes FOR ALL    USING ((SELECT is_admin FROM users WHERE id::text = auth.uid()::text));

-- ── collections ──
-- Users can only access their own collection row.
CREATE POLICY collections_own ON collections FOR ALL USING (user_id::text = auth.uid()::text);

-- ── tournaments ──
-- Anyone can read active tournaments (for code validation); admins can manage all.
CREATE POLICY tournaments_select   ON tournaments FOR SELECT USING (is_active = true OR (SELECT is_admin FROM users WHERE id::text = auth.uid()::text));
CREATE POLICY tournaments_insert   ON tournaments FOR INSERT WITH CHECK (creator_id::text = auth.uid()::text);
CREATE POLICY tournaments_update   ON tournaments FOR UPDATE USING (creator_id::text = auth.uid()::text OR (SELECT is_admin FROM users WHERE id::text = auth.uid()::text));

-- ── admin_templates ──
-- Anyone can read; admins can create/modify.
CREATE POLICY templates_select       ON admin_templates FOR SELECT USING (true);
CREATE POLICY templates_modify_admin ON admin_templates FOR ALL    USING ((SELECT is_admin FROM users WHERE id::text = auth.uid()::text));

-- ── user_admin_template_assignments ──
-- Users can see their own assignments; admins can manage all.
CREATE POLICY assignments_select ON user_admin_template_assignments FOR SELECT USING (user_id::text = auth.uid()::text OR (SELECT is_admin FROM users WHERE id::text = auth.uid()::text));
CREATE POLICY assignments_modify ON user_admin_template_assignments FOR ALL    USING ((SELECT is_admin FROM users WHERE id::text = auth.uid()::text));

-- ── system_stats ──
-- Only admins can read/write.
CREATE POLICY stats_admin ON system_stats FOR ALL USING ((SELECT is_admin FROM users WHERE id::text = auth.uid()::text));

-- ── admin_actions ──
-- Only admins can read/write.
CREATE POLICY actions_admin ON admin_actions FOR ALL USING ((SELECT is_admin FROM users WHERE id::text = auth.uid()::text));
