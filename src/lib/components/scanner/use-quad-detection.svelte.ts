/**
 * Phase 2 Doc 2.2 — Live quad detection composable.
 *
 * Sits alongside use-scanner-analysis. Both are driven from the same
 * 250ms tick. Each tick captures a frame; the existing alignment-signal
 * worker call and this detection run effectively in parallel (worker
 * runs in its own thread; detection runs on main but lazy-loads OpenCV
 * which is already warm by Scanner.svelte's preload).
 *
 * Smoothing: EMA on corner positions (α=0.5). Lost detection fades out
 * over 200ms via the QuadOverlay component itself.
 *
 * Back-pressure: if a previous detection is still in flight when the
 * next tick fires, we drop that tick's detection (alignment signals
 * still run). Prevents queue buildup on slower devices.
 */

import { detectCard } from '$lib/services/upload-card-detector';
import { smoothQuad, mapBitmapQuadToCss, type Pt, type VideoLayout } from './quad-coords';

export type QuadState = 'detected' | 'ready' | 'lost';

export interface QuadDetectionState {
	readonly cssCorners: [Pt, Pt, Pt, Pt] | null;
	readonly quadState: QuadState;
	readonly bitmapCorners: [Pt, Pt, Pt, Pt] | null;
	/** Last per-tick max-corner displacement, in bitmap pixels. Null when no
	 *  prior frame to compare against (first detection or after reset). */
	readonly motionPx: number | null;
	/** performance.now() when continuous detection began. Null whenever
	 *  quadState becomes 'lost'. Used by analysis loop for stable-dwell. */
	readonly detectedSince: number | null;
	/** Call from the analysis tick AFTER you've captured a bitmap. */
	processBitmap: (
		bitmap: ImageBitmap,
		alignmentReady: boolean,
		videoEl: HTMLVideoElement
	) => Promise<void>;
	/** Call when scanning starts/stops to reset internal smoothing state. */
	reset: () => void;
}

export function useQuadDetection(): QuadDetectionState {
	let _bitmapCorners = $state<[Pt, Pt, Pt, Pt] | null>(null);
	let _cssCorners = $state<[Pt, Pt, Pt, Pt] | null>(null);
	let _quadState = $state<QuadState>('lost');
	let _motionPx = $state<number | null>(null);
	let _detectedSince = $state<number | null>(null);
	let _inFlight = false;
	let _smoothedBitmap: [Pt, Pt, Pt, Pt] | null = null;

	function maxCornerDisplacement(
		a: [Pt, Pt, Pt, Pt],
		b: [Pt, Pt, Pt, Pt]
	): number {
		let max = 0;
		for (let i = 0; i < 4; i++) {
			const dx = a[i].x - b[i].x;
			const dy = a[i].y - b[i].y;
			const d = Math.sqrt(dx * dx + dy * dy);
			if (d > max) max = d;
		}
		return max;
	}

	async function processBitmap(
		bitmap: ImageBitmap,
		alignmentReady: boolean,
		videoEl: HTMLVideoElement
	): Promise<void> {
		if (_inFlight) return; // back-pressure: drop this tick's detection
		_inFlight = true;
		try {
			const detection = await detectCard(bitmap, { mode: 'live' });
			if (detection.method !== 'corner_detected' || !detection.corners) {
				_bitmapCorners = null;
				_cssCorners = null;
				_quadState = 'lost';
				_smoothedBitmap = null; // reset smoothing on detection loss
				_motionPx = null;
				_detectedSince = null;
				return;
			}
			const next: [Pt, Pt, Pt, Pt] = detection.corners as [Pt, Pt, Pt, Pt];

			// Capture the previous SMOOTHED quad before EMA overwrites it.
			// Comparing against smoothed (not raw) avoids per-tick OCR noise
			// inflating the metric when the card is actually still.
			const prevSmoothed = _smoothedBitmap;

			// EMA in BITMAP coords (not CSS) so the underlying quad is
			// smoothed at the source. CSS is a downstream projection.
			const smoothed = smoothQuad(next, _smoothedBitmap, 0.5);
			_smoothedBitmap = smoothed;
			_bitmapCorners = smoothed;

			_motionPx = prevSmoothed ? maxCornerDisplacement(smoothed, prevSmoothed) : null;
			if (_detectedSince === null) {
				_detectedSince = performance.now();
			}

			// Project to CSS for rendering. Layout is read each tick — the
			// video element can resize on rotation/window change.
			const layout: VideoLayout = {
				naturalW: videoEl.videoWidth,
				naturalH: videoEl.videoHeight,
				displayedW: videoEl.clientWidth,
				displayedH: videoEl.clientHeight,
				fit: 'cover'
			};
			const css = mapBitmapQuadToCss(smoothed, layout);
			_cssCorners = css;
			_quadState = alignmentReady ? 'ready' : 'detected';
		} catch (err) {
			console.debug('[quad-detection] tick failed', err);
			_bitmapCorners = null;
			_cssCorners = null;
			_quadState = 'lost';
		} finally {
			_inFlight = false;
		}
	}

	function reset() {
		_bitmapCorners = null;
		_cssCorners = null;
		_quadState = 'lost';
		_smoothedBitmap = null;
		_motionPx = null;
		_detectedSince = null;
		_inFlight = false;
	}

	return {
		get cssCorners() { return _cssCorners; },
		get quadState() { return _quadState; },
		get bitmapCorners() { return _bitmapCorners; },
		get motionPx() { return _motionPx; },
		get detectedSince() { return _detectedSince; },
		processBitmap,
		reset
	};
}
