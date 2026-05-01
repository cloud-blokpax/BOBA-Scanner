/**
 * Scanner Pipeline State Store
 */

import type { ScanPipelineState, ScanResult } from '$lib/types';
import { recognizeCard, initWorkers, resetWorkerFailCount } from '$lib/services/recognition';

const initialState: ScanPipelineState = {
	status: 'idle',
	currentTier: null,
	result: null,
	error: null
};

let _scanState = $state<ScanPipelineState>({ ...initialState });

// Scan generation counter (Session 1.4-rect-pathA). Incremented on every
// startNewScan() / resetScanner() so an in-flight scan can be invalidated:
// once `_scanGeneration` moves past the value an in-flight scan captured,
// its late-arriving result is silently discarded instead of overwriting
// the next scan's UI state. Guards the "Try Again mid-scan" race.
let _scanGeneration = $state(0);

// Full-screen scanner overlay mode — hides top nav and bottom tab bar
let _scannerActive = $state(false);
export function scannerActive(): boolean { return _scannerActive; }
export function setScannerActive(active: boolean): void { _scannerActive = active; }

export function scanState(): ScanPipelineState { return _scanState; }
export function isScanning(): boolean {
	return ['capturing', 'processing', 'tier1', 'tier2'].includes(_scanState.status);
}
export function scanResult(): ScanResult | null { return _scanState.result; }

/** Current scan generation value. */
export function scanGeneration(): number { return _scanGeneration; }

/** True if `generation` was captured before the current scan started. */
export function isScanStale(generation: number): boolean { return generation !== _scanGeneration; }

/**
 * Bump the scan generation, force-clear scan state, and return the new
 * generation value. Callers should pass the returned generation to
 * `scanImage` and check `isScanStale()` before applying any result.
 */
export function startNewScan(): number {
	_scanGeneration += 1;
	_scanState = { ...initialState };
	return _scanGeneration;
}

export async function initScanner(): Promise<void> {
	// Reset failure counter on fresh scanner init so navigation acts as a retry
	resetWorkerFailCount();
	await initWorkers();
}

export async function scanImage(
	imageSource: File | Blob | ImageBitmap,
	options?: {
		isAuthenticated?: boolean;
		skipBlurCheck?: boolean;
		cropRegion?: { x: number; y: number; width: number; height: number } | null;
		gameHint?: string | null;
		/** Alignment classifier state at the moment of shutter. Written to
		 *  capture_context so Tier 1 hit rate can be segmented by capture quality. */
		alignmentStateAtCapture?: 'no_card' | 'partial' | 'ready' | null;
		/** Viewfinder rect (source-pixel coords) that was used to crop the bitmap. */
		viewfinder?: { x: number; y: number; width: number; height: number } | null;
		/** Session 2.1a: pre-shutter live-OCR consensus snapshot, used as a hint
		 *  in the Tier 1 canonical path. */
		liveConsensusSnapshot?:
			| import('$lib/services/live-ocr-coordinator').LiveOCRSnapshot
			| null;
		/** Doc 1, Phase 6: per-capture geometry telemetry from live corner
		 *  detection. Upload mode ignores this — recognition.ts runs
		 *  detectCard internally for File inputs. */
		geometry?: import('$lib/services/scan-writer.types').ScanWriteGeometry | null;
	},
	generation?: number
): Promise<ScanResult | null> {
	// Mint a generation if the caller didn't pass one. The Scanner component's
	// auto-capture path passes its own (so it can detect staleness around the
	// scanImage call); other call sites rely on this internal mint.
	const myGen = generation ?? startNewScan();

	if (!isScanStale(myGen)) {
		_scanState = { status: 'processing', currentTier: null, result: null, error: null };
	}

	try {
		const result = await recognizeCard(imageSource, (tier) => {
			// Drop progress updates from a scan that's already been superseded
			// by a Try Again. Without this, the old scan's tier ticks would
			// overwrite the fresh scan's state mid-flight.
			if (isScanStale(myGen)) return;
			_scanState = {
				..._scanState,
				status: `tier${tier}` as ScanPipelineState['status'],
				currentTier: tier
			};
		}, options);

		if (isScanStale(myGen)) return null;
		_scanState = { status: 'complete', currentTier: null, result, error: null };
		return result;
	} catch (err) {
		if (isScanStale(myGen)) return null;
		const errorMessage = err instanceof Error ? err.message : 'Scan failed';
		_scanState = { status: 'error', currentTier: null, result: null, error: errorMessage };
		return null;
	}
}

export function resetScanner(): void {
	// Bump generation so any in-flight scan from before reset gets discarded.
	_scanGeneration += 1;
	_scanState = { ...initialState };
}
