#!/usr/bin/env node
/**
 * Generates fixture JPEGs for tests/fixtures/hash-parity/.
 *
 * We don't have access to the production Supabase buckets from this
 * environment, so we synthesize JPEGs that exercise the same code paths
 * as real card images: varied aspect ratios, varied content (gradients,
 * noise, patterns), JPEG-specific pixel variation.
 *
 * The parity test asserts server == client-algorithm-mirror on these
 * fixtures, so the content doesn't need to be real cards — it just needs
 * to produce meaningful DCT output (not solid colors).
 *
 * Run once: node scripts/generate-hash-fixtures.mjs
 */

import sharp from 'sharp';
import { mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, '..', 'tests', 'fixtures', 'hash-parity');

mkdirSync(OUT_DIR, { recursive: true });

function rng(seed) {
	let s = seed >>> 0;
	return () => {
		s = (s * 1664525 + 1013904223) >>> 0;
		return s / 0x100000000;
	};
}

/** Card-like image: vertical gradient + colored rectangles + text-like bands. */
function makeCard1(w, h) {
	const buf = Buffer.alloc(w * h * 3);
	for (let y = 0; y < h; y++) {
		for (let x = 0; x < w; x++) {
			const i = (y * w + x) * 3;
			const t = y / h;
			buf[i] = Math.floor(30 + t * 180);
			buf[i + 1] = Math.floor(10 + (1 - t) * 100 + x / w * 80);
			buf[i + 2] = Math.floor(40 + Math.abs(Math.sin((x + y) * 0.05)) * 150);
			// Card frame
			if (x < w * 0.05 || x > w * 0.95 || y < h * 0.05 || y > h * 0.95) {
				buf[i] = 20; buf[i + 1] = 20; buf[i + 2] = 20;
			}
			// Title band
			if (y > h * 0.08 && y < h * 0.16 && x > w * 0.1 && x < w * 0.9) {
				buf[i] = 240; buf[i + 1] = 230; buf[i + 2] = 180;
			}
			// Stats box
			if (y > h * 0.75 && y < h * 0.92 && x > w * 0.1 && x < w * 0.9) {
				buf[i] = 50; buf[i + 1] = 50; buf[i + 2] = 80;
			}
		}
	}
	return buf;
}

/** High-contrast diagonal stripes — tests DCT frequency response. */
function makeStripes(w, h) {
	const buf = Buffer.alloc(w * h * 3);
	for (let y = 0; y < h; y++) {
		for (let x = 0; x < w; x++) {
			const i = (y * w + x) * 3;
			const stripe = ((x + y) >> 3) & 1;
			const shade = stripe ? 230 : 25;
			buf[i] = shade;
			buf[i + 1] = shade + (x % 40) - 20;
			buf[i + 2] = shade + (y % 40) - 20;
		}
	}
	return buf;
}

/** Photographic noise — tests numerical precision in DCT. */
function makeNoise(w, h, seed) {
	const r = rng(seed);
	const buf = Buffer.alloc(w * h * 3);
	// Slow-varying base
	for (let y = 0; y < h; y++) {
		for (let x = 0; x < w; x++) {
			const i = (y * w + x) * 3;
			const base = Math.floor(100 + 60 * Math.sin(x * 0.02) * Math.cos(y * 0.03));
			buf[i] = Math.max(0, Math.min(255, base + Math.floor(r() * 40 - 20)));
			buf[i + 1] = Math.max(0, Math.min(255, base + Math.floor(r() * 40 - 20) + 15));
			buf[i + 2] = Math.max(0, Math.min(255, base + Math.floor(r() * 40 - 20) - 10));
		}
	}
	return buf;
}

/** Concentric rings — symmetric pattern, good DCT test. */
function makeRings(w, h) {
	const buf = Buffer.alloc(w * h * 3);
	const cx = w / 2;
	const cy = h / 2;
	for (let y = 0; y < h; y++) {
		for (let x = 0; x < w; x++) {
			const i = (y * w + x) * 3;
			const d = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2);
			const ring = Math.sin(d * 0.15) * 127 + 128;
			buf[i] = Math.floor(ring);
			buf[i + 1] = Math.floor(ring * 0.8);
			buf[i + 2] = Math.floor(255 - ring * 0.5);
		}
	}
	return buf;
}

/** Hero card layout: border + portrait + name + power number. */
function makeHero(w, h, seed) {
	const r = rng(seed);
	const buf = Buffer.alloc(w * h * 3);
	for (let y = 0; y < h; y++) {
		for (let x = 0; x < w; x++) {
			const i = (y * w + x) * 3;
			// Background gradient
			buf[i] = Math.floor(60 + (x / w) * 80);
			buf[i + 1] = Math.floor(40 + (y / h) * 60);
			buf[i + 2] = Math.floor(90 + ((x + y) / (w + h)) * 100);
			// Border
			const bw = Math.min(w, h) * 0.04;
			if (x < bw || x > w - bw || y < bw || y > h - bw) {
				buf[i] = 180; buf[i + 1] = 150; buf[i + 2] = 40;
			}
			// Portrait region
			if (y > h * 0.2 && y < h * 0.65 && x > w * 0.15 && x < w * 0.85) {
				const nx = (x - w * 0.5) / (w * 0.35);
				const ny = (y - h * 0.425) / (h * 0.225);
				const skin = 1 - Math.sqrt(nx * nx + ny * ny);
				if (skin > 0) {
					buf[i] = Math.floor(200 + r() * 30 - 15);
					buf[i + 1] = Math.floor(150 + r() * 30 - 15);
					buf[i + 2] = Math.floor(120 + r() * 30 - 15);
				}
			}
			// Power number box (bottom-right)
			if (y > h * 0.82 && y < h * 0.95 && x > w * 0.7 && x < w * 0.9) {
				buf[i] = 240; buf[i + 1] = 40; buf[i + 2] = 40;
			}
		}
	}
	return buf;
}

/** Dragon-like fantasy pattern (stands in for Wonders cards). */
function makeFantasy(w, h, seed) {
	const r = rng(seed);
	const buf = Buffer.alloc(w * h * 3);
	for (let y = 0; y < h; y++) {
		for (let x = 0; x < w; x++) {
			const i = (y * w + x) * 3;
			const scales = Math.sin(x * 0.3) * Math.cos(y * 0.25) * 60;
			buf[i] = Math.max(0, Math.min(255, Math.floor(80 + scales + r() * 20)));
			buf[i + 1] = Math.max(0, Math.min(255, Math.floor(140 + scales * 0.5 + r() * 20)));
			buf[i + 2] = Math.max(0, Math.min(255, Math.floor(60 + scales * 0.3 + r() * 20)));
		}
	}
	return buf;
}

async function writeFixture(name, buffer, w, h, jpegOpts = {}) {
	const out = join(OUT_DIR, name);
	await sharp(buffer, { raw: { width: w, height: h, channels: 3 } })
		.jpeg({ quality: 85, ...jpegOpts })
		.toFile(out);
	console.log(`wrote ${name}`);
}

async function main() {
	// Mix aspect ratios and sizes — simulate BoBA 800x1120, Wonders, and
	// phone-scan variations. Keep each file small.
	await writeFixture('card-01.jpg', makeCard1(400, 560), 400, 560);
	await writeFixture('card-02.jpg', makeHero(400, 560, 42), 400, 560);
	await writeFixture('card-03.jpg', makeHero(400, 560, 777), 400, 560);
	await writeFixture('wonders-01.jpg', makeFantasy(400, 560, 111), 400, 560);
	await writeFixture('wonders-02.jpg', makeFantasy(400, 560, 222), 400, 560);
	await writeFixture('stripes.jpg', makeStripes(400, 400), 400, 400);
	await writeFixture('rings.jpg', makeRings(400, 400), 400, 400);
	// Odd aspect ratio — exercises resize-to-square for pHash
	await writeFixture('wide.jpg', makeNoise(720, 320, 99), 720, 320);
	// Portrait phone photo ratio
	await writeFixture('phone-scan.jpg', makeCard1(360, 640), 360, 640);
	// High-quality JPEG to reduce encoding noise on one sample
	await writeFixture('card-hq.jpg', makeHero(400, 560, 55), 400, 560, { quality: 95 });
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
