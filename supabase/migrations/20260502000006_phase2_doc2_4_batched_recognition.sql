-- Phase 2 Doc 2.4 — Batched OCR Region Recognition.
-- Applied via Supabase MCP on 2026-05-02 prior to repo commit.

ALTER TABLE public.scans
  ADD COLUMN IF NOT EXISTS ocr_region_batch_size smallint
    CHECK (ocr_region_batch_size IS NULL OR ocr_region_batch_size BETWEEN 1 AND 10),
  ADD COLUMN IF NOT EXISTS ocr_region_total_ms smallint;

COMMENT ON COLUMN public.scans.ocr_region_batch_size IS
  'Phase 2 Doc 2.4. Number of regions submitted in a single Recognition.run() batch on the canonical Tier 1 OCR pass. NULL = pre-Doc-2.4 / non-Tier-1 / batched flag off (each region was its own call). 2 or 3 = batched call covering card_number + name + optional set_code.';

COMMENT ON COLUMN public.scans.ocr_region_total_ms IS
  'Phase 2 Doc 2.4. Wall-clock milliseconds spent in the batched (or serial) Recognition pass on the canonical Tier 1 path. Includes preprocessing, ONNX inference, and decode. Excludes the consensus-builder vote pass. NULL = Tier 1 did not run.';

INSERT INTO public.feature_flags
  (feature_key, display_name, description, icon,
   enabled_globally, enabled_for_guest, enabled_for_authenticated,
   enabled_for_pro, enabled_for_admin)
VALUES
  ('phase2_batched_recognition_v1',
   'Phase 2: Batched Region Recognition',
   'Submits all canonical OCR regions (card_number, name, optional set_code) to PaddleOCR Recognition.run() as a single batched call instead of three serial ocrRecOnly invocations. Shares ONNX session warm-up and parallelizes preprocessing. ~15-25% latency reduction on the region-OCR phase. Doc 2.4.',
   '⏱️', false, false, false, false, true)
ON CONFLICT (feature_key) DO UPDATE SET
  display_name = EXCLUDED.display_name,
  description = EXCLUDED.description,
  icon = EXCLUDED.icon,
  enabled_for_admin = EXCLUDED.enabled_for_admin;
