-- Admin Dashboard Tables
-- Adds tables for the admin dashboard: scan flags, changelog, activity log, ebay quota tracking

-- Scan flags: user "wrong card" reports for misidentification review
CREATE TABLE IF NOT EXISTS public.scan_flags (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id         UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    scan_id         UUID,
    card_identified TEXT,
    card_suggested  TEXT,
    image_url       TEXT,
    status          TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed_user', 'confirmed_ai', 'resolved')),
    notes           TEXT,
    resolved_by     UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    resolved_at     TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_scan_flags_status ON public.scan_flags(status);
CREATE INDEX IF NOT EXISTS idx_scan_flags_created ON public.scan_flags(created_at DESC);

-- Changelog entries for "What's New" notifications
CREATE TABLE IF NOT EXISTS public.changelog_entries (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    title           TEXT NOT NULL,
    body            TEXT NOT NULL DEFAULT '',
    published       BOOLEAN NOT NULL DEFAULT FALSE,
    is_notification BOOLEAN NOT NULL DEFAULT FALSE,
    published_at    TIMESTAMPTZ,
    created_by      UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_changelog_published ON public.changelog_entries(published, published_at DESC);

-- Admin activity log for audit trail
CREATE TABLE IF NOT EXISTS public.admin_activity_log (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    admin_id    UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    action      TEXT NOT NULL,
    entity_type TEXT,
    entity_id   TEXT,
    details     JSONB DEFAULT '{}',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_admin_activity_created ON public.admin_activity_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_activity_admin ON public.admin_activity_log(admin_id);

-- eBay API quota tracking
CREATE TABLE IF NOT EXISTS public.ebay_api_log (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    calls_used      INT NOT NULL DEFAULT 0,
    calls_remaining INT,
    calls_limit     INT,
    reset_at        TIMESTAMPTZ,
    recorded_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ebay_api_log_recorded ON public.ebay_api_log(recorded_at DESC);

-- Enable RLS on all new tables
ALTER TABLE public.scan_flags ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.changelog_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_activity_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ebay_api_log ENABLE ROW LEVEL SECURITY;

-- RLS policies: service role only (admin access via API endpoints)
-- Published changelog entries are readable by all authenticated users
CREATE POLICY "Published changelog readable by authenticated" ON public.changelog_entries
    FOR SELECT TO authenticated
    USING (published = true);

-- Users can create scan flags for their own scans
CREATE POLICY "Users can create own scan flags" ON public.scan_flags
    FOR INSERT TO authenticated
    WITH CHECK (auth.uid() = user_id);

-- Users can view their own scan flags
CREATE POLICY "Users can view own scan flags" ON public.scan_flags
    FOR SELECT TO authenticated
    USING (auth.uid() = user_id);
