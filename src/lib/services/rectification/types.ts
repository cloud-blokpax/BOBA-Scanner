/**
 * Shared types between the main thread and the disposable rectification worker.
 *
 * The diagnostic shape matches `RectificationAttemptRow` (see
 * rectification-diagnostic.ts) so existing telemetry writing is unchanged.
 */

export interface RectifyWorkerRectifyRequest {
	bitmap: ImageBitmap;
	inputWidth: number;
	inputHeight: number;
}

/**
 * Pre-warm request: tells the worker to load OpenCV eagerly and then sit
 * idle awaiting a rectify request. No response is posted for this message.
 * Caller either follows up with a rectify request or terminates the worker.
 */
export interface RectifyWorkerPrewarmRequest {
	prewarm: true;
}

export type RectifyWorkerRequest =
	| RectifyWorkerRectifyRequest
	| RectifyWorkerPrewarmRequest;

/**
 * Per-attempt rectification diagnostic. Always populated — on both success
 * and failure paths — so the caller can write a rectification_attempt row
 * regardless of outcome.
 */
export interface RectifyDiagnostic {
	succeeded: boolean;
	fail_reason: string | null;
	total_ms: number;
	src_width: number;
	src_height: number;
	contour_count: number;
	quad_count: number;
	viable_quad_count: number;
	best_quad: {
		area_ratio: number;
		aspect: number;
		score: number;
		chosen: boolean;
		reject_reason: string | null;
		points: Array<{ x: number; y: number }>;
	} | null;
	timings: {
		gray_ms: number;
		blur_ms: number;
		canny_ms: number;
		dilate_ms: number;
		contour_ms: number;
		approx_ms: number;
		warp_ms: number;
	};
}

export type RectifyWorkerResponse =
	| {
			ok: true;
			rectifiedBitmap: ImageBitmap;
			confidence: number;
			corners: Array<{ x: number; y: number }>;
			diagnostic: RectifyDiagnostic;
	  }
	| {
			ok: false;
			diagnostic: RectifyDiagnostic;
	  };

/**
 * Main-thread return shape from rectifyBitmap(). Always contains a diagnostic
 * so the caller can record telemetry regardless of success.
 */
export type RectifyResult =
	| {
			bitmap: ImageBitmap;
			confidence: number;
			corners: Array<{ x: number; y: number }>;
			diagnostic: RectifyDiagnostic;
	  }
	| {
			bitmap: null;
			diagnostic: RectifyDiagnostic;
	  };
