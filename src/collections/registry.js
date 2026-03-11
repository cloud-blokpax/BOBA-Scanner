// ============================================================
// src/collections/registry.js
// Adapter registry — register collection-type adapters and
// access the currently active one.
//
// Usage:
//   registerAdapter(new BobaAdapter());
//   setActiveAdapter('boba');
//   const adapter = getActiveAdapter();
// ============================================================

import { CollectionAdapter } from './adapter.js';

const _adapters = {};
let _activeAdapter = null;

export function registerAdapter(adapter) {
    if (!(adapter instanceof CollectionAdapter)) {
        console.warn('[Registry] adapter must extend CollectionAdapter');
        return;
    }
    _adapters[adapter.id] = adapter;
    console.log(`[Registry] Registered adapter: ${adapter.id} (${adapter.displayName})`);
}

export function setActiveAdapter(id) {
    if (!_adapters[id]) {
        console.warn(`[Registry] No adapter registered for "${id}"`);
        return false;
    }
    _activeAdapter = _adapters[id];
    console.log(`[Registry] Active adapter: ${id}`);
    return true;
}

export function getActiveAdapter() {
    return _activeAdapter;
}

export function getAdapter(id) {
    return _adapters[id] || null;
}

export function listAdapters() {
    return Object.values(_adapters).map(a => ({ id: a.id, displayName: a.displayName }));
}

// Make getActiveAdapter available to lazy-loaded modules (e.g. deck-builder)
window.getActiveAdapter = getActiveAdapter;
