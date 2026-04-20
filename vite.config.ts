import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';
import { visualizer } from 'rollup-plugin-visualizer';

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
	build: {
		sourcemap: true,
		target: 'es2020'
	},
	worker: {
		// Classic workers so the image-processor can importScripts('/vendor/opencv.js')
		// without needing CSP 'unsafe-eval'. Vite bundles imports into an IIFE.
		format: 'iife'
	}
});
