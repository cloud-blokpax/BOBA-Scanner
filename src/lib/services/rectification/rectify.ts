/**
 * Main-thread rectification harness (Path B2 — disposable worker).
 *
 * Every call spawns a brand-new Worker, runs ONE rectification, and
 * terminates that worker on any resolution path (success, failure,
 * timeout, error). No pooling. No reuse. This is the whole point of
 * B2: if OpenCV hangs mid-WASM-call, worker.terminate() kills the
 * worker thread unconditionally per the HTML spec, and the next scan
 * gets a fresh worker with no poisoned state.
 *
 * Attempts 1.1–1.3 all failed because they tried to reuse a single
 * worker across scans. One hang poisoned the worker forever. This
 * design accepts that OpenCV.js WASM is uninterruptible from JS and
 * uses per-scan Worker disposal as the only viable abort mechanism.
 */

import type {
	RectifyWorkerRequest,
	RectifyWorkerResponse,
	RectifyResult,
	RectifyDiagnostic
} from './types';

/**
 * Main-thread timeout. Longer than the worker's internal 2s budget so
 * a well-behaved worker always resolves first. If it hasn't responded
 * by 3s, it's hung on a WASM call and we terminate unconditionally.
 */
const MAIN_THREAD_TIMEOUT_MS = 3000;

function emptyDiagnostic(
	inputWidth: number,
	inputHeight: number,
	failReason: string,
	elapsedMs: number
): RectifyDiagnostic {
	return {
		succeeded: false,
		fail_reason: failReason,
		total_ms: elapsedMs,
		src_width: inputWidth,
		src_height: inputHeight,
		contour_count: 0,
		quad_count: 0,
		viable_quad_count: 0,
		best_quad: null,
		timings: {
			gray_ms: 0,
			blur_ms: 0,
			canny_ms: 0,
			dilate_ms: 0,
			contour_ms: 0,
			approx_ms: 0,
			warp_ms: 0
		}
	};
}

/**
 * Rectify a bitmap via a disposable worker.
 *
 * The caller must NOT rely on `bitmap` after this returns — ownership is
 * transferred to the worker. Returns a RectifyResult containing either a
 * rectified bitmap (success) or `null` (failure), plus a diagnostic object
 * that is ALWAYS populated.
 *
 * Never throws. Any exception path produces a failure RectifyResult so
 * the scan pipeline can fall through to the raw bitmap.
 */
export async function rectifyBitmap(bitmap: ImageBitmap): Promise<RectifyResult> {
	const mainStart = performance.now();
	const inputWidth = bitmap.width;
	const inputHeight = bitmap.height;

	// Classic worker so `importScripts('/vendor/opencv.js')` works — matches
	// the vite.config.ts worker.format: 'iife' setting. Fresh instance each
	// call. This is load-bearing: do NOT add pooling, do NOT reuse workers.
	let worker: Worker;
	try {
		worker = new Worker(
			new URL('./rectifyWorker.ts', import.meta.url),
			{ type: 'classic' }
		);
	} catch (err) {
		return {
			bitmap: null,
			diagnostic: emptyDiagnostic(
				inputWidth,
				inputHeight,
				`worker_spawn: ${err instanceof Error ? err.message : String(err)}`,
				Math.round(performance.now() - mainStart)
			)
		};
	}

	const response = await new Promise<RectifyWorkerResponse>((resolve) => {
		let settled = false;

		const settle = (r: RectifyWorkerResponse): void => {
			if (settled) return;
			settled = true;
			clearTimeout(timeoutHandle);
			// worker.terminate() is synchronous from the caller's view per the
			// HTML spec and will kill the worker thread even if OpenCV is in
			// the middle of an uninterruptible WASM call. This is the entire
			// reason Path B2 exists.
			worker.terminate();
			resolve(r);
		};

		const timeoutHandle = setTimeout(() => {
			settle({
				ok: false,
				diagnostic: emptyDiagnostic(
					inputWidth,
					inputHeight,
					'main_thread_timeout',
					MAIN_THREAD_TIMEOUT_MS
				)
			});
		}, MAIN_THREAD_TIMEOUT_MS);

		worker.onmessage = (e: MessageEvent<RectifyWorkerResponse>) => {
			settle(e.data);
		};

		worker.onerror = (e: ErrorEvent) => {
			settle({
				ok: false,
				diagnostic: emptyDiagnostic(
					inputWidth,
					inputHeight,
					`worker_onerror: ${e.message || 'unknown'}`,
					Math.round(performance.now() - mainStart)
				)
			});
		};

		const request: RectifyWorkerRequest = { bitmap, inputWidth, inputHeight };
		try {
			// Transfer the bitmap (zero-copy). Caller must not touch `bitmap`
			// after this posts. Any main-thread use must happen BEFORE calling
			// rectifyBitmap or use a pre-cloned copy.
			worker.postMessage(request, [bitmap]);
		} catch (err) {
			settle({
				ok: false,
				diagnostic: emptyDiagnostic(
					inputWidth,
					inputHeight,
					`post_message: ${err instanceof Error ? err.message : String(err)}`,
					Math.round(performance.now() - mainStart)
				)
			});
		}
	});

	if (response.ok) {
		return {
			bitmap: response.rectifiedBitmap,
			confidence: response.confidence,
			corners: response.corners,
			diagnostic: response.diagnostic
		};
	}
	return { bitmap: null, diagnostic: response.diagnostic };
}
