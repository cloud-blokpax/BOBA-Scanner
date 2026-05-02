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
	let _inFlight = false;
	let _smoothedBitmap: [Pt, Pt, Pt, Pt] | null = null;

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
				return;
			}
			const next: [Pt, Pt, Pt, Pt] = detection.corners as [Pt, Pt, Pt, Pt];
			// EMA in BITMAP coords (not CSS) so the underlying quad is
			// smoothed at the source. CSS is a downstream projection.
			const smoothed = smoothQuad(next, _smoothedBitmap, 0.5);
			_smoothedBitmap = smoothed;
			_bitmapCorners = smoothed;

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
		_inFlight = false;
	}

	return {
		get cssCorners() { return _cssCorners; },
		get quadState() { return _quadState; },
		get bitmapCorners() { return _bitmapCorners; },
		processBitmap,
		reset
	};
}
