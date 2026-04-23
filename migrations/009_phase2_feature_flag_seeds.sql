-- Migration 9 — Phase 2 feature flag seeds
--
-- Sessions 2.1a / 2.1b / 2.2: seed the three Phase 2 rollout flags.
-- Admin-only at launch; authorized flips happen via the admin UI or
-- direct UPDATE later. INSERT ON CONFLICT DO NOTHING so re-running
-- against a prod that already has rows (via the TS FEATURE_DEFINITIONS
-- fallback on first app load) is a no-op.
--
-- Idempotent. Safe on fresh branches and on branches that loaded
-- feature-flags.svelte.ts at least once.

BEGIN;

INSERT INTO public.feature_flags
  (feature_key, display_name, description, icon,
   enabled_globally, enabled_for_guest, enabled_for_authenticated,
   enabled_for_pro, enabled_for_admin)
VALUES
  (
    'live_ocr_tier1_v1',
    'Live OCR Tier 1 (PaddleOCR)',
    'Replaces Claude Haiku as primary recognition path with local PaddleOCR + voting consensus from continuous live OCR. Haiku remains as a fallback when confidence is below the floor.',
    '👁️',
    false, false, false, false, true
  ),
  (
    'upload_tta_v1',
    'Upload TTA Voting (Tier 1 fallback)',
    'Runs test-time augmentation voting (5 synthetic frames, PaddleOCR consensus) on uploaded images whose single-frame canonical OCR falls below the confidence floor. Canonical still runs first; TTA only fires on the minority of uploads that need help. Requires live_ocr_tier1_v1 on.',
    '🎞️',
    false, false, false, false, true
  ),
  (
    'binder_mode_v1',
    'Binder Mode (Full-Page Grid Scan)',
    'Scan a full binder page at once. User selects 2×2, 3×3, or 4×4 grid; each non-blank cell runs an independent live-OCR session with its own consensus. At shutter, each cell canonicalizes through the same PaddleOCR pipeline as single-card scans and is persisted as a child of one parent binder scan row.',
    '🗂️',
    false, false, false, false, true
  )
ON CONFLICT (feature_key) DO NOTHING;

COMMIT;
