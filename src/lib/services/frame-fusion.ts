/**
 * Phase 1 — Frame fusion service.
 *
 * Takes the shutter frame plus the recent fusion-buffer frames, scores each
 * one for sharpness / glare / exposure, picks the top K, and composites them
 * via per-channel median pixel. The composite replaces the shutter frame as
 * input to detectCard + cropToCanonical.
 *
 * Returns a diagnostic block so telemetry can compare pre-vs-post composite
 * blur variance, see which frames were used, and segment hit rate by method.
 *
 * Best-effort by design: any failure falls through to shutter_only and the
 * caller keeps using the original bitmap. Never throws.
 */
import { getImageWorker } from './recognition-workers';
import { getMotionAtTimestamp, getPermissionState as getImuPermission } from './imu-monitor';

// Phase 5 — weight applied to motion magnitude (m/s²) when adjusting a
// frame's composite_score. Tuned so a 0.5 m/s² spike costs ~2,500 points;
// recalibrate if blur_variance ranges shift.
const IMU_SCORE_PENALTY = 5000;

export type FusionMethod = 'best_frame' | 'min_pixel' | 'shutter_only';

export interface FusionPerFrameScore {
	blur_variance: number;
	glare_area_pct: number;
	composite_score: number;
	used: boolean;
}

export interface FusionDiag {
	frames_buffered: number;
	frames_used: number;
	composite_method: FusionMethod;
	pre_composite_blur_variance: number;
	post_composite_blur_variance: number;
	per_frame_scores: FusionPerFrameScore[];
	composite_ms: number;
}

interface FuseInput {
	bitmap: ImageBitmap;
	capturedAt: number;
}

export interface FuseResult {
	bitmap: ImageBitmap;
	/** True when the returned bitmap is a new composite (caller must close
	 *  it). False when the returned bitmap is the original shutter frame. */
	owned: boolean;
	diag: FusionDiag;
}

const FRAMES_TO_PICK = 4;
const MIN_BUFFER_TO_FUSE = 2;

/**
 * Fuse the shutter frame with the buffered frames. Always returns a valid
 * bitmap — never throws. Caller closes `bitmap` only when `owned === true`.
 *
 * The composite dimensions match the shutter frame (and the buffered frames,
 * which are captured at the same native video resolution).
 */
export async function fuseShutterWithBuffer(
	shutter: ImageBitmap,
	buffered: FuseInput[],
	opts: { foilMode?: boolean } = {}
): Promise<FuseResult> {
	const start = performance.now();
	const diag: FusionDiag = {
		frames_buffered: buffered.length,
		frames_used: 1,
		composite_method: 'shutter_only',
		pre_composite_blur_variance: 0,
		post_composite_blur_variance: 0,
		per_frame_scores: [],
		composite_ms: 0
	};

	if (buffered.length < MIN_BUFFER_TO_FUSE) {
		diag.composite_ms = Math.round(performance.now() - start);
		return { bitmap: shutter, owned: false, diag };
	}

	// Drop any buffered frame whose dims don't match the shutter (would
	// corrupt per-pixel median). Common: video dim changed mid-session.
	const sameDim = buffered.filter(
		(f) => f.bitmap.width === shutter.width && f.bitmap.height === shutter.height
	);
	if (sameDim.length < MIN_BUFFER_TO_FUSE) {
		diag.composite_ms = Math.round(performance.now() - start);
		return { bitmap: shutter, owned: false, diag };
	}

	try {
		const worker = getImageWorker();
		const allFrames: ImageBitmap[] = [...sameDim.map((f) => f.bitmap), shutter];
		const allTimestamps: Array<number | null> = [
			...sameDim.map((f) => f.capturedAt),
			null // shutter has no buffered timestamp; treat as motion-free
		];

		const scores = await Promise.all(allFrames.map((b) => worker.scoreFrame(b)));

		// Phase 5 — penalize frames captured during phone motion. Skipped when
		// IMU permission isn't granted (no signal to read from).
		const imuActive = getImuPermission() === 'granted';
		const adjustedScores = scores.map((s, idx) => {
			const ts = allTimestamps[idx];
			if (!imuActive || ts === null) return s.composite_score;
			const motion = getMotionAtTimestamp(ts);
			return s.composite_score - motion * IMU_SCORE_PENALTY;
		});

		const ranked = scores
			.map((s, idx) => ({ idx, score: adjustedScores[idx], full: s }))
			.sort((a, b) => b.score - a.score)
			.slice(0, Math.min(FRAMES_TO_PICK, allFrames.length));

		const usedIdxSet = new Set(ranked.map((r) => r.idx));
		const topFrames = ranked.map((r) => allFrames[r.idx]);

		diag.per_frame_scores = scores.slice(0, 10).map((s, idx) => ({
			blur_variance: Math.round(s.blur_variance),
			glare_area_pct: Number(s.glare_area_pct.toFixed(4)),
			composite_score: Math.round(s.composite_score),
			used: usedIdxSet.has(idx)
		}));

		const shutterScore = scores[scores.length - 1];
		diag.pre_composite_blur_variance = Math.round(shutterScore.blur_variance);
		diag.frames_used = topFrames.length;
		// Phase 1 fix 2026-05-19: median composite was producing softer output
		// than the sharpest input frame because hand-jitter mis-registers
		// per-pixel samples across frames. Switched to best-single-frame
		// selection. compositeMinPixel is retained for foilMode where the
		// glare-suppression benefit outweighs the registration cost (user is
		// holding still for the foil sweep on purpose).
		diag.composite_method = opts.foilMode ? 'min_pixel' : 'best_frame';

		let composited: ImageBitmap;
		let ownsComposite: boolean;
		let bestFrameIdx = -1;
		if (opts.foilMode) {
			composited = await worker.compositeMinPixel(topFrames);
			ownsComposite = true;
		} else {
			// Highest score is at ranked[0] (sorted desc by adjustedScore).
			// Return a reference to the buffered/shutter bitmap directly;
			// caller's existing lifecycle owns close().
			bestFrameIdx = ranked[0].idx;
			composited = allFrames[bestFrameIdx];
			ownsComposite = false;
		}

		// For best_frame, post-score == the picked frame's pre-score; no
		// re-score needed. For min_pixel, the composite is a new bitmap so
		// re-score it.
		if (opts.foilMode) {
			try {
				const post = await worker.scoreFrame(composited);
				diag.post_composite_blur_variance = Math.round(post.blur_variance);
			} catch {
				diag.post_composite_blur_variance = diag.pre_composite_blur_variance;
			}
		} else {
			diag.post_composite_blur_variance = Math.round(scores[bestFrameIdx].blur_variance);
		}

		diag.composite_ms = Math.round(performance.now() - start);
		return { bitmap: composited, owned: ownsComposite, diag };
	} catch (err) {
		console.debug('[frame-fusion] fusion failed, falling back to shutter:', err);
		diag.composite_method = 'shutter_only';
		diag.composite_ms = Math.round(performance.now() - start);
		return { bitmap: shutter, owned: false, diag };
	}
}
