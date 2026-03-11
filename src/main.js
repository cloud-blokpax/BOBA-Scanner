// src/main.js — Vite entry point
// Imports all core modules directly (ES modules) and lazy-loads heavy features.

// ── Core modules (imported in dependency order) ─────────────────────────────
// Side-effect modules (run on import)
import './core/infra/source-protection.js';
import './core/infra/error-tracking.js';

// State and infrastructure
import './core/state.js';
import './core/event-bus.js';
import './core/config.js';

// Database
import './core/database/database.js';

// Scanner pipeline
import './core/scanner/opencv.js';
import './core/collection/collections.js';
import './core/scanner/image-processing.js';

// Collection adapters
import './collections/adapter.js';
import './collections/registry.js';
import './collections/boba/heroes.js';
import './collections/boba/boba-adapter.js';

// Scan learning & OCR
import './core/database/scan-learning.js';
import './core/ocr/ocr.js';
import './core/scanner/scanner.js';

// UI modules
import './ui/utils.js';
import './ui/toast.js';
import './ui/stats-strip.js';
import './ui/cards-grid.js';
import './ui/upload-area.js';
import './ui/events.js';
import './ui/card-detail.js';
import './ui/card-corrections.js';
import './ui/card-actions.js';

// Auth
import './core/auth/google-auth.js';
import './core/auth/user-management.js';

// Collection features
import './core/collection/statistics.js';
import './features/export/export.js';
import './core/sync/image-storage.js';
import './features/tags/tags.js';
import './core/sync/sync.js';

// Marketplace (eBay)
import './features/marketplace/ebay.js';

// Infrastructure
import './core/infra/version.js';
import './core/collection/scan-history.js';

// UI polish
import './ui/themes.js';
import './ui/bottom-nav.js';
import './core/infra/feature-flags.js';
import './core/scanner/continuous-scanner.js';
import './features/marketplace/price-trends.js';
import './ui/ui-enhancements.js';

// App init — MUST BE LAST: orchestrates init
import './app.js';

// ── Lazy-loaded feature modules ─────────────────────────────────────────────
// These are code-split into separate chunks and only loaded when needed.
// Each module is self-contained with its own window.* assignments.

const lazyModules = {
  adminDashboard: () => import('./features/admin/admin-dashboard.js'),
  grader:         () => import('./features/grader/grader.js'),
  setCompletion:  () => import('./features/set-completion/set-completion.js'),
  ebayLister:     () => import('./features/marketplace/ebay-lister.js'),
  tournaments:    () => import('./features/tournaments/tournaments.js'),
  deckBuilder:    () => import('./features/deck-builder/deck-builder.js'),
  batchScanner:   () => import('./core/scanner/batch-scanner.js'),
  binderScanner:  () => import('./core/scanner/binder-scanner.js'),
  sellerMonitor:  () => import('./features/marketplace/seller-monitor.js'),
  templates:      () => import('./features/export/templates.js'),
};

// ── Lazy-load wiring ────────────────────────────────────────────────────────
// Replace direct function calls with lazy-loading wrappers.
// The first call loads the chunk, subsequent calls go directly to the function.

function lazyWire(globalName, moduleName, fnName) {
  const original = window[globalName];
  if (original) return; // already defined (e.g. by core scripts)

  const wrapper = async function(...args) {
    const mod = await lazyModules[moduleName]();
    // After import, the module's side effects set window[globalName]
    // to the real function. Call it.
    if (typeof window[globalName] === 'function' && window[globalName] !== wrapper) {
      return window[globalName](...args);
    }
    // Fallback: try the named export
    if (mod && typeof mod[fnName || globalName] === 'function') {
      return mod[fnName || globalName](...args);
    }
  };
  window[globalName] = wrapper;
}

// Admin Dashboard
lazyWire('openAdminDashboard', 'adminDashboard', 'openAdminDashboard');
lazyWire('loadActivityLog', 'adminDashboard', 'loadActivityLog');
lazyWire('showAdminTab', 'adminDashboard', 'showAdminTab');

// Grader
lazyWire('triggerGradeCard', 'grader', 'triggerGradeCard');
lazyWire('triggerGradeCardWithPicker', 'grader', 'triggerGradeCardWithPicker');
lazyWire('gradeCardFromDetail', 'grader', 'gradeCardFromDetail');

// Set Completion
lazyWire('analyzeSetCompletion', 'setCompletion', 'analyzeSetCompletion');

// eBay Lister
lazyWire('triggerEbayLister', 'ebayLister', 'triggerEbayLister');
lazyWire('triggerEbayListerWithPicker', 'ebayLister', 'triggerEbayListerWithPicker');
lazyWire('ebayListFromDetail', 'ebayLister', 'ebayListFromDetail');

// Tournaments
lazyWire('showCreateTournamentModal', 'tournaments', 'showCreateTournamentModal');
lazyWire('showMyTournamentsModal', 'tournaments', 'showMyTournamentsModal');
lazyWire('renderTournamentsTab', 'tournaments', 'renderTournamentsTab');
lazyWire('showDeckBuilderGate', 'tournaments', 'showDeckBuilderGate');
lazyWire('canCreateTournament', 'tournaments', 'canCreateTournament');
lazyWire('hasDeckBuilderAccess', 'tournaments', 'hasDeckBuilderAccess');
lazyWire('validateTournamentCode', 'tournaments', 'validateTournamentCode');

// Deck Builder
lazyWire('openDeckBuilder', 'deckBuilder', 'openDeckBuilder');
lazyWire('ensureDeckBuildingCollection', 'deckBuilder', 'ensureDeckBuildingCollection');
lazyWire('deckBuilderOnCardScanned', 'deckBuilder', 'deckBuilderOnCardScanned');
lazyWire('getDeckTags', 'deckBuilder', 'getDeckTags');
lazyWire('getDeckCards', 'deckBuilder', 'getDeckCards');

// Batch Scanner
lazyWire('openBatchScanner', 'batchScanner', 'openBatchScanner');

// Binder Scanner
lazyWire('openBinderScanner', 'binderScanner', 'openBinderScanner');

// Seller Monitor
lazyWire('setupSellerMonitor', 'sellerMonitor', 'setupSellerMonitor');
lazyWire('checkSellerListings', 'sellerMonitor', 'checkSellerListings');

// Templates
lazyWire('loadTemplate', 'templates', 'loadTemplate');
lazyWire('deleteTemplateConfirm', 'templates', 'deleteTemplateConfirm');
lazyWire('_loadUserTemplates', 'templates', '_loadUserTemplates');

// ── Service Worker registration ─────────────────────────────────────────────
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').then(reg => {
      console.log('✅ SW registered:', reg.scope);
    }).catch(err => {
      console.warn('SW registration failed:', err);
    });
  });

  navigator.serviceWorker.addEventListener('message', event => {
    if (event.data?.type === 'SYNC_COLLECTIONS' && typeof window.forceSync === 'function') {
      window.forceSync();
    }
  });
}

console.log('✅ Main entry point loaded');
