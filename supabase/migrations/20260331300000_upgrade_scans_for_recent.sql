-- ============================================================
-- Upgrade scans table for recent-scans feature
-- ============================================================

-- Denormalized card display fields (avoids JOIN on every home page load)
ALTER TABLE public.scans
    ADD COLUMN IF NOT EXISTS hero_name    TEXT,
    ADD COLUMN IF NOT EXISTS card_number  TEXT;

-- Index for "my recent successful scans" query
CREATE INDEX IF NOT EXISTS idx_scans_user_recent
    ON public.scans(user_id, created_at DESC)
    WHERE card_id IS NOT NULL;
