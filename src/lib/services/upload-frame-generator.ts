/**
 * Test-time augmentation (TTA) frame generator for uploaded images.
 *
 * Session 2.1b: when the canonical Tier 1 pass (runCanonicalTier1) falls
 * below its confidence floor on a single static frame, we synthesize a
 * small bank of augmented frames from the same source and run consensus
 * OCR across them. Augmentations are subtle — rotation, brightness,
 * contrast, micro-crop — chosen to perturb marginal OCR reads without
 * distorting readable glyphs.
 *
 * Synthetic frames are correlated (a smudge that reads as "8" in the
 * source will likely read "8" in every copy), so this helps with
 * borderline OCR cases, not fundamentally unreadable sources. Haiku
 * remains the safety net beneath.
 *
 * Augmentation set is versioned via `AUGMENTATION_SET_VERSION` in
 * upload-pipeline.ts — bump when the parameter table below changes so
 * downstream telemetry can separate cohorts.
 */

export interface AugmentationSpec {
	/** Rotation around card center, degrees. Kept tiny (≤2°) so axis-aligned
	 *  OCR box detectors continue to work. */
	rotationDeg: number;
	/** Brightness delta applied via CSS filter: `brightness(1 + delta)`. */
	brightnessDelta: number;
	/** Contrast multiplier applied via CSS filter: `contrast(factor)`. */
	contrastFactor: number;
	/** Percentage of min(width,height) to crop off each edge — simulates the
	 *  user's framing wobble. */
	cropInsetPct: number;
}

export const UPLOAD_AUGMENTATIONS: AugmentationSpec[] = [
	{ rotationDeg: 0,    brightnessDelta: 0,     contrastFactor: 1.0,  cropInsetPct: 0     }, // identity
	{ rotationDeg: 1,    brightnessDelta: 0.05,  contrastFactor: 1.05, cropInsetPct: 0.01  },
	{ rotationDeg: -1,   brightnessDelta: -0.05, contrastFactor: 0.95, cropInsetPct: 0.01  },
	{ rotationDeg: 0.5,  brightnessDelta: 0.08,  contrastFactor: 1.0,  cropInsetPct: 0.015 },
	{ rotationDeg: -0.5, brightnessDelta: -0.08, contrastFactor: 1.0,  cropInsetPct: 0     }
];

/**
 * Stream augmented frames one at a time, with the next augmentation
 * pre-computed in parallel with the current frame's processing.
 *
 * Two memory + speed wins versus the array-returning generateFrames:
 *   1. Peak memory is bounded to TWO frames (current + prefetch) instead of
 *      all 5 (~32MB instead of ~80MB). Stops iOS Safari/Chrome OOM.
 *   2. The next frame's augmentation work overlaps with the current frame's
 *      OCR work. Augmentation is ~50ms, OCR is ~400ms — overlapping saves
 *      ~50ms × N frames of wall time at zero CPU cost.
 *
 * The caller MUST call `frame.close()` on each yielded frame when done.
 */
export async function* streamFrames(
	sourceBitmap: ImageBitmap
): AsyncGenerator<{ frame: ImageBitmap; specIndex: number }, void, void> {
	if (UPLOAD_AUGMENTATIONS.length === 0) return;

	let nextPromise: Promise<ImageBitmap> = applyAugmentation(sourceBitmap, UPLOAD_AUGMENTATIONS[0]);

	for (let i = 0; i < UPLOAD_AUGMENTATIONS.length; i++) {
		const frame = await nextPromise;

		if (i + 1 < UPLOAD_AUGMENTATIONS.length) {
			nextPromise = applyAugmentation(sourceBitmap, UPLOAD_AUGMENTATIONS[i + 1]);
		}

		yield { frame, specIndex: i };
	}
}

/** @deprecated Use streamFrames(). Kept temporarily for any external callers. */
export async function generateFrames(sourceBitmap: ImageBitmap): Promise<ImageBitmap[]> {
	const frames: ImageBitmap[] = [];
	for (const spec of UPLOAD_AUGMENTATIONS) {
		frames.push(await applyAugmentation(sourceBitmap, spec));
	}
	return frames;
}

async function applyAugmentation(
	bitmap: ImageBitmap,
	spec: AugmentationSpec
): Promise<ImageBitmap> {
	const { width: srcW, height: srcH } = bitmap;
	const insetPx = Math.floor(Math.min(srcW, srcH) * spec.cropInsetPct);
	const cropW = Math.max(1, srcW - 2 * insetPx);
	const cropH = Math.max(1, srcH - 2 * insetPx);

	const canvas = new OffscreenCanvas(cropW, cropH);
	const ctx = canvas.getContext('2d');
	if (!ctx) throw new Error('2D context unavailable for augmentation');

	// Brightness + contrast via CSS filter (GPU-accelerated when available).
	const b = 1 + spec.brightnessDelta;
	const c = spec.contrastFactor;
	ctx.filter = `brightness(${b}) contrast(${c})`;

	if (spec.rotationDeg !== 0) {
		ctx.translate(cropW / 2, cropH / 2);
		ctx.rotate((spec.rotationDeg * Math.PI) / 180);
		ctx.translate(-cropW / 2, -cropH / 2);
	}

	ctx.drawImage(bitmap, insetPx, insetPx, cropW, cropH, 0, 0, cropW, cropH);
	ctx.filter = 'none';

	return canvas.transferToImageBitmap();
}

export function disposeFrames(frames: ImageBitmap[]): void {
	for (const f of frames) {
		try {
			f.close();
		} catch {
			// Some browsers throw on double-close; harmless.
		}
	}
}
