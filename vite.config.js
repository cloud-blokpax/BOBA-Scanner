import { defineConfig } from 'vite';
import { copyFileSync, existsSync, mkdirSync } from 'fs';
import { resolve } from 'path';

// ── Plugin: copy static runtime assets to dist ──────────────────────────────
function copyStaticAssetsPlugin() {
  const STATIC_FILES = [
    'card-database.json',
    'sw.js',
    'version.json',
    'manifest.json',
  ];

  return {
    name: 'copy-static-assets',
    closeBundle() {
      const outDir = resolve(process.cwd(), 'dist');
      mkdirSync(outDir, { recursive: true });
      for (const file of STATIC_FILES) {
        const src = resolve(process.cwd(), file);
        const dest = resolve(outDir, file);
        if (existsSync(src)) {
          copyFileSync(src, dest);
        }
      }
    }
  };
}

export default defineConfig({
  root: '.',
  publicDir: false,
  plugins: [copyStaticAssetsPlugin()],
  build: {
    outDir: 'dist',
    rollupOptions: {
      input: 'index.html'
    },
    sourcemap: true,
    target: 'es2020',
    chunkSizeWarningLimit: 300,
    // Ensure assets go to predictable paths
    assetsDir: 'assets'
  },
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true
      }
    }
  }
});
