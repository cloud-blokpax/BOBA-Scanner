-- Session 2.17 — eBay token RLS lockdown
-- Drop the user-readable SELECT policy. RLS stays enabled but with no
-- policies for authenticated/anon roles, all reads/writes must go through
-- the service-role admin client (getAdminClient()).

DROP POLICY IF EXISTS "Users read own ebay tokens" ON public.ebay_seller_tokens;

COMMENT ON TABLE public.ebay_seller_tokens IS
  'eBay seller OAuth tokens. SERVICE-ROLE-ONLY access — no RLS policies for authenticated/anon roles. Read via getAdminClient() in server-side code. Tokens are encrypted at rest in the *_ciphertext columns; legacy plaintext columns are deprecated and will be dropped after backfill.';
