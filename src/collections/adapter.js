// ============================================================
// src/collections/adapter.js
// Base class for collection-type adapters.
// Override these methods for each card game/collection type.
// The core scanner calls adapter methods instead of
// hardcoding collection-specific logic.
// ============================================================

export class CollectionAdapter {
    /** Unique ID for this collection type (e.g., 'boba', 'pokemon') */
    get id() { throw new Error('CollectionAdapter: implement id'); }

    /** Human-readable name (e.g., "Bo Jackson Battle Arena") */
    get displayName() { throw new Error('CollectionAdapter: implement displayName'); }

    /** URL or path to the card database JSON */
    get databaseUrl() { return '/card-database.json'; }

    /**
     * Define the card fields this collection type uses.
     * Returns an array of { key, label, dbField } objects.
     * Core fields (cardNumber, imageUrl, timestamp) are always included.
     */
    getFieldDefinitions() { return []; }

    /**
     * Map a raw database record to a normalized card object.
     * @param {Object} dbRecord - Raw record from the database JSON
     * @returns {Object} - Normalized card with standard + custom fields
     */
    normalizeDbRecord(dbRecord) { return dbRecord; }

    /**
     * Map a scanned match + scan metadata to a storable card object.
     * @param {Object} match - Database record that matched the scan
     * @param {Object} scanMeta - { displayUrl, fileName, type, confidence, lowConfidence, tags, centeringData, cardBounds }
     * @returns {Object} - Card object ready for collection storage
     */
    buildCardFromMatch(match, scanMeta) {
        return {
            cardNumber:  match['Card Number'] || '',
            imageUrl:    scanMeta.displayUrl,
            fileName:    scanMeta.fileName,
            scanType:    scanMeta.type,
            scanMethod:  this.buildScanMethodLabel(scanMeta.type, scanMeta.confidence),
            confidence:  scanMeta.confidence,
            lowConfidence: scanMeta.lowConfidence || false,
            timestamp:   new Date().toISOString(),
            tags:        scanMeta.tags || [],
            condition:   '',
            notes:       '',
            readyToList:   false,
            listingStatus: null,
            listingUrl:    null,
            listingPrice:  null,
            soldAt:        null,
            centeringData: scanMeta.centeringData || null,
            cardBounds:    scanMeta.cardBounds || null,
        };
    }

    /**
     * Return the AI prompt for card identification.
     * @param {boolean} dualImage - Whether two images are provided
     * @returns {string}
     */
    getAIPrompt(dualImage) { return ''; }

    /**
     * Build an eBay search query for a given card.
     * @param {Object} card - The card to search for
     * @returns {string}
     */
    buildEbayQuery(card) { return card.cardNumber || ''; }

    /**
     * Resolve additional metadata from a match (e.g., hero -> athlete for BOBA).
     * @param {Object} match - The database record
     * @returns {Object} - Additional fields to merge into the card
     */
    resolveMetadata(match) { return {}; }

    /**
     * OCR character whitelist for Tesseract.
     * @returns {string}
     */
    get ocrWhitelist() { return 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789- '; }

    /**
     * Build the scan method label for display.
     * @param {string} type - 'ocr', 'manual', or 'ai'
     * @param {number} confidence
     * @returns {string}
     */
    buildScanMethodLabel(type, confidence) {
        if (type === 'ocr')    return `Free OCR (${Math.round(confidence || 0)}%)`;
        if (type === 'manual') return 'Manual Search';
        return 'AI + Database';
    }

    /**
     * OCR regions to scan for card numbers, ordered by priority.
     * Each region is { x, y, w, h } as fractions of image dimensions.
     * @returns {Array<{x: number, y: number, w: number, h: number}>}
     */
    getOCRRegions() {
        return [
            { x: 0.01, y: 0.84, w: 0.35, h: 0.13 },
            { x: 0.60, y: 0.84, w: 0.35, h: 0.13 },
            { x: 0.0,  y: 0.80, w: 1.0,  h: 0.18 },
        ];
    }

    /**
     * Region to crop for the AI card-number zoom image.
     * @returns {{x: number, y: number, w: number, h: number}}
     */
    getCardNumberCropRegion() {
        return { x: 0.0, y: 0.82, w: 0.40, h: 0.15 };
    }

    /**
     * Default scan settings for this collection type.
     * @returns {{quality: number, threshold: number, maxSize: number, aiCost: number, region: {x: number, y: number, w: number, h: number}}}
     */
    getScanConfig() {
        return {
            quality: 0.7,
            threshold: 60,
            maxSize: 1400,
            aiCost: 0.002,
            region: { x: 0.05, y: 0.85, w: 0.4, h: 0.12 }
        };
    }

    /**
     * Database configuration for this collection type.
     * @returns {{idbName: string, storeName: string, databaseUrl: string}}
     */
    getDatabaseConfig() {
        return {
            idbName: 'card-scanner',
            storeName: 'card-db',
            databaseUrl: this.databaseUrl,
        };
    }

    /**
     * Fields searchable in the manual search modal.
     * Each entry maps to a raw database field name.
     * @returns {Array<{key: string, label: string, dbField: string}>}
     */
    getSearchableFields() {
        return [
            { key: 'cardNumber', label: 'Card Number', dbField: 'Card Number' },
            { key: 'name',      label: 'Name',         dbField: 'Name' },
            { key: 'set',       label: 'Set',           dbField: 'Set' },
        ];
    }

    /**
     * Format a raw database record for display in manual search results.
     * @param {Object} dbRecord - Raw record from the database JSON
     * @returns {{title: string, subtitle: string, id: string}}
     */
    formatSearchResult(dbRecord) {
        return {
            id:       String(dbRecord['Card ID'] || ''),
            title:    dbRecord.Name || '',
            subtitle: dbRecord['Card Number'] || '',
        };
    }

    /**
     * Field keys expected in the AI JSON response.
     * @returns {string[]}
     */
    getAIResponseFields() {
        return ['cardNumber', 'confidence'];
    }

    /**
     * The raw database field that holds the card number for indexing.
     * @returns {string}
     */
    get cardNumberField() { return 'Card Number'; }

    /**
     * The raw database field that holds the card's unique ID.
     * @returns {string}
     */
    get cardIdField() { return 'Card ID'; }

    /**
     * The raw database field that holds the card/character name.
     * @returns {string}
     */
    get nameField() { return 'Name'; }
}

// Make available globally
window.CollectionAdapter = CollectionAdapter;
