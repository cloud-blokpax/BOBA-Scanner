-- Migration 7 — Link listing_templates back to the originating scan
--
-- Session 2.1a: lets the eBay listing row remember which scan produced
-- it. Uses ON DELETE SET NULL so deleting a scan doesn't cascade into
-- a listing the user still cares about. Applied to prod via MCP.
--
-- Idempotent.

BEGIN;

ALTER TABLE public.listing_templates
  ADD COLUMN IF NOT EXISTS scan_id uuid
  REFERENCES public.scans(id) ON DELETE SET NULL;

-- Partial index — only indexes listings that actually have a scan_id.
-- Matches the access pattern: "find the scan for this listing."
CREATE INDEX IF NOT EXISTS listing_templates_scan_id_idx
  ON public.listing_templates (scan_id)
  WHERE scan_id IS NOT NULL;

COMMIT;
