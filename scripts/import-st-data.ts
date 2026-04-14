/**
 * Import Scraping Test Data
 *
 * Reads the source data dump and imports it into the scraping_test table,
 * matching cards by hero_name + card_number.
 *
 * Usage: npx tsx scripts/import-st-data.ts <path-to-dump.json>
 *
 * Adjust field names in SOURCE_FIELD_MAP to match your dump format.
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { config } from 'dotenv';

config();

const SUPABASE_URL = process.env.PUBLIC_SUPABASE_URL || '';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// ── Map source fields to our sanitized schema ───────────
// Adjust these keys to match whatever field names your dump uses
const SOURCE_FIELD_MAP = {
  name:          'heroName',       // or 'name', 'hero_name'
  cardNumber:    'cardNumber',     // or 'card_number', 'number'
  price:         'lastSalePrice',  // primary price field
  low:           'lowPrice',       // optional
  high:          'highPrice',      // optional
  setName:       'setName',        // optional
  variant:       'variant',        // or 'parallel', 'treatment'
  rarity:        'rarity',         // optional
  imageUrl:      'imageUrl',       // optional
  sourceId:      'id',             // opaque source record ID
};

interface SourceRecord {
  [key: string]: unknown;
}

async function main() {
  const dumpPath = process.argv[2];
  if (!dumpPath) {
    console.error('Usage: npx tsx scripts/import-st-data.ts <path-to-dump.json>');
    process.exit(1);
  }

  console.log('Loading source dump...');
  const raw: SourceRecord[] = JSON.parse(readFileSync(dumpPath, 'utf-8'));
  console.log(`  Found ${raw.length} records\n`);

  // Load all cards from DB for matching
  console.log('Loading cards from Supabase...');
  let allCards: Array<{ id: string; hero_name: string | null; card_number: string | null }> = [];
  let offset = 0;
  const PAGE = 5000;

  while (true) {
    const { data, error: err } = await supabase
      .from('cards')
      .select('id, hero_name, card_number')
      .range(offset, offset + PAGE - 1);

    if (err) { console.error('Failed to load cards:', err); process.exit(1); }
    if (!data || data.length === 0) break;
    allCards = allCards.concat(data);
    offset += data.length;
    if (data.length < PAGE) break;
  }

  console.log(`  Loaded ${allCards.length} cards\n`);

  // Build lookup: lowercase "heroname|cardnumber" -> card_id
  const cardLookup = new Map<string, string>();
  for (const c of allCards) {
    if (c.hero_name && c.card_number) {
      const key = `${c.hero_name.toLowerCase()}|${c.card_number.toLowerCase()}`;
      cardLookup.set(key, c.id);
    }
  }

  // Match and build upsert rows
  let matched = 0;
  let unmatched = 0;
  let noPrice = 0;
  const rows: Array<Record<string, unknown>> = [];
  const unmatchedRecords: SourceRecord[] = [];

  for (const rec of raw) {
    const name = String(rec[SOURCE_FIELD_MAP.name] || '').trim();
    const cardNumber = String(rec[SOURCE_FIELD_MAP.cardNumber] || '').trim();
    const price = rec[SOURCE_FIELD_MAP.price];

    if (!name || !cardNumber) { unmatched++; continue; }

    const key = `${name.toLowerCase()}|${cardNumber.toLowerCase()}`;
    const cardId = cardLookup.get(key);

    if (!cardId) {
      unmatched++;
      unmatchedRecords.push(rec);
      continue;
    }

    const stPrice = typeof price === 'number' ? price : parseFloat(String(price));

    rows.push({
      card_id: cardId,
      st_price: isNaN(stPrice) ? null : stPrice,
      st_low: rec[SOURCE_FIELD_MAP.low] != null ? Number(rec[SOURCE_FIELD_MAP.low]) : null,
      st_high: rec[SOURCE_FIELD_MAP.high] != null ? Number(rec[SOURCE_FIELD_MAP.high]) : null,
      st_source_id: rec[SOURCE_FIELD_MAP.sourceId] ? String(rec[SOURCE_FIELD_MAP.sourceId]) : null,
      st_card_name: name,
      st_set_name: rec[SOURCE_FIELD_MAP.setName] ? String(rec[SOURCE_FIELD_MAP.setName]) : null,
      st_variant: rec[SOURCE_FIELD_MAP.variant] ? String(rec[SOURCE_FIELD_MAP.variant]) : null,
      st_rarity: rec[SOURCE_FIELD_MAP.rarity] ? String(rec[SOURCE_FIELD_MAP.rarity]) : null,
      st_image_url: rec[SOURCE_FIELD_MAP.imageUrl] ? String(rec[SOURCE_FIELD_MAP.imageUrl]) : null,
      st_raw_data: rec,
      st_updated: new Date().toISOString(),
    });

    if (isNaN(stPrice)) noPrice++;
    matched++;
  }

  console.log(`Matching results:`);
  console.log(`  Matched:     ${matched}`);
  console.log(`  Unmatched:   ${unmatched}`);
  console.log(`  No price:    ${noPrice}\n`);

  // Upsert in batches of 500
  if (rows.length > 0) {
    console.log(`Upserting ${rows.length} rows...`);
    const BATCH = 500;
    let upserted = 0;

    for (let i = 0; i < rows.length; i += BATCH) {
      const batch = rows.slice(i, i + BATCH);
      const { error: err } = await supabase
        .from('scraping_test')
        .upsert(batch, { onConflict: 'card_id' });

      if (err) {
        console.error(`  Batch ${Math.floor(i / BATCH) + 1} failed:`, err.message);
      } else {
        upserted += batch.length;
      }
    }
    console.log(`  Upserted ${upserted} rows\n`);
  }

  // Save unmatched for review
  mkdirSync('scripts/output', { recursive: true });
  if (unmatchedRecords.length > 0) {
    writeFileSync('scripts/output/st-unmatched.json', JSON.stringify(unmatchedRecords, null, 2));
    console.log(`Saved ${unmatchedRecords.length} unmatched records to scripts/output/st-unmatched.json`);
  }

  console.log('Done!');
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
