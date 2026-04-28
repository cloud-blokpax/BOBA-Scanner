/**
 * Generate the bundled play-card data files from public.play_cards.
 *
 * Reads play_cards via the Supabase admin client and writes two artifacts:
 *
 *   src/lib/data/play-cards.generated.json
 *     The full bundled catalog (id, card_number, name, release, hot_dog_cost,
 *     dbs, ability) used as offline fallback by play-cards.ts.
 *
 *   src/lib/data/boba-dbs-scores.generated.ts
 *     The DBS_SCORES const map keyed by "set_code:card_number", consumed by
 *     boba-dbs-scores.ts (which imports it and applies the buildKey/getDbs
 *     fallthrough logic on top).
 *
 * Run via `npm run generate-play-bundle`. Deterministic: same DB state always
 * produces byte-identical output, so the CI drift lint can compare to the
 * checked-in copy.
 *
 * Source of truth is the DB. Hand-edits to either generated file will be
 * overwritten the next time this script runs.
 */

import { writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadEnv } from 'dotenv';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

loadEnv();

// ── Paths ─────────────────────────────────────────────────────────────
const __filename = fileURLToPath(import.meta.url);
const ROOT = join(dirname(__filename), '..');
const OUT_JSON = join(ROOT, 'src/lib/data/play-cards.generated.json');
const OUT_TS = join(ROOT, 'src/lib/data/boba-dbs-scores.generated.ts');

// ── Set-code mapping (release → human-readable set name in DBS_SCORES key) ──
// Mirrors the existing convention in the hand-maintained file.
const RELEASE_TO_SET: Record<string, string> = {
	A: 'Alpha Edition',
	G: 'Griffey Edition',
	U: 'Alpha Update',
	HTD: 'Alpha Blast',
	LA: 'Limited Awards'
};

// HTD and LA cards are referenced bare (e.g. 'HTD-1', 'LA-20') without the set
// prefix, matching the buildKey() fallthrough logic in boba-dbs-scores.ts.
const BARE_KEY_RELEASES = new Set(['HTD', 'LA']);

interface PlayCardRow {
	id: string;
	card_number: string;
	name: string;
	release: string;
	hot_dog_cost: number | null;
	dbs: number;
	ability: string;
}

// ── Sort: deterministic, stable across runs ─────────────────────────
const RELEASE_ORDER: Record<string, number> = { A: 0, G: 1, U: 2, HTD: 3, LA: 4 };
const TYPE_ORDER: Record<string, number> = { PL: 0, BPL: 1, HTD: 2, LA: 3 };

function sortRows(rows: PlayCardRow[]): PlayCardRow[] {
	return [...rows].sort((a, b) => {
		const relA = RELEASE_ORDER[a.release] ?? 99;
		const relB = RELEASE_ORDER[b.release] ?? 99;
		if (relA !== relB) return relA - relB;

		const [prefixA, numA] = parseCardNumber(a.card_number);
		const [prefixB, numB] = parseCardNumber(b.card_number);
		const tA = TYPE_ORDER[prefixA] ?? 99;
		const tB = TYPE_ORDER[prefixB] ?? 99;
		if (tA !== tB) return tA - tB;
		return numA - numB;
	});
}

function parseCardNumber(cn: string): [string, number] {
	const m = cn.match(/^([A-Z]+)-(\d+)$/);
	if (!m) return [cn, 0];
	return [m[1], parseInt(m[2], 10)];
}

// ── Generate ─────────────────────────────────────────────────────────
async function fetchPlayCards(client: SupabaseClient): Promise<PlayCardRow[]> {
	const { data, error } = await client
		.from('play_cards')
		.select('id, card_number, name, release, hot_dog_cost, dbs, ability');

	if (error) throw new Error(`Failed to read play_cards: ${error.message}`);
	if (!data || data.length === 0) throw new Error('play_cards returned 0 rows');
	return data as PlayCardRow[];
}

function generateJson(rows: PlayCardRow[]): string {
	// Match the existing bundled shape exactly — nothing more, nothing less.
	const shaped = rows.map((r) => ({
		id: r.id,
		card_number: r.card_number,
		name: r.name,
		release: r.release,
		hot_dog_cost: r.hot_dog_cost,
		dbs: r.dbs,
		ability: r.ability
	}));
	return JSON.stringify(shaped, null, '\t') + '\n';
}

function generateTs(rows: PlayCardRow[]): string {
	const lines: string[] = [
		'/**',
		' * AUTO-GENERATED FILE. DO NOT EDIT BY HAND.',
		' *',
		' * Source: public.play_cards (Supabase)',
		' * Generator: scripts/generate-play-card-bundle.ts',
		' * Run: npm run generate-play-bundle',
		' *',
		' * Edit the DB and re-run the generator instead.',
		' */',
		'',
		'/** DBS score for a specific Play card, keyed by "set_code:card_number" (or bare card_number for HTD/LA). */',
		'export const DBS_SCORES: Record<string, number> = {'
	];

	let lastRelease: string | null = null;
	for (const r of rows) {
		if (r.release !== lastRelease) {
			if (lastRelease !== null) lines.push('');
			const setName = RELEASE_TO_SET[r.release] ?? r.release;
			lines.push(`\t// ── ${setName} (${r.release}) ──`);
			lastRelease = r.release;
		}

		const setName = RELEASE_TO_SET[r.release] ?? r.release;
		const key = BARE_KEY_RELEASES.has(r.release) ? r.card_number : `${setName}:${r.card_number}`;
		// Comments preserve the human-readable name for code review readability.
		// Sanitize block-comment terminators just in case (defense against weird names).
		const safeName = r.name.replace(/\*\//g, '* /');
		lines.push(`\t'${key}': ${r.dbs}, // ${safeName}`);
	}

	lines.push('};', '');
	return lines.join('\n');
}

async function main() {
	const url = process.env.PUBLIC_SUPABASE_URL ?? '';
	const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
	if (!url || !serviceKey) {
		console.error('[generate-play-bundle] Missing PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
		process.exit(1);
	}

	const client = createClient(url, serviceKey);
	const rows = sortRows(await fetchPlayCards(client));

	console.log(`[generate-play-bundle] Fetched ${rows.length} rows from play_cards`);

	const jsonOut = generateJson(rows);
	const tsOut = generateTs(rows);

	await mkdir(dirname(OUT_JSON), { recursive: true });
	await writeFile(OUT_JSON, jsonOut, 'utf-8');
	await writeFile(OUT_TS, tsOut, 'utf-8');

	console.log(`[generate-play-bundle] Wrote ${OUT_JSON} (${jsonOut.length} bytes)`);
	console.log(`[generate-play-bundle] Wrote ${OUT_TS} (${tsOut.length} bytes)`);
	console.log('[generate-play-bundle] Done. Commit both files together with the migration that produced them.');
}

main().catch((err) => {
	console.error('[generate-play-bundle] FAILED:', err);
	process.exit(1);
});
