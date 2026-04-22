/**
 * Session 1.3 — One-shot BoBA hash backfill
 *
 * Reads every BoBA card that has an image_url but no hash_cache entry,
 * fetches the image from our Supabase Storage CDN, computes dHash + pHash-256
 * via the server-side hashing module (Session 1.0), and upserts a row into
 * hash_cache with source='ebay_seed' via upsert_hash_cache_v2.
 *
 * Idempotent. Safe to re-run. Rate-limited at 5 concurrent requests.
 *
 * Usage:
 *   npm run backfill:boba-hashes
 *
 * Prereqs:
 *   - .env.local has PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY
 *   - Session 1.0 hashing module is committed (src/lib/server/hashing)
 *   - Session 1.3 RPC migration (upsert_hash_cache_v2) is applied
 */

import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
import {
	computeDHashFromBuffer,
	computePHashFromBuffer
} from '../src/lib/server/hashing';

config({ path: '.env.local' });

const SUPABASE_URL = process.env.PUBLIC_SUPABASE_URL ?? '';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

if (!SUPABASE_URL || !SERVICE_KEY) {
	console.error(
		'Missing PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local'
	);
	process.exit(1);
}

const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
	auth: { persistSession: false, autoRefreshToken: false }
});

const CONCURRENCY = 5;
const FETCH_TIMEOUT_MS = 10_000;
const MIN_IMAGE_BYTES = 1_000;

interface CardRow {
	id: string;
	image_url: string;
	card_number: string | null;
}

async function fetchWorkList(): Promise<CardRow[]> {
	// Cards that have an image but no hash_cache row yet. Inline antijoin:
	// pull BoBA cards with images, pull the set of already-hashed card_ids,
	// subtract. At ~1,250 rows this is well inside a single query budget.
	const { data: rows, error: cardsErr } = await admin
		.from('cards')
		.select('id, image_url, card_number')
		.eq('game_id', 'boba')
		.not('image_url', 'is', null)
		.order('updated_at', { ascending: false })
		.limit(20_000);

	if (cardsErr) throw cardsErr;

	const { data: hashed, error: hashErr } = await admin
		.from('hash_cache')
		.select('card_id')
		.eq('game_id', 'boba');

	if (hashErr) throw hashErr;

	const hashedSet = new Set((hashed ?? []).map((r: { card_id: string }) => r.card_id));
	return (rows ?? []).filter((r) => !hashedSet.has(r.id)) as CardRow[];
}

async function fetchImageBuffer(url: string): Promise<Buffer> {
	const ctl = new AbortController();
	const timer = setTimeout(() => ctl.abort(), FETCH_TIMEOUT_MS);
	try {
		const res = await fetch(url, { signal: ctl.signal });
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		const contentType = res.headers.get('content-type') ?? '';
		if (!contentType.startsWith('image/')) {
			throw new Error(`non-image content-type: ${contentType}`);
		}
		const ab = await res.arrayBuffer();
		return Buffer.from(ab);
	} finally {
		clearTimeout(timer);
	}
}

interface Result {
	cardId: string;
	cardNumber: string | null;
	status: 'inserted' | 'collision' | 'error';
	error?: string;
}

async function processOne(card: CardRow): Promise<Result> {
	try {
		const buf = await fetchImageBuffer(card.image_url);
		if (buf.length < MIN_IMAGE_BYTES) {
			return {
				cardId: card.id,
				cardNumber: card.card_number,
				status: 'error',
				error: `image too small (${buf.length} bytes)`
			};
		}

		const [phash, phash256] = await Promise.all([
			computeDHashFromBuffer(buf),
			computePHashFromBuffer(buf)
		]);

		const { data, error } = await admin.rpc('upsert_hash_cache_v2', {
			p_phash: phash,
			p_card_id: card.id,
			p_phash_256: phash256,
			p_game_id: 'boba',
			p_variant: 'paper',
			p_source: 'ebay_seed',
			p_confidence: 1.0
		});

		if (error) {
			return {
				cardId: card.id,
				cardNumber: card.card_number,
				status: 'error',
				error: error.message
			};
		}

		return {
			cardId: card.id,
			cardNumber: card.card_number,
			status: data === true ? 'inserted' : 'collision'
		};
	} catch (e) {
		const msg = e instanceof Error ? e.message : String(e);
		return {
			cardId: card.id,
			cardNumber: card.card_number,
			status: 'error',
			error: msg
		};
	}
}

async function main() {
	console.log('[backfill] fetching work list...');
	const work = await fetchWorkList();
	console.log(`[backfill] ${work.length} BoBA cards to hash`);

	if (work.length === 0) {
		console.log('[backfill] nothing to do — exiting');
		return;
	}

	const stats = { inserted: 0, collision: 0, error: 0 };
	const errors: Result[] = [];
	let processed = 0;

	const queue = [...work];
	const workers: Promise<void>[] = [];

	for (let i = 0; i < CONCURRENCY; i++) {
		workers.push(
			(async () => {
				while (queue.length > 0) {
					const next = queue.shift();
					if (!next) break;
					const r = await processOne(next);
					stats[r.status]++;
					processed++;
					if (r.status === 'error') errors.push(r);
					if (processed % 50 === 0) {
						console.log(
							`[backfill] ${processed}/${work.length} ` +
								`(inserted=${stats.inserted} collision=${stats.collision} error=${stats.error})`
						);
					}
				}
			})()
		);
	}

	await Promise.all(workers);

	console.log('\n[backfill] done');
	console.log(`[backfill] inserted:  ${stats.inserted}`);
	console.log(
		`[backfill] collision: ${stats.collision}  <- existing phash in table`
	);
	console.log(`[backfill] error:     ${stats.error}`);

	if (errors.length > 0) {
		console.log('\n[backfill] first 10 errors:');
		for (const e of errors.slice(0, 10)) {
			console.log(`  ${e.cardNumber ?? '?'} (${e.cardId}): ${e.error}`);
		}
	}
}

main().catch((err) => {
	console.error('[backfill] fatal:', err);
	process.exit(1);
});
