// ============================================================
// src/collections/boba/boba-adapter.js
// BOBA (Bo Jackson Battle Arena) collection adapter.
// Implements the CollectionAdapter interface for BOBA cards.
// ============================================================

import { CollectionAdapter } from '../adapter.js';
import { registerAdapter, setActiveAdapter } from '../registry.js';
import { getAthleteForHero } from './heroes.js';

export class BobaAdapter extends CollectionAdapter {
    get id() { return 'boba'; }
    get displayName() { return 'Bo Jackson Battle Arena'; }
    get databaseUrl() { return '/card-database.json'; }

    getFieldDefinitions() {
        return [
            { key: 'cardId',     label: 'Card ID',     dbField: 'Card ID' },
            { key: 'hero',       label: 'Hero',         dbField: 'Name' },
            { key: 'athlete',    label: 'Athlete',      dbField: null },   // resolved via hero lookup
            { key: 'year',       label: 'Year',         dbField: 'Year' },
            { key: 'set',        label: 'Set',          dbField: 'Set' },
            { key: 'cardNumber', label: 'Card Number',  dbField: 'Card Number' },
            { key: 'pose',       label: 'Pose',         dbField: 'Parallel' },
            { key: 'weapon',     label: 'Weapon',       dbField: 'Weapon' },
            { key: 'power',      label: 'Power',        dbField: 'Power' },
        ];
    }

    normalizeDbRecord(dbRecord) {
        return {
            cardId:     String(dbRecord['Card ID'] || ''),
            hero:       dbRecord.Name || '',
            year:       dbRecord.Year || '',
            set:        dbRecord.Set || '',
            cardNumber: dbRecord['Card Number'] || '',
            pose:       dbRecord.Parallel || '',
            weapon:     dbRecord.Weapon || '',
            power:      dbRecord.Power || '',
        };
    }

    buildCardFromMatch(match, scanMeta) {
        const athleteName = getAthleteForHero(match.Name) || '';

        return {
            cardId:        String(match['Card ID'] || ''),
            hero:          match.Name || '',
            athlete:       athleteName,
            year:          match.Year || '',
            set:           match.Set || '',
            cardNumber:    match['Card Number'] || '',
            pose:          match.Parallel || '',
            weapon:        match.Weapon || '',
            power:         match.Power || '',
            imageUrl:      scanMeta.displayUrl,
            fileName:      scanMeta.fileName,
            scanType:      scanMeta.type,
            scanMethod:    this.buildScanMethodLabel(scanMeta.type, scanMeta.confidence),
            confidence:    scanMeta.confidence,
            lowConfidence: scanMeta.lowConfidence || false,
            timestamp:     new Date().toISOString(),
            tags:          scanMeta.tags || [],
            condition:     '',
            notes:         '',
            readyToList:   false,
            listingStatus: null,
            listingUrl:    null,
            listingPrice:  null,
            soldAt:        null,
            centeringData: scanMeta.centeringData || null,
            cardBounds:    scanMeta.cardBounds || null,
        };
    }

    getAIPrompt(dualImage) {
        if (dualImage) {
            return `You are analyzing a Bo Jackson trading card. Two images are provided:
1. The full card image — use this for hero name, set, power, pose, weapon, and year.
2. A zoomed, contrast-enhanced crop of the BOTTOM-LEFT card number region — use this for the card number.

CARD NUMBER FORMAT: Letters-Numbers, e.g. "BLBF-84", "BF-108", "EDLCA-22", "GLBF-12".
The card number is NOT the power number in the top right!

Common OCR errors to watch for: 6 vs 8, 0 vs O, 1 vs I, B vs 8, S vs 5.

Return ONLY valid JSON with no markdown or extra text:
{
  "cardNumber": "BLBF-84",
  "hero": "CHARACTER NAME",
  "year": "2024",
  "set": "Set Name",
  "pose": "Parallel type or Base",
  "weapon": "Weapon name or None",
  "power": "125",
  "confidence": 90
}`;
        }

        return `You are analyzing a Bo Jackson trading card. Extract the following information:

CRITICAL LOCATIONS ON THE CARD:
1. CARD NUMBER — BOTTOM LEFT corner. Format: Letters-Numbers e.g. "BLBF-84", "BF-108", "EDLCA-22", "GLBF-12".
   This is NOT the power number in the top right!
2. POWER — TOP RIGHT corner in a circle/badge. Just a number e.g. "125". NOT the card number.
3. HERO NAME — Printed prominently near the top, often all caps.
4. SET NAME — Near bottom or on a banner (e.g. "Battle Arena", "Alpha Edition").
5. YEAR — Usually "2023" or "2024".

Common OCR errors to watch for: 6 vs 8, 0 vs O, 1 vs I, B vs 8, S vs 5.

Also include a confidence score (0-100) for how certain you are about the card number.

Return ONLY valid JSON with no markdown or extra text:
{
  "cardNumber": "BLBF-84",
  "hero": "CHARACTER NAME",
  "year": "2024",
  "set": "Set Name",
  "pose": "Parallel type or Base",
  "weapon": "Weapon name or None",
  "power": "125",
  "confidence": 90
}`;
    }

    buildEbayQuery(card) {
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

    resolveMetadata(match) {
        const athlete = getAthleteForHero(match.Name || match.hero) || '';
        return { athlete };
    }

    get ocrWhitelist() {
        return 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789- ';
    }

    // ── BOBA-specific OCR regions ──────────────────────────────────────────────
    getOCRRegions() {
        return [
            { x: 0.01, y: 0.84, w: 0.35, h: 0.13 },  // bottom-left (most common)
            { x: 0.60, y: 0.84, w: 0.35, h: 0.13 },  // bottom-right (alternate layouts)
            { x: 0.0,  y: 0.80, w: 1.0,  h: 0.18 },  // full bottom strip (fallback)
        ];
    }

    getCardNumberCropRegion() {
        return { x: 0.0, y: 0.82, w: 0.40, h: 0.15 };
    }

    getScanConfig() {
        return {
            quality: 0.7,
            threshold: 60,
            maxSize: 1400,
            aiCost: 0.002,
            region: { x: 0.05, y: 0.85, w: 0.4, h: 0.12 }
        };
    }

    getDatabaseConfig() {
        return {
            idbName: 'boba-scanner',
            storeName: 'card-db',
            databaseUrl: '/card-database.json',
        };
    }

    getSearchableFields() {
        return [
            { key: 'cardNumber', label: 'Card Number', dbField: 'Card Number' },
            { key: 'name',      label: 'Name',         dbField: 'Name' },
            { key: 'set',       label: 'Set',           dbField: 'Set' },
        ];
    }

    formatSearchResult(dbRecord) {
        const parts = [
            dbRecord['Card Number'] || '',
            dbRecord.Year ? String(dbRecord.Year) : '',
            dbRecord.Set || '',
        ].filter(Boolean);
        const parallel = dbRecord.Parallel;
        if (parallel && parallel !== 'Base') parts.push(parallel);

        return {
            id:       String(dbRecord['Card ID'] || ''),
            title:    dbRecord.Name || '',
            subtitle: parts.join(' · '),
        };
    }

    getAIResponseFields() {
        return ['cardNumber', 'hero', 'year', 'set', 'pose', 'weapon', 'power', 'confidence'];
    }
}

// Register the BOBA adapter as default
registerAdapter(new BobaAdapter());
setActiveAdapter('boba');

console.log('✅ BOBA adapter registered');
