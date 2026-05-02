/**
 * Unit tests for ocrRecOnlyBatch — Phase 2 Doc 2.4.
 *
 * The batching helper is hard to unit-test directly: it depends on the
 * package's standalone Recognition instance + the ONNX runtime, neither
 * of which is available in the Node-side vitest environment. Internal
 * calls to ocrRecOnly bind statically (ESM semantics), so a vi.mock at
 * the module surface can't intercept them either.
 *
 * What we CAN test cleanly is the input-validation surface: empty input
 * arrays short-circuit before any Recognition or ocrRecOnly call. The
 * happy-path batched call (Recognition.run with N line-images) and the
 * per-region fallback path are both covered by the recognition-pipeline
 * e2e suite, which runs against the real ONNX runtime.
 */
import { describe, it, expect } from 'vitest';
import { ocrRecOnlyBatch } from '../src/lib/services/paddle-ocr';

const mockBitmap = { width: 1000, height: 1500 } as unknown as ImageBitmap;

describe('ocrRecOnlyBatch — input-surface guards', () => {
	it('returns an empty array when no regions are submitted', async () => {
		const r = await ocrRecOnlyBatch(mockBitmap, []);
		expect(r).toEqual([]);
	});

	it('is exported as an async function', () => {
		expect(typeof ocrRecOnlyBatch).toBe('function');
		// Async fns return a Promise when called; we already exercised that
		// in the empty-input test above. This double-check guards against
		// an accidental signature regression (e.g. someone making it sync).
		const ret = ocrRecOnlyBatch(mockBitmap, []);
		expect(ret).toBeInstanceOf(Promise);
	});
});
