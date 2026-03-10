// ============================================================
// src/collections/boba/boba-adapter.js
// BOBA (Bo Jackson Battle Arena) collection adapter.
// Implements the CollectionAdapter interface for BOBA cards.
// ============================================================

class BobaAdapter extends CollectionAdapter {
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
        const athleteName = (typeof getAthleteForHero === 'function')
            ? (getAthleteForHero(match.Name) || '') : '';

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
            lowConfidence: scanMeta.lowConfidence,
            timestamp:     new Date().toISOString(),
            tags:          scanMeta.tags || [],
            condition:     '',
            notes:         '',
            readyToList:   false,
            listingStatus: null,
            listingUrl:    null,
            listingPrice:  null,
            soldAt:        null,
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

    resolveMetadata(match) {
        const athlete = (typeof getAthleteForHero === 'function')
            ? (getAthleteForHero(match.Name) || '') : '';
        return { athlete };
    }

    get ocrWhitelist() {
        return 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789- ';
    }
}

// Register the BOBA adapter
registerAdapter(new BobaAdapter());
setActiveAdapter('boba');

console.log('✅ BOBA adapter registered');
