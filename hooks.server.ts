#!/usr/bin/env node

/**
 * Generate SQL seed file from card-database.json
 *
 * Usage: node scripts/generate-card-seed.js
 * Output: supabase/migrations/003_seed_cards.sql
 */

import { readFileSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(__dirname, '..');

const cards = JSON.parse(readFileSync(resolve(rootDir, 'card-database.json'), 'utf8'));

function escapeSQL(str) {
	if (str === null || str === undefined) return 'NULL';
	return "'" + String(str).replace(/'/g, "''") + "'";
}

const lines = [
	'-- ============================================================',
	'-- BOBA Scanner — Migration 003: Seed Cards Table',
	`-- Generated: ${new Date().toISOString()}`,
	`-- Total cards: ${cards.length}`,
	'-- ============================================================',
	'',
	'-- Insert cards in batches of 500 for performance',
	''
];

const BATCH_SIZE = 500;

for (let i = 0; i < cards.length; i += BATCH_SIZE) {
	const batch = cards.slice(i, i + BATCH_SIZE);

	lines.push(
		'INSERT INTO public.cards (card_id_legacy, name, set_code, card_number, year, parallel, weapon_type, power) VALUES'
	);

	const values = batch.map((card, idx) => {
		const cardNumber = card['Card Number'] !== null && card['Card Number'] !== undefined
			? escapeSQL(String(card['Card Number']))
			: 'NULL';
		const comma = idx < batch.length - 1 ? ',' : '';
		return `  (${card['Card ID']}, ${escapeSQL(card.Name)}, ${escapeSQL(card.Set || 'Unknown')}, ${cardNumber}, ${card.Year || 'NULL'}, ${escapeSQL(card.Parallel)}, ${escapeSQL(card.Weapon)}, ${card.Power || 'NULL'})${comma}`;
	});

	lines.push(...values);
	lines.push('ON CONFLICT (card_id_legacy) DO UPDATE SET');
	lines.push('  name = EXCLUDED.name,');
	lines.push('  set_code = EXCLUDED.set_code,');
	lines.push('  card_number = EXCLUDED.card_number,');
	lines.push('  year = EXCLUDED.year,');
	lines.push('  parallel = EXCLUDED.parallel,');
	lines.push('  weapon_type = EXCLUDED.weapon_type,');
	lines.push('  power = EXCLUDED.power;');
	lines.push('');
}

lines.push(`-- Seed complete: ${cards.length} cards inserted/updated`);

const outputPath = resolve(rootDir, 'supabase/migrations/003_seed_cards.sql');
writeFileSync(outputPath, lines.join('\n'), 'utf8');

console.log(`Generated ${outputPath}`);
console.log(`Total cards: ${cards.length}`);
console.log(`Batches: ${Math.ceil(cards.length / BATCH_SIZE)}`);
