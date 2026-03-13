import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
	plugins: [sveltekit()],
	build: {
		sourcemap: true,
		target: 'es2020'
	},
	worker: {
		format: 'es'
	},
	json: {
		stringify: true
	}
});
