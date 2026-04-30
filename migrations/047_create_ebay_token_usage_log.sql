-- Session 2.17 — eBay API audit log
-- Append-only forensic record of every outbound api.ebay.com call made on
-- behalf of a user. Used for investigating suspected token misuse.

CREATE TABLE public.ebay_token_usage_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  endpoint text NOT NULL,
  http_method text NOT NULL,
  http_status int NULL,
  success boolean NOT NULL,
  error_message text NULL,
  request_path text NOT NULL,
  ip_address inet NULL,
  user_agent text NULL,
  duration_ms int NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_ebay_token_usage_log_user_created
  ON public.ebay_token_usage_log (user_id, created_at DESC);

CREATE INDEX idx_ebay_token_usage_log_endpoint
  ON public.ebay_token_usage_log (endpoint, created_at DESC);

ALTER TABLE public.ebay_token_usage_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read own token usage" ON public.ebay_token_usage_log
  FOR SELECT
  TO authenticated
  USING ((SELECT auth.uid()) = user_id);

COMMENT ON TABLE public.ebay_token_usage_log IS
  'Audit log of eBay API calls made on behalf of users. Append-only. Used for forensics when a user reports suspicious activity.';
