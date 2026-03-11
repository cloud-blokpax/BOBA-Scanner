import { defineConfig } from 'vite';
import { resolve } from 'path';

// Separate Vite config for building the SDK as a library.
// Run: npx vite build --config vite.config.sdk.js

export default defineConfig({
  build: {
    outDir: 'dist-sdk',
    lib: {
      entry: resolve(__dirname, 'src/sdk/index.js'),
      name: 'BobaScanner',
      fileName: (format) => `boba-scanner-sdk.${format}.js`,
      formats: ['es', 'umd'],
    },
    sourcemap: true,
    target: 'es2020',
    rollupOptions: {
      // Externalize dependencies that consumers should provide
      external: [],
      output: {
        globals: {},
      },
    },
  },
});
