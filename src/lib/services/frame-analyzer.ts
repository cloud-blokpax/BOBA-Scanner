/**
 * Frame Analyzer — Bridges the Scanner component and the image-processor worker.
 *
 * Provides high-level analysis functions that combine multiple worker calls
 * into single meaningful results. Handles adaptive throttling logic.
 */

export interface FrameAnalysisResult {
	cardDetected: boolean;
	isSharp: boolean;
	hasGlare: boolean;
	blurVariance: number;
	frameHash: string | null;
	hashDistance: number | null;
}

const BLUR_THRESHOLD = 100;
const HASH_STABILITY_THRESHOLD = 3;

/**
 * Determine the optimal analysis interval based on current state.
 */
export function getAdaptiveInterval(
	cardDetected: boolean,
	noCardDurationMs: number,
	lowBattery: boolean
): number {
	if (lowBattery) return 500;
	if (cardDetected) return 150;
	if (noCardDurationMs > 2000) return 500;
	return 250;
}

export { BLUR_THRESHOLD, HASH_STABILITY_THRESHOLD };
