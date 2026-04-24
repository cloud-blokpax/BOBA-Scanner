/**
 * Runtime shim for `@techstark/opencv-js`.
 *
 * Vite's `resolve.alias` redirects every `import cv from '@techstark/opencv-js'`
 * (notably inside `@gutenye/ocr-common`) to this file. The real UMD bundle is
 * served as a static asset from `/vendor/opencv.js` — keeping ~10MB of
 * embedded WebAssembly out of the client JS budget.
 *
 * Usage contract: call `preloadOpencv()` and await it before any code path
 * that ultimately imports `@gutenye/ocr-browser` runs. Once the UMD has
 * installed `globalThis.cv` and the Emscripten runtime has fired
 * `onRuntimeInitialized`, the default-export proxy forwards every property
 * access to the live global — so downstream `cv.cvtColor(...)` calls
 * behave identically to a direct npm import.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

declare global {
	// eslint-disable-next-line no-var
	var __opencvLoadPromise: Promise<void> | undefined;
	// eslint-disable-next-line no-var
	var cv: any;
}

function getCv(): any {
	const cv = (globalThis as any).cv;
	if (!cv || !cv.Mat) {
		throw new Error(
			'[opencv-shim] cv global not ready. Call preloadOpencv() before using OCR.'
		);
	}
	return cv;
}

// Forward every access to the live global. OCR code reads constants
// (cv.CV_32SC2), calls methods (cv.cvtColor), and constructs types (new cv.Mat)
// — Proxy traps cover each case by re-dispatching to `globalThis.cv` at
// call time.
const cvProxy = new Proxy(Object.create(null), {
	get(_target, prop) {
		return getCv()[prop as keyof typeof globalThis.cv];
	},
	has(_target, prop) {
		return prop in getCv();
	},
	ownKeys() {
		return Reflect.ownKeys(getCv());
	},
	getOwnPropertyDescriptor(_target, prop) {
		return Reflect.getOwnPropertyDescriptor(getCv(), prop);
	}
});

export default cvProxy;

export async function preloadOpencv(): Promise<void> {
	if ((globalThis as any).cv?.Mat) return;
	if (typeof document === 'undefined') {
		throw new Error('[opencv-shim] preloadOpencv requires a browser environment');
	}
	if (!globalThis.__opencvLoadPromise) {
		globalThis.__opencvLoadPromise = new Promise<void>((resolve, reject) => {
			const script = document.createElement('script');
			script.src = '/vendor/opencv.js';
			script.async = true;
			script.onload = () => {
				const cv = (globalThis as any).cv;
				if (!cv) {
					reject(new Error('[opencv-shim] /vendor/opencv.js loaded but cv global missing'));
					return;
				}
				if (cv.Mat) {
					resolve();
					return;
				}
				const prior = cv.onRuntimeInitialized;
				cv.onRuntimeInitialized = () => {
					prior?.();
					resolve();
				};
			};
			script.onerror = () =>
				reject(new Error('[opencv-shim] Failed to load /vendor/opencv.js'));
			document.head.appendChild(script);
		});
	}
	return globalThis.__opencvLoadPromise;
}
