ALTER TABLE public.ebay_seller_tokens
  ADD COLUMN IF NOT EXISTS envelope_fulfillment_policy_id text,
  ADD COLUMN IF NOT EXISTS standard_fulfillment_policy_id text,
  ADD COLUMN IF NOT EXISTS payment_policy_id_override text,
  ADD COLUMN IF NOT EXISTS return_policy_id_override text;

COMMENT ON COLUMN public.ebay_seller_tokens.envelope_fulfillment_policy_id IS
  'Manual override for eBay Standard Envelope fulfillment policy ID. When set, bypasses the find/create logic in ebay-policies.ts. Used for accounts with pre-configured working policies.';

COMMENT ON COLUMN public.ebay_seller_tokens.standard_fulfillment_policy_id IS
  'Manual override for the standard (non-envelope) fulfillment policy ID. When set, bypasses the find/create logic in ebay-policies.ts.';

COMMENT ON COLUMN public.ebay_seller_tokens.payment_policy_id_override IS
  'Manual override for the payment policy ID. When set, bypasses auto-detection in ebay-policies.ts.';

COMMENT ON COLUMN public.ebay_seller_tokens.return_policy_id_override IS
  'Manual override for the return policy ID. When set, bypasses auto-detection in ebay-policies.ts.';
