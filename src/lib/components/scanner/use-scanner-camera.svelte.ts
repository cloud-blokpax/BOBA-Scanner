/**
 * Scanner Camera Composable
 *
 * Manages camera stream lifecycle, permission flow, visibility handling,
 * and torch control. Returns reactive state for the Scanner UI to bind.
 */

import { startCamera, stopCamera, toggleTorch, checkCameraPermission, getActiveStream } from '$lib/services/camera';

export type CameraState = 'initializing' | 'ready' | 'error';

export interface ScannerCameraResult {
	readonly cameraError: string | null;
	readonly showExplainer: boolean;
	readonly showPermissionBlocked: boolean;
	readonly torchOn: boolean;
	/** Initialize camera — checks permissions first, shows explainer if needed */
	initCamera: (videoEl: HTMLVideoElement, onReady: () => void) => Promise<void>;
	/** Accept the pre-prompt explainer and start the camera */
	acceptExplainer: (videoEl: HTMLVideoElement, onReady: () => void) => Promise<void>;
	/** Toggle torch on/off */
	handleTorchToggle: () => Promise<void>;
	/** Setup visibility change handler (returns cleanup function) */
	setupVisibilityHandler: (videoEl: HTMLVideoElement, onResume: () => void, onPause: () => void) => () => void;
	/** Stop camera and clean up */
	destroy: () => void;
}

export function useScannerCamera(embedded: boolean): ScannerCameraResult {
	let _cameraError = $state<string | null>(null);
	let _showExplainer = $state(false);
	let _showPermissionBlocked = $state(false);
	let _torchOn = $state(false);

	async function startCameraStream(videoEl: HTMLVideoElement, onReady: () => void) {
		try {
			const existing = getActiveStream();
			const stream = existing || await startCamera();
			videoEl.srcObject = stream;
			await videoEl.play();
			onReady();
		} catch (err) {
			console.error('Camera error:', err);
			if (err instanceof DOMException) {
				if (err.name === 'NotAllowedError') {
					_showPermissionBlocked = true;
					_cameraError = 'Camera access was denied. Please enable camera permissions in your browser settings and reload.';
				} else if (err.name === 'NotFoundError') {
					_cameraError = 'No camera found on this device. Try uploading a photo instead.';
				} else if (err.name === 'NotReadableError') {
					_cameraError = 'Camera is in use by another app. Close other apps and try again.';
				} else {
					_cameraError = 'Could not access camera. Make sure you are using HTTPS.';
				}
			} else {
				_cameraError = 'Camera failed to start. Please reload the page.';
			}
			throw err; // Re-throw so caller can set phase to 'error'
		}
	}

	async function initCamera(videoEl: HTMLVideoElement, onReady: () => void) {
		const permission = await checkCameraPermission();
		if (permission === 'granted' || embedded) {
			await startCameraStream(videoEl, onReady);
		} else if (permission === 'denied') {
			_showPermissionBlocked = true;
			_cameraError = 'Camera access was denied. Please enable camera permissions in your browser settings and reload.';
			throw new Error('Camera permission denied');
		} else {
			_showExplainer = true;
		}
	}

	async function acceptExplainer(videoEl: HTMLVideoElement, onReady: () => void) {
		_showExplainer = false;
		await startCameraStream(videoEl, onReady);
	}

	async function handleTorchToggle() {
		_torchOn = await toggleTorch(!_torchOn);
	}

	function setupVisibilityHandler(videoEl: HTMLVideoElement, onResume: () => void, onPause: () => void): () => void {
		const handler = () => {
			if (document.visibilityState === 'hidden') {
				onPause();
				_torchOn = false;
			} else if (document.visibilityState === 'visible') {
				const existing = getActiveStream();
				if (existing && videoEl) {
					videoEl.srcObject = existing;
					videoEl.play().then(() => {
						onResume();
					}).catch(() => {
						startCameraStream(videoEl, onResume).catch(() => {
							// Camera re-acquisition failed — error state already set
						});
					});
				} else {
					startCameraStream(videoEl, onResume).catch(() => {
						// Camera re-acquisition failed — error state already set
					});
				}
			}
		};
		document.addEventListener('visibilitychange', handler);
		return () => document.removeEventListener('visibilitychange', handler);
	}

	function destroy() {
		stopCamera();
		_torchOn = false;
	}

	return {
		get cameraError() { return _cameraError; },
		get showExplainer() { return _showExplainer; },
		get showPermissionBlocked() { return _showPermissionBlocked; },
		get torchOn() { return _torchOn; },
		initCamera,
		acceptExplainer,
		handleTorchToggle,
		setupVisibilityHandler,
		destroy,
	};
}
