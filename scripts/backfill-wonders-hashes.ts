/**
 * Phase 1 / Session 1.1 — Wonders hash backfill
 *
 * One-shot script that reads every Wonders card's image_url, downloads
 * the image, computes dHash + pHash via the server-side hashing module
 * shipped in Session 1.0, and upserts into hash_cache with
 * source='official_seed' and confidence=1.0.
 *
 * Idempotent: skips cards that already have a hash_cache row for the
 * paper variant. Safe to re-run.
 *
 * Runtime: ~10-20 minutes for 1,007 cards at 200ms inter-card delay.
 *
 * Usage:
 *   npm run backfill:wonders-hashes
 *
 * Required env vars (loaded from .env.local or .env.development):
 *   - SUPABASE_URL (or PUBLIC_SUPABASE_URL)
 *   - SUPABASE_SERVICE_ROLE_KEY
 */

import { createClient } from '@supabase/supabase-js';
import { config as loadDotenv } from 'dotenv';
import {
	computeDHashFromBuffer,
	computePHashFromBuffer
} from '../src/lib/server/hashing';

// ── Env loading ─────────────────────────────────────────
// Matches the app's convention: prefer .env.local, fall back to .env.development.
loadDotenv({ path: '.env.local' });
loadDotenv({ path: '.env.development' });

const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_KEY) {
	console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in env');
	process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
	auth: { autoRefreshToken: false, persistSession: false }
});

// ── Tuning ──────────────────────────────────────────────

const INTER_CARD_DELAY_MS = 200;
const PROGRESS_LOG_EVERY_N = 50;
const HTTP_TIMEOUT_MS = 15_000;
const MAX_CONSECUTIVE_DB_FAILURES = 10;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ── Fetch helper ────────────────────────────────────────

async function fetchImageBuffer(url: string): Promise<Buffer> {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), HTTP_TIMEOUT_MS);
	try {
		const response = await fetch(url, { signal: controller.signal });
		if (!response.ok) {
			throw new Error(`HTTP ${response.status} ${response.statusText}`);
		}
		const ab = await response.arrayBuffer();
		return Buffer.from(ab);
	} finally {
		clearTimeout(timer);
	}
}

// ── Main ────────────────────────────────────────────────

type WondersCard = { id: string; image_url: string | null };

async function main() {
	const startTime = Date.now();
	console.log('[backfill:wonders] Starting Wonders hash backfill');

	// Fetch all Wonders cards with image URLs
	const { data: cards, error: cardsErr } = await supabase
		.from('cards')
		.select('id, image_url')
		.eq('game_id', 'wonders')
		.not('image_url', 'is', null)
		.returns<WondersCard[]>();

	if (cardsErr || !cards) {
		console.error('[backfill:wonders] Failed to list cards:', cardsErr?.message);
		process.exit(1);
	}

	console.log(`[backfill:wonders] Found ${cards.length} Wonders cards with images`);

	// Fetch existing hash_cache rows so we can skip
	const { data: existing, error: existingErr } = await supabase
		.from('hash_cache')
		.select('card_id')
		.eq('game_id', 'wonders')
		.eq('variant', 'paper')
		.is('superseded_at', null)
		.returns<{ card_id: string }[]>();

	if (existingErr) {
		console.error('[backfill:wonders] Failed to list existing hashes:', existingErr.message);
		process.exit(1);
	}

	const existingCardIds = new Set((existing ?? []).map((r) => r.card_id));
	console.log(`[backfill:wonders] ${existingCardIds.size} cards already have a hash — will skip`);

	let processed = 0;
	let succeeded = 0;
	let skipped = 0;
	let fetchFailed = 0;
	let hashFailed = 0;
	let dbFailed = 0;
	let consecutiveDbFailures = 0;

	for (const card of cards) {
		processed++;

		if (processed % PROGRESS_LOG_EVERY_N === 0) {
			const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
			console.log(
				`[backfill:wonders] Progress ${processed}/${cards.length} ` +
					`(succeeded=${succeeded} skipped=${skipped} ` +
					`fetchFailed=${fetchFailed} hashFailed=${hashFailed} dbFailed=${dbFailed}) ` +
					`elapsed=${elapsed}s`
			);
		}

		if (existingCardIds.has(card.id)) {
			skipped++;
			continue;
		}

		if (!card.image_url) {
			// Shouldn't happen given the query filter, but defensive
			skipped++;
			continue;
		}

		// 1. Fetch
		let buffer: Buffer;
		try {
			buffer = await fetchImageBuffer(card.image_url);
		} catch (err) {
			fetchFailed++;
			const msg = err instanceof Error ? err.message : String(err);
			console.warn(`[backfill:wonders] Fetch failed for card ${card.id}: ${msg}`);
			await sleep(INTER_CARD_DELAY_MS);
			continue;
		}

		// 2. Hash
		let dHash: string;
		let pHash256: string;
		try {
			dHash = await computeDHashFromBuffer(buffer); // 16 hex
			pHash256 = await computePHashFromBuffer(buffer); // 64 hex
		} catch (err) {
			hashFailed++;
			const msg = err instanceof Error ? err.message : String(err);
			console.warn(`[backfill:wonders] Hash failed for card ${card.id}: ${msg}`);
			await sleep(INTER_CARD_DELAY_MS);
			continue;
		}

		// 3. Upsert
		// ON CONFLICT (phash) DO NOTHING: if another card (cross-card collision) or
		// a prior run already wrote this dHash, leave it alone.
		const { error: upsertErr } = await supabase
			.from('hash_cache')
			.upsert(
				{
					phash: dHash,
					phash_256: pHash256,
					card_id: card.id,
					confidence: 1.0,
					scan_count: 1,
					last_seen: new Date().toISOString(),
					game_id: 'wonders',
					variant: 'paper',
					source: 'official_seed'
				} as never,
				{ onConflict: 'phash', ignoreDuplicates: true }
			);

		if (upsertErr) {
			dbFailed++;
			consecutiveDbFailures++;
			console.error(
				`[backfill:wonders] DB upsert failed for card ${card.id}: ${upsertErr.message}`
			);
			if (consecutiveDbFailures >= MAX_CONSECUTIVE_DB_FAILURES) {
				console.error(
					`[backfill:wonders] ${MAX_CONSECUTIVE_DB_FAILURES} consecutive DB failures — aborting`
				);
				break;
			}
		} else {
			succeeded++;
			consecutiveDbFailures = 0;
		}

		await sleep(INTER_CARD_DELAY_MS);
	}

	const elapsedTotal = ((Date.now() - startTime) / 1000).toFixed(0);
	console.log('');
	console.log('[backfill:wonders] ─── FINAL REPORT ───');
	console.log(`  Total cards:       ${cards.length}`);
	console.log(`  Processed:         ${processed}`);
	console.log(`  Succeeded (new):   ${succeeded}`);
	console.log(`  Skipped (exists):  ${skipped}`);
	console.log(`  Fetch failures:    ${fetchFailed}`);
	console.log(`  Hash failures:     ${hashFailed}`);
	console.log(`  DB failures:       ${dbFailed}`);
	console.log(`  Elapsed:           ${elapsedTotal}s`);
	console.log('');
	console.log('[backfill:wonders] Run this after to check coverage:');
	console.log('  SELECT refresh_scan_history_mvs();');
	console.log('  SELECT game_id, coverage_tier, COUNT(*) FROM mv_card_coverage');
	console.log('    GROUP BY game_id, coverage_tier ORDER BY game_id, coverage_tier;');
}

main().catch((err) => {
	console.error('[backfill:wonders] Fatal error:', err);
	process.exit(1);
});
