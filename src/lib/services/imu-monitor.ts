/**
 * Phase 5 — IMU monitor for capture stability.
 *
 * Subscribes to DeviceMotionEvent and maintains a ring buffer of recent
 * samples. Provides:
 *   - Instantaneous motion magnitude → auto-capture stability gate
 *   - Timestamp-indexed lookup        → frame-quality scoring weight
 *
 * iOS requires explicit permission via DeviceMotionEvent.requestPermission(),
 * which MUST be invoked from a user gesture. Call requestImuPermission()
 * once on first scanner mount; failure is non-fatal — auto-capture
 * gracefully falls back to alignment-only stability signals.
 *
 * Pure module — no Svelte runes, no DOM dependency beyond `window`.
 */

interface MotionSample {
	t: number; // performance.now()
	ax: number;
	ay: number;
	az: number;
	rx: number;
	ry: number;
	rz: number;
}

export type ImuPermissionState = 'unknown' | 'granted' | 'denied' | 'unsupported';

export interface RecentMotion {
	acceleration_mean_mag: number;
	acceleration_max_mag: number;
	rotation_max_dps: number;
	samples_in_window: number;
}

const BUFFER_SIZE = 256; // ~4 seconds at 60 Hz

const buf: MotionSample[] = [];
let listening = false;
let permissionState: ImuPermissionState = 'unknown';

export function getPermissionState(): ImuPermissionState {
	return permissionState;
}

/**
 * Request IMU permission. Safe to call multiple times; subsequent calls
 * after grant are no-ops. Must be called from a user gesture on iOS.
 * Returns true if permission was granted (now or previously).
 */
export async function requestImuPermission(): Promise<boolean> {
	if (typeof window === 'undefined' || typeof DeviceMotionEvent === 'undefined') {
		permissionState = 'unsupported';
		return false;
	}
	if (permissionState === 'granted') {
		startListening();
		return true;
	}
	// iOS 13+ exposes a static requestPermission on the constructor.
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const DME = DeviceMotionEvent as any;
	if (typeof DME.requestPermission === 'function') {
		try {
			const result = await DME.requestPermission();
			permissionState = result === 'granted' ? 'granted' : 'denied';
		} catch {
			permissionState = 'denied';
		}
	} else {
		// Non-iOS browsers grant implicitly.
		permissionState = 'granted';
	}
	if (permissionState === 'granted') startListening();
	return permissionState === 'granted';
}

function onMotion(ev: DeviceMotionEvent): void {
	const t = performance.now();
	const a = ev.acceleration ?? { x: 0, y: 0, z: 0 };
	const r = ev.rotationRate ?? { alpha: 0, beta: 0, gamma: 0 };
	if (buf.length >= BUFFER_SIZE) buf.shift();
	buf.push({
		t,
		ax: a.x ?? 0,
		ay: a.y ?? 0,
		az: a.z ?? 0,
		rx: r.alpha ?? 0,
		ry: r.beta ?? 0,
		rz: r.gamma ?? 0
	});
}

function startListening(): void {
	if (listening) return;
	if (typeof window === 'undefined') return;
	listening = true;
	window.addEventListener('devicemotion', onMotion);
}

export function stopListening(): void {
	if (!listening) return;
	if (typeof window !== 'undefined') {
		window.removeEventListener('devicemotion', onMotion);
	}
	listening = false;
	buf.length = 0;
}

/**
 * Aggregate motion over the most-recent `windowMs` (default 500). Returns
 * zeros if no samples landed in that window — caller can interpret as
 * "no signal" and skip the gate.
 */
export function getRecentMotion(windowMs: number = 500): RecentMotion {
	if (buf.length === 0) {
		return {
			acceleration_mean_mag: 0,
			acceleration_max_mag: 0,
			rotation_max_dps: 0,
			samples_in_window: 0
		};
	}
	const cutoff = performance.now() - windowMs;
	let aSum = 0;
	let aMax = 0;
	let rMax = 0;
	let n = 0;
	for (let i = buf.length - 1; i >= 0; i--) {
		if (buf[i].t < cutoff) break;
		const aMag = Math.hypot(buf[i].ax, buf[i].ay, buf[i].az);
		const rMag = Math.hypot(buf[i].rx, buf[i].ry, buf[i].rz);
		aSum += aMag;
		if (aMag > aMax) aMax = aMag;
		if (rMag > rMax) rMax = rMag;
		n++;
	}
	return {
		acceleration_mean_mag: n > 0 ? aSum / n : 0,
		acceleration_max_mag: aMax,
		rotation_max_dps: rMax,
		samples_in_window: n
	};
}

/**
 * Mean acceleration magnitude in the ±50 ms window around a timestamp.
 * Used to weight buffered frames during best-frame selection (high motion
 * at frame capture → lower score).
 */
export function getMotionAtTimestamp(timestampMs: number): number {
	if (buf.length === 0) return 0;
	const half = 50;
	let sum = 0;
	let n = 0;
	for (const s of buf) {
		if (Math.abs(s.t - timestampMs) <= half) {
			sum += Math.hypot(s.ax, s.ay, s.az);
			n++;
		}
	}
	return n > 0 ? sum / n : 0;
}
