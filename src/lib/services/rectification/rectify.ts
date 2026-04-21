/**
 * Main-thread rectification harness (Path B3 — disposable worker with
 * pre-warm stash).
 *
 * Every scan still gets a FRESH worker that is terminated after one
 * rectification. B2's disposable-per-scan guarantee is intact: no state
 * carries over between scans, hangs are killed via worker.terminate() per
 * HTML spec.
 *
 * What changed from B2: we stash one pre-warmed worker at camera-open time
 * so the first scan doesn't pay the ~2-3s OpenCV cold-start cost within
 * its 3s budget. Each rectifyBitmap() call:
 *   - consumes the stashed worker if present (already has OpenCV loaded), OR
 *   - spawns fresh if the stash is empty (fallback to B2 behavior).
 * After consumption, the stash is IMMEDIATELY refilled for the NEXT scan
 * (queueMicrotask, non-blocking).
 *
 * The stashed worker is "idle" — it's waiting for a postMessage that will
 * never come until a scan fires. OpenCV loading is triggered by posting a
 * 'prewarm' message; the worker responds by loading OpenCV but NOT
 * terminating itself, awaiting the real rectify message.
 *
 * Attempts 1.1–1.3 all tried to reuse a single worker across scans. One
 * hang poisoned the worker forever. This design accepts that OpenCV.js
 * WASM is uninterruptible from JS and uses per-scan Worker disposal as the
 * only viable abort mechanism. The pre-warm stash does NOT reuse workers;
 * each one is consumed exactly once.
 */

import type {
	RectifyWorkerRequest,
	RectifyWorkerRectifyRequest,
	RectifyWorkerPrewarmRequest,
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

/**
 * Stashed pre-warmed worker. Holds a worker that has already loaded (or is
 * loading) OpenCV and is awaiting its one rectify() call. Null when empty.
 *
 * Single-slot by design: we only need ONE worker ready for the next scan.
 * Allowing more would be a resource leak — if the user doesn't scan, workers
 * would accumulate on every preWarm() call.
 */
let _stashedWorker: Worker | null = null;

function spawnWorker(): Worker {
	// Classic worker so `importScripts('/vendor/opencv.js')` works — matches
	// the vite.config.ts worker.format: 'iife' setting.
	return new Worker(
		new URL('./rectifyWorker.ts', import.meta.url),
		{ type: 'classic' }
	);
}

/**
 * Pre-warm a rectification worker so the next rectifyBitmap() call doesn't
 * pay OpenCV cold-start cost. Call this on camera-open — the user is about
 * to compose a shot; loading OpenCV during compose time hides the latency.
 *
 * Idempotent: no-op if a worker is already stashed. Safe to call repeatedly
 * (e.g., on camera re-open after backgrounding).
 */
export function preWarm(): void {
	if (_stashedWorker) return;
	let w: Worker;
	try {
		w = spawnWorker();
	} catch {
		// Spawn failed — next rectifyBitmap() will spawn fresh and fail the
		// same way with a structured diagnostic. Nothing to recover here.
		return;
	}
	_stashedWorker = w;
	// If the worker crashes during prewarm, clear the stash so the next
	// rectifyBitmap call spawns fresh. Don't try to recover — next scan
	// just pays the cold-start cost.
	w.onerror = () => {
		if (_stashedWorker === w) _stashedWorker = null;
	};
	const req: RectifyWorkerPrewarmRequest = { prewarm: true };
	try {
		w.postMessage(req);
	} catch {
		try { w.terminate(); } catch { /* ignore */ }
		if (_stashedWorker === w) _stashedWorker = null;
	}
}

/**
 * Dispose the currently-stashed pre-warmed worker, if any. Call this when
 * the scanner is being torn down (e.g., user navigates away) to prevent
 * orphaned workers from accumulating resources.
 */
export function disposePreWarmed(): void {
	if (_stashedWorker) {
		try { _stashedWorker.terminate(); } catch { /* ignore */ }
		_stashedWorker = null;
	}
}

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

	// Consume the stashed worker if present; spawn fresh otherwise. Either
	// way, this worker is single-use and will be terminated after one call.
	let worker: Worker;
	if (_stashedWorker) {
		worker = _stashedWorker;
		_stashedWorker = null;
	} else {
		try {
			worker = spawnWorker();
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
	}

	// Immediately refill the stash for the NEXT scan — async, non-blocking.
	// queueMicrotask ensures the current event loop iteration (which is about
	// to postMessage to THIS worker) completes first.
	queueMicrotask(() => { preWarm(); });

	const response = await new Promise<RectifyWorkerResponse>((resolve) => {
		let settled = false;

		const settle = (r: RectifyWorkerResponse): void => {
			if (settled) return;
			settled = true;
			clearTimeout(timeoutHandle);
			// worker.terminate() is synchronous from the caller's view per the
			// HTML spec and will kill the worker thread even if OpenCV is in
			// the middle of an uninterruptible WASM call. This is the entire
			// reason disposable-per-scan exists.
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

		const request: RectifyWorkerRectifyRequest = { bitmap, inputWidth, inputHeight };
		try {
			// Transfer the bitmap (zero-copy). Caller must not touch `bitmap`
			// after this posts. Any main-thread use must happen BEFORE calling
			// rectifyBitmap or use a pre-cloned copy.
			worker.postMessage(request satisfies RectifyWorkerRequest, [bitmap]);
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
