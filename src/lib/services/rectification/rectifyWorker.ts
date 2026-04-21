/**
 * Disposable rectification worker (Path B2).
 *
 * One-shot: receives a bitmap in a postMessage, computes the rectified
 * output, sends a single response message back, and is terminated by
 * the caller. If OpenCV hangs on pathological input, the caller kills
 * this worker via `worker.terminate()` after a 3s main-thread timeout.
 * No state persists between scans because every scan spawns a fresh
 * worker — that is the entire point of this architecture.
 *
 * Critical constraint: this file is the ONLY place in the codebase that
 * loads OpenCV.js on the web tier. The persistent Comlink worker in
 * $lib/workers/image-processor.ts no longer touches OpenCV.
 */

import type {
	RectifyWorkerRequest,
	RectifyWorkerRectifyRequest,
	RectifyWorkerResponse,
	RectifyDiagnostic
} from './types';

// ── OpenCV loader ──────────────────────────────────────────
// OpenCV is served as a ~11MB static asset from /vendor/opencv.js (copied
// by scripts/copy-opencv.js at build time) to keep it out of the rollup
// graph. The UMD wrapper attaches `cv` to self when evaluated inside a
// classic worker. We cache the load promise so a retry inside one scan
// doesn't reload the script (browsers cache the response anyway, but this
// avoids re-instantiating the WASM runtime).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _cvPromise: Promise<any> | null = null;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function loadOpenCV(): Promise<any> {
	if (_cvPromise) return _cvPromise;
	_cvPromise = (async () => {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		(self as any).importScripts('/vendor/opencv.js');
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const cv: any = (self as any).cv;
		if (!cv) {
			throw new Error('OpenCV script loaded but self.cv is not defined');
		}

		// @techstark/opencv-js sets `cv.ready` as the authoritative "WASM
		// runtime is done instantiating" signal. Safe to await even if the
		// runtime is already initialized. Race against a 5s hard cap — if
		// WASM isn't ready in 5s on modern hardware, something is deeply
		// wrong and the main-thread timeout will kill us anyway.
		if (cv?.ready && typeof cv.ready.then === 'function') {
			await Promise.race([
				cv.ready,
				new Promise<never>((_, reject) =>
					setTimeout(() => reject(new Error('OpenCV cv.ready timed out after 5s')), 5000)
				)
			]);
		} else if (typeof cv?.Mat !== 'function') {
			await Promise.race([
				new Promise<void>((resolve) => {
					if (typeof cv?.Mat === 'function') { resolve(); return; }
					cv.onRuntimeInitialized = () => resolve();
					const poll = setInterval(() => {
						if (typeof cv?.Mat === 'function') {
							clearInterval(poll);
							resolve();
						}
					}, 50);
				}),
				new Promise<never>((_, reject) =>
					setTimeout(() => reject(new Error('OpenCV init timed out after 5s')), 5000)
				)
			]);
		}

		if (typeof cv?.Mat !== 'function') {
			throw new Error('OpenCV load completed but cv.Mat is not available');
		}
		return cv;
	})().catch((err) => {
		_cvPromise = null; // allow retry if worker lives long enough for another call (it shouldn't)
		throw err;
	});
	return _cvPromise;
}

// ── Geometry helpers (pure JS, no OpenCV) ─────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function bitmapToMat(cv: any, bitmap: ImageBitmap): any {
	const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
	const ctx = canvas.getContext('2d')!;
	ctx.drawImage(bitmap, 0, 0);
	const imageData = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
	return cv.matFromImageData(imageData);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractCorners(approx: any): Array<{ x: number; y: number }> {
	const corners: Array<{ x: number; y: number }> = [];
	for (let i = 0; i < approx.rows; i++) {
		corners.push({
			x: approx.data32S[i * 2],
			y: approx.data32S[i * 2 + 1]
		});
	}
	return corners;
}

function orderCornersClockwise(
	corners: Array<{ x: number; y: number }>
): Array<{ x: number; y: number }> {
	const sums = corners.map((c) => c.x + c.y);
	const diffs = corners.map((c) => c.y - c.x);
	const tl = corners[sums.indexOf(Math.min(...sums))];
	const br = corners[sums.indexOf(Math.max(...sums))];
	const tr = corners[diffs.indexOf(Math.min(...diffs))];
	const bl = corners[diffs.indexOf(Math.max(...diffs))];
	return [tl, tr, br, bl];
}

function quadAspectRatio(ordered: Array<{ x: number; y: number }>): number {
	const [tl, tr, br, bl] = ordered;
	const topW = Math.hypot(tr.x - tl.x, tr.y - tl.y);
	const bottomW = Math.hypot(br.x - bl.x, br.y - bl.y);
	const leftH = Math.hypot(bl.x - tl.x, bl.y - tl.y);
	const rightH = Math.hypot(br.x - tr.x, br.y - tr.y);
	const avgW = (topW + bottomW) / 2;
	const avgH = (leftH + rightH) / 2;
	if (avgH === 0) return 0;
	return avgW / avgH;
}

function averageCornerDeviation(ordered: Array<{ x: number; y: number }>): number {
	const deviations: number[] = [];
	for (let i = 0; i < 4; i++) {
		const prev = ordered[(i + 3) % 4];
		const curr = ordered[i];
		const next = ordered[(i + 1) % 4];
		const v1x = prev.x - curr.x;
		const v1y = prev.y - curr.y;
		const v2x = next.x - curr.x;
		const v2y = next.y - curr.y;
		const mag = Math.hypot(v1x, v1y) * Math.hypot(v2x, v2y);
		if (mag === 0) {
			deviations.push(90);
			continue;
		}
		const cos = Math.max(-1, Math.min(1, (v1x * v2x + v1y * v2y) / mag));
		const angleDeg = (Math.acos(cos) * 180) / Math.PI;
		deviations.push(Math.abs(angleDeg - 90));
	}
	return deviations.reduce((a, b) => a + b, 0) / 4;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function cleanupMats(mats: Array<any>): void {
	for (const m of mats) {
		if (m && typeof m.delete === 'function') {
			try { m.delete(); } catch { /* ignore */ }
		}
	}
}

// ── Rectification pipeline ────────────────────────────────

async function rectify(bitmap: ImageBitmap): Promise<RectifyWorkerResponse> {
	const startTime = performance.now();
	const BUDGET_MS = 2000;

	const diagnostic: RectifyDiagnostic = {
		succeeded: false,
		fail_reason: null,
		total_ms: 0,
		src_width: bitmap.width,
		src_height: bitmap.height,
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

	const finalize = (): void => {
		diagnostic.total_ms = Math.round(performance.now() - startTime);
	};

	const checkBudget = (stage: string): boolean => {
		if (performance.now() - startTime > BUDGET_MS) {
			diagnostic.fail_reason = `timeout_${stage}`;
			finalize();
			return false;
		}
		return true;
	};

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	let cv: any;
	try {
		cv = await loadOpenCV();
	} catch (err) {
		diagnostic.fail_reason = `opencv_load: ${err instanceof Error ? err.message : String(err)}`;
		finalize();
		return { ok: false, diagnostic };
	}

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const mats: Array<any> = [];
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	let contours: any = null;
	const scoredQuads: Array<{
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		quad: any;
		score: number;
		area_ratio: number;
		aspect: number;
		points: Array<{ x: number; y: number }>;
		convex: boolean;
		corner_dev: number;
	}> = [];

	const cleanup = (): void => {
		for (const sq of scoredQuads) {
			if (sq.quad && typeof sq.quad.delete === 'function') {
				try { sq.quad.delete(); } catch { /* ignore */ }
			}
		}
		if (contours && typeof contours.delete === 'function') {
			try { contours.delete(); } catch { /* ignore */ }
		}
		cleanupMats(mats);
	};

	try {
		const src = bitmapToMat(cv, bitmap);
		mats.push(src);
		const imageArea = src.rows * src.cols;

		if (!checkBudget('pre_gray')) { cleanup(); return { ok: false, diagnostic }; }
		const t0 = performance.now();
		const gray = new cv.Mat();
		mats.push(gray);
		cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
		diagnostic.timings.gray_ms = Math.round(performance.now() - t0);

		if (!checkBudget('pre_blur')) { cleanup(); return { ok: false, diagnostic }; }
		const t1 = performance.now();
		cv.GaussianBlur(gray, gray, new cv.Size(5, 5), 0);
		diagnostic.timings.blur_ms = Math.round(performance.now() - t1);

		if (!checkBudget('pre_canny')) { cleanup(); return { ok: false, diagnostic }; }
		const t2 = performance.now();
		const edges = new cv.Mat();
		mats.push(edges);
		cv.Canny(gray, edges, 40, 150);
		diagnostic.timings.canny_ms = Math.round(performance.now() - t2);

		if (!checkBudget('pre_dilate')) { cleanup(); return { ok: false, diagnostic }; }
		const t3 = performance.now();
		const kernel = cv.Mat.ones(3, 3, cv.CV_8U);
		mats.push(kernel);
		cv.dilate(edges, edges, kernel);
		diagnostic.timings.dilate_ms = Math.round(performance.now() - t3);

		if (!checkBudget('pre_contour')) { cleanup(); return { ok: false, diagnostic }; }
		const t4 = performance.now();
		contours = new cv.MatVector();
		const hierarchy = new cv.Mat();
		mats.push(hierarchy);
		cv.findContours(edges, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);
		diagnostic.contour_count = contours.size();
		diagnostic.timings.contour_ms = Math.round(performance.now() - t4);

		if (!checkBudget('pre_approx')) { cleanup(); return { ok: false, diagnostic }; }
		const t5 = performance.now();
		const MAX_CONTOURS_TO_EXAMINE = 50;
		const contourIndices: Array<{ idx: number; area: number }> = [];
		for (let i = 0; i < contours.size(); i++) {
			const c = contours.get(i);
			const area = cv.contourArea(c);
			c.delete();
			if (area < imageArea * 0.02) continue;
			contourIndices.push({ idx: i, area });
		}
		contourIndices.sort((a, b) => b.area - a.area);
		const examine = contourIndices.slice(0, MAX_CONTOURS_TO_EXAMINE);

		for (let loopIdx = 0; loopIdx < examine.length; loopIdx++) {
			if (!checkBudget(`approx_${loopIdx}`)) break;

			const { idx, area } = examine[loopIdx];
			const contour = contours.get(idx);
			const peri = cv.arcLength(contour, true);
			const approx = new cv.Mat();
			cv.approxPolyDP(contour, approx, 0.02 * peri, true);
			contour.delete();

			if (approx.rows !== 4) {
				approx.delete();
				continue;
			}

			diagnostic.quad_count += 1;
			const points = extractCorners(approx);
			const ordered = orderCornersClockwise(points);
			const aspect = quadAspectRatio(ordered);
			const area_ratio = area / imageArea;

			const areaScore = Math.min(1, Math.max(0, (area_ratio - 0.02) / 0.08));
			const aspectDelta = Math.abs(aspect - 0.714);
			const aspectScore = Math.min(1, Math.max(0, 1 - (aspectDelta - 0.05) / 0.15));
			const corner_dev = averageCornerDeviation(ordered);
			const orthoScore = Math.min(1, Math.max(0, 1 - corner_dev / 30));
			const convex = cv.isContourConvex(approx);
			const convexScore = convex ? 1 : 0;

			const score =
				areaScore * 0.35 + aspectScore * 0.35 + orthoScore * 0.20 + convexScore * 0.10;

			scoredQuads.push({ quad: approx, score, area_ratio, aspect, points: ordered, convex, corner_dev });
			if (score >= 0.5) diagnostic.viable_quad_count += 1;
		}
		diagnostic.timings.approx_ms = Math.round(performance.now() - t5);

		if (scoredQuads.length === 0) {
			diagnostic.fail_reason = diagnostic.contour_count === 0 ? 'no_contours' : 'no_quads';
			finalize();
			cleanup();
			return { ok: false, diagnostic };
		}

		scoredQuads.sort((a, b) => b.score - a.score);
		const best = scoredQuads[0];
		diagnostic.best_quad = {
			area_ratio: best.area_ratio,
			aspect: best.aspect,
			score: best.score,
			chosen: false,
			reject_reason: null,
			points: best.points
		};

		const MIN_ACCEPT_SCORE = 0.45;
		if (best.score < MIN_ACCEPT_SCORE) {
			diagnostic.fail_reason = 'no_valid_quad';
			diagnostic.best_quad.reject_reason =
				`score_${best.score.toFixed(2)}_below_${MIN_ACCEPT_SCORE}`;
			finalize();
			cleanup();
			return { ok: false, diagnostic };
		}

		if (!checkBudget('pre_warp')) { cleanup(); return { ok: false, diagnostic }; }
		const t6 = performance.now();
		const CANONICAL_W = 500;
		const CANONICAL_H = 700;
		const srcCorners = cv.matFromArray(
			4, 1, cv.CV_32FC2,
			best.points.flatMap((p) => [p.x, p.y])
		);
		mats.push(srcCorners);
		const dstCorners = cv.matFromArray(
			4, 1, cv.CV_32FC2,
			[0, 0, CANONICAL_W, 0, CANONICAL_W, CANONICAL_H, 0, CANONICAL_H]
		);
		mats.push(dstCorners);
		const M = cv.getPerspectiveTransform(srcCorners, dstCorners);
		mats.push(M);
		const warped = new cv.Mat();
		mats.push(warped);
		cv.warpPerspective(src, warped, M, new cv.Size(CANONICAL_W, CANONICAL_H));
		diagnostic.timings.warp_ms = Math.round(performance.now() - t6);

		const outCanvas = new OffscreenCanvas(CANONICAL_W, CANONICAL_H);
		const outCtx = outCanvas.getContext('2d')!;
		const imgData = outCtx.createImageData(CANONICAL_W, CANONICAL_H);
		imgData.data.set(warped.data as Uint8Array);
		outCtx.putImageData(imgData, 0, 0);
		const rectifiedBitmap = outCanvas.transferToImageBitmap();

		diagnostic.succeeded = true;
		diagnostic.best_quad.chosen = true;
		finalize();
		cleanup();

		return {
			ok: true,
			rectifiedBitmap,
			confidence: best.score,
			corners: best.points,
			diagnostic
		};
	} catch (err) {
		diagnostic.fail_reason = `opencv_error: ${err instanceof Error ? err.message : String(err)}`;
		finalize();
		cleanup();
		return { ok: false, diagnostic };
	}
}

// ── Message plumbing ──────────────────────────────────────

self.onmessage = async (event: MessageEvent<RectifyWorkerRequest>) => {
	const msg = event.data;

	// Pre-warm path (Path B3): load OpenCV eagerly and stay idle. No response
	// is posted for this message — the caller will either follow up with a
	// real rectify request or terminate us. If loadOpenCV rejects here, the
	// subsequent rectify call will hit the same failure path and return a
	// structured diagnostic; no need to signal anything to the main thread.
	if ('prewarm' in msg && msg.prewarm === true) {
		try {
			await loadOpenCV();
		} catch { /* swallow; real rectify call will surface the error */ }
		return;
	}

	const { bitmap } = msg as RectifyWorkerRectifyRequest;
	try {
		const response = await rectify(bitmap);
		if (response.ok) {
			// Transfer the rectified bitmap back to the main thread (zero-copy).
			(self as unknown as Worker).postMessage(response, [response.rectifiedBitmap]);
		} else {
			(self as unknown as Worker).postMessage(response);
		}
	} catch (err) {
		// Final safety net — rectify() already catches everything, but if
		// message handling itself throws, surface it as a structured failure.
		const fallback: RectifyWorkerResponse = {
			ok: false,
			diagnostic: {
				succeeded: false,
				fail_reason: `worker_exception: ${err instanceof Error ? err.message : String(err)}`,
				total_ms: 0,
				src_width: bitmap?.width ?? 0,
				src_height: bitmap?.height ?? 0,
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
			}
		};
		(self as unknown as Worker).postMessage(fallback);
	}
};
