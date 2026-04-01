/**
 * Camera Service — getUserMedia wrapper
 *
 * Handles:
 *   - Environment-facing camera selection
 *   - iOS/Android compatibility
 *   - Torch/flashlight toggle
 *   - Stream lifecycle
 */

let currentStream: MediaStream | null = null;

/**
 * Check camera permission state without triggering a prompt.
 * Returns 'granted', 'denied', or 'prompt' (unknown / first-time).
 */
export async function checkCameraPermission(): Promise<'granted' | 'denied' | 'prompt'> {
	try {
		const result = await navigator.permissions.query({ name: 'camera' as PermissionName });
		return result.state;
	} catch {
		// Permissions API not supported (iOS Safari, Firefox on iOS, etc.)
		// Return 'granted' to skip the custom explainer — if permission is
		// actually denied, getUserMedia() in initCamera() will throw
		// NotAllowedError which is already handled with a proper error message.
		return 'granted';
	}
}

/**
 * Get the current active stream (for reuse across navigations).
 */
export function getActiveStream(): MediaStream | null {
	if (currentStream && currentStream.active) {
		return currentStream;
	}
	return null;
}

export interface CameraConfig {
	facingMode?: 'environment' | 'user';
	width?: number;
	height?: number;
	frameRate?: number;
}

const DEFAULT_CONFIG: CameraConfig = {
	facingMode: 'environment',
	width: 1280,
	height: 720,
	frameRate: 30
};

/**
 * Start the camera and return the MediaStream.
 */
export async function startCamera(config: CameraConfig = {}): Promise<MediaStream> {
	await stopCamera();

	const settings = { ...DEFAULT_CONFIG, ...config };

	const constraints: MediaStreamConstraints = {
		video: {
			facingMode: settings.facingMode,
			width: { ideal: settings.width },
			height: { ideal: settings.height },
			frameRate: { ideal: settings.frameRate }
		},
		audio: false
	};

	try {
		currentStream = await navigator.mediaDevices.getUserMedia(constraints);
	} catch (err) {
		console.debug('[camera] Preferred constraints failed, falling back:', err);
		// Fallback: try without specific constraints
		currentStream = await navigator.mediaDevices.getUserMedia({
			video: { facingMode: settings.facingMode },
			audio: false
		});
	}

	return currentStream;
}

/**
 * Stop the camera and release resources.
 * Always nullifies the stream reference even if stopping tracks throws,
 * to prevent resource leaks from holding a stale stream reference.
 */
export async function stopCamera(): Promise<void> {
	if (currentStream) {
		const stream = currentStream;
		currentStream = null;
		try {
			stream.getTracks().forEach((track) => track.stop());
		} catch (err) {
			console.warn('Error stopping camera tracks:', err);
		}
	}
}

/**
 * Toggle the torch/flashlight.
 */
export async function toggleTorch(enabled: boolean): Promise<boolean> {
	if (!currentStream) return false;

	const track = currentStream.getVideoTracks()[0];
	if (!track) return false;

	try {
		await track.applyConstraints({
			// @ts-expect-error - torch is a non-standard constraint
			advanced: [{ torch: enabled }]
		});
		return true;
	} catch (err) {
		console.debug('[camera] Torch toggle failed:', err);
		return false;
	}
}

/**
 * Capture a frame from the current video stream.
 */
export function captureFrame(
	video: HTMLVideoElement
): Promise<ImageBitmap> {
	return createImageBitmap(video);
}
