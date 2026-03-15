-- Atomic increment for tournament usage_count to prevent race conditions
-- when multiple users register concurrently.
CREATE OR REPLACE FUNCTION increment_tournament_usage(tid UUID)
RETURNS void AS $$
BEGIN
  UPDATE tournaments
  SET usage_count = COALESCE(usage_count, 0) + 1
  WHERE id = tid;
END;
$$ LANGUAGE plpgsql;
