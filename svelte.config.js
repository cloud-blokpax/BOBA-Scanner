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
				'script-src': ['self', 'strict-dynamic', 'wasm-unsafe-eval', 'https://accounts.google.com', 'https://cdn.jsdelivr.net'],
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
			$server: 'src/lib/server'
		}
	}
};

export default config;
