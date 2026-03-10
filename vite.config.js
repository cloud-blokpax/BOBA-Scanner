import { defineConfig } from 'vite';
import { readFileSync, copyFileSync, existsSync } from 'fs';
import { resolve } from 'path';

// ── Custom plugin: concatenate classic scripts into a single ES module ──────
// The existing codebase uses 37+ classic (non-module) scripts that share state
// via implicit globals. Rather than rewriting every cross-file reference to use
// ES imports, this plugin bundles them into one module that preserves the global
// scope behavior while giving us Vite's dev server, HMR, minification, and
// code splitting for lazy-loaded features.
function classicScriptsPlugin() {
  const VIRTUAL_ID = 'virtual:classic-scripts';
  const RESOLVED_ID = '\0' + VIRTUAL_ID;

  // These scripts are loaded in order (matching index.html script tag order).
  // Heavy features (grader, set-completion, ebay-lister, tournaments,
  // deck-builder, admin-dashboard, batch-scanner, seller-monitor, templates)
  // are excluded — they're lazy-loaded via dynamic import() in main.js.
  const CORE_SCRIPTS = [
    'js/source-protection.js',
    'js/error-tracking.js',
    'js/state.js',
    'js/config.js',
    'js/database.js',
    'js/opencv.js',
    'js/collections.js',
    'js/api.js',
    'js/heroes.js',
    'js/scan-learning.js',
    'js/scanner.js',
    'js/ui.js',
    'js/google-auth.js',
    'js/user-management.js',
    'js/statistics.js',
    'js/export.js',
    'js/image-storage.js',
    'js/tags.js',
    'js/sync.js',
    'js/ebay.js',
    'js/version.js',
    'js/scan-history.js',
    'js/themes.js',
    'js/bottom-nav.js',
    'js/feature-flags.js',
    'js/continuous-scanner.js',
    'js/price-trends.js',
    'js/ui-enhancements.js',
    'js/app.js',         // MUST BE LAST: orchestrates init
  ];

  return {
    name: 'classic-scripts',
    resolveId(id) {
      if (id === VIRTUAL_ID) return RESOLVED_ID;
    },
    load(id) {
      if (id !== RESOLVED_ID) return;

      // Concatenate all core scripts into a single string.
      // Each script runs in the same scope, preserving implicit globals.
      const chunks = CORE_SCRIPTS.map(path => {
        const fullPath = resolve(process.cwd(), path);
        try {
          return `// ── ${path} ──\n${readFileSync(fullPath, 'utf-8')}`;
        } catch (e) {
          console.warn(`Warning: ${path} not found, skipping`);
          return `// ${path} — not found`;
        }
      });

      return chunks.join('\n\n');
    }
  };
}

// ── Plugin: copy static runtime assets to dist ──────────────────────────────
function copyStaticAssetsPlugin() {
  const STATIC_FILES = [
    'card-database.json',
    'sw.js',
    'version.json',
  ];

  return {
    name: 'copy-static-assets',
    closeBundle() {
      const outDir = resolve(process.cwd(), 'dist');
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
  plugins: [classicScriptsPlugin(), copyStaticAssetsPlugin()],
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
