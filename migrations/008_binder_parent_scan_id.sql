-- Migration 8 — Binder mode parent/child scan relationship
--
-- Session 2.2: a binder capture writes one "parent" scans row
-- representing the whole page plus N child rows (one per non-blank cell).
-- parent_scan_id points from child → parent. Single-card scans have
-- parent_scan_id = NULL.
--
-- Applied to prod via MCP during session 2.2. Also extends the
-- capture_source CHECK to accept 'binder_live_cell'.
--
-- Idempotent.

BEGIN;

ALTER TABLE public.scans
  ADD COLUMN IF NOT EXISTS parent_scan_id uuid
  REFERENCES public.scans(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS scans_parent_scan_id_idx
  ON public.scans (parent_scan_id)
  WHERE parent_scan_id IS NOT NULL;

-- Extend capture_source to accept the new binder value. Drop and re-add
-- the CHECK; the DO block makes it idempotent by checking for the
-- constraint's current value set.
DO $$
DECLARE
  has_binder_cell boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    WHERE t.relname = 'scans'
      AND c.contype = 'c'
      AND pg_get_constraintdef(c.oid) ILIKE '%binder_live_cell%'
  ) INTO has_binder_cell;

  IF NOT has_binder_cell THEN
    ALTER TABLE public.scans
      DROP CONSTRAINT IF EXISTS scans_capture_source_check;
    ALTER TABLE public.scans
      ADD CONSTRAINT scans_capture_source_check
      CHECK (capture_source IN (
        'camera_live',
        'camera_upload',
        'camera_roll_import',
        'binder_live_cell',
        'manual'
      ));
  END IF;
END $$;

COMMIT;
