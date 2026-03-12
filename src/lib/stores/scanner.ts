/**
 * Scanner Pipeline State Store
 *
 * Tracks the current state of the 3-tier scan pipeline
 * for reactive UI updates.
 */

import { writable, derived } from 'svelte/store';
import type { ScanPipelineState, ScanResult } from '$lib/types';
import { recognizeCard, initWorkers } from '$lib/services/recognition';

const initialState: ScanPipelineState = {
	status: 'idle',
	currentTier: null,
	result: null,
	error: null
};

export const scanState = writable<ScanPipelineState>(initialState);

export const isScanning = derived(scanState, ($s) =>
	['capturing', 'processing', 'tier1', 'tier2', 'tier3'].includes($s.status)
);

export const scanResult = derived(scanState, ($s) => $s.result);

/**
 * Initialize scanner workers. Call once on app mount.
 */
export async function initScanner(): Promise<void> {
	await initWorkers();
}

/**
 * Scan an image through the 3-tier pipeline.
 */
export async function scanImage(imageSource: File | Blob | ImageBitmap): Promise<ScanResult | null> {
	scanState.set({
		status: 'processing',
		currentTier: null,
		result: null,
		error: null
	});

	try {
		const result = await recognizeCard(imageSource, (tier) => {
			scanState.update((s) => ({
				...s,
				status: `tier${tier}` as ScanPipelineState['status'],
				currentTier: tier
			}));
		});

		scanState.set({
			status: 'complete',
			currentTier: null,
			result,
			error: null
		});

		return result;
	} catch (err) {
		const errorMessage = err instanceof Error ? err.message : 'Scan failed';
		scanState.set({
			status: 'error',
			currentTier: null,
			result: null,
			error: errorMessage
		});
		return null;
	}
}

/**
 * Reset scanner state to idle.
 */
export function resetScanner(): void {
	scanState.set(initialState);
}
