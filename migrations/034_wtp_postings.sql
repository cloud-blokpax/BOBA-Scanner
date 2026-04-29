-- WTP integration tables: seller credentials + posting tracker.
--
-- This migration covers the schema needed by the WTP sell flow. It
-- consolidates the foundational pieces from the auto-listing doc with
-- the sell-flow delta (scan_id origin, source_listing_id optional).
--
-- Both wtp_seller_credentials and wtp_postings are service-role-only.
-- All writes happen from server-side endpoints under /api/wtp/*.

-- ── Seller credentials ──────────────────────────────────────
-- Per-user encrypted credentials for posting to WTP. Stripe Connect
-- status is mirrored here so we can warn users in the sell flow.
CREATE TABLE IF NOT EXISTS wtp_seller_credentials (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  -- Encrypted credential blob (AES-GCM, see services/wtp/crypto.ts).
  -- Schema is opaque to the DB — the service layer owns shape.
  credential_ciphertext text NOT NULL,
  credential_iv text NOT NULL,
  -- Last-known WTP seller handle (for display only, not auth).
  wtp_username text,
  -- Stripe Connect onboarding status. WTP returns one of:
  --   not_started | pending | active | restricted | rejected
  stripe_connect_status text,
  stripe_connect_checked_at timestamptz,
  scopes text,
  connected_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE wtp_seller_credentials ENABLE ROW LEVEL SECURITY;

-- Service role only — no direct user access. The /api/wtp/* endpoints
-- gate via locals.safeGetSession() and write through the admin client.
DROP POLICY IF EXISTS wtp_seller_credentials_service_only ON wtp_seller_credentials;
CREATE POLICY wtp_seller_credentials_service_only ON wtp_seller_credentials
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- ── Posting tracker ─────────────────────────────────────────
-- One row per (user, scan|source_listing) → WTP listing attempt.
-- Carries idempotency so a re-submit doesn't double-post.
CREATE TABLE IF NOT EXISTS wtp_postings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  card_id uuid NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  -- Origin tracking: at least one of scan_id or source_listing_id must
  -- be set. The sell flow uses scan_id; the legacy export-from-listing
  -- path (carried over from doc 2) uses source_listing_id.
  scan_id uuid REFERENCES scans(id) ON DELETE SET NULL,
  source_listing_id uuid REFERENCES listing_templates(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'posted', 'failed', 'sold', 'ended')),
  wtp_listing_id text,
  wtp_listing_url text,
  payload jsonb,
  error_message text,
  posted_at timestamptz,
  last_synced_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT wtp_postings_origin_present
    CHECK (scan_id IS NOT NULL OR source_listing_id IS NOT NULL)
);

ALTER TABLE wtp_postings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS wtp_postings_service_only ON wtp_postings;
CREATE POLICY wtp_postings_service_only ON wtp_postings
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- Authenticated users can read their own postings (powers /sell/wtp/history)
DROP POLICY IF EXISTS wtp_postings_owner_read ON wtp_postings;
CREATE POLICY wtp_postings_owner_read ON wtp_postings
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

-- ── Indexes ─────────────────────────────────────────────────
-- Idempotency: same scan can't be posted twice by the same user
CREATE UNIQUE INDEX IF NOT EXISTS wtp_postings_user_scan_unique
  ON wtp_postings (user_id, scan_id)
  WHERE scan_id IS NOT NULL;

-- Idempotency: same source-listing can't be re-posted by the same user
CREATE UNIQUE INDEX IF NOT EXISTS wtp_postings_user_source_unique
  ON wtp_postings (user_id, source_listing_id)
  WHERE source_listing_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS wtp_postings_user_idx
  ON wtp_postings (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS wtp_postings_scan_idx
  ON wtp_postings (scan_id) WHERE scan_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS wtp_postings_status_idx
  ON wtp_postings (user_id, status);

-- ── updated_at triggers ─────────────────────────────────────
CREATE TRIGGER wtp_seller_credentials_updated_at
  BEFORE UPDATE ON wtp_seller_credentials
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER wtp_postings_updated_at
  BEFORE UPDATE ON wtp_postings
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
