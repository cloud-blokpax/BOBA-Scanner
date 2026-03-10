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
     * @param {Object} scanMeta - { displayUrl, fileName, type, confidence, lowConfidence, tags }
     * @returns {Object} - Card object ready for collection storage
     */
    buildCardFromMatch(match, scanMeta) {
        return {
            cardNumber:  match['Card Number'] || '',
            imageUrl:    scanMeta.displayUrl,
            fileName:    scanMeta.fileName,
            scanType:    scanMeta.type,
            confidence:  scanMeta.confidence,
            timestamp:   new Date().toISOString(),
            tags:        scanMeta.tags || [],
            condition:   '',
            notes:       '',
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
     * @param {string} type - 'free', 'manual', or 'ai'
     * @param {number} confidence
     * @returns {string}
     */
    buildScanMethodLabel(type, confidence) {
        if (type === 'free')   return `Free OCR (${Math.round(confidence || 0)}%)`;
        if (type === 'manual') return 'Manual Search';
        return 'AI + Database';
    }
}

// Make available globally
window.CollectionAdapter = CollectionAdapter;
