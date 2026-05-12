ALTER TABLE public.ebay_seller_tokens
  ADD COLUMN IF NOT EXISTS ebay_user_id TEXT;

CREATE INDEX IF NOT EXISTS ebay_seller_tokens_ebay_user_id_idx
  ON public.ebay_seller_tokens (ebay_user_id)
  WHERE ebay_user_id IS NOT NULL;

COMMENT ON COLUMN public.ebay_seller_tokens.ebay_user_id IS
  'Stable eBay user identifier from commerce.identity.get_user.userId. Used to match MARKETPLACE_ACCOUNT_DELETION notifications. Survives eBay username changes.';
