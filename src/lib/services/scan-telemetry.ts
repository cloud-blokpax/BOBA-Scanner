/**
 * Browser-side scan telemetry collector.
 *
 * Listens to passive sensor and network events and exposes a snapshot
 * function called at shutter-time. All fields are nullable — iOS Safari,
 * desktop browsers, and permission-gated APIs routinely return nothing
 * and the call path must not fail for those users.
 *
 * Privacy: this module never reads GPS, never reads EXIF, and never
 * touches the camera — those are owned by the recognition pipeline and
 * the EXIF helper respectively.
 */

export interface ScanTelemetry {
	// Network Information API (Chrome/Edge; absent in Safari)
	netEffectiveType: string | null;
	netDownlinkMbps: number | null;
	netRttMs: number | null;

	// PWA + session timing
	isPwaStandalone: boolean;
	pageSessionAgeMs: number;

	// Battery Status API (Chrome only; removed in Safari)
	batteryLevel: number | null;
	batteryCharging: boolean | null;

	// Device orientation snapshot (permission-gated on iOS 13+)
	deviceOrientationBeta: number | null;
	deviceOrientationGamma: number | null;

	// Rolling peak accel magnitude since the last snapshot (g-free,
	// gravity subtracted), or null if no motion events fired.
	accelMagnitude: number | null;
}

// Rolling state mutated by passive listeners.
let _maxAccel = 0;
let _orientationBeta: number | null = null;
let _orientationGamma: number | null = null;
let _pageLoadTime = Date.now();
let _initialized = false;
let _cachedBattery: { level: number | null; charging: boolean | null } | null = null;

/**
 * Register the passive listeners used to populate the rolling telemetry
 * buffers. Safe to call multiple times — subsequent calls are no-ops.
 * Safe on SSR (guarded by a typeof window check).
 */
export function initScanTelemetry(): void {
	if (typeof window === 'undefined') return;
	if (_initialized) return;
	_initialized = true;
	_pageLoadTime = Date.now();

	if ('DeviceOrientationEvent' in window) {
		try {
			window.addEventListener(
				'deviceorientation',
				(ev) => {
					_orientationBeta = typeof ev.beta === 'number' ? ev.beta : _orientationBeta;
					_orientationGamma = typeof ev.gamma === 'number' ? ev.gamma : _orientationGamma;
				},
				{ passive: true }
			);
		} catch {
			// no-op; listener registration failed
		}
	}

	if ('DeviceMotionEvent' in window) {
		try {
			window.addEventListener(
				'devicemotion',
				(ev) => {
					const a = ev.accelerationIncludingGravity;
					if (!a) return;
					const mag = Math.sqrt(
						(a.x ?? 0) ** 2 + (a.y ?? 0) ** 2 + (a.z ?? 0) ** 2
					) - 9.8;
					const abs = Math.abs(mag);
					if (abs > _maxAccel) _maxAccel = abs;
				},
				{ passive: true }
			);
		} catch {
			// no-op
		}
	}

	// Kick off the one-shot battery fetch so captureScanTelemetry has
	// a cached value by the first scan. Safe to fail silently.
	void primeBatteryStatus();
}

/**
 * Snapshot current telemetry state. Call at shutter-time.
 * Resets the rolling accel peak after reading so each scan captures
 * motion since the previous one.
 */
export function captureScanTelemetry(): ScanTelemetry {
	const out: ScanTelemetry = {
		netEffectiveType: null,
		netDownlinkMbps: null,
		netRttMs: null,
		isPwaStandalone: isPwaStandalone(),
		pageSessionAgeMs: Date.now() - _pageLoadTime,
		batteryLevel: _cachedBattery?.level ?? null,
		batteryCharging: _cachedBattery?.charging ?? null,
		deviceOrientationBeta: _orientationBeta,
		deviceOrientationGamma: _orientationGamma,
		accelMagnitude: _maxAccel > 0 ? _maxAccel : null
	};

	try {
		const conn = (navigator as unknown as {
			connection?: {
				effectiveType?: string;
				downlink?: number;
				rtt?: number;
			};
		}).connection;
		if (conn) {
			out.netEffectiveType = conn.effectiveType ?? null;
			out.netDownlinkMbps = typeof conn.downlink === 'number' ? conn.downlink : null;
			out.netRttMs = typeof conn.rtt === 'number' ? conn.rtt : null;
		}
	} catch {
		// no-op
	}

	_maxAccel = 0;
	return out;
}

function isPwaStandalone(): boolean {
	if (typeof window === 'undefined') return false;
	// iOS Safari uses the non-standard `navigator.standalone`
	const iosStandalone = (navigator as unknown as { standalone?: boolean }).standalone;
	if (iosStandalone === true) return true;
	try {
		if (window.matchMedia('(display-mode: standalone)').matches) return true;
	} catch {
		// no-op
	}
	return false;
}

/**
 * Resolve the Battery Status API once and cache the result for the
 * remainder of the page lifetime. Returns null fields on Safari (no API)
 * or on any unexpected error.
 */
export async function getBatteryStatus(): Promise<{
	level: number | null;
	charging: boolean | null;
}> {
	if (_cachedBattery) return _cachedBattery;
	try {
		const nav = navigator as unknown as {
			getBattery?: () => Promise<{ level: number; charging: boolean }>;
		};
		if (typeof nav.getBattery === 'function') {
			const battery = await nav.getBattery();
			_cachedBattery = {
				level: typeof battery.level === 'number' ? battery.level : null,
				charging: typeof battery.charging === 'boolean' ? battery.charging : null
			};
			return _cachedBattery;
		}
	} catch {
		// no-op
	}
	_cachedBattery = { level: null, charging: null };
	return _cachedBattery;
}

async function primeBatteryStatus(): Promise<void> {
	try {
		await getBatteryStatus();
	} catch {
		// swallow — telemetry must never escalate
	}
}
