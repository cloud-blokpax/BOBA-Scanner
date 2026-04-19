/**
 * Hash parity gate for Phase 1.
 *
 * Asserts that the server-side dHash and pHash implementations in
 * src/lib/server/hashing/ produce bit-identical output to the algorithm
 * running in the client worker at src/lib/workers/image-processor.ts.
 *
 * We don't run the actual Comlink/OffscreenCanvas worker in Node. Instead,
 * we embed a mirror of the client's algorithm here and feed it the same
 * pixel buffers (sourced from sharp). The mirror is copy-pasted from the
 * production worker and MUST be kept in sync — any change to
 * computeDHash/computePHash in the worker must also update this file.
 *
 * The parity contract is: for identical input pixels, the two algorithms
 * produce the same hex string. If they do, we then trust that the
 * pixel-decoding layers (OffscreenCanvas on client, sharp on server) are
 * close enough that real-world cards round-trip cleanly. Session 1.2
 * measures that in production.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import {
	computeDHashFromBuffer,
	computePHashFromBuffer,
	hammingDistance
} from '../src/lib/server/hashing';

// ── Client algorithm mirror ─────────────────────────────────────────
// Identical to src/lib/workers/image-processor.ts computeDHash/computePHash,
// but operating on a raw RGB pixel buffer rather than a canvas ImageData
// (which is RGBA). The server module uses .removeAlpha() so it also sees
// RGB; we use the same pixel pipeline here so the only thing under test
// is the hash algorithm itself — NOT sharp vs OffscreenCanvas decoding.
//
// Keep in sync with src/lib/workers/image-processor.ts.

const DCT_SIZE = 32;
const clientDctMatrix: Float64Array[] = (() => {
	const m: Float64Array[] = [];
	for (let k = 0; k < DCT_SIZE; k++) {
		m[k] = new Float64Array(DCT_SIZE);
		const scale = k === 0 ? 1 / Math.sqrt(DCT_SIZE) : Math.sqrt(2 / DCT_SIZE);
		for (let n = 0; n < DCT_SIZE; n++) {
			m[k][n] = scale * Math.cos((Math.PI * k * (2 * n + 1)) / (2 * DCT_SIZE));
		}
	}
	return m;
})();

async function clientDHash(buffer: Buffer, hashSize = 8): Promise<string> {
	const w = hashSize + 1;
	const h = hashSize;
	const { data } = await sharp(buffer)
		.rotate()
		.resize(w, h, { fit: 'fill' })
		.toColorspace('srgb')
		.removeAlpha()
		.raw()
		.toBuffer({ resolveWithObject: true });

	let bits = '';
	for (let y = 0; y < h; y++) {
		for (let x = 0; x < hashSize; x++) {
			const li = (y * w + x) * 3;
			const ri = (y * w + x + 1) * 3;
			const lg = data[li] * 0.299 + data[li + 1] * 0.587 + data[li + 2] * 0.114;
			const rg = data[ri] * 0.299 + data[ri + 1] * 0.587 + data[ri + 2] * 0.114;
			bits += lg < rg ? '1' : '0';
		}
	}
	return BigInt('0b' + bits)
		.toString(16)
		.padStart((hashSize * hashSize) / 4, '0');
}

async function clientPHash(buffer: Buffer, hashSize = 16): Promise<string> {
	const { data } = await sharp(buffer)
		.rotate()
		.resize(DCT_SIZE, DCT_SIZE, { fit: 'fill' })
		.toColorspace('srgb')
		.removeAlpha()
		.raw()
		.toBuffer({ resolveWithObject: true });

	const gray = new Float64Array(DCT_SIZE * DCT_SIZE);
	for (let i = 0; i < DCT_SIZE * DCT_SIZE; i++) {
		const idx = i * 3;
		gray[i] = data[idx] * 0.299 + data[idx + 1] * 0.587 + data[idx + 2] * 0.114;
	}

	const rowDct = new Float64Array(DCT_SIZE * DCT_SIZE);
	for (let y = 0; y < DCT_SIZE; y++) {
		for (let k = 0; k < DCT_SIZE; k++) {
			let sum = 0;
			for (let n = 0; n < DCT_SIZE; n++) sum += clientDctMatrix[k][n] * gray[y * DCT_SIZE + n];
			rowDct[y * DCT_SIZE + k] = sum;
		}
	}
	const dctCoeffs = new Float64Array(DCT_SIZE * DCT_SIZE);
	for (let x = 0; x < DCT_SIZE; x++) {
		for (let k = 0; k < DCT_SIZE; k++) {
			let sum = 0;
			for (let n = 0; n < DCT_SIZE; n++) sum += clientDctMatrix[k][n] * rowDct[n * DCT_SIZE + x];
			dctCoeffs[k * DCT_SIZE + x] = sum;
		}
	}

	const coeffs: number[] = [];
	for (let y = 0; y < hashSize; y++) {
		for (let x = 0; x < hashSize; x++) {
			if (y === 0 && x === 0) continue;
			coeffs.push(dctCoeffs[y * DCT_SIZE + x]);
		}
	}
	const sorted = [...coeffs].sort((a, b) => a - b);
	const median =
		sorted.length % 2 === 0
			? (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2
			: sorted[Math.floor(sorted.length / 2)];

	let bits = '';
	for (let y = 0; y < hashSize; y++) {
		for (let x = 0; x < hashSize; x++) {
			if (y === 0 && x === 0) {
				bits += '0';
				continue;
			}
			bits += dctCoeffs[y * DCT_SIZE + x] > median ? '1' : '0';
		}
	}
	return BigInt('0b' + bits)
		.toString(16)
		.padStart((hashSize * hashSize) / 4, '0');
}

// ── Fixture loading ─────────────────────────────────────────────────

const FIXTURES_DIR = join(__dirname, 'fixtures', 'hash-parity');

function getFixtures(): string[] {
	return readdirSync(FIXTURES_DIR)
		.filter((f) => /\.(jpe?g|png|webp)$/i.test(f))
		.sort()
		.map((f) => join(FIXTURES_DIR, f));
}

// ── Tests ───────────────────────────────────────────────────────────

describe('hash-parity: server implementation matches client algorithm', () => {
	const fixtures = getFixtures();

	if (fixtures.length === 0) {
		it.skip('no fixtures present — run `node scripts/generate-hash-fixtures.mjs`', () => {});
		return;
	}

	describe.each(fixtures.map((p) => [p.split('/').pop()!, p]))(
		'fixture %s',
		(_name, path) => {
			const buffer = readFileSync(path);

			it('dHash (64-bit) matches client algorithm bit-identically', async () => {
				const client = await clientDHash(buffer);
				const server = await computeDHashFromBuffer(buffer);
				const dist = hammingDistance(client, server);
				if (dist !== 0) {
					console.log(
						`  dHash drift on ${path}: client=${client} server=${server} dist=${dist}`
					);
				}
				expect(dist).toBe(0);
			});

			it('pHash (256-bit) matches client algorithm bit-identically', async () => {
				const client = await clientPHash(buffer);
				const server = await computePHashFromBuffer(buffer);
				const dist = hammingDistance(client, server);
				if (dist !== 0) {
					console.log(
						`  pHash drift on ${path}: client=${client.slice(0, 16)}… server=${server.slice(0, 16)}… dist=${dist}`
					);
				}
				expect(dist).toBe(0);
			});

			it('dHash output length is 16 hex chars', async () => {
				const hash = await computeDHashFromBuffer(buffer);
				expect(hash).toMatch(/^[0-9a-f]{16}$/);
			});

			it('pHash output length is 64 hex chars', async () => {
				const hash = await computePHashFromBuffer(buffer);
				expect(hash).toMatch(/^[0-9a-f]{64}$/);
			});
		}
	);

	it('re-encoded JPEG drifts by no more than a few bits from the original', async () => {
		// Documents the cost of JPEG re-encoding. Session 1.3 needs to decide
		// whether the image-harvester hashes BEFORE or AFTER re-encoding.
		const fixture = fixtures[0];
		const raw = readFileSync(fixture);
		const reencoded = await sharp(raw).jpeg({ quality: 95 }).toBuffer();
		const hashRaw = await computeDHashFromBuffer(raw);
		const hashReencoded = await computeDHashFromBuffer(reencoded);
		const dist = hammingDistance(hashRaw, hashReencoded);
		expect(dist).toBeLessThan(5);
	});

	it('hammingDistance throws on hash length mismatch', () => {
		expect(() => hammingDistance('abcd', 'abcdef')).toThrow(/length mismatch/);
	});

	it('hammingDistance is 0 for identical hashes', () => {
		expect(hammingDistance('deadbeef', 'deadbeef')).toBe(0);
	});
});
