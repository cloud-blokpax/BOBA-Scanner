/**
 * Phase 6 — Per-device camera intrinsics for lens distortion correction.
 *
 * Values for iPhone are derived from ARKit's published camera calibration
 * (CameraCalibration) — approximated against a nominal 1080×1920 frame.
 * Pixel coords scale linearly to the actual frame resolution at use time.
 * These are PUBLIC APPROXIMATIONS, not per-device calibrations; refine
 * empirically from telemetry (avg aspect by device label).
 *
 * Unknown devices fall back to a mild barrel distortion estimate. Devices
 * marked 'identity' apply no correction (preserves pre-Phase-6 behavior).
 *
 * Registry uses regex matchers against navigator.userAgent. Add more
 * devices as they show up in telemetry. Never silently change existing
 * intrinsics — that flips production behavior with no rollback signal.
 */

export interface CameraIntrinsics {
	fx: number;
	fy: number;
	cx: number;
	cy: number;
	k1: number;
	k2: number;
	p1: number;
	p2: number;
	k3: number;
	source: 'published_apple' | 'published_google' | 'estimated' | 'identity';
	label: string;
}

const IDENTITY: CameraIntrinsics = {
	fx: 1080,
	fy: 1080,
	cx: 540,
	cy: 960,
	k1: 0,
	k2: 0,
	p1: 0,
	p2: 0,
	k3: 0,
	source: 'identity',
	label: 'unknown_device'
};

const REGISTRY: ReadonlyArray<{ matcher: RegExp; intrinsics: CameraIntrinsics }> = [
	{
		matcher: /iPhone\s*1[5-7]/,
		intrinsics: {
			fx: 1610,
			fy: 1610,
			cx: 540,
			cy: 960,
			k1: -0.15,
			k2: 0.12,
			p1: 0,
			p2: 0,
			k3: 0,
			source: 'published_apple',
			label: 'iPhone 15+ family'
		}
	},
	{
		matcher: /iPhone\s*1[34]/,
		intrinsics: {
			fx: 1480,
			fy: 1480,
			cx: 540,
			cy: 960,
			k1: -0.18,
			k2: 0.14,
			p1: 0,
			p2: 0,
			k3: 0,
			source: 'published_apple',
			label: 'iPhone 13/14 family'
		}
	},
	{
		matcher: /Pixel\s*[7-9]/,
		intrinsics: {
			fx: 1520,
			fy: 1520,
			cx: 540,
			cy: 960,
			k1: -0.2,
			k2: 0.16,
			p1: 0,
			p2: 0,
			k3: 0,
			source: 'published_google',
			label: 'Pixel 7-9 family'
		}
	}
];

/** Lookup intrinsics by user-agent. Falls back to estimated default for
 *  unknown mobile devices; identity for unrecognized desktop UAs. */
export function getIntrinsicsForUserAgent(ua: string): CameraIntrinsics {
	for (const entry of REGISTRY) {
		if (entry.matcher.test(ua)) return entry.intrinsics;
	}
	// Mobile UAs we don't recognize get a mild barrel-distortion estimate —
	// most phone wide-angle cameras need at least a small correction.
	if (/Mobile|iPhone|Android/.test(ua)) {
		return {
			...IDENTITY,
			k1: -0.1,
			k2: 0.05,
			source: 'estimated',
			label: 'estimated_default'
		};
	}
	return IDENTITY;
}

/**
 * Build cv.Mats for cv.undistort. Pixel values scale linearly to the
 * provided frame resolution. Caller owns and deletes the returned Mats.
 */
export function buildCvIntrinsics(
	intr: CameraIntrinsics,
	frameW: number,
	frameH: number,
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	cv: any
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
): { cameraMatrix: any; distCoeffs: any } {
	const sx = frameW / 1080;
	const sy = frameH / 1920;
	const cameraMatrix = cv.matFromArray(3, 3, cv.CV_64F, [
		intr.fx * sx, 0, intr.cx * sx,
		0, intr.fy * sy, intr.cy * sy,
		0, 0, 1
	]);
	const distCoeffs = cv.matFromArray(1, 5, cv.CV_64F, [
		intr.k1, intr.k2, intr.p1, intr.p2, intr.k3
	]);
	return { cameraMatrix, distCoeffs };
}
