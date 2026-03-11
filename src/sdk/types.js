// ============================================================
// src/sdk/types.js — JSDoc type definitions for the SDK
// ============================================================

/**
 * @typedef {Object} ScanResult
 * @property {string} cardNumber - The identified card number
 * @property {Object} fields - All adapter-defined fields (e.g., hero, set, year)
 * @property {number} confidence - AI confidence score (0-100)
 * @property {string} scanMethod - 'ocr' | 'ai' | 'manual'
 * @property {string} [imageUrl] - URL to the card image (if available)
 * @property {string} collectionType - Adapter ID that identified this card
 */

/**
 * @typedef {Object} ScannerOptions
 * @property {string} [collectionType='boba'] - Adapter ID to use
 * @property {string} [apiEndpoint='/api/anthropic'] - AI identification endpoint
 * @property {string} [apiToken] - API auth token (passed as X-Api-Token header)
 * @property {string} [databaseUrl] - Override adapter's default database URL
 * @property {Function} [onCardIdentified] - Called when a card is successfully identified
 * @property {Function} [onScanError] - Called when scan fails
 * @property {Function} [onScanStart] - Called when scan begins
 * @property {Function} [onScanProgress] - Called with progress updates
 */

/**
 * @typedef {Object} WidgetOptions
 * @property {HTMLElement} container - DOM element to mount the widget into
 * @property {boolean} [ui=true] - Whether to render built-in UI (false = headless)
 * @property {string} [collectionType='boba'] - Adapter ID to use
 * @property {string} [apiEndpoint='/api/anthropic'] - AI identification endpoint
 * @property {string} [apiToken] - API auth token
 * @property {string} [databaseUrl] - Override adapter's default database URL
 * @property {Function} [onCardScanned] - Callback when a card is successfully scanned
 * @property {Function} [onError] - Callback on scan error
 */

export {};
