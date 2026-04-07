/**
 * Carde.io Image Backfill Script
 *
 * Fetches all BoBA card images from the public Carde.io Play API,
 * maps them to our cards/play_cards tables by hero_name + weapon_type,
 * and generates SQL to backfill image_url.
 *
 * Usage: npx tsx scripts/carde-image-backfill.ts
 *
 * The script outputs:
 *   1. A SQL file (scripts/output/backfill-images.sql) for Supabase SQL Editor
 *   2. A JSON mapping file (scripts/output/carde-mapping.json) for reference
 *   3. A report of unmatched cards for manual review
 */

import { writeFileSync, mkdirSync } from 'fs';

// ── Carde.io API Config ──────────────────────────────────────────
const GAME_ID = '651f3b0e5f72a5fca3f6fe34';
const API_BASE = 'https://play-api.carde.io/v1/cards';
const PAGE_SIZE = 50;

// ── Carde.io slug prefix → your parallel system ─────────────────
// Each Carde.io "set" slug prefix maps to a parallel in your DB.
// The card_number prefix is what your cards table uses to identify parallels.
// Source of truth: src/lib/data/parallel-prefixes.ts (PREFIX_TO_PARALLEL)
// Cross-referenced with uploaded checklists (National 2024 Starter, Sandstorm, World Champions)
const SLUG_TO_PARALLEL: Record<string, { parallel: string; cardNumberPrefix: string | null; notes: string }> = {
	// ── Alpha Edition Hero Parallels ──────────────────────────────
	'alphaedition-sets-basepaper':          { parallel: 'Paper',                cardNumberPrefix: null,    notes: 'numeric-only card_numbers (e.g. 1, 48, 134)' },
	'alphaedition-sets-basebattlefoils':    { parallel: 'Battlefoil',           cardNumberPrefix: 'BF',    notes: 'BF-123' },
	'alphaedition-sets-rad':                { parallel: '80s Rad',              cardNumberPrefix: 'RAD',   notes: 'RAD-45' },
	'alphaedition-sets-linoleum':           { parallel: "Grandma's Linoleum",   cardNumberPrefix: 'GLBF',  notes: 'GLBF-XXX — confirmed via checklist' },
	'alphaedition-sets-blizzard':           { parallel: 'Blizzard',             cardNumberPrefix: 'BLBF',  notes: 'BLBF-XXX — confirmed via checklist' },
	'alphaedition-sets-superfoils':         { parallel: 'Super',                cardNumberPrefix: 'SF',    notes: 'SF-XXX — confirmed via checklist' },
	'alphaedition-sets-bubblegum':          { parallel: 'Bubblegum',            cardNumberPrefix: 'BGBF',  notes: 'BGBF-XXX — from parallel-prefixes.ts' },
	'alphaedition-sets-headlines':          { parallel: 'Headliner',            cardNumberPrefix: 'HBF',   notes: 'HBF-XXX' },

	// ── "Inverted Battlefoils" = Color Battlefoils (mixed bag) ────
	// Carde.io lumps Orange, Blue, Silver, Green, and Pink Battlefoils
	// into one "invertedbattlefoils" set. In your DB these are separate
	// parallels with prefixes: SBF-, BBF-, OBF-, GBF-, PBF-.
	// Since we can't distinguish which color from Carde.io data alone,
	// assign image by hero_name + weapon_type to ALL color BF cards.
	'alphaedition-sets-invertedbattlefoils':{ parallel: 'Color Battlefoil',     cardNumberPrefix: null,    notes: 'Maps to SBF/BBF/OBF/GBF/PBF — match by hero_name+weapon_type across all 5 prefixes' },

	// ── Autographs / Inspired Ink ─────────────────────────────────
	'alphaedition-autos-only-setorder':     { parallel: 'Inspired Ink',         cardNumberPrefix: 'BFA',   notes: 'BFA-XXX is the standard prefix. Also 71 athlete-specific prefixes (AAA, BOJA, etc.) all map to inspired_ink' },

	// ── Special / Unknown ─────────────────────────────────────────
	'alphaedition-sets-bls':                { parallel: 'Unknown BLS',          cardNumberPrefix: 'BLS',   notes: 'Only 1 card: Leducky, Steel. Verify prefix exists in DB' },
	'alphaedition-sets-blp':                { parallel: 'Unknown BLP',          cardNumberPrefix: 'BLP',   notes: 'Only 1 card: Leducky, Hex. Verify prefix exists in DB' },

	// ── Sidekicks & Promos ────────────────────────────────────────
	'alphaedition-dogs-brandi-bopromo':     { parallel: 'Mixed',                cardNumberPrefix: null,    notes: 'Mix of Billy (BILLY-), Brandi, BoJax promos. Match by hero_name' },

	// ── Play Cards & Hot Dogs ─────────────────────────────────────
	'alpha-hd':                             { parallel: 'Hot Dog',              cardNumberPrefix: null,    notes: 'Hot Dog cards in play_cards table' },
	'alphaedition-100plays':                { parallel: 'Play',                 cardNumberPrefix: null,    notes: 'Alpha Edition play cards' },
	'alphaedition-bonusplays':              { parallel: 'Bonus Play',           cardNumberPrefix: null,    notes: 'Alpha Edition bonus plays (BPL- prefix in play_cards)' },

	// ── National 2024 Starter Set ─────────────────────────────────
	// Checklist confirms: S-01/100 through S-107/100 + S-101A
	// Heroes, plays, hot dogs, secret starters, serialized variants
	'2024-national-show-starter-set':       { parallel: 'Starter Kit',          cardNumberPrefix: 'S',     notes: 'S-XX/100 format. Set code N24 in DB' },

	// ── World Champion Series ─────────────────────────────────────
	// Checklist confirms: LA-1 through LA-38
	// Heroes (MVFREE, Showtime, Gambler), Plays, Hot Dogs, Kanjifoil
	'2024-world-champions':                 { parallel: 'World Champions',      cardNumberPrefix: 'LA',    notes: 'LA-XX format. Includes Kanjifoil (LA-30 through LA-38)' },

	// ── Sandstorm Superfan Series ─────────────────────────────────
	// Checklist confirms: SSE-1 through SSE-29 (heroes, plays, hot dog)
	// SSA-1 through SSA-6 (Inspired Ink autographs)
	'sandstorm':                            { parallel: 'Sandstorm',            cardNumberPrefix: 'SSE',   notes: 'SSE-XX format. Heroes: XL, Pet-Dog, Hitstick' },
	'sandstorm-auto':                       { parallel: 'Sandstorm Inspired Ink', cardNumberPrefix: 'SSA', notes: 'SSA-XX format. XL/Xavier Leggette autos. SSA already in PREFIX_TO_PARALLEL as inspired_ink' },
};

// ── Carde.io element → your weapon_type ──────────────────────────
// These map 1:1 except for casing on SUPER and None
const ELEMENT_TO_WEAPON: Record<string, string | null> = {
	'Steel': 'Steel',
	'Fire':  'Fire',
	'Ice':   'Ice',
	'Glow':  'Glow',
	'Hex':   'Hex',
	'Gum':   'Gum',
	'SUPER': 'Super',
	'ALT':   null,     // ALT is a parallel, not a weapon
	'None':  null,     // play cards / hot dogs have no weapon
};

// ── Types ────────────────────────────────────────────────────────
interface CardeCard {
	id: string;
	name: string;
	slug: string;
	imageUrl: string;
	cardType: { _id: string; name: string };
	subtype: { _id: string; name: string };
	element: { _id: string; name: string; hexColor: string };
}

interface MappedCard {
	carde_id: string;
	carde_name: string;
	carde_slug: string;
	image_url: string;
	card_type: string;
	weapon_type: string | null;
	parallel_guess: string;
	card_number_prefix: string | null;
	slug_prefix: string;
}

// ── Fetch all cards from Carde.io ────────────────────────────────
async function fetchAllCards(): Promise<CardeCard[]> {
	const all: CardeCard[] = [];
	let page = 1;

	while (true) {
		const url = `${API_BASE}/${GAME_ID}?limit=${PAGE_SIZE}&page=${page}`;
		const res = await fetch(url);
		if (!res.ok) {
			console.error(`API error on page ${page}: ${res.status}`);
			break;
		}

		const json = await res.json();
		const data = json.data as CardeCard[];
		if (!data || data.length === 0) break;

		all.push(...data);
		if (page % 10 === 0) console.log(`  Fetched page ${page} (${all.length} cards so far)`);

		if (page >= json.pagination.totalPages) break;
		page++;
	}

	console.log(`Fetched ${all.length} total cards from Carde.io\n`);
	return all;
}

// ── Extract slug prefix (everything before trailing digits) ──────
function getSlugPrefix(slug: string): string {
	const match = slug.match(/^(.*?)(\d+)$/);
	return match ? match[1].replace(/-$/, '') : slug;
}

// ── Map Carde.io cards to your schema ────────────────────────────
function mapCards(cardeCards: CardeCard[]): MappedCard[] {
	return cardeCards.map(c => {
		const slugPrefix = getSlugPrefix(c.slug);
		const mapping = SLUG_TO_PARALLEL[slugPrefix];
		const weaponType = ELEMENT_TO_WEAPON[c.element?.name] ?? null;

		return {
			carde_id: c.id,
			carde_name: c.name,
			carde_slug: c.slug,
			image_url: c.imageUrl,
			card_type: c.cardType?.name || 'Unknown',
			weapon_type: weaponType,
			parallel_guess: mapping?.parallel || `UNKNOWN(${slugPrefix})`,
			card_number_prefix: mapping?.cardNumberPrefix || null,
			slug_prefix: slugPrefix,
		};
	});
}

// ── Generate SQL ─────────────────────────────────────────────────
function generateSQL(mapped: MappedCard[]): string {
	const lines: string[] = [];

	lines.push('-- ═══════════════════════════════════════════════════════════');
	lines.push('-- Carde.io Image Backfill');
	lines.push(`-- Generated: ${new Date().toISOString()}`);
	lines.push(`-- Total images available: ${mapped.length}`);
	lines.push('-- ═══════════════════════════════════════════════════════════');
	lines.push('');
	lines.push('BEGIN;');
	lines.push('');

	// ── Strategy 1: Hero cards matched by hero_name + weapon_type ──
	lines.push('-- ═══ HERO CARDS: Match by hero_name + weapon_type ═══');
	lines.push('-- This assigns ONE representative image per hero+weapon combo');
	lines.push('-- to all parallels of that hero+weapon (since parallels share base art).');
	lines.push('');

	// Group by (name, weapon_type), prefer basepaper slug
	const heroImages = mapped.filter(m => m.card_type === 'Hero');
	const heroMap = new Map<string, MappedCard>();

	// Priority order: basepaper > basebattlefoils > headlines > anything else
	const PRIORITY = [
		'alphaedition-sets-basepaper',
		'alphaedition-sets-basebattlefoils',
		'alphaedition-sets-headlines',
		'alphaedition-sets-rad',
		'alphaedition-sets-linoleum',
		'alphaedition-sets-blizzard',
		'alphaedition-sets-invertedbattlefoils',
		'alphaedition-sets-superfoils',
		'alphaedition-sets-bubblegum',
		'alphaedition-autos-only-setorder',
		'alphaedition-dogs-brandi-bopromo',
		'2024-national-show-starter-set',
		'2024-world-champions',
		'sandstorm',
		'sandstorm-auto',
	];

	for (const priority of PRIORITY) {
		for (const h of heroImages) {
			if (h.slug_prefix !== priority) continue;
			const key = `${h.carde_name.toLowerCase()}|${h.weapon_type || 'null'}`;
			if (!heroMap.has(key)) {
				heroMap.set(key, h);
			}
		}
	}

	// Also catch any that didn't match priority list
	for (const h of heroImages) {
		const key = `${h.carde_name.toLowerCase()}|${h.weapon_type || 'null'}`;
		if (!heroMap.has(key)) {
			heroMap.set(key, h);
		}
	}

	let heroUpdateCount = 0;
	for (const [, img] of heroMap) {
		// Escape single quotes in hero names (e.g., "Grandma's")
		const safeName = img.carde_name.replace(/'/g, "''");
		const safeUrl = img.image_url.replace(/'/g, "''");

		const weaponClause = img.weapon_type
			? `AND LOWER(weapon_type) = '${img.weapon_type.toLowerCase()}'`
			: `AND weapon_type IS NULL`;

		lines.push(`-- ${img.carde_name} (${img.weapon_type || 'no weapon'}) from ${img.slug_prefix}`);
		lines.push(`UPDATE cards SET image_url = '${safeUrl}'`);
		lines.push(`  WHERE LOWER(hero_name) = '${safeName.toLowerCase()}'`);
		lines.push(`  ${weaponClause}`);
		lines.push(`  AND image_url IS NULL;`);
		lines.push('');
		heroUpdateCount++;
	}

	lines.push(`-- Total hero UPDATE statements: ${heroUpdateCount}`);
	lines.push('');

	// ── Strategy 2: Fallback — match by hero_name only ─────────────
	lines.push('-- ═══ HERO CARDS FALLBACK: Match by hero_name only ═══');
	lines.push('-- Catches remaining cards where weapon_type matching missed.');
	lines.push('-- Only updates cards that STILL have NULL image_url.');
	lines.push('');

	const seenNames = new Set<string>();
	for (const [, img] of heroMap) {
		const nameLower = img.carde_name.toLowerCase();
		if (seenNames.has(nameLower)) continue;
		seenNames.add(nameLower);

		const safeName = img.carde_name.replace(/'/g, "''");
		const safeUrl = img.image_url.replace(/'/g, "''");

		lines.push(`UPDATE cards SET image_url = '${safeUrl}'`);
		lines.push(`  WHERE LOWER(hero_name) = '${safeName.toLowerCase()}'`);
		lines.push(`  AND image_url IS NULL;`);
		lines.push('');
	}

	// ── Strategy 3: Play cards matched by name ─────────────────────
	lines.push('-- ═══ PLAY CARDS: Match by name ═══');
	lines.push('');

	const playImages = mapped.filter(m => ['Play', 'Bonus Play'].includes(m.card_type));
	const playMap = new Map<string, MappedCard>();
	for (const p of playImages) {
		const key = p.carde_name.toLowerCase();
		if (!playMap.has(key)) {
			playMap.set(key, p);
		}
	}

	let playUpdateCount = 0;
	for (const [, img] of playMap) {
		const safeName = img.carde_name.replace(/'/g, "''");
		const safeUrl = img.image_url.replace(/'/g, "''");

		lines.push(`UPDATE play_cards SET image_url = '${safeUrl}'`);
		lines.push(`  WHERE LOWER(name) = '${safeName.toLowerCase()}'`);
		lines.push(`  AND image_url IS NULL;`);
		lines.push('');
		playUpdateCount++;
	}

	lines.push(`-- Total play card UPDATE statements: ${playUpdateCount}`);
	lines.push('');

	// ── Strategy 4: Hot Dogs ───────────────────────────────────────
	lines.push('-- ═══ HOT DOG CARDS: Match by name ═══');
	lines.push('-- Hot dogs are in the play_cards table.');
	lines.push('');

	const hotDogImages = mapped.filter(m => m.card_type === 'Hot Dog');
	const hotDogMap = new Map<string, MappedCard>();
	for (const h of hotDogImages) {
		const key = h.carde_name.toLowerCase();
		if (!hotDogMap.has(key)) {
			hotDogMap.set(key, h);
		}
	}

	for (const [, img] of hotDogMap) {
		const safeName = img.carde_name.replace(/'/g, "''");
		const safeUrl = img.image_url.replace(/'/g, "''");

		lines.push(`UPDATE play_cards SET image_url = '${safeUrl}'`);
		lines.push(`  WHERE LOWER(name) = '${safeName.toLowerCase()}'`);
		lines.push(`  AND image_url IS NULL;`);
		lines.push('');
	}

	lines.push('COMMIT;');
	lines.push('');

	// ── Verification queries ───────────────────────────────────────
	lines.push('-- ═══ VERIFICATION QUERIES ═══');
	lines.push('-- Run these AFTER the migration to confirm results.');
	lines.push('');
	lines.push('-- Total cards with images (hero cards):');
	lines.push("SELECT COUNT(*) AS hero_with_image FROM cards WHERE image_url IS NOT NULL;");
	lines.push('');
	lines.push('-- Total cards still missing images:');
	lines.push("SELECT COUNT(*) AS hero_missing_image FROM cards WHERE image_url IS NULL;");
	lines.push('');
	lines.push('-- Coverage by set_code:');
	lines.push("SELECT set_code, COUNT(*) AS total, COUNT(image_url) AS with_image,");
	lines.push("  ROUND(COUNT(image_url)::numeric / COUNT(*)::numeric * 100, 1) AS pct");
	lines.push("FROM cards GROUP BY set_code ORDER BY set_code;");
	lines.push('');
	lines.push('-- Play cards with images:');
	lines.push("SELECT COUNT(*) AS play_with_image FROM play_cards WHERE image_url IS NOT NULL;");
	lines.push('');
	lines.push('-- Sample: first 10 cards with images:');
	lines.push("SELECT hero_name, card_number, parallel, weapon_type, image_url");
	lines.push("FROM cards WHERE image_url IS NOT NULL LIMIT 10;");

	return lines.join('\n');
}

// ── Main ─────────────────────────────────────────────────────────
async function main() {
	console.log('Carde.io Image Backfill Script');
	console.log('==============================\n');

	// Fetch
	const cardeCards = await fetchAllCards();

	// Map
	const mapped = mapCards(cardeCards);

	// Report
	const heroes = mapped.filter(m => m.card_type === 'Hero');
	const plays = mapped.filter(m => m.card_type === 'Play');
	const bonusPlays = mapped.filter(m => m.card_type === 'Bonus Play');
	const hotDogs = mapped.filter(m => m.card_type === 'Hot Dog');

	console.log('Card type breakdown:');
	console.log(`  Heroes:      ${heroes.length}`);
	console.log(`  Plays:        ${plays.length}`);
	console.log(`  Bonus Plays:  ${bonusPlays.length}`);
	console.log(`  Hot Dogs:     ${hotDogs.length}`);
	console.log('');

	// Check for unmapped slug prefixes
	const unmapped = mapped.filter(m => m.parallel_guess.startsWith('UNKNOWN'));
	if (unmapped.length > 0) {
		console.log(`WARNING: ${unmapped.length} cards with unmapped slug prefixes:`);
		const byPrefix = new Map<string, number>();
		for (const u of unmapped) {
			byPrefix.set(u.slug_prefix, (byPrefix.get(u.slug_prefix) || 0) + 1);
		}
		for (const [prefix, count] of byPrefix) {
			console.log(`    ${prefix}: ${count} cards`);
		}
		console.log('');
	}

	// Generate output
	mkdirSync('scripts/output', { recursive: true });

	const sql = generateSQL(mapped);
	writeFileSync('scripts/output/backfill-images.sql', sql);
	console.log('Generated scripts/output/backfill-images.sql');

	writeFileSync('scripts/output/carde-mapping.json', JSON.stringify(mapped, null, 2));
	console.log('Generated scripts/output/carde-mapping.json');

	// Summary
	const uniqueHeroWeapon = new Set(
		heroes.map(h => `${h.carde_name.toLowerCase()}|${h.weapon_type || 'null'}`)
	);
	const uniqueHeroName = new Set(heroes.map(h => h.carde_name.toLowerCase()));

	console.log('\nMapping summary:');
	console.log(`  Unique hero+weapon combos with images: ${uniqueHeroWeapon.size}`);
	console.log(`  Unique hero names with images:         ${uniqueHeroName.size}`);
	console.log(`  Your DB has 17,077 hero cards — images will propagate to all parallels`);
	console.log(`  of each matched hero+weapon via the name-only fallback.`);
	console.log('');
	console.log('Next steps:');
	console.log('  1. Review scripts/output/backfill-images.sql');
	console.log('  2. Run in Supabase SQL Editor (select "No limit" in dropdown)');
	console.log('  3. Run the verification queries at the bottom of the file');
	console.log('  4. If play_cards table lacks image_url column, add it first');
}

main().catch(console.error);
