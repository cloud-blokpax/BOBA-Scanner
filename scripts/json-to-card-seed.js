#!/usr/bin/env node

/**
 * Convert exported card database JSON (from Settings → Export)
 * into SQL INSERT statements for Supabase.
 *
 * Usage: node scripts/json-to-card-seed.js <path-to-exported-json>
 * Output: supabase/migrations/003_seed_cards.sql
 */

import { readFileSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(__dirname, '..');

const inputPath = process.argv[2];
if (!inputPath) {
	console.error('Usage: node scripts/json-to-card-seed.js <path-to-exported-json>');
	process.exit(1);
}

const cards = JSON.parse(readFileSync(resolve(inputPath), 'utf8'));
console.log(`Read ${cards.length} cards from ${inputPath}`);

function esc(str) {
	if (str === null || str === undefined) return 'NULL';
	return "'" + String(str).replace(/'/g, "''") + "'";
}

function numOrNull(val) {
	if (val === null || val === undefined) return 'NULL';
	const n = Number(val);
	return isNaN(n) ? 'NULL' : String(n);
}

const COLUMNS = [
	'id', 'name', 'hero_name', 'athlete_name', 'set_code',
	'card_number', 'power', 'rarity', 'weapon_type', 'battle_zone',
	'image_url', 'year', 'parallel', 'card_id_legacy'
];

const lines = [
	'-- ============================================================',
	'-- BOBA Scanner — Seed Cards Table (from IDB export)',
	`-- Generated: ${new Date().toISOString()}`,
	`-- Total cards: ${cards.length}`,
	'-- ============================================================',
	''
];

const BATCH_SIZE = 500;

for (let i = 0; i < cards.length; i += BATCH_SIZE) {
	const batch = cards.slice(i, i + BATCH_SIZE);

	lines.push(`INSERT INTO public.cards (${COLUMNS.join(', ')}) VALUES`);

	const values = batch.map((card, idx) => {
		const vals = [
			esc(card.id),
			esc(card.name),
			esc(card.hero_name),
			esc(card.athlete_name),
			esc(card.set_code || 'Unknown'),
			esc(card.card_number),
			numOrNull(card.power),
			esc(card.rarity),
			esc(card.weapon_type),
			esc(card.battle_zone),
			esc(card.image_url),
			numOrNull(card.year),
			esc(card.parallel),
			esc(card.card_id_legacy)
		];
		const comma = idx < batch.length - 1 ? ',' : '';
		return `  (${vals.join(', ')})${comma}`;
	});

	lines.push(...values);
	lines.push('ON CONFLICT (id) DO UPDATE SET');
	lines.push('  name = EXCLUDED.name,');
	lines.push('  hero_name = EXCLUDED.hero_name,');
	lines.push('  athlete_name = EXCLUDED.athlete_name,');
	lines.push('  set_code = EXCLUDED.set_code,');
	lines.push('  card_number = EXCLUDED.card_number,');
	lines.push('  power = EXCLUDED.power,');
	lines.push('  rarity = EXCLUDED.rarity,');
	lines.push('  weapon_type = EXCLUDED.weapon_type,');
	lines.push('  battle_zone = EXCLUDED.battle_zone,');
	lines.push('  image_url = EXCLUDED.image_url,');
	lines.push('  year = EXCLUDED.year,');
	lines.push('  parallel = EXCLUDED.parallel,');
	lines.push('  card_id_legacy = EXCLUDED.card_id_legacy,');
	lines.push('  updated_at = NOW();');
	lines.push('');
}

lines.push(`-- Seed complete: ${cards.length} cards inserted/updated`);

const outputPath = resolve(rootDir, 'supabase/migrations/003_seed_cards.sql');
writeFileSync(outputPath, lines.join('\n'), 'utf8');

console.log(`Generated ${outputPath}`);
console.log(`Total cards: ${cards.length}`);
console.log(`Batches: ${Math.ceil(cards.length / BATCH_SIZE)}`);
