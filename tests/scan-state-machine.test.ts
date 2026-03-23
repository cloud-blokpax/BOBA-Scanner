import { describe, it, expect } from 'vitest';
import {
	createInitialState,
	cameraReady,
	frameAnalyzed,
	shouldAutoCapture,
	beginCapture,
	foilFrameCaptured,
	beginProcessing,
	processingComplete,
	reset,
	errorOccurred
} from '../src/lib/services/scan-state-machine';

describe('Scan State Machine', () => {
	it('starts in initializing phase', () => {
		const state = createInitialState();
		expect(state.phase).toBe('initializing');
		expect(state.guidanceText).toBe('Point camera at a card');
	});

	it('transitions to idle when camera is ready', () => {
		const state = cameraReady(createInitialState());
		expect(state.phase).toBe('idle');
	});

	it('ignores cameraReady when not in initializing phase', () => {
		const state = cameraReady({ ...createInitialState(), phase: 'processing' });
		expect(state.phase).toBe('processing');
	});

	it('transitions to detecting when card is found', () => {
		const idle = { ...createInitialState(), phase: 'idle' as const };
		const state = frameAnalyzed(idle, {
			cardDetected: true, isSharp: true, frameHash: 'abc123', hasGlare: false
		});
		expect(state.phase).toBe('detecting');
		expect(state.cardDetectedSince).toBeGreaterThan(0);
	});

	it('returns to idle when card disappears', () => {
		const detecting = { ...createInitialState(), phase: 'detecting' as const, cardDetectedSince: Date.now() };
		const state = frameAnalyzed(detecting, {
			cardDetected: false, isSharp: true, frameHash: null, hasGlare: false
		});
		expect(state.phase).toBe('idle');
		expect(state.stableFrameCount).toBe(0);
	});

	it('shows blur guidance when card detected but blurry', () => {
		const idle = { ...createInitialState(), phase: 'idle' as const };
		const state = frameAnalyzed(idle, {
			cardDetected: true, isSharp: false, frameHash: null, hasGlare: false
		});
		expect(state.guidanceText).toContain('blurry');
	});

	it('shows glare guidance when glare detected', () => {
		const idle = { ...createInitialState(), phase: 'idle' as const };
		const state = frameAnalyzed(idle, {
			cardDetected: true, isSharp: false, frameHash: null, hasGlare: true
		});
		expect(state.guidanceText).toContain('glare');
	});

	it('increments stable frame count in stabilizing', () => {
		const stabilizing = {
			...createInitialState(),
			phase: 'stabilizing' as const,
			stableFrameCount: 2,
			lastFrameHash: 'aaa',
			cardDetectedSince: Date.now()
		};
		const state = frameAnalyzed(stabilizing, {
			cardDetected: true, isSharp: true, frameHash: 'aab', hasGlare: false
		});
		expect(state.phase).toBe('stabilizing');
		expect(state.stableFrameCount).toBe(3);
	});

	it('triggers auto-capture after stable frames threshold', () => {
		const state = {
			...createInitialState(),
			phase: 'stabilizing' as const,
			stableFrameCount: 4
		};
		expect(shouldAutoCapture(state)).toBe(true);
	});

	it('does not trigger auto-capture below threshold', () => {
		const state = {
			...createInitialState(),
			phase: 'stabilizing' as const,
			stableFrameCount: 3
		};
		expect(shouldAutoCapture(state)).toBe(false);
	});

	it('does not trigger auto-capture in wrong phase', () => {
		const state = {
			...createInitialState(),
			phase: 'idle' as const,
			stableFrameCount: 10
		};
		expect(shouldAutoCapture(state)).toBe(false);
	});

	it('begins normal capture', () => {
		const state = beginCapture(createInitialState(), false);
		expect(state.phase).toBe('capturing');
	});

	it('begins foil capture', () => {
		const state = beginCapture(createInitialState(), true);
		expect(state.phase).toBe('foil_capturing');
		expect(state.foilCaptureIndex).toBe(0);
	});

	it('progresses foil captures', () => {
		let state = { ...createInitialState(), phase: 'foil_capturing' as const, foilCaptureIndex: 0 };
		state = foilFrameCaptured(state);
		expect(state.foilCaptureIndex).toBe(1);
		expect(state.phase).toBe('foil_capturing');

		state = foilFrameCaptured(state);
		expect(state.foilCaptureIndex).toBe(2);

		state = foilFrameCaptured(state);
		expect(state.phase).toBe('processing');
	});

	it('ignores foil capture in wrong phase', () => {
		const state = foilFrameCaptured({ ...createInitialState(), phase: 'idle' });
		expect(state.phase).toBe('idle');
	});

	it('transitions to processing', () => {
		const state = beginProcessing(createInitialState());
		expect(state.phase).toBe('processing');
		expect(state.guidanceText).toBe('Identifying card...');
	});

	it('transitions to result_success', () => {
		const state = processingComplete(beginProcessing(createInitialState()), true);
		expect(state.phase).toBe('result_success');
	});

	it('transitions to result_fail with error message', () => {
		const state = processingComplete(beginProcessing(createInitialState()), false, 'Card not found');
		expect(state.phase).toBe('result_fail');
		expect(state.errorMessage).toBe('Card not found');
	});

	it('uses default error message when none provided', () => {
		const state = processingComplete(beginProcessing(createInitialState()), false);
		expect(state.errorMessage).toBe('Card not identified');
	});

	it('resets cleanly to idle', () => {
		const messy = {
			...createInitialState(),
			phase: 'result_success' as const,
			stableFrameCount: 7,
			lastFrameHash: 'xyz',
			foilCaptureIndex: 2,
			errorMessage: 'old error'
		};
		const clean = reset(messy);
		expect(clean.phase).toBe('idle');
		expect(clean.stableFrameCount).toBe(0);
		expect(clean.errorMessage).toBeNull();
		expect(clean.lastFrameHash).toBeNull();
	});

	it('handles error transition', () => {
		const state = errorOccurred(createInitialState(), 'Camera failed');
		expect(state.phase).toBe('error');
		expect(state.errorMessage).toBe('Camera failed');
	});

	it('ignores frame analysis in non-applicable phases', () => {
		for (const phase of ['capturing', 'processing', 'result_success', 'error'] as const) {
			const state = frameAnalyzed(
				{ ...createInitialState(), phase },
				{ cardDetected: true, isSharp: true, frameHash: 'abc', hasGlare: false }
			);
			expect(state.phase).toBe(phase);
		}
	});
});
