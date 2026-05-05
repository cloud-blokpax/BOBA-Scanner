/**
 * Scanner Analysis Composable
 *
 * Manages the auto-analyze loop: frame capture → alignment signal computation →
 * AR price overlay → auto-capture trigger.
 *
 * Runs on a 250ms interval when active. Computes viewfinder alignment signals
 * in the image worker via computeAlignmentSignals and classifies each frame
 * as 'no_card' | 'partial' | 'ready'. Auto-capture fires when the state has
 * been 'ready' for ≥300ms continuous (tunable).
 *
 * Thresholds validated Session 1.4.a:
 *   blur_inside >= 5500 AND corner_gradient_score >= 140 → 'ready'
 *   corner_gradient_score >= 100 → 'partial'
 *   otherwise → 'no_card'
 */

import { captureFrame } from '$lib/services/camera';
import { cloneImageBitmap, computeFrameHash } from '$lib/services/recognition';
import { getImageWorker, initWorkers } from '$lib/services/recognition-workers';
import { triggerHaptic } from '$lib/utils/haptics';
import { lookupOverlayPrice, type OverlayData } from './overlay-price-lookup';
import type { ViewfinderRect } from '$lib/services/constrained-crop';
import { useQuadDetection, type QuadDetectionState } from './use-quad-detection.svelte';
import { featureEnabled } from '$lib/stores/feature-flags.svelte';

const READY_DWELL_MS = 300;
const ALIGN_BLUR_THRESHOLD = 5500;
const ALIGN_CORNER_READY = 140;
const ALIGN_CORNER_PARTIAL = 100;

// Phase 2 Doc 2.2.x — second auto-capture trigger path: quad-stability.
// Slightly longer dwell than alignment because the geometric signal can
// flicker on focus pulses. 8 px in bitmap coords ≈ ~4 px on a 720p preview.
const QUAD_READY_DWELL_MS = 400;
const QUAD_MAX_MOTION_PX = 8;

export type AlignmentState = 'no_card' | 'partial' | 'ready';

export interface AnalysisState {
	readonly alignmentState: AlignmentState;
	readonly guidanceText: string | null;
	readonly overlayData: OverlayData | null;
	readonly overlayVisible: boolean;
	readonly showFlash: boolean;
	readonly alignmentReadySince: number | null;
	/** Phase 2 Doc 2.2 — read-through to the quad-detection composable. */
	readonly quad: QuadDetectionState;
	shouldAutoTrigger: () => boolean;
	start: () => void;
	stop: () => void;
	destroy: () => void;
	resetStability: () => void;
}

export function useScannerAnalysis(
	getVideoEl: () => HTMLVideoElement | null,
	isScanReady: () => boolean,
	onAutoCapture: () => Promise<void>,
	getViewfinderRect: () => ViewfinderRect | null
): AnalysisState {
	let _alignmentState = $state<AlignmentState>('no_card');
	let _alignmentReadySince = $state<number | null>(null);
	let _guidanceText = $state<string | null>(null);
	let _overlayData = $state<OverlayData | null>(null);
	let _overlayVisible = $state(false);
	let _showFlash = $state(false);

	let _interval: ReturnType<typeof setInterval> | null = null;
	let _overlayTimeout: ReturnType<typeof setTimeout> | null = null;
	let _overlayLookupInProgress = false;
	let _lastOverlayHash: string | null = null;
	let _autoCaptureFired = false;

	// Phase 2 Doc 2.2 — quad-detection composable. State is read through
	// the AnalysisState interface so callers see one source of truth.
	const quadDetection = useQuadDetection();
	const quadEnabled = featureEnabled('phase2_quad_overlay_v1');
	const quadAutoCaptureEnabled = featureEnabled('phase2_quad_autocapture_v1');

	function guidanceFor(state: AlignmentState): string {
		if (state === 'ready') return 'Hold still…';
		if (state === 'partial') return 'Align with frame';
		return 'Point at card';
	}

	async function runAnalysis() {
		const videoEl = getVideoEl();
		if (!videoEl || !isScanReady()) {
			_alignmentState = 'no_card';
			_alignmentReadySince = null;
			_guidanceText = null;
			_autoCaptureFired = false;
			quadDetection.reset();
			return;
		}

		let bitmap: ImageBitmap | null = null;
		try {
			bitmap = await captureFrame(videoEl);
			await initWorkers();

			const viewfinder = getViewfinderRect();
			// Fall back to a centered 60%×75% region of the bitmap if the caller
			// can't resolve a viewfinder rect yet (e.g., before video metadata
			// loaded). Keeps alignment signals meaningful on the first few ticks.
			const vf = viewfinder ?? {
				x: Math.round(bitmap.width * 0.2),
				y: Math.round(bitmap.height * 0.125),
				width: Math.round(bitmap.width * 0.6),
				height: Math.round(bitmap.height * 0.75)
			};

			// Phase 2 Doc 2.2.1 (under Doc 2.4.1) — Comlink calls effectively
			// transfer ImageBitmap; without a clone, whichever consumer
			// completes its bitmap reads first "wins" and the loser silently
			// fails. Match the recognition.ts pattern: clone for the worker
			// call, leave the original for the main-thread quad detection.
			const workerBitmap = quadEnabled()
				? await cloneImageBitmap(bitmap)
				: bitmap;

			const quadPromise = quadEnabled()
				? quadDetection.processBitmap(
					bitmap,
					_alignmentState === 'ready',
					videoEl
				)
				: Promise.resolve();

			const signals = await getImageWorker().computeAlignmentSignals(workerBitmap, {
				x: vf.x,
				y: vf.y,
				w: vf.width,
				h: vf.height
			});

			const nextState: AlignmentState =
				signals.blurInside >= ALIGN_BLUR_THRESHOLD &&
				signals.cornerGradientScore >= ALIGN_CORNER_READY
					? 'ready'
					: signals.cornerGradientScore >= ALIGN_CORNER_PARTIAL
						? 'partial'
						: 'no_card';

			// Wait for the parallel quad detection so we don't race the
			// finally{ bitmap.close() } below. Already started above.
			await quadPromise;

			const now = performance.now();
			if (nextState !== _alignmentState) {
				_alignmentState = nextState;
				_alignmentReadySince = nextState === 'ready' ? now : null;
				_autoCaptureFired = false;
			} else if (nextState === 'ready' && _alignmentReadySince === null) {
				_alignmentReadySince = now;
			}
			_guidanceText = guidanceFor(nextState);

			// AR Price Overlay: attempt lookup on the first 'ready' frame
			// so we don't fire lookups during re-acquisition churn.
			if (nextState === 'ready' && !_overlayLookupInProgress) {
				const frameHash = await computeFrameHash(bitmap);
				if (frameHash !== _lastOverlayHash) {
					_lastOverlayHash = frameHash;
					_overlayLookupInProgress = true;
					lookupOverlayPrice(frameHash)
						.then((data) => {
							if (data) {
								_overlayData = data;
								_overlayVisible = true;
								if (_overlayTimeout) clearTimeout(_overlayTimeout);
								_overlayTimeout = setTimeout(() => {
									_overlayVisible = false;
								}, 4000);
							}
						})
						.catch((err) => {
							console.debug('[scanner] AR overlay price lookup failed:', err);
						})
						.finally(() => {
							_overlayLookupInProgress = false;
						});
				}
			} else if (nextState !== 'ready') {
				_overlayData = null;
				_overlayVisible = false;
				_lastOverlayHash = null;
			}

			// Path A (existing): alignment-heuristic dwell.
			const alignmentReadyToFire =
				nextState === 'ready' &&
				_alignmentReadySince !== null &&
				now - _alignmentReadySince >= READY_DWELL_MS;

			// Path B (new): quad-detection stability, gated by feature flag.
			// Safety: never fire when alignment says no_card — protects against
			// the OpenCV detector latching onto a non-card 5:7 rectangle.
			const quadReadyToFire =
				quadEnabled() &&
				quadAutoCaptureEnabled() &&
				nextState !== 'no_card' &&
				quadDetection.detectedSince !== null &&
				now - quadDetection.detectedSince >= QUAD_READY_DWELL_MS &&
				quadDetection.motionPx !== null &&
				quadDetection.motionPx <= QUAD_MAX_MOTION_PX;

			if (!_autoCaptureFired && (alignmentReadyToFire || quadReadyToFire)) {
				_autoCaptureFired = true;
				_overlayData = null;
				_overlayVisible = false;
				_lastOverlayHash = null;
				_showFlash = true;
				setTimeout(() => {
					_showFlash = false;
				}, 150);
				triggerHaptic('tap');
				await onAutoCapture();
			}
		} catch (err) {
			console.debug('[Scanner] Frame analysis failed:', err);
		} finally {
			bitmap?.close();
		}
	}

	function start() {
		if (_interval) return;
		_interval = setInterval(runAnalysis, 250);
	}

	function stop() {
		if (_interval) {
			clearInterval(_interval);
			_interval = null;
		}
		quadDetection.reset();
	}

	function destroy() {
		stop();
		if (_overlayTimeout) {
			clearTimeout(_overlayTimeout);
			_overlayTimeout = null;
		}
	}

	function resetStability() {
		_alignmentReadySince = null;
		_autoCaptureFired = false;
	}

	function shouldAutoTrigger(): boolean {
		if (_autoCaptureFired) return false;
		const now = performance.now();
		const alignmentReady =
			_alignmentState === 'ready' &&
			_alignmentReadySince !== null &&
			now - _alignmentReadySince >= READY_DWELL_MS;
		const quadReady =
			quadEnabled() &&
			quadAutoCaptureEnabled() &&
			_alignmentState !== 'no_card' &&
			quadDetection.detectedSince !== null &&
			now - quadDetection.detectedSince >= QUAD_READY_DWELL_MS &&
			quadDetection.motionPx !== null &&
			quadDetection.motionPx <= QUAD_MAX_MOTION_PX;
		return alignmentReady || quadReady;
	}

	return {
		get alignmentState() {
			return _alignmentState;
		},
		get guidanceText() {
			return _guidanceText;
		},
		get overlayData() {
			return _overlayData;
		},
		get overlayVisible() {
			return _overlayVisible;
		},
		get showFlash() {
			return _showFlash;
		},
		get alignmentReadySince() {
			return _alignmentReadySince;
		},
		get quad() {
			return quadDetection;
		},
		shouldAutoTrigger,
		start,
		stop,
		destroy,
		resetStability
	};
}
