/**
 * Import a Wonders set catalog into the cards table.
 *
 * Materializes one row per (card_number, parallel) tuple. Idempotent
 * via ON CONFLICT (game_id, card_number, parallel) DO NOTHING — the
 * uniqueness constraint comes from migration 33.
 *
 * Usage:
 *   npm run wonders:import-set -- data/wonders/catalogs/wotf2.json
 *
 * The script writes to cards via the service role. After insert, the
 * harvester picks up the new (card_id, parallel) pairs on its next run
 * (no additional config needed — `get_harvest_candidates` selects from
 * cards directly post-migration 31).
 *
 * Required env (loaded via dotenv):
 *   PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 */

import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import { config as loadEnv } from 'dotenv';

loadEnv();

const SUPABASE_URL = process.env.PUBLIC_SUPABASE_URL || '';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const GAME_ID = 'wonders';

if (!SUPABASE_URL || !SUPABASE_KEY) {
	console.error('Missing PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env');
	process.exit(1);
}

interface CatalogCard {
	card_number: string;
	name: string;
	hero_name?: string;
	athlete_name?: string;
	rarity?: string;
	type_line?: string;
	card_class?: string;
	parallels?: string[];
	metadata?: Record<string, unknown>;
}

interface SetCatalog {
	set_code: string;
	set_name_display?: string;
	year?: number;
	default_parallels: string[];
	cards: CatalogCard[];
}

// Closed vocabulary. Any catalog parallel outside this set is rejected
// before the script touches Supabase — easier to debug a typo at
// catalog-load time than at row-insert time.
const VALID_PARALLELS = new Set([
	'Paper',
	'Classic Foil',
	'Formless Foil',
	'Orbital Color Match',
	'Stonefoil'
]);

const CHUNK_SIZE = 500;

async function main() {
	const path = process.argv[2];
	if (!path) {
		console.error('Usage: npm run wonders:import-set -- <catalog.json>');
		process.exit(1);
	}

	const catalog: SetCatalog = JSON.parse(readFileSync(path, 'utf-8'));

	if (!Array.isArray(catalog.default_parallels) || catalog.default_parallels.length === 0) {
		throw new Error(
			'Catalog must specify a non-empty `default_parallels` array. ' +
				'Use `["Paper", "Classic Foil", "Formless Foil", "Orbital Color Match", "Stonefoil"]` for a standard set.'
		);
	}

	const allParallels = new Set<string>([
		...catalog.default_parallels,
		...catalog.cards.flatMap((c) => c.parallels ?? [])
	]);
	for (const p of allParallels) {
		if (!VALID_PARALLELS.has(p)) {
			throw new Error(
				`Invalid parallel name: "${p}". Must be one of ${[...VALID_PARALLELS].join(', ')}`
			);
		}
	}

	console.log(
		`Importing ${catalog.cards.length} cards from set ${catalog.set_code} ` +
			`(default parallels: ${catalog.default_parallels.join(', ')})`
	);

	const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
		auth: { persistSession: false }
	});

	const rows: Array<Record<string, unknown>> = [];
	for (const card of catalog.cards) {
		if (!card.card_number || !card.name) {
			throw new Error(
				`Catalog entry missing card_number or name: ${JSON.stringify(card)}`
			);
		}

		const parallels = card.parallels ?? catalog.default_parallels;
		for (const parallel of parallels) {
			rows.push({
				game_id: GAME_ID,
				card_number: card.card_number,
				name: card.name,
				hero_name: card.hero_name ?? card.name,
				athlete_name: card.athlete_name ?? null,
				set_code: catalog.set_code,
				rarity: card.rarity ?? null,
				year: catalog.year ?? null,
				parallel,
				metadata: {
					...(card.metadata ?? {}),
					...(card.type_line ? { type_line: card.type_line } : {}),
					...(card.card_class ? { card_class: card.card_class } : {}),
					...(catalog.set_name_display
						? { set_name_display: catalog.set_name_display }
						: {})
				}
			});
		}
	}

	console.log(`Upserting ${rows.length} (card, parallel) rows in chunks of ${CHUNK_SIZE}`);

	let inserted = 0;
	let chunkNum = 0;
	for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
		chunkNum++;
		const chunk = rows.slice(i, i + CHUNK_SIZE);

		const { error, count } = await supabase
			.from('cards')
			.upsert(chunk, {
				onConflict: 'game_id,card_number,parallel',
				ignoreDuplicates: true,
				count: 'exact'
			});

		if (error) {
			console.error(`  chunk ${chunkNum} failed:`, error.message);
			throw error;
		}

		const chunkInserted = count ?? 0;
		inserted += chunkInserted;
		console.log(
			`  chunk ${chunkNum}: ${chunk.length} candidates → ${chunkInserted} inserted, ${chunk.length - chunkInserted} already existed`
		);
	}

	console.log(`\nDone. Inserted: ${inserted} new rows. Total processed: ${rows.length}.`);
}

main().catch((err) => {
	console.error('Import failed:', err instanceof Error ? err.message : err);
	process.exit(1);
});
