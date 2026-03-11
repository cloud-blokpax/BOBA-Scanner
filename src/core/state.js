// ============================================================
// src/core/state.js
// Global app state: readiness flags, database, config, scan mode.
// Uses setter functions for variables that get reassigned so
// ES module live bindings work correctly across importers.
// ============================================================

import { setStatus } from '../ui/toast.js';

// ── Readiness flags ──────────────────────────────────────────────────────────
export const ready = {
  db:     false,
  cv:     false,
  config: false,
  ocr:    false
};

// ── Shared state ───────────────────────────────────────────────────────────
export let database  = [];
export let appConfig = {};  // Loaded from /api/config on startup
export let tesseractWorker = null;

// Setter functions — ES module importers can't reassign imported bindings.
// Other modules call these to update shared state.
export function setDatabase(data) { database = data; }
export function setAppConfig(cfg) { appConfig = cfg; }
export function setTesseractWorker(worker) { tesseractWorker = worker; }

// ── App config loader ─────────────────────────────────────────────────────────
export async function loadAppConfig() {
  try {
    const res = await fetch('/api/config');
    if (!res.ok) throw new Error(`Config fetch failed: ${res.status}`);
    appConfig = await res.json();
    window.appConfig = appConfig; // expose to lazy-loaded modules
    ready.config = true;
    console.log('✅ App config loaded');
  } catch (err) {
    console.error('❌ Failed to load app config:', err);
    appConfig = { supabaseUrl: '', supabaseKey: '', googleClientId: '', apiToken: '' };
    ready.config = true; // Mark as ready even on error so downstream code isn't blocked
  }
}

// Returns the API token for authenticating to serverless endpoints.
export function getApiToken() {
  return appConfig.apiToken || null;
}
window.getApiToken = getApiToken;

// ── Scan mode ────────────────────────────────────────────────────────────────
export function getScanMode() { return window.scanMode || 'collection'; }
export function setScanMode(mode) { window.scanMode = mode; }

console.log('✅ State module loaded');
