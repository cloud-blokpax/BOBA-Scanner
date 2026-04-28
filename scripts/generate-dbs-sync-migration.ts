/**
 * Generate a play_cards sync migration from a cards.json snapshot.
 *
 * Usage:
 *   curl https://deck-builder.bobattlearena.com/data/cards.json > /tmp/cards.json
 *   npm run generate-dbs-migration /tmp/cards.json
 *
 * Or, with auto-fetch:
 *   npm run generate-dbs-migration --fetch
 *
 * Output: writes migrations/NNN_dbs_vX_Y_Z_sync.sql with:
 *   - bulk UPDATE for DBS / hot_dog_cost / name / ability changes
 *   - INSERT … ON CONFLICT for new cards
 *   - All statements idempotent (gated on IS DISTINCT FROM, ON CONFLICT DO NOTHING)
 *   - Removals are NOT auto-applied (could be upstream bugs); script logs them
 *     and prints a manual DELETE template for the human to evaluate.
 *
 * The next migration number is auto-detected from existing files in migrations/.
 *
 * After generating: review the SQL, apply via Supabase MCP, then run
 * `npm run generate-play-bundle` to refresh the bundled files.
 */

import { readFile, writeFile, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadEnv } from 'dotenv';
import { createClient } from '@supabase/supabase-js';

loadEnv();

const __filename = fileURLToPath(import.meta.url);
const ROOT = join(dirname(__filename), '..');
const MIGRATIONS_DIR = join(ROOT, 'migrations');
const CARDS_JSON_URL = 'https://deck-builder.bobattlearena.com/data/cards.json';

interface UpstreamCard {
	id: string;
	name: string;
	release: string;
	type: string;
	number: number | string;
	cost: number | null;
	dbs: number;
	ability: string;
}

interface UpstreamPayload {
	version: string;
	generatedAt?: string;
	cards: UpstreamCard[];
}

interface DbCard {
	id: string;
	card_number: string;
	name: string;
	release: string;
	type: string;
	hot_dog_cost: number | null;
	dbs: number;
	ability: string;
}

async function loadUpstream(args: string[]): Promise<UpstreamPayload> {
	const fetchFlag = args.includes('--fetch');
	const filePath = args.find((a) => !a.startsWith('--'));

	if (fetchFlag) {
		console.log(`[gen-migration] Fetching ${CARDS_JSON_URL}`);
		const res = await fetch(CARDS_JSON_URL);
		if (!res.ok) throw new Error(`Fetch failed: HTTP ${res.status}`);
		return (await res.json()) as UpstreamPayload;
	}

	if (!filePath) {
		throw new Error(
			'Usage: npm run generate-dbs-migration <path/to/cards.json>  OR  --fetch'
		);
	}

	const raw = await readFile(filePath, 'utf-8');
	return JSON.parse(raw) as UpstreamPayload;
}

async function loadDbCards(): Promise<DbCard[]> {
	const url = process.env.PUBLIC_SUPABASE_URL ?? '';
	const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
	if (!url || !key) throw new Error('Missing PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');

	const client = createClient(url, key);
	const { data, error } = await client
		.from('play_cards')
		.select('id, card_number, name, release, type, hot_dog_cost, dbs, ability');
	if (error) throw new Error(`DB read failed: ${error.message}`);
	return (data ?? []) as DbCard[];
}

async function nextMigrationNumber(): Promise<number> {
	const files = await readdir(MIGRATIONS_DIR);
	const nums = files
		.map((f) => f.match(/^(\d+)_/)?.[1])
		.filter((s): s is string => Boolean(s))
		.map((s) => parseInt(s, 10));
	return (Math.max(0, ...nums) || 0) + 1;
}

function sqlEscape(s: string): string {
	return s.replace(/'/g, "''");
}

function deriveCardNumber(id: string): string {
	if (id.startsWith('A---') || id.startsWith('G---') || id.startsWith('U---')) {
		return id.split('---')[1];
	}
	if (id.includes('---')) return id.replace('---', '-');
	return id;
}

interface ChangeSet {
	dbsUpdates: Array<{ id: string; dbs: number }>;
	hdcUpdates: Array<{ id: string; cost: number | null }>;
	nameUpdates: Array<{ id: string; name: string }>;
	abilityUpdates: Array<{ id: string; ability: string }>;
	inserts: UpstreamCard[];
	removals: string[]; // ids in DB but not upstream
}

function diff(upstream: UpstreamCard[], db: DbCard[]): ChangeSet {
	const upById = new Map(upstream.map((c) => [c.id, c]));
	const dbById = new Map(db.map((r) => [r.id, r]));
	const cs: ChangeSet = {
		dbsUpdates: [],
		hdcUpdates: [],
		nameUpdates: [],
		abilityUpdates: [],
		inserts: [],
		removals: []
	};

	for (const [id, u] of upById) {
		const d = dbById.get(id);
		if (!d) {
			cs.inserts.push(u);
			continue;
		}
		if (u.dbs !== d.dbs) cs.dbsUpdates.push({ id, dbs: u.dbs });
		if ((u.cost ?? null) !== (d.hot_dog_cost ?? null)) {
			cs.hdcUpdates.push({ id, cost: u.cost ?? null });
		}
		if (u.name !== d.name) cs.nameUpdates.push({ id, name: u.name });
		if (u.ability !== d.ability) cs.abilityUpdates.push({ id, ability: u.ability });
	}
	for (const id of dbById.keys()) {
		if (!upById.has(id)) cs.removals.push(id);
	}

	return cs;
}

function buildMigrationSql(
	upstreamVersion: string,
	generatedAt: string | undefined,
	cs: ChangeSet
): string {
	const sections: string[] = [];

	const totalChanges =
		cs.dbsUpdates.length +
		cs.hdcUpdates.length +
		cs.nameUpdates.length +
		cs.abilityUpdates.length +
		cs.inserts.length;

	sections.push(`-- Sync play_cards with deck builder cards.json v${upstreamVersion}`);
	sections.push(`-- Source: https://deck-builder.bobattlearena.com/data/cards.json`);
	if (generatedAt) sections.push(`-- Upstream generatedAt: ${generatedAt}`);
	sections.push('--');
	sections.push(`-- Changes:`);
	sections.push(`--   DBS updates:          ${cs.dbsUpdates.length}`);
	sections.push(`--   hot_dog_cost updates: ${cs.hdcUpdates.length}`);
	sections.push(`--   name updates:         ${cs.nameUpdates.length}`);
	sections.push(`--   ability updates:      ${cs.abilityUpdates.length}`);
	sections.push(`--   new cards:            ${cs.inserts.length}`);
	sections.push(`--   removed from upstream: ${cs.removals.length} (NOT auto-deleted; see comment block below)`);
	sections.push('--');
	sections.push(`-- Total non-removal changes: ${totalChanges}`);
	sections.push(`-- All statements are idempotent — re-running this migration is a no-op.`);
	sections.push('');

	if (cs.dbsUpdates.length > 0) {
		sections.push('-- DBS updates');
		const values = cs.dbsUpdates.map((u) => `('${sqlEscape(u.id)}', ${u.dbs})`).join(',\n  ');
		sections.push(`UPDATE public.play_cards AS pc
SET    dbs = v.dbs, updated_at = now()
FROM   (VALUES
  ${values}
) AS v(id, dbs)
WHERE  pc.id = v.id AND pc.dbs IS DISTINCT FROM v.dbs;
`);
	}

	if (cs.hdcUpdates.length > 0) {
		sections.push('-- hot_dog_cost updates');
		const values = cs.hdcUpdates
			.map((u) => `('${sqlEscape(u.id)}', ${u.cost === null ? 'NULL' : u.cost})`)
			.join(',\n  ');
		sections.push(`UPDATE public.play_cards AS pc
SET    hot_dog_cost = v.cost, updated_at = now()
FROM   (VALUES
  ${values}
) AS v(id, cost)
WHERE  pc.id = v.id AND pc.hot_dog_cost IS DISTINCT FROM v.cost;
`);
	}

	if (cs.nameUpdates.length > 0) {
		sections.push('-- Name updates');
		const values = cs.nameUpdates
			.map((u) => `('${sqlEscape(u.id)}', '${sqlEscape(u.name)}')`)
			.join(',\n  ');
		sections.push(`UPDATE public.play_cards AS pc
SET    name = v.name, updated_at = now()
FROM   (VALUES
  ${values}
) AS v(id, name)
WHERE  pc.id = v.id AND pc.name IS DISTINCT FROM v.name;
`);
	}

	if (cs.abilityUpdates.length > 0) {
		sections.push('-- Ability text updates');
		const values = cs.abilityUpdates
			.map((u) => `('${sqlEscape(u.id)}', '${sqlEscape(u.ability)}')`)
			.join(',\n  ');
		sections.push(`UPDATE public.play_cards AS pc
SET    ability = v.ability, updated_at = now()
FROM   (VALUES
  ${values}
) AS v(id, ability)
WHERE  pc.id = v.id AND pc.ability IS DISTINCT FROM v.ability;
`);
	}

	if (cs.inserts.length > 0) {
		sections.push('-- New cards (idempotent via ON CONFLICT)');
		const values = cs.inserts
			.map((c) => {
				const cardNumber = deriveCardNumber(c.id);
				const release = c.release || 'LA'; // empty release → LA namespace
				const type = c.type || release; // empty type → mirror release (e.g. LA)
				const number = typeof c.number === 'string' ? parseInt(c.number, 10) || 0 : c.number;
				const cost = c.cost === null ? 'NULL' : c.cost;
				return `  ('${sqlEscape(c.id)}', '${sqlEscape(cardNumber)}', '${sqlEscape(c.name)}', '${sqlEscape(release)}', '${sqlEscape(type)}', ${number}, ${cost}, ${c.dbs}, '${sqlEscape(c.ability)}')`;
			})
			.join(',\n');
		sections.push(`INSERT INTO public.play_cards (id, card_number, name, release, type, number, hot_dog_cost, dbs, ability)
VALUES
${values}
ON CONFLICT (id) DO NOTHING;
`);
	}

	if (cs.removals.length > 0) {
		sections.push('-- ────────────────────────────────────────────────────────────────');
		sections.push('-- ⚠ REMOVALS — NOT AUTO-APPLIED');
		sections.push('-- ────────────────────────────────────────────────────────────────');
		sections.push(`-- The following ${cs.removals.length} card(s) exist in play_cards but are absent`);
		sections.push('-- from upstream. This could mean upstream removed them (rare) OR upstream');
		sections.push('-- has a bug (more likely). Investigate before deleting:');
		sections.push('--');
		for (const id of cs.removals) {
			sections.push(`--   ${id}`);
		}
		sections.push('--');
		sections.push('-- To delete after manual review, uncomment and run:');
		sections.push('--');
		sections.push(
			`-- DELETE FROM public.play_cards WHERE id IN (${cs.removals.map((id) => `'${sqlEscape(id)}'`).join(', ')});`
		);
		sections.push('');
	}

	return sections.join('\n') + '\n';
}

async function main() {
	const args = process.argv.slice(2);
	const upstream = await loadUpstream(args);
	console.log(`[gen-migration] Upstream: v${upstream.version} with ${upstream.cards.length} cards`);

	const dbCards = await loadDbCards();
	console.log(`[gen-migration] DB has ${dbCards.length} rows`);

	const cs = diff(upstream.cards, dbCards);
	const totalChanges =
		cs.dbsUpdates.length +
		cs.hdcUpdates.length +
		cs.nameUpdates.length +
		cs.abilityUpdates.length +
		cs.inserts.length;

	if (totalChanges === 0 && cs.removals.length === 0) {
		console.log('[gen-migration] No changes — DB is in sync with upstream. Nothing to write.');
		return;
	}

	const num = await nextMigrationNumber();
	const slug = `dbs_v${upstream.version.replace(/\./g, '_')}_sync`;
	const filename = `${String(num).padStart(3, '0')}_${slug}.sql`;
	const outPath = join(MIGRATIONS_DIR, filename);

	const sql = buildMigrationSql(upstream.version, upstream.generatedAt, cs);
	await writeFile(outPath, sql, 'utf-8');

	console.log(`[gen-migration] Wrote ${outPath}`);
	console.log(`[gen-migration] Summary:`);
	console.log(`  DBS updates:          ${cs.dbsUpdates.length}`);
	console.log(`  hot_dog_cost updates: ${cs.hdcUpdates.length}`);
	console.log(`  name updates:         ${cs.nameUpdates.length}`);
	console.log(`  ability updates:      ${cs.abilityUpdates.length}`);
	console.log(`  inserts:              ${cs.inserts.length}`);
	console.log(`  removals (not auto):  ${cs.removals.length}`);
	console.log('');
	console.log('[gen-migration] Next: review the SQL, apply via Supabase MCP, then run');
	console.log('[gen-migration]       `npm run generate-play-bundle` to refresh bundled files.');
}

main().catch((err) => {
	console.error('[gen-migration] FAILED:', err);
	process.exit(1);
});
