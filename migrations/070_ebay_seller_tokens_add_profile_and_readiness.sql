-- Add profile cache + readiness-check cache columns
ALTER TABLE public.ebay_seller_tokens
  ADD COLUMN IF NOT EXISTS ebay_email TEXT,
  ADD COLUMN IF NOT EXISTS seller_account_ready BOOLEAN,
  ADD COLUMN IF NOT EXISTS seller_account_status_message TEXT,
  ADD COLUMN IF NOT EXISTS profile_last_refreshed_at TIMESTAMPTZ;

COMMENT ON COLUMN public.ebay_seller_tokens.ebay_username IS
  'Cached eBay seller username from commerce.identity.get_user. Refreshed on connect + on user-triggered Test action.';
COMMENT ON COLUMN public.ebay_seller_tokens.ebay_email IS
  'Cached eBay seller email from commerce.identity.get_user. Same refresh rules as ebay_username.';
COMMENT ON COLUMN public.ebay_seller_tokens.seller_account_ready IS
  'Cached result of /sell/account/v1/privilege check on connect. NULL = unknown, TRUE = Inventory API ready, FALSE = needs setup at sellers.ebay.com.';
COMMENT ON COLUMN public.ebay_seller_tokens.seller_account_status_message IS
  'Human-readable explanation surfaced in the settings UI when seller_account_ready=false.';
