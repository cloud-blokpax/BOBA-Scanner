-- Session 2.18 — Drop the deprecated plaintext token columns. The application
-- code stopped reading and writing these in the previous deploy; this migration
-- removes them from the schema for good. End state: tokens exist in the
-- database only as AES-256-GCM ciphertext (encrypted with EBAY_CREDENTIAL_KEY).

ALTER TABLE public.ebay_seller_tokens
  DROP COLUMN access_token,
  DROP COLUMN refresh_token;

COMMENT ON TABLE public.ebay_seller_tokens IS
  'eBay seller OAuth tokens. SERVICE-ROLE-ONLY access — no RLS policies for authenticated/anon roles. Tokens are stored exclusively as AES-256-GCM ciphertext (encrypted with EBAY_CREDENTIAL_KEY). Read via getAdminClient() in server-side code.';
