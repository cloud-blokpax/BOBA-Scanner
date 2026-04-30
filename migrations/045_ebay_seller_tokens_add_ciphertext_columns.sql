-- Session 2.17 — eBay token encryption columns
-- Adds AES-256-GCM ciphertext + IV columns alongside the legacy plaintext
-- columns. Code dual-writes during the soak window; cleanup migration
-- drops the plaintext columns afterward.

ALTER TABLE public.ebay_seller_tokens
  ADD COLUMN access_token_ciphertext text NULL,
  ADD COLUMN access_token_iv text NULL,
  ADD COLUMN refresh_token_ciphertext text NULL,
  ADD COLUMN refresh_token_iv text NULL;

COMMENT ON COLUMN public.ebay_seller_tokens.access_token_ciphertext IS
  'AES-256-GCM ciphertext (base64) of the eBay access token. Encrypted at rest with EBAY_CREDENTIAL_KEY.';
COMMENT ON COLUMN public.ebay_seller_tokens.access_token_iv IS
  'AES-GCM IV (base64, 12 bytes) for access_token_ciphertext.';
COMMENT ON COLUMN public.ebay_seller_tokens.refresh_token_ciphertext IS
  'AES-256-GCM ciphertext (base64) of the eBay refresh token.';
COMMENT ON COLUMN public.ebay_seller_tokens.refresh_token_iv IS
  'AES-GCM IV (base64, 12 bytes) for refresh_token_ciphertext.';
