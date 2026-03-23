/**
 * Scanner State Machine — Pure logic, no DOM or camera dependencies.
 *
 * Phases: initializing → idle → detecting → stabilizing → capturing →
 *         processing → result_success → result_fail → foil_capturing → error
 *
 * Every transition is an explicit function call with guards.
 * Testable with Vitest without any browser mocks.
 */

export type ScanPhase =
	| 'initializing'
	| 'idle'
	| 'detecting'
	| 'stabilizing'
	| 'capturing'
	| 'processing'
	| 'result_success'
	| 'result_fail'
	| 'foil_capturing'
	| 'error';

export interface ScanMachineState {
	phase: ScanPhase;
	stableFrameCount: number;
	lastFrameHash: string | null;
	cardDetectedSince: number | null;
	foilCaptureIndex: number;
	foilTotalCaptures: number;
	errorMessage: string | null;
	guidanceText: string;
}

const STABLE_FRAMES_REQUIRED = 4;
const FOIL_TOTAL_CAPTURES = 3;

export function createInitialState(): ScanMachineState {
	return {
		phase: 'initializing',
		stableFrameCount: 0,
		lastFrameHash: null,
		cardDetectedSince: null,
		foilCaptureIndex: 0,
		foilTotalCaptures: FOIL_TOTAL_CAPTURES,
		errorMessage: null,
		guidanceText: 'Point camera at a card'
	};
}

/**
 * Transition: Camera ready → idle
 */
export function cameraReady(state: ScanMachineState): ScanMachineState {
	if (state.phase !== 'initializing') return state;
	return { ...state, phase: 'idle', guidanceText: 'Point camera at a card' };
}

/**
 * Transition: Frame analyzed → detecting/stabilizing/idle
 */
export function frameAnalyzed(
	state: ScanMachineState,
	result: { cardDetected: boolean; isSharp: boolean; frameHash: string | null; hasGlare: boolean }
): ScanMachineState {
	if (!['idle', 'detecting', 'stabilizing'].includes(state.phase)) return state;

	if (!result.cardDetected || !result.isSharp) {
		let guidance = 'Point camera at a card';
		if (result.cardDetected && !result.isSharp) guidance = 'Hold steady — image is blurry';
		if (result.hasGlare) guidance = 'Reduce glare — tilt the card slightly';

		return {
			...state,
			phase: 'idle',
			stableFrameCount: 0,
			lastFrameHash: null,
			cardDetectedSince: null,
			guidanceText: guidance
		};
	}

	const now = Date.now();
	const detectedSince = state.cardDetectedSince ?? now;

	if (state.lastFrameHash && result.frameHash) {
		return {
			...state,
			phase: 'stabilizing',
			stableFrameCount: state.stableFrameCount + 1,
			lastFrameHash: result.frameHash,
			cardDetectedSince: detectedSince,
			guidanceText: 'Hold steady...'
		};
	}

	return {
		...state,
		phase: 'detecting',
		stableFrameCount: 0,
		lastFrameHash: result.frameHash,
		cardDetectedSince: detectedSince,
		guidanceText: 'Card detected — hold still'
	};
}

/**
 * Check if auto-capture should trigger.
 */
export function shouldAutoCapture(state: ScanMachineState): boolean {
	return state.phase === 'stabilizing' && state.stableFrameCount >= STABLE_FRAMES_REQUIRED;
}

/**
 * Transition: Begin capture
 */
export function beginCapture(state: ScanMachineState, foilMode: boolean): ScanMachineState {
	if (foilMode) {
		return { ...state, phase: 'foil_capturing', foilCaptureIndex: 0, guidanceText: 'Capture 1/3 — hold card at current angle' };
	}
	return { ...state, phase: 'capturing', guidanceText: 'Capturing...' };
}

/**
 * Transition: Foil capture progress
 */
export function foilFrameCaptured(state: ScanMachineState): ScanMachineState {
	if (state.phase !== 'foil_capturing') return state;
	const next = state.foilCaptureIndex + 1;
	if (next >= state.foilTotalCaptures) {
		return { ...state, phase: 'processing', foilCaptureIndex: next, guidanceText: 'Processing...' };
	}
	return {
		...state,
		foilCaptureIndex: next,
		guidanceText: `Capture ${next + 1}/${state.foilTotalCaptures} — tilt card slightly`
	};
}

/**
 * Transition: Begin processing
 */
export function beginProcessing(state: ScanMachineState): ScanMachineState {
	return { ...state, phase: 'processing', guidanceText: 'Identifying card...' };
}

/**
 * Transition: Processing complete
 */
export function processingComplete(state: ScanMachineState, success: boolean, errorMsg?: string): ScanMachineState {
	if (success) {
		return { ...state, phase: 'result_success', guidanceText: '' };
	}
	return { ...state, phase: 'result_fail', guidanceText: '', errorMessage: errorMsg || 'Card not identified' };
}

/**
 * Transition: Reset to idle
 */
export function reset(state: ScanMachineState): ScanMachineState {
	return {
		...createInitialState(),
		phase: 'idle',
		guidanceText: 'Point camera at a card'
	};
}

/**
 * Transition: Error
 */
export function errorOccurred(state: ScanMachineState, message: string): ScanMachineState {
	return { ...state, phase: 'error', errorMessage: message, guidanceText: '' };
}
