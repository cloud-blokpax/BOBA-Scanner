/**
 * DCT-II coefficient matrix — bit-identical to the client implementation at
 * src/lib/workers/image-processor.ts.
 *
 * C[k][n] = scale(k) * cos(π * k * (2n+1) / (2N))
 *   where scale(0) = 1/√N and scale(k>0) = √(2/N)
 *
 * Must be numerically identical to the client's DCT_MATRIX or hash parity
 * will drift in the lowest bits. Do NOT reformulate — use this exact form.
 */

export const DCT_SIZE = 32;

function buildDctMatrix(): Float64Array[] {
	const m: Float64Array[] = [];
	for (let k = 0; k < DCT_SIZE; k++) {
		m[k] = new Float64Array(DCT_SIZE);
		const scale = k === 0 ? 1 / Math.sqrt(DCT_SIZE) : Math.sqrt(2 / DCT_SIZE);
		for (let n = 0; n < DCT_SIZE; n++) {
			m[k][n] = scale * Math.cos((Math.PI * k * (2 * n + 1)) / (2 * DCT_SIZE));
		}
	}
	return m;
}

export const DCT_MATRIX: readonly Float64Array[] = buildDctMatrix();
