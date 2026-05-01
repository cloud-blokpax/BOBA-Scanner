-- Phase 6 of the Geometry Rebuild (Doc 1).
-- Adds per-capture geometry fields populated by the new corner-detection +
-- homography pipeline. All nullable; old rows stay NULL forever and that's
-- expected — they were captured before geometry telemetry existed.

ALTER TABLE public.scans
  ADD COLUMN IF NOT EXISTS px_per_mm_at_capture     real,
  ADD COLUMN IF NOT EXISTS aspect_ratio_at_capture  real,
  ADD COLUMN IF NOT EXISTS detection_method         text,
  ADD COLUMN IF NOT EXISTS rectification_applied    boolean,
  ADD COLUMN IF NOT EXISTS canonical_size           text,
  ADD COLUMN IF NOT EXISTS detected_corners         jsonb;

COMMENT ON COLUMN public.scans.px_per_mm_at_capture IS
  'Physical pixels-per-millimeter at the card surface, computed from detected corner side lengths divided by 63mm/88mm physical dimensions. NULL when detection_method=centered_fallback.';

COMMENT ON COLUMN public.scans.aspect_ratio_at_capture IS
  'Aspect ratio (long side / short side) of the detected card quad, computed from average side lengths (not bounding rect). Target: 1.397 (88/63). NULL on centered_fallback.';

COMMENT ON COLUMN public.scans.detection_method IS
  'How the card was located in the source frame. ''corner_detected'' = four-corner approxPolyDP success. ''centered_fallback'' = detector failed, used 85%-of-frame default.';

COMMENT ON COLUMN public.scans.rectification_applied IS
  'TRUE when cv.warpPerspective produced the canonical (only possible when detection_method=corner_detected). FALSE when the legacy drawImage rectangular crop ran (centered_fallback path).';

COMMENT ON COLUMN public.scans.canonical_size IS
  'Resolution of the canonical image fed to OCR. Post-rebuild: ''750x1050''. Pre-rebuild rows: ''1500x2100''. Lets us bucket pre/post-rebuild scans without joining a separate version table.';

COMMENT ON COLUMN public.scans.detected_corners IS
  'JSON array [TL, TR, BR, BL] of {x, y} in source-frame pixels. Used for retrospective geometry analysis (e.g. corner-stability across burst frames). NULL on centered_fallback.';
