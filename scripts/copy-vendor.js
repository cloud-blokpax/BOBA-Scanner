#!/usr/bin/env node
// Copies the heavy OCR runtime deps out of node_modules into static/vendor/
// so they're served as static files and never enter Vite's bundle graph.
//
// Why: @techstark/opencv-js is a 10MB UMD blob (WebAssembly embedded as
// base64) and onnxruntime-web ships its WASM loader alongside a 12MB+
// .wasm binary. If either slips into a Vite chunk, the CI total-JS budget
// (1.7MB) trips instantly. The runtime shims in src/lib/shims/ load these
// files from /vendor/ at runtime.

import { copyFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

const targets = [
	{
		from: 'node_modules/@techstark/opencv-js/dist/opencv.js',
		to: 'static/vendor/opencv.js'
	},
	{
		from: 'node_modules/onnxruntime-web/dist/ort.wasm.min.mjs',
		to: 'static/vendor/ort/ort.wasm.min.mjs'
	},
	{
		from: 'node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.mjs',
		to: 'static/vendor/ort/ort-wasm-simd-threaded.mjs'
	},
	{
		from: 'node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.wasm',
		to: 'static/vendor/ort/ort-wasm-simd-threaded.wasm'
	}
];

for (const { from, to } of targets) {
	const src = resolve(root, from);
	const dst = resolve(root, to);
	if (!existsSync(src)) {
		console.error(`[copy-vendor] missing source: ${from}`);
		process.exit(1);
	}
	mkdirSync(dirname(dst), { recursive: true });
	copyFileSync(src, dst);
	console.log(`[copy-vendor] ${from} -> ${to}`);
}
