-- ============================================================================
-- BOBA Scanner — Row Level Security Policies
-- ============================================================================
-- CRITICAL: Without RLS, the anon key in the client bundle gives full
-- read/write access to all tables. This migration locks down every table.
-- ============================================================================

-- ── users ────────────────────────────────────────────────────
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users_select_own" ON public.users
    FOR SELECT USING (auth.uid() = auth_user_id);

CREATE POLICY "users_update_own" ON public.users
    FOR UPDATE USING (auth.uid() = auth_user_id)
    WITH CHECK (auth.uid() = auth_user_id);

CREATE POLICY "users_insert_own" ON public.users
    FOR INSERT WITH CHECK (auth.uid() = auth_user_id);

-- ── collections ──────────────────────────────────────────────
ALTER TABLE public.collections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "collections_select_own" ON public.collections
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "collections_insert_own" ON public.collections
    FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "collections_update_own" ON public.collections
    FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "collections_delete_own" ON public.collections
    FOR DELETE USING (auth.uid() = user_id);

-- ── cards (public read, no client write) ─────────────────────
ALTER TABLE public.cards ENABLE ROW LEVEL SECURITY;

CREATE POLICY "cards_select_all" ON public.cards
    FOR SELECT USING (true);

-- ── hash_cache (public read, authenticated write) ────────────
ALTER TABLE public.hash_cache ENABLE ROW LEVEL SECURITY;

CREATE POLICY "hash_cache_select_all" ON public.hash_cache
    FOR SELECT USING (true);

CREATE POLICY "hash_cache_insert_authenticated" ON public.hash_cache
    FOR INSERT WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "hash_cache_update_authenticated" ON public.hash_cache
    FOR UPDATE USING (auth.role() = 'authenticated');

-- ── price_cache (public read, no client write — server uses service role) ─
ALTER TABLE public.price_cache ENABLE ROW LEVEL SECURITY;

CREATE POLICY "price_cache_select_all" ON public.price_cache
    FOR SELECT USING (true);

-- ── price_history (public read) ──────────────────────────────
ALTER TABLE public.price_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "price_history_select_all" ON public.price_history
    FOR SELECT USING (true);

-- ── ebay_seller_tokens (CRITICAL — never expose to client) ───
ALTER TABLE public.ebay_seller_tokens ENABLE ROW LEVEL SECURITY;
-- No RLS policies — accessed exclusively via service role key on the server.

-- ── feature_flags (public read) ──────────────────────────────
ALTER TABLE public.feature_flags ENABLE ROW LEVEL SECURITY;

CREATE POLICY "feature_flags_select_all" ON public.feature_flags
    FOR SELECT USING (true);

-- ── user_feature_overrides ───────────────────────────────────
ALTER TABLE public.user_feature_overrides ENABLE ROW LEVEL SECURITY;

CREATE POLICY "user_feature_overrides_select_own" ON public.user_feature_overrides
    FOR SELECT USING (auth.uid() = user_id);

-- ── tournaments (public read for active tournaments) ─────────
ALTER TABLE public.tournaments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tournaments_select_active" ON public.tournaments
    FOR SELECT USING (is_active = true);

-- ── tournament_registrations ─────────────────────────────────
ALTER TABLE public.tournament_registrations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tournament_registrations_select_own" ON public.tournament_registrations
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "tournament_registrations_insert_authenticated" ON public.tournament_registrations
    FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "tournament_registrations_update_own" ON public.tournament_registrations
    FOR UPDATE USING (auth.uid() = user_id);

-- ── card_reference_images (public read, authenticated write) ─
ALTER TABLE public.card_reference_images ENABLE ROW LEVEL SECURITY;

CREATE POLICY "card_reference_images_select_all" ON public.card_reference_images
    FOR SELECT USING (true);

-- ── user_badges ──────────────────────────────────────────────
ALTER TABLE public.user_badges ENABLE ROW LEVEL SECURITY;

CREATE POLICY "user_badges_select_own" ON public.user_badges
    FOR SELECT USING (auth.uid() = user_id);

-- ── scans ────────────────────────────────────────────────────
ALTER TABLE public.scans ENABLE ROW LEVEL SECURITY;

CREATE POLICY "scans_insert_authenticated" ON public.scans
    FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "scans_select_own" ON public.scans
    FOR SELECT USING (auth.uid() = user_id);

-- ── listing_templates ────────────────────────────────────────
ALTER TABLE public.listing_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "listing_templates_select_own" ON public.listing_templates
    FOR SELECT USING (auth.uid() = user_id);

-- ── deck_shop_refresh_log ────────────────────────────────────
ALTER TABLE public.deck_shop_refresh_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "deck_shop_refresh_log_select_own" ON public.deck_shop_refresh_log
    FOR SELECT USING (auth.uid() = user_id);

-- ── app_config (public read) ─────────────────────────────────
ALTER TABLE public.app_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "app_config_select_all" ON public.app_config
    FOR SELECT USING (true);

-- ── system_settings (public read) ────────────────────────────
ALTER TABLE public.system_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "system_settings_select_all" ON public.system_settings
    FOR SELECT USING (true);

-- ── api_call_logs ────────────────────────────────────────────
ALTER TABLE public.api_call_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "api_call_logs_select_own" ON public.api_call_logs
    FOR SELECT USING (auth.uid() = user_id);

-- ── user_decks ───────────────────────────────────────────────
ALTER TABLE public.user_decks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "user_decks_select_own" ON public.user_decks
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "user_decks_insert_own" ON public.user_decks
    FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "user_decks_update_own" ON public.user_decks
    FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "user_decks_delete_own" ON public.user_decks
    FOR DELETE USING (auth.uid() = user_id);

-- ── shared_decks (public read) ───────────────────────────────
ALTER TABLE public.shared_decks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "shared_decks_select_all" ON public.shared_decks
    FOR SELECT USING (true);

-- ── community_corrections (public read, authenticated write) ─
ALTER TABLE public.community_corrections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "community_corrections_select_all" ON public.community_corrections
    FOR SELECT USING (true);

-- ── scan_metrics (no client access — server uses service role) ─
ALTER TABLE public.scan_metrics ENABLE ROW LEVEL SECURITY;

-- ── parallel_rarity_config (public read) ─────────────────────
ALTER TABLE public.parallel_rarity_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "parallel_rarity_config_select_all" ON public.parallel_rarity_config
    FOR SELECT USING (true);

-- ── error_logs (no client access — server uses service role) ─
-- Note: error_logs may not exist as a standalone table; if it does, lock it down.
DO $$ BEGIN
    ALTER TABLE public.error_logs ENABLE ROW LEVEL SECURITY;
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

-- ── dbs_scores (public read) ─────────────────────────────────
ALTER TABLE public.dbs_scores ENABLE ROW LEVEL SECURITY;

CREATE POLICY "dbs_scores_select_all" ON public.dbs_scores
    FOR SELECT USING (true);

-- ── play_cards (public read) ─────────────────────────────────
ALTER TABLE public.play_cards ENABLE ROW LEVEL SECURITY;

CREATE POLICY "play_cards_select_all" ON public.play_cards
    FOR SELECT USING (true);
