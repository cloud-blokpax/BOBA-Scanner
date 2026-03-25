/**
 * Lazy OpenCV.js loader.
 *
 * Downloads the WASM binary only when a CV feature is first used.
 * Caches the loaded module for subsequent calls.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _cvPromise: Promise<any> | null = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _cv: any | null = null;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function loadOpenCV(): Promise<any> {
	if (_cv) return _cv;
	if (_cvPromise) return _cvPromise;

	_cvPromise = (async () => {
		// Dynamic import — Vite splits this into a separate async chunk
		const opencvModule = await import('@techstark/opencv-js');
		// The module default export IS the cv object after WASM init
		_cv = opencvModule.default || opencvModule;
		return _cv;
	})();

	try {
		return await _cvPromise;
	} finally {
		_cvPromise = null;
	}
}

export function isOpenCVLoaded(): boolean {
	return _cv !== null;
}
