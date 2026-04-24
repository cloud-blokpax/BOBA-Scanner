import adapter from '@sveltejs/adapter-vercel';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	preprocess: vitePreprocess(),
	kit: {
		adapter: adapter({
			runtime: 'nodejs22.x'
		}),
		csp: {
			directives: {
				'default-src': ['self'],
				// 'unsafe-eval' is required by onnxruntime-web (the WASM runtime used
				// by @gutenye/ocr-browser). Its init path compiles kernel functions
				// via `new Function(...)`, which 'wasm-unsafe-eval' does NOT cover —
				// `wasm-unsafe-eval` only allows WebAssembly.compile/instantiate.
				// Session 2.14 traced a "Refused to evaluate a string as JavaScript"
				// CSP error on every Tier 1 scan attempt (checkpoint stage
				// `tier1_canonical:threw`) to this gap.
				//
				// Tradeoff: adding 'unsafe-eval' widens the XSS attack surface — a
				// self-hosted script could now execute eval(userInput). The practical
				// risk is bounded by the other CSP guardrails ('self' + nonce +
				// strict-dynamic prevent arbitrary inline/external scripts from
				// loading in the first place), but it's a real regression vs the
				// prior CSP-only-allows-wasm-eval posture.
				//
				// Alternatives rejected: trusted-types-eval needs the whole Trusted
				// Types infra, switching ONNX backend needs a package upgrade or
				// vendor fork, worker-isolation doesn't inherit a different CSP.
				// This is the one-line fix; pick a better long-term strategy when
				// ONNX Runtime Web v2 drops the JIT path (roadmapped, no ETA).
				'script-src': ['self', 'strict-dynamic', 'wasm-unsafe-eval', 'unsafe-eval', 'https://accounts.google.com', 'https://cdn.jsdelivr.net'],
				'style-src': ['self', 'unsafe-inline', 'https://fonts.googleapis.com'],
				'font-src': ['self', 'https://fonts.gstatic.com'],
				'img-src': ['self', 'blob:', 'data:', 'https://*.supabase.co', 'https://lh3.googleusercontent.com', 'https://storage.googleapis.com', 'https://*.carde.io'],
				'media-src': ['self', 'blob:', 'mediastream:'],
				'connect-src': ['self', 'data:', 'blob:', 'https://*.supabase.co', 'wss://*.supabase.co', 'https://api.ebay.com', 'https://accounts.google.com', 'https://fonts.googleapis.com', 'https://fonts.gstatic.com', 'https://lh3.googleusercontent.com', 'https://cdn.jsdelivr.net', 'https://storage.googleapis.com', 'https://*.carde.io', 'https://vitals.vercel-analytics.com'],
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
