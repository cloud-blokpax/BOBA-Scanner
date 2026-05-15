#!/usr/bin/env node
// Fails the build if any vendor file produced by copy-vendor.js is missing.
// Runs after copy-vendor.js and before vite build to catch silent breakage
// before it reaches production (missing /vendor/opencv.js takes down both
// the upload-card detector and PaddleOCR Tier 1 — see CLAUDE.md
// Recognition Pipeline notes).

import { existsSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

const required = [
	'static/vendor/opencv.js',
	'static/vendor/ort/ort.wasm.min.mjs',
	'static/vendor/ort/ort-wasm-simd-threaded.mjs',
	'static/vendor/ort/ort-wasm-simd-threaded.wasm'
];

const missing = [];
const empty = [];
for (const rel of required) {
	const abs = resolve(root, rel);
	if (!existsSync(abs)) {
		missing.push(rel);
		continue;
	}
	if (statSync(abs).size === 0) {
		empty.push(rel);
	}
}

if (missing.length || empty.length) {
	console.error('[verify-vendor] vendor files missing or empty:');
	for (const f of missing) console.error(`  MISSING: ${f}`);
	for (const f of empty) console.error(`  EMPTY:   ${f}`);
	console.error('[verify-vendor] run `npm run copy:vendor` to regenerate.');
	process.exit(1);
}

console.log(`[verify-vendor] ok (${required.length} files present)`);
