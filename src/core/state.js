// ============================================================
// js/state.js — FIXED
// Changes:
//   - REMOVED duplicate showToast() — ui.js is the single source of truth
//   - REMOVED duplicate showLoading() — ui.js is the single source of truth
//   - REMOVED duplicate setStatus() — ui.js is the single source of truth
//   - Kept: ready flags, global state vars (database, tesseractWorker)
//   - Added: appConfig loaded from /api/config
//   - Added: getApiToken() — returns BOBA_API_SECRET from appConfig for
//     authenticating to /api/anthropic, /api/ebay-*, /api/grade, /api/upload-image
// ============================================================

// ── Readiness flags ──────────────────────────────────────────────────────────
let ready = {
  db:     false,
  cv:     false,
  config: false
};

// ── Shared globals ───────────────────────────────────────────────────────────
let database  = [];
let appConfig = {};  // Loaded from /api/config on startup

// ── App config loader ─────────────────────────────────────────────────────────
// FIXED: Credentials no longer hardcoded in user-management.js.
// Everything comes from /api/config which reads Vercel env vars.
async function loadAppConfig() {
  try {
    const res = await fetch('/api/config');
    if (!res.ok) throw new Error(`Config fetch failed: ${res.status}`);
    appConfig = await res.json();
    window.appConfig = appConfig; // expose to lazy-loaded modules
    ready.config = true;
    console.log('✅ App config loaded');
  } catch (err) {
    console.error('❌ Failed to load app config:', err);
    // Fall back to empty config — app will degrade gracefully
    appConfig = { supabaseUrl: '', supabaseKey: '', googleClientId: '', apiToken: '' };
  }
}

// Returns the API token for authenticating to serverless endpoints.
// Called by scanner.js, ebay.js, and image-storage.js.
function getApiToken() {
  return appConfig.apiToken || null;
}
window.getApiToken = getApiToken;

// ── Scan mode ────────────────────────────────────────────────────────────────
// Centralised scan mode accessor — 'collection' | 'pricecheck' | 'deckbuilder'
// Still stored on window for backwards compatibility with ui.js, deck-builder.js, etc.
function getScanMode() { return window.scanMode || 'collection'; }
function setScanMode(mode) { window.scanMode = mode; }

console.log('✅ State module loaded');
