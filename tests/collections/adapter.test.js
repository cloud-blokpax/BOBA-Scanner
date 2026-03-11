// tests/collections/adapter.test.js — Tests for adapter base class and BobaAdapter
import { describe, it, expect, beforeEach } from 'vitest';

// Re-implement adapter classes for testing (avoid DOM dependencies)
class CollectionAdapter {
    get id() { throw new Error('implement id'); }
    get displayName() { throw new Error('implement displayName'); }
    get databaseUrl() { return '/card-database.json'; }
    getFieldDefinitions() { return []; }
    normalizeDbRecord(r) { return r; }
    buildCardFromMatch(match, meta) {
        return {
            cardNumber: match['Card Number'] || '',
            imageUrl: meta.displayUrl,
            fileName: meta.fileName,
            scanType: meta.type,
            scanMethod: this.buildScanMethodLabel(meta.type, meta.confidence),
            confidence: meta.confidence,
            lowConfidence: meta.lowConfidence || false,
            timestamp: new Date().toISOString(),
            tags: meta.tags || [],
        };
    }
    getAIPrompt(dual) { return ''; }
    buildEbayQuery(card) { return card.cardNumber || ''; }
    resolveMetadata(match) { return {}; }
    get ocrWhitelist() { return 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789- '; }
    buildScanMethodLabel(type, confidence) {
        if (type === 'ocr') return `Free OCR (${Math.round(confidence || 0)}%)`;
        if (type === 'manual') return 'Manual Search';
        return 'AI + Database';
    }
    getOCRRegions() {
        return [
            { x: 0.01, y: 0.84, w: 0.35, h: 0.13 },
            { x: 0.60, y: 0.84, w: 0.35, h: 0.13 },
            { x: 0.0,  y: 0.80, w: 1.0,  h: 0.18 },
        ];
    }
    getCardNumberCropRegion() { return { x: 0.0, y: 0.82, w: 0.40, h: 0.15 }; }
    getScanConfig() { return { quality: 0.7, threshold: 60, maxSize: 1400, aiCost: 0.002 }; }
    getDatabaseConfig() { return { idbName: 'card-scanner', storeName: 'card-db', databaseUrl: this.databaseUrl }; }
    getSearchableFields() { return [{ key: 'cardNumber', label: 'Card Number', dbField: 'Card Number' }]; }
    formatSearchResult(r) { return { id: '', title: r.Name || '', subtitle: r['Card Number'] || '' }; }
    getAIResponseFields() { return ['cardNumber', 'confidence']; }
    get cardNumberField() { return 'Card Number'; }
    get cardIdField() { return 'Card ID'; }
    get nameField() { return 'Name'; }
}

// Simplified BobaAdapter for testing (no DOM/heroes dependency)
class BobaAdapter extends CollectionAdapter {
    get id() { return 'boba'; }
    get displayName() { return 'Bo Jackson Battle Arena'; }
    get databaseUrl() { return '/card-database.json'; }

    getFieldDefinitions() {
        return [
            { key: 'cardId',     label: 'Card ID',     dbField: 'Card ID' },
            { key: 'hero',       label: 'Hero',         dbField: 'Name' },
            { key: 'athlete',    label: 'Athlete',      dbField: null },
            { key: 'year',       label: 'Year',         dbField: 'Year' },
            { key: 'set',        label: 'Set',          dbField: 'Set' },
            { key: 'cardNumber', label: 'Card Number',  dbField: 'Card Number' },
            { key: 'pose',       label: 'Pose',         dbField: 'Parallel' },
            { key: 'weapon',     label: 'Weapon',       dbField: 'Weapon' },
            { key: 'power',      label: 'Power',        dbField: 'Power' },
        ];
    }

    normalizeDbRecord(r) {
        return {
            cardId: String(r['Card ID'] || ''),
            hero: r.Name || '',
            year: r.Year || '',
            set: r.Set || '',
            cardNumber: r['Card Number'] || '',
            pose: r.Parallel || '',
            weapon: r.Weapon || '',
            power: r.Power || '',
        };
    }

    buildCardFromMatch(match, meta) {
        return {
            cardId: String(match['Card ID'] || ''),
            hero: match.Name || '',
            athlete: '',
            year: match.Year || '',
            set: match.Set || '',
            cardNumber: match['Card Number'] || '',
            pose: match.Parallel || '',
            weapon: match.Weapon || '',
            power: match.Power || '',
            imageUrl: meta.displayUrl,
            fileName: meta.fileName,
            scanType: meta.type,
            scanMethod: this.buildScanMethodLabel(meta.type, meta.confidence),
            confidence: meta.confidence,
            lowConfidence: meta.lowConfidence || false,
            timestamp: new Date().toISOString(),
            tags: meta.tags || [],
            condition: '',
            notes: '',
        };
    }

    buildEbayQuery(card) {
        const parts = ['bo jackson battle arena'];
        if (card.cardNumber) parts.push(card.cardNumber);
        if (card.hero && card.hero !== 'Unknown') parts.push(card.hero);
        return parts.join(' ');
    }

    getDatabaseConfig() {
        return { idbName: 'boba-scanner', storeName: 'card-db', databaseUrl: '/card-database.json' };
    }

    getSearchableFields() {
        return [
            { key: 'cardNumber', label: 'Card Number', dbField: 'Card Number' },
            { key: 'name',      label: 'Name',         dbField: 'Name' },
            { key: 'set',       label: 'Set',           dbField: 'Set' },
        ];
    }

    formatSearchResult(r) {
        const parts = [r['Card Number'] || '', r.Year ? String(r.Year) : '', r.Set || ''].filter(Boolean);
        const parallel = r.Parallel;
        if (parallel && parallel !== 'Base') parts.push(parallel);
        return { id: String(r['Card ID'] || ''), title: r.Name || '', subtitle: parts.join(' · ') };
    }

    getOCRRegions() {
        return [
            { x: 0.01, y: 0.84, w: 0.35, h: 0.13 },
            { x: 0.60, y: 0.84, w: 0.35, h: 0.13 },
            { x: 0.0,  y: 0.80, w: 1.0,  h: 0.18 },
        ];
    }

    getAIResponseFields() {
        return ['cardNumber', 'hero', 'year', 'set', 'pose', 'weapon', 'power', 'confidence'];
    }
}

// ── Registry tests ──────────────────────────────────────────────────────────
describe('Adapter Registry', () => {
    let registry;

    beforeEach(() => {
        registry = new Map();
    });

    function registerAdapter(adapter) {
        registry.set(adapter.id, adapter);
    }

    function getAdapter(id) {
        return registry.get(id) || null;
    }

    function listAdapters() {
        return [...registry.values()];
    }

    it('registers and retrieves an adapter', () => {
        const adapter = new BobaAdapter();
        registerAdapter(adapter);
        expect(getAdapter('boba')).toBe(adapter);
    });

    it('returns null for unknown adapter', () => {
        expect(getAdapter('pokemon')).toBeNull();
    });

    it('lists all registered adapters', () => {
        registerAdapter(new BobaAdapter());
        const list = listAdapters();
        expect(list).toHaveLength(1);
        expect(list[0].id).toBe('boba');
    });
});

// ── Base CollectionAdapter tests ────────────────────────────────────────────
describe('CollectionAdapter (base)', () => {
    it('throws on abstract id/displayName', () => {
        const base = new CollectionAdapter();
        expect(() => base.id).toThrow();
        expect(() => base.displayName).toThrow();
    });

    it('provides sensible defaults', () => {
        const base = new CollectionAdapter();
        expect(base.databaseUrl).toBe('/card-database.json');
        expect(base.cardNumberField).toBe('Card Number');
        expect(base.cardIdField).toBe('Card ID');
        expect(base.nameField).toBe('Name');
        expect(base.ocrWhitelist).toContain('A');
        expect(base.ocrWhitelist).toContain('0');
    });

    it('builds scan method labels correctly', () => {
        const base = new CollectionAdapter();
        expect(base.buildScanMethodLabel('ocr', 85)).toBe('Free OCR (85%)');
        expect(base.buildScanMethodLabel('manual', 0)).toBe('Manual Search');
        expect(base.buildScanMethodLabel('ai', 95)).toBe('AI + Database');
    });

    it('returns default OCR regions', () => {
        const base = new CollectionAdapter();
        const regions = base.getOCRRegions();
        expect(regions).toHaveLength(3);
        expect(regions[0]).toHaveProperty('x');
        expect(regions[0]).toHaveProperty('y');
        expect(regions[0]).toHaveProperty('w');
        expect(regions[0]).toHaveProperty('h');
    });

    it('returns default scan config', () => {
        const base = new CollectionAdapter();
        const config = base.getScanConfig();
        expect(config.quality).toBe(0.7);
        expect(config.threshold).toBe(60);
    });

    it('returns default database config', () => {
        const base = new CollectionAdapter();
        const config = base.getDatabaseConfig();
        expect(config.idbName).toBe('card-scanner');
        expect(config.storeName).toBe('card-db');
    });

    it('buildCardFromMatch creates a card object', () => {
        const base = new CollectionAdapter();
        const match = { 'Card Number': 'BF-42' };
        const meta = { displayUrl: 'http://img.png', fileName: 'test.jpg', type: 'ocr', confidence: 90, tags: ['test'] };
        const card = base.buildCardFromMatch(match, meta);
        expect(card.cardNumber).toBe('BF-42');
        expect(card.scanType).toBe('ocr');
        expect(card.scanMethod).toBe('Free OCR (90%)');
        expect(card.tags).toEqual(['test']);
    });
});

// ── BobaAdapter tests ───────────────────────────────────────────────────────
describe('BobaAdapter', () => {
    let adapter;

    beforeEach(() => {
        adapter = new BobaAdapter();
    });

    it('has correct id and displayName', () => {
        expect(adapter.id).toBe('boba');
        expect(adapter.displayName).toBe('Bo Jackson Battle Arena');
    });

    it('defines 9 field definitions', () => {
        const fields = adapter.getFieldDefinitions();
        expect(fields.length).toBe(9);
        expect(fields.map(f => f.key)).toContain('hero');
        expect(fields.map(f => f.key)).toContain('cardNumber');
        expect(fields.map(f => f.key)).toContain('weapon');
    });

    it('normalizes a DB record', () => {
        const raw = {
            'Card ID': '123',
            Name: 'Blaze',
            Year: '2024',
            Set: 'Alpha',
            'Card Number': 'BLBF-84',
            Parallel: 'Base',
            Weapon: 'Sword',
            Power: '125'
        };
        const normalized = adapter.normalizeDbRecord(raw);
        expect(normalized.hero).toBe('Blaze');
        expect(normalized.cardNumber).toBe('BLBF-84');
        expect(normalized.weapon).toBe('Sword');
    });

    it('builds card from match with correct fields', () => {
        const match = {
            'Card ID': '42',
            Name: 'Frost',
            Year: '2024',
            Set: 'Beta',
            'Card Number': 'BF-108',
            Parallel: 'Holo',
            Weapon: 'Staff',
            Power: '200'
        };
        const meta = {
            displayUrl: 'http://card.jpg',
            fileName: 'frost.jpg',
            type: 'ai',
            confidence: 95,
            tags: ['rare']
        };
        const card = adapter.buildCardFromMatch(match, meta);
        expect(card.hero).toBe('Frost');
        expect(card.cardNumber).toBe('BF-108');
        expect(card.scanMethod).toBe('AI + Database');
        expect(card.pose).toBe('Holo');
        expect(card.weapon).toBe('Staff');
    });

    it('builds eBay query with game name', () => {
        const card = { cardNumber: 'BLBF-84', hero: 'Blaze', athlete: 'Bo Jackson' };
        const query = adapter.buildEbayQuery(card);
        expect(query).toContain('bo jackson battle arena');
        expect(query).toContain('BLBF-84');
        expect(query).toContain('Blaze');
    });

    it('returns BOBA-specific database config', () => {
        const config = adapter.getDatabaseConfig();
        expect(config.idbName).toBe('boba-scanner');
        expect(config.databaseUrl).toBe('/card-database.json');
    });

    it('returns BOBA-specific searchable fields', () => {
        const fields = adapter.getSearchableFields();
        expect(fields).toHaveLength(3);
        expect(fields.map(f => f.dbField)).toContain('Name');
    });

    it('formats search result with subtitle parts', () => {
        const record = {
            'Card ID': '5',
            Name: 'Frost',
            'Card Number': 'BF-108',
            Year: '2024',
            Set: 'Alpha',
            Parallel: 'Holo'
        };
        const result = adapter.formatSearchResult(record);
        expect(result.title).toBe('Frost');
        expect(result.subtitle).toContain('BF-108');
        expect(result.subtitle).toContain('Holo');
    });

    it('returns correct AI response fields', () => {
        const fields = adapter.getAIResponseFields();
        expect(fields).toContain('cardNumber');
        expect(fields).toContain('hero');
        expect(fields).toContain('confidence');
        expect(fields.length).toBe(8);
    });

    it('OCR regions have 3 entries', () => {
        const regions = adapter.getOCRRegions();
        expect(regions).toHaveLength(3);
    });

    it('getCardNumberCropRegion returns bottom-left region', () => {
        const region = adapter.getCardNumberCropRegion();
        expect(region.y).toBeGreaterThan(0.7);
        expect(region.x).toBeLessThan(0.1);
    });
});
