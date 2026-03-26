/**
 * Scanner Pipeline State Store
 */

import type { ScanPipelineState, ScanResult } from '$lib/types';
import { recognizeCard, initWorkers } from '$lib/services/recognition';

const initialState: ScanPipelineState = {
	status: 'idle',
	currentTier: null,
	result: null,
	error: null
};

let _scanState = $state<ScanPipelineState>({ ...initialState });

// Full-screen scanner overlay mode — hides top nav and bottom tab bar
let _scannerActive = $state(false);
export function scannerActive(): boolean { return _scannerActive; }
export function setScannerActive(active: boolean): void { _scannerActive = active; }

export function scanState(): ScanPipelineState { return _scanState; }
export function isScanning(): boolean {
	return ['capturing', 'processing', 'tier1', 'tier2', 'tier3'].includes(_scanState.status);
}
export function scanResult(): ScanResult | null { return _scanState.result; }

export async function initScanner(): Promise<void> {
	await initWorkers();
}

export async function scanImage(
	imageSource: File | Blob | ImageBitmap,
	options?: { isAuthenticated?: boolean; skipBlurCheck?: boolean }
): Promise<ScanResult | null> {
	_scanState = { status: 'processing', currentTier: null, result: null, error: null };

	try {
		const result = await recognizeCard(imageSource, (tier) => {
			_scanState = {
				..._scanState,
				status: `tier${tier}` as ScanPipelineState['status'],
				currentTier: tier
			};
		}, options);

		_scanState = { status: 'complete', currentTier: null, result, error: null };
		return result;
	} catch (err) {
		const errorMessage = err instanceof Error ? err.message : 'Scan failed';
		_scanState = { status: 'error', currentTier: null, result: null, error: errorMessage };
		return null;
	}
}

export function resetScanner(): void {
	_scanState = { ...initialState };
}
