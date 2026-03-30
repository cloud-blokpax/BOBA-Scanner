-- error_logs — stores client-side error reports from /api/log
-- Accessed exclusively via service_role from the server; no client access.

CREATE TABLE IF NOT EXISTS public.error_logs (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    type        TEXT NOT NULL DEFAULT 'error',
    message     TEXT NOT NULL DEFAULT '',
    file        TEXT DEFAULT '',
    line        INTEGER DEFAULT 0,
    col         INTEGER DEFAULT 0,
    stack       TEXT DEFAULT '',
    url         TEXT DEFAULT '',
    user_agent  TEXT DEFAULT '',
    session_id  TEXT DEFAULT '',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_error_logs_created ON public.error_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_error_logs_type ON public.error_logs(type);

-- RLS: no client access — server uses service_role key
ALTER TABLE public.error_logs ENABLE ROW LEVEL SECURITY;

-- Auto-purge logs older than 30 days (run via pg_cron or manual cleanup)
-- No policy needed — service_role bypasses RLS.
