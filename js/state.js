// ============================================================
// js/state.js — FIXED
// Changes:
//   - REMOVED duplicate showToast() — ui.js is the single source of truth
//   - REMOVED duplicate showLoading() — ui.js is the single source of truth
//   - REMOVED duplicate setStatus() — ui.js is the single source of truth
//   - Kept: ready flags, global state vars (database, tesseractWorker, apiToken)
//   - Added: appConfig loaded from /api/config
// ============================================================

// ── Readiness flags ──────────────────────────────────────────────────────────
let ready = {
  db:     false,
  ocr:    false,
  cv:     false,
  config: false
};

// ── Shared globals ───────────────────────────────────────────────────────────
let database        = [];
let tesseractWorker = null;
let appConfig       = {};  // Loaded from /api/config on startup

// ── App config loader ─────────────────────────────────────────────────────────
// FIXED: Credentials no longer hardcoded in user-management.js.
// Everything comes from /api/config which reads Vercel env vars.
async function loadAppConfig() {
  try {
    const res = await fetch('/api/config');
    if (!res.ok) throw new Error(`Config fetch failed: ${res.status}`);
    appConfig = await res.json();
    ready.config = true;
    console.log('✅ App config loaded');
  } catch (err) {
    console.error('❌ Failed to load app config:', err);
    // Fall back to empty config — app will degrade gracefully
    appConfig = { supabaseUrl: '', supabaseKey: '', apiToken: '', googleClientId: '' };
  }
}

console.log('✅ State module loaded');
