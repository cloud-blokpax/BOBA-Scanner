import { describe, it, expect } from 'vitest';
import { useQuadDetection } from '../src/lib/components/scanner/use-quad-detection.svelte';

describe('useQuadDetection — smoke', () => {
	it('initializes with lost state and null corners', () => {
		const q = useQuadDetection();
		expect(q.cssCorners).toBeNull();
		expect(q.bitmapCorners).toBeNull();
		expect(q.quadState).toBe('lost');
	});
	it('reset() is idempotent', () => {
		const q = useQuadDetection();
		q.reset();
		q.reset();
		expect(q.quadState).toBe('lost');
	});
});
