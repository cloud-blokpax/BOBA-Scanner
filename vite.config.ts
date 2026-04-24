import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';
import { visualizer } from 'rollup-plugin-visualizer';
import { fileURLToPath } from 'node:url';

export default defineConfig({
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
		})
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
