-- Add is_member flag for premium feature gating (monetization)
-- Defaults to false. Will be set to true via Stripe webhook on payment.
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_member boolean DEFAULT false;

-- Index for feature flag lookups (called on every authenticated page load)
CREATE INDEX IF NOT EXISTS idx_users_auth_user_id ON users(auth_user_id);
