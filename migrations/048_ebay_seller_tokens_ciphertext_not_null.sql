-- Session 2.18 — Lock down ciphertext columns now that all rows are populated.
-- Prerequisite verified before running: every row has non-NULL ciphertext+iv pairs.

ALTER TABLE public.ebay_seller_tokens
  ALTER COLUMN access_token_ciphertext SET NOT NULL,
  ALTER COLUMN access_token_iv SET NOT NULL,
  ALTER COLUMN refresh_token_ciphertext SET NOT NULL,
  ALTER COLUMN refresh_token_iv SET NOT NULL;
