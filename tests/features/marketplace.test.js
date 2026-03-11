// tests/features/marketplace.test.js — Tests for marketplace/eBay query building
import { describe, it, expect } from 'vitest';

// Re-implement eBay query builder for testing (mirrors boba-adapter.js logic)
function buildBobaEbayQuery(card) {
    const s = v => String(v ?? '').trim();
    const parts = [];

    parts.push('bo jackson battle arena');

    const cardNum = s(card.cardNumber);
    if (cardNum) parts.push(cardNum);

    const hero = s(card.hero);
    if (hero && hero.toLowerCase() !== 'unknown') parts.push(hero);

    const athlete = s(card.athlete);
    if (athlete) parts.push(athlete);

    return parts.join(' ');
}

// Generic adapter fallback query
function buildGenericEbayQuery(card) {
    return card.cardNumber || '';
}

describe('eBay Query Builder - BOBA Adapter', () => {
    it('includes "bo jackson battle arena" prefix', () => {
        const query = buildBobaEbayQuery({ cardNumber: 'BF-108', hero: 'Frost' });
        expect(query.startsWith('bo jackson battle arena')).toBe(true);
    });

    it('includes card number', () => {
        const query = buildBobaEbayQuery({ cardNumber: 'BLBF-84', hero: 'Blaze' });
        expect(query).toContain('BLBF-84');
    });

    it('includes hero name', () => {
        const query = buildBobaEbayQuery({ cardNumber: 'BF-108', hero: 'Frost' });
        expect(query).toContain('Frost');
    });

    it('includes athlete name', () => {
        const query = buildBobaEbayQuery({ cardNumber: 'BF-108', hero: 'Frost', athlete: 'Bo Jackson' });
        expect(query).toContain('Bo Jackson');
    });

    it('excludes "Unknown" hero', () => {
        const query = buildBobaEbayQuery({ cardNumber: 'BF-108', hero: 'Unknown' });
        expect(query).not.toContain('Unknown');
    });

    it('handles missing fields gracefully', () => {
        const query = buildBobaEbayQuery({});
        expect(query).toBe('bo jackson battle arena');
    });

    it('trims whitespace from values', () => {
        const query = buildBobaEbayQuery({ cardNumber: '  BF-108  ', hero: '  Frost  ' });
        expect(query).toContain('BF-108');
        expect(query).not.toContain('  BF-108  ');
    });
});

describe('eBay Query Builder - Generic fallback', () => {
    it('returns just card number', () => {
        const query = buildGenericEbayQuery({ cardNumber: 'XY-99' });
        expect(query).toBe('XY-99');
    });

    it('returns empty string for missing card number', () => {
        const query = buildGenericEbayQuery({});
        expect(query).toBe('');
    });
});
