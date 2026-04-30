import adapter from '@sveltejs/adapter-vercel';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	preprocess: vitePreprocess(),
	kit: {
		adapter: adapter({
			runtime: 'nodejs22.x'
		}),
		// CSP NOTES:
		// - `strict-dynamic` in script-src OVERRIDES the allowlist entries
		//   (`'self'`, `https://accounts.google.com`, `https://cdn.jsdelivr.net`).
		//   Per CSP3 spec: when strict-dynamic is present, browsers ignore
		//   host-source allowlists. Scripts are trusted only via nonce
		//   propagation (SvelteKit auto-generates per-request nonces).
		//   The allowlist entries are left in place as defense-in-depth
		//   for CSP1/CSP2 browsers that don't support strict-dynamic.
		// - `wasm-unsafe-eval` permits WebAssembly.compile/instantiate
		//   (needed for ONNX Runtime's wasm backend used by PaddleOCR).
		// - `unsafe-eval` permits `new Function(...)` / `eval()` (needed
		//   for ONNX Runtime's JIT kernel compilation, added in Session 2.14).
		//   Per spec, unsafe-eval supersedes wasm-unsafe-eval.
		// - `cdn.jsdelivr.net` was originally for the OCR package; Session
		//   2.12 moved it to a bundled npm import. Left in place as a
		//   belt-and-suspenders allowlist (harmless under strict-dynamic).
		csp: {
			directives: {
				'default-src': ['self'],
				'script-src': ['self', 'strict-dynamic', 'wasm-unsafe-eval', 'unsafe-eval', 'https://accounts.google.com', 'https://cdn.jsdelivr.net'],
				'style-src': ['self', 'unsafe-inline', 'https://fonts.googleapis.com'],
				'font-src': ['self', 'https://fonts.gstatic.com'],
				'img-src': ['self', 'blob:', 'data:', 'https://*.supabase.co', 'https://lh3.googleusercontent.com', 'https://storage.googleapis.com'],
				'media-src': ['self', 'blob:', 'mediastream:'],
				'connect-src': ['self', 'data:', 'blob:', 'https://*.supabase.co', 'wss://*.supabase.co', 'https://api.ebay.com', 'https://accounts.google.com', 'https://fonts.googleapis.com', 'https://fonts.gstatic.com', 'https://lh3.googleusercontent.com', 'https://cdn.jsdelivr.net', 'https://storage.googleapis.com', 'https://vitals.vercel-analytics.com'],
				'worker-src': ['self', 'blob:'],
				'frame-ancestors': ['none'],
				'upgrade-insecure-requests': true
			}
		},
		alias: {
			$lib: 'src/lib',
			$components: 'src/lib/components',
			$services: 'src/lib/services',
			$stores: 'src/lib/stores',
			$workers: 'src/lib/workers',
			$types: 'src/lib/types',
			$server: 'src/lib/server',
			$games: 'src/lib/games'
		}
	}
};

export default config;
