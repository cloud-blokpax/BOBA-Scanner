/**
 * Runtime shim for `onnxruntime-web`.
 *
 * Vite's `resolve.alias` redirects `import { InferenceSession } from
 * 'onnxruntime-web'` (inside `@gutenye/ocr-browser`) to this file. The real
 * ORT Web bundle — plus its ~12MB WebAssembly backend — is served from
 * `/vendor/ort/` and loaded on demand via a `/* @vite-ignore *\/` dynamic
 * import so Rollup never pulls it into the client JS budget.
 *
 * Only `InferenceSession` is consumed at runtime by the OCR library; the
 * `Tensor` class comes from `onnxruntime-common` (tiny, bundled inline).
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

let realModulePromise: Promise<any> | null = null;

const ORT_URL = '/vendor/ort/ort.wasm.min.mjs';

async function loadReal(): Promise<any> {
	if (!realModulePromise) {
		// Storing the URL in a variable keeps TypeScript's module resolver
		// out of this — the file is shipped in static/vendor/ort/ and is
		// only resolvable at runtime. ort.wasm.min.mjs fetches its sibling
		// .mjs/.wasm assets relative to its own URL, which works because
		// everything lives under /vendor/ort/.
		realModulePromise = import(/* @vite-ignore */ ORT_URL);
	}
	return realModulePromise;
}

export const InferenceSession = {
	async create(path: string | Uint8Array, options?: any): Promise<any> {
		const ort = await loadReal();
		return ort.InferenceSession.create(path, options);
	}
};
