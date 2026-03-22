-- ============================================================
-- CRITICAL: Enable RLS on legacy tables that were left open
-- These tables were created before Supabase Auth migration
-- and had RLS disabled for the vanilla JS client. Now that
-- all access goes through Supabase Auth, RLS must be enforced.
-- ============================================================

-- ── users ─────────────────────────────────────────────────
ALTER TABLE users ENABLE ROW LEVEL SECURITY;

-- Users can read their own profile
DROP POLICY IF EXISTS "users_select_own" ON users;
CREATE POLICY "users_select_own" ON users
  FOR SELECT USING (auth.uid()::text = auth_user_id::text);

-- Users can update their own profile (but not is_admin/is_member)
DROP POLICY IF EXISTS "users_update_own" ON users;
CREATE POLICY "users_update_own" ON users
  FOR UPDATE USING (auth.uid()::text = auth_user_id::text)
  WITH CHECK (auth.uid()::text = auth_user_id::text);

-- Service role can do everything (for auth callback user creation)
DROP POLICY IF EXISTS "users_service" ON users;
CREATE POLICY "users_service" ON users
  FOR ALL USING (auth.role() = 'service_role');

-- ── system_settings ───────────────────────────────────────
ALTER TABLE system_settings ENABLE ROW LEVEL SECURITY;

-- Anyone can read settings (they're configuration, not secrets)
DROP POLICY IF EXISTS "settings_select_all" ON system_settings;
CREATE POLICY "settings_select_all" ON system_settings
  FOR SELECT USING (true);

-- Only service role can modify
DROP POLICY IF EXISTS "settings_manage_service" ON system_settings;
CREATE POLICY "settings_manage_service" ON system_settings
  FOR ALL USING (auth.role() = 'service_role');

-- ── api_call_logs ─────────────────────────────────────────
ALTER TABLE api_call_logs ENABLE ROW LEVEL SECURITY;

-- Users can read their own logs
DROP POLICY IF EXISTS "api_logs_select_own" ON api_call_logs;
CREATE POLICY "api_logs_select_own" ON api_call_logs
  FOR SELECT USING (auth.uid() = user_id);

-- Service role manages all logs
DROP POLICY IF EXISTS "api_logs_service" ON api_call_logs;
CREATE POLICY "api_logs_service" ON api_call_logs
  FOR ALL USING (auth.role() = 'service_role');

-- ── feature_flags ─────────────────────────────────────────
ALTER TABLE feature_flags ENABLE ROW LEVEL SECURITY;

-- Anyone can read feature flags (needed for client-side flag checks)
DROP POLICY IF EXISTS "flags_select_all" ON feature_flags;
CREATE POLICY "flags_select_all" ON feature_flags
  FOR SELECT USING (true);

-- Only service role can modify
DROP POLICY IF EXISTS "flags_manage_service" ON feature_flags;
CREATE POLICY "flags_manage_service" ON feature_flags
  FOR ALL USING (auth.role() = 'service_role');

-- ── user_feature_overrides ────────────────────────────────
ALTER TABLE user_feature_overrides ENABLE ROW LEVEL SECURITY;

-- Users can read their own overrides
DROP POLICY IF EXISTS "overrides_select_own" ON user_feature_overrides;
CREATE POLICY "overrides_select_own" ON user_feature_overrides
  FOR SELECT USING (auth.uid() = user_id);

-- Only service role can manage overrides (admin function)
DROP POLICY IF EXISTS "overrides_manage_service" ON user_feature_overrides;
CREATE POLICY "overrides_manage_service" ON user_feature_overrides
  FOR ALL USING (auth.role() = 'service_role');

-- ── themes ────────────────────────────────────────────────
ALTER TABLE themes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "themes_select_public" ON themes;
CREATE POLICY "themes_select_public" ON themes
  FOR SELECT USING (is_public = true OR auth.uid() = created_by);

DROP POLICY IF EXISTS "themes_manage_service" ON themes;
CREATE POLICY "themes_manage_service" ON themes
  FOR ALL USING (auth.role() = 'service_role');

-- ── collections (legacy v1 — may still have data) ────────
ALTER TABLE collections ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "collections_select_own" ON collections;
CREATE POLICY "collections_select_own" ON collections
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "collections_manage_own" ON collections;
CREATE POLICY "collections_manage_own" ON collections
  FOR ALL USING (auth.uid() = user_id);

-- ── tournaments ───────────────────────────────────────────
ALTER TABLE tournaments ENABLE ROW LEVEL SECURITY;

-- Anyone can read active tournaments (for the tournaments list page)
DROP POLICY IF EXISTS "tournaments_select_active" ON tournaments;
CREATE POLICY "tournaments_select_active" ON tournaments
  FOR SELECT USING (is_active = true);

-- Creators can manage their own tournaments
DROP POLICY IF EXISTS "tournaments_manage_own" ON tournaments;
CREATE POLICY "tournaments_manage_own" ON tournaments
  FOR ALL USING (auth.uid() = creator_id);

DROP POLICY IF EXISTS "tournaments_service" ON tournaments;
CREATE POLICY "tournaments_service" ON tournaments
  FOR ALL USING (auth.role() = 'service_role');

-- ── tournament_registrations ──────────────────────────────
ALTER TABLE tournament_registrations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "registrations_select_own" ON tournament_registrations;
CREATE POLICY "registrations_select_own" ON tournament_registrations
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "registrations_service" ON tournament_registrations;
CREATE POLICY "registrations_service" ON tournament_registrations
  FOR ALL USING (auth.role() = 'service_role');

-- ── admin_templates ───────────────────────────────────────
ALTER TABLE admin_templates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admin_templates_select" ON admin_templates;
CREATE POLICY "admin_templates_select" ON admin_templates
  FOR SELECT USING (true);

DROP POLICY IF EXISTS "admin_templates_service" ON admin_templates;
CREATE POLICY "admin_templates_service" ON admin_templates
  FOR ALL USING (auth.role() = 'service_role');

-- ── user_admin_template_assignments ───────────────────────
ALTER TABLE user_admin_template_assignments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "assignments_select_own" ON user_admin_template_assignments;
CREATE POLICY "assignments_select_own" ON user_admin_template_assignments
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "assignments_service" ON user_admin_template_assignments;
CREATE POLICY "assignments_service" ON user_admin_template_assignments
  FOR ALL USING (auth.role() = 'service_role');

-- ── system_stats ──────────────────────────────────────────
ALTER TABLE system_stats ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "stats_select_all" ON system_stats;
CREATE POLICY "stats_select_all" ON system_stats
  FOR SELECT USING (true);

DROP POLICY IF EXISTS "stats_service" ON system_stats;
CREATE POLICY "stats_service" ON system_stats
  FOR ALL USING (auth.role() = 'service_role');

-- ── admin_actions ─────────────────────────────────────────
ALTER TABLE admin_actions ENABLE ROW LEVEL SECURITY;

-- Only service role can read/write admin actions
DROP POLICY IF EXISTS "admin_actions_service" ON admin_actions;
CREATE POLICY "admin_actions_service" ON admin_actions
  FOR ALL USING (auth.role() = 'service_role');
