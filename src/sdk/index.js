// ============================================================
// src/sdk/index.js — Public API surface for the BOBA Scanner SDK
//
// This is the entry point for external integrations (e.g., Bazooka Vault).
// Import from this file to get access to the scanner, widget, and adapter system.
//
// Usage:
//   import { createScanner, createWidget, CollectionAdapter } from '@boba/scanner-sdk';
// ============================================================

// Headless scanner (no UI required)
export { createScanner } from './scanner-client.js';

// Embeddable widget (with optional UI)
export { createWidget } from '../embed/widget.js';

// Adapter system (for custom collection types)
export { CollectionAdapter } from '../collections/adapter.js';
export { registerAdapter, getActiveAdapter, getAdapter, setActiveAdapter, listAdapters } from '../collections/registry.js';

// Built-in adapters
export { BobaAdapter } from '../collections/boba/boba-adapter.js';

// Type definitions (for IDE autocomplete)
export {} from './types.js';
