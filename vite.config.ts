import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';
import { visualizer } from 'rollup-plugin-visualizer';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

// Build-time version stamp. Prefer VERCEL_GIT_COMMIT_SHA (CI/prod) and fall
// back to a local `git rev-parse` for previews and dev. Truncated to 7
// chars — the privacy/CSP audit pulled the previous "1.1.0 (2026-02-23) +
// changelog notes" string and used it to fingerprint feature cadence; a
// short SHA is opaque to the same observer.
const buildSha: string = (() => {
	const fromEnv = (process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.GIT_SHA ?? '').trim();
	if (fromEnv) return fromEnv.slice(0, 7);
	try {
		return execSync('git rev-parse --short=7 HEAD', { stdio: ['ignore', 'pipe', 'ignore'] })
			.toString()
			.trim();
	} catch {
		return 'dev';
	}
})();

export default defineConfig({
	define: {
		__APP_BUILD_SHA__: JSON.stringify(buildSha)
	},
	plugins: [
		sveltekit(),
		// Bundle treemap. Output lives at .svelte-kit/stats.html — outside
		// the shipped build so it never inflates the bundle itself.
		// CI uploads this as an artifact so PR authors can inspect what grew.
		// Only emits during production builds (vite dev is unaffected).
		visualizer({
			filename: '.svelte-kit/stats.html',
			gzipSize: true,
			brotliSize: true,
			template: 'treemap',
			emitFile: false
		}),
		{
			// Writes static/version.json with the build SHA each `build`. The
			// runtime checks /version.json against the bundled APP_VERSION to
			// surface an update banner; both ends now use the same SHA.
			name: 'stamp-version-json',
			apply: 'build',
			buildStart() {
				try {
					writeFileSync(
						fileURLToPath(new URL('./static/version.json', import.meta.url)),
						JSON.stringify({ version: buildSha }) + '\n'
					);
				} catch (err) {
					this.warn(`stamp-version-json: write failed (${(err as Error).message})`);
				}
			}
		}
	],
	resolve: {
		alias: {
			// Heavy OCR runtime deps are shipped as static assets under
			// /vendor/ (populated by scripts/copy-vendor.js) and fetched
			// lazily by the shim modules. This keeps ~10MB of embedded
			// WebAssembly (opencv-js) and the ORT Web wasm loader out of
			// the client JS bundle. The shims preserve the same public
			// API, so `@gutenye/ocr-browser` links against them without
			// modification.
			'@techstark/opencv-js': fileURLToPath(
				new URL('./src/lib/shims/opencv-js.ts', import.meta.url)
			),
			'onnxruntime-web': fileURLToPath(
				new URL('./src/lib/shims/onnxruntime-web.ts', import.meta.url)
			),
			// Doc 2 — Recognition class is not in ocr-common's package.json
			// `exports` whitelist, so deep imports fail under Node strict
			// resolution. Aliasing the bare-specifier 'gutenye-ocr-recognition'
			// to the file path lets paddle-ocr.ts dynamically import the rec
			// head standalone for the rec-only sub-ROI path. Vite's alias is
			// applied before package-export resolution, so this bypasses the
			// boundary cleanly.
			'gutenye-ocr-recognition': fileURLToPath(
				new URL(
					'./node_modules/@gutenye/ocr-common/build/models/Recognition.js',
					import.meta.url
				)
			)
		}
	},
	build: {
		sourcemap: true,
		target: 'es2020',
		rollupOptions: {
			// The ORT shim does a runtime dynamic import of a file served
			// from /vendor/ — mark it external so Rollup stops trying to
			// resolve it at build time.
			external: [/^\/vendor\/ort\//]
		}
	},
	worker: {
		// Classic workers so the image-processor can importScripts('/vendor/opencv.js')
		// without needing CSP 'unsafe-eval'. Vite bundles imports into an IIFE.
		format: 'iife'
	}
});
