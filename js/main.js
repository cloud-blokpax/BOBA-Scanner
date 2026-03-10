// js/main.js — Vite entry point
// Loads core scripts (concatenated via virtual module) and lazy-loads heavy features.

// ── Core scripts (bundled together, share global scope) ─────────────────────
import 'virtual:classic-scripts';

// ── Lazy-loaded feature modules ─────────────────────────────────────────────
// These are code-split into separate chunks and only loaded when needed.
// Each module is self-contained with its own window.* assignments.

const lazyModules = {
  adminDashboard: () => import('./admin-dashboard.js'),
  grader:         () => import('./grader.js'),
  setCompletion:  () => import('./set-completion.js'),
  ebayLister:     () => import('./ebay-lister.js'),
  tournaments:    () => import('./tournaments.js'),
  deckBuilder:    () => import('./deck-builder.js'),
  batchScanner:   () => import('./batch-scanner.js'),
  binderScanner:  () => import('./binder-scanner.js'),
  sellerMonitor:  () => import('./seller-monitor.js'),
  templates:      () => import('./templates.js'),
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

// Set Completion
lazyWire('analyzeSetCompletion', 'setCompletion', 'analyzeSetCompletion');

// eBay Lister
lazyWire('triggerEbayLister', 'ebayLister', 'triggerEbayLister');
lazyWire('triggerEbayListerWithPicker', 'ebayLister', 'triggerEbayListerWithPicker');

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

// ── App initialization ──────────────────────────────────────────────────────
// app.js is part of core scripts and runs init() on DOMContentLoaded.
// The lazy-load wrappers above are available before init() runs, so when
// init() calls functions like triggerGradeCard, they'll load the chunk on
// first invocation.

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
    if (event.data?.type === 'SYNC_COLLECTIONS' && typeof forceSync === 'function') {
      forceSync();
    }
  });
}

console.log('✅ Main entry point loaded');
