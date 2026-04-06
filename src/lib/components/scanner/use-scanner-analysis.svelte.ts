/**
 * Scanner Analysis Composable
 *
 * Manages the auto-analyze loop: frame capture → card presence detection →
 * frame stability tracking → AR price overlay → auto-capture trigger.
 *
 * Runs on a 250ms interval when active. Tracks frame hashes to detect
 * when the card is being held still enough for auto-capture.
 */

import { captureFrame } from '$lib/services/camera';
import { analyzeFrame, computeFrameHash, computeHammingDistance } from '$lib/services/recognition';
import { triggerHaptic } from '$lib/utils/haptics';
import { lookupOverlayPrice, type OverlayData } from './overlay-price-lookup';

const STABLE_FRAMES_REQUIRED = 3;
const STABILITY_THRESHOLD = 5;
const GUIDANCE_COOLDOWN = 1500;

export interface AnalysisState {
	readonly bracketState: 'idle' | 'detected' | 'locked';
	readonly guidanceText: string | null;
	readonly overlayData: OverlayData | null;
	readonly overlayVisible: boolean;
	readonly showFlash: boolean;
	readonly stableFrameCount: number;
	readonly lastFrameHash: string | null;
	start: () => void;
	stop: () => void;
	destroy: () => void;
	resetStability: () => void;
}

export function useScannerAnalysis(
	getVideoEl: () => HTMLVideoElement | null,
	isScanReady: () => boolean,
	onAutoCapture: () => Promise<void>,
): AnalysisState {
	let _bracketState = $state<'idle' | 'detected' | 'locked'>('idle');
	let _guidanceText = $state<string | null>(null);
	let _guidanceLastChanged = $state(0);
	let _overlayData = $state<OverlayData | null>(null);
	let _overlayVisible = $state(false);
	let _showFlash = $state(false);

	let _lastFrameHash = $state<string | null>(null);
	let _stableFrameCount = $state(0);
	let _cardDetectedSince: number | null = null;
	let _interval: ReturnType<typeof setInterval> | null = null;
	let _overlayTimeout: ReturnType<typeof setTimeout> | null = null;
	let _overlayLookupInProgress = false;
	let _lastOverlayHash: string | null = null;

	function updateGuidance(text: string | null) {
		const now = Date.now();
		if (now - _guidanceLastChanged < GUIDANCE_COOLDOWN && _guidanceText !== null) return;
		_guidanceText = text;
		_guidanceLastChanged = now;
	}

	async function runAnalysis() {
		const videoEl = getVideoEl();
		if (!videoEl || !isScanReady()) {
			_bracketState = 'idle';
			_cardDetectedSince = null;
			_stableFrameCount = 0;
			_lastFrameHash = null;
			return;
		}

		let bitmap: ImageBitmap | null = null;
		try {
			bitmap = await captureFrame(videoEl);
			const result = await analyzeFrame(bitmap);

			if (result.cardDetected && result.isSharp) {
				const frameHash = await computeFrameHash(bitmap);
				bitmap.close();
				bitmap = null;

				if (_lastFrameHash) {
					const dist = await computeHammingDistance(_lastFrameHash, frameHash);
					if (dist <= STABILITY_THRESHOLD) {
						_stableFrameCount++;
					} else {
						_stableFrameCount = 1;
					}
				} else {
					_stableFrameCount = 1;
				}
				_lastFrameHash = frameHash;

				// AR Price Overlay: attempt lookup on first stable frame
				if (_stableFrameCount === 1 && frameHash !== _lastOverlayHash && !_overlayLookupInProgress) {
					_lastOverlayHash = frameHash;
					_overlayLookupInProgress = true;
					lookupOverlayPrice(frameHash).then(data => {
						if (data) {
							_overlayData = data;
							_overlayVisible = true;
							if (_overlayTimeout) clearTimeout(_overlayTimeout);
							_overlayTimeout = setTimeout(() => { _overlayVisible = false; }, 4000);
						}
					}).catch((err) => {
						console.debug('[scanner] AR overlay price lookup failed:', err);
					}).finally(() => {
						_overlayLookupInProgress = false;
					});
				}

				if (_stableFrameCount >= STABLE_FRAMES_REQUIRED) {
					_bracketState = 'locked';
					_stableFrameCount = 0;
					_lastFrameHash = null;
					updateGuidance(null);
					// Trigger auto-capture
					_overlayData = null;
					_overlayVisible = false;
					_lastOverlayHash = null;
					_showFlash = true;
					setTimeout(() => { _showFlash = false; }, 150);
					triggerHaptic('tap');
					await onAutoCapture();
					_bracketState = 'idle';
				} else if (!_cardDetectedSince) {
					_cardDetectedSince = Date.now();
					_bracketState = 'detected';
					updateGuidance('Hold still...');
				}
			} else {
				bitmap.close();
				bitmap = null;
				_stableFrameCount = 0;
				_lastFrameHash = null;
				_cardDetectedSince = null;
				_overlayData = null;
				_overlayVisible = false;
				_lastOverlayHash = null;

				if (result.cardDetected && !result.isSharp) {
					_bracketState = 'idle';
					updateGuidance('Hold steady...');
				} else {
					_bracketState = 'idle';
					updateGuidance('Position card within the frame');
				}
			}
		} catch (err) {
			console.debug('[Scanner] Frame analysis failed:', err);
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
	}

	function destroy() {
		stop();
		if (_overlayTimeout) {
			clearTimeout(_overlayTimeout);
			_overlayTimeout = null;
		}
	}

	function resetStability() {
		_stableFrameCount = 0;
		_lastFrameHash = null;
	}

	return {
		get bracketState() { return _bracketState; },
		get guidanceText() { return _guidanceText; },
		get overlayData() { return _overlayData; },
		get overlayVisible() { return _overlayVisible; },
		get showFlash() { return _showFlash; },
		get stableFrameCount() { return _stableFrameCount; },
		get lastFrameHash() { return _lastFrameHash; },
		start,
		stop,
		destroy,
		resetStability,
	};
}
