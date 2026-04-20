#!/usr/bin/env node
/**
 * Copy opencv.js from node_modules to static/vendor/ so it ships as a
 * plain static asset instead of a bundled chunk. OpenCV is ~11MB and
 * only needed by the image-processor worker's rectifyCard() path — the
 * worker fetches it on first rectify call. Keeping it out of the
 * rollup graph lets the cumulative-JS bundle guard stay tight (1.7MB).
 */
import { copyFileSync, mkdirSync, existsSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(__dirname, '..');
const src = resolve(rootDir, 'node_modules/@techstark/opencv-js/dist/opencv.js');
const destDir = resolve(rootDir, 'static/vendor');
const dest = resolve(destDir, 'opencv.js');

if (!existsSync(src)) {
	console.error(`[copy-opencv] Source not found: ${src}`);
	console.error('[copy-opencv] Run `npm install` first.');
	process.exit(1);
}

mkdirSync(destDir, { recursive: true });
copyFileSync(src, dest);
const bytes = statSync(dest).size;
console.log(`[copy-opencv] ${src} → ${dest} (${(bytes / 1024 / 1024).toFixed(1)}MB)`);
