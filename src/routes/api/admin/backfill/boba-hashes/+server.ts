/**
 * POST /api/admin/backfill/boba-hashes
 *
 * Phase 1 / Session 1.3 follow-up — BoBA hash backfill, admin-triggered.
 * Each tap processes one batch with a 6-wide parallelism pool and returns.
 * The admin UI shows "Continue backfill (N/total)" until done.
 *
 * Mirrors the Wonders backfill endpoint pattern. Differences:
 *   - game_id = 'boba', source = 'ebay_seed'
 *   - Writes via upsert_hash_cache_v2 RPC (same path used by the CLI
 *     script and the live harvester piggyback — keeps write semantics
 *     consistent across all three producers of ebay_seed rows).
 *   - Antijoin is JS-side (two simple queries) because no server-side
 *     RPC exists for BoBA and the dataset is small (~1,300 rows).
 *
 * Idempotent. Safe to re-run. Redis mutex persists progress across taps.
 */

import { json, error } from '@sveltejs/kit';
import { requireAdmin } from '$lib/server/admin-guard';
import { getAdminClient } from '$lib/server/supabase-admin';
import { getRedis } from '$lib/server/redis';
import {
	computeDHashFromBuffer,
	computePHashFromBuffer
} from '$lib/server/hashing';
import type { RequestHandler } from './$types';

export const config = { maxDuration: 60 };

const BATCH_SIZE = 100;
const SAFETY_MARGIN_MS = 5_000;
const MAX_FUNCTION_MS = 55_000;
const HTTP_TIMEOUT_MS = 8_000;
const MIN_IMAGE_BYTES = 1_000;
const PARALLELISM = 6;

const MUTEX_KEY = 'backfill:boba-hashes:lock';
const MUTEX_TTL_SECONDS = 120;
const COMPLETED_TTL_SECONDS = 300;

type BackfillStatus = {
	started_at: string;
	last_batch_at: string;
	batch_count: number;
	total_cards: number;
	processed: number;
	succeeded: number;
	skipped: number;
	fetch_failed: number;
	hash_failed: number;
	db_failed: number;
	completed: boolean;
	completed_at?: string;
	admin_id: string | null;
};

type BobaCard = { id: string; image_url: string; parallel: string | null };

/**
 * PostgREST caps `.select()` at 1,000 rows by default. Once BoBA hash_cache
 * exceeded that, the antijoin was silently reading a truncated set and
 * re-queueing already-hashed cards (RPC reported them as collisions →
 * skipped count climbed while succeeded stayed at zero). Paginate
 * explicitly with .range() until we've seen the full set.
 */
async function fetchAllHashedBobaIds(
	admin: ReturnType<typeof getAdminClient>
): Promise<Set<string>> {
	if (!admin) throw new Error('admin client required');
	const PAGE = 1000;
	const all = new Set<string>();
	let from = 0;
	for (;;) {
		const { data, error: err } = await admin
			.from('hash_cache')
			.select('card_id')
			.eq('game_id', 'boba')
			.range(from, from + PAGE - 1);
		if (err) throw new Error(err.message);
		const page = data ?? [];
		for (const row of page) {
			if (row.card_id) all.add(row.card_id);
		}
		if (page.length < PAGE) break;
		from += PAGE;
	}
	return all;
}

/**
 * Same pagination pattern as fetchAllHashedBobaIds, but for the `cards`
 * candidates side. PostgREST silently caps `.select()` at 1,000 rows
 * regardless of `.limit()`, which previously left BoBA cards in positions
 * 1001+ of the `updated_at DESC` ordering invisible to the endpoint.
 *
 * Safety cap at 5 pages (5,000 rows) — more than the entire BoBA image
 * catalog is expected to grow to. If coverage ever approaches that,
 * revisit with a server-side RPC (the Session 1.1.1c Wonders pattern).
 */
async function fetchAllBobaCardsWithImages(
	admin: ReturnType<typeof getAdminClient>
): Promise<BobaCard[]> {
	if (!admin) throw new Error('admin client required');
	const PAGE = 1000;
	const MAX_PAGES = 5;
	const all: BobaCard[] = [];
	for (let p = 0; p < MAX_PAGES; p++) {
		const from = p * PAGE;
		const { data, error: err } = await admin
			.from('cards')
			.select('id, image_url, parallel')
			.eq('game_id', 'boba')
			.not('image_url', 'is', null)
			.order('updated_at', { ascending: false })
			.range(from, from + PAGE - 1);
		if (err) throw new Error(err.message);
		const page = (data ?? []) as BobaCard[];
		all.push(...page);
		if (page.length < PAGE) break;
	}
	return all;
}

async function fetchImageBuffer(url: string): Promise<Buffer> {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), HTTP_TIMEOUT_MS);
	try {
		const response = await fetch(url, { signal: controller.signal });
		if (!response.ok) throw new Error(`HTTP ${response.status}`);
		const contentType = response.headers.get('content-type') ?? '';
		if (!contentType.startsWith('image/')) {
			throw new Error(`non-image content-type: ${contentType}`);
		}
		return Buffer.from(await response.arrayBuffer());
	} finally {
		clearTimeout(timer);
	}
}

export const POST: RequestHandler = async ({ locals }) => {
	const startTime = Date.now();
	const user = await requireAdmin(locals);
	const adminId = user.id;

	const redis = getRedis();
	if (!redis) throw error(503, 'Redis not available');

	const admin = getAdminClient();
	if (!admin) throw error(503, 'Database not available');

	let status = (await redis.get<BackfillStatus>(MUTEX_KEY)) ?? null;

	if (status && !status.completed) {
		console.log(
			`[backfill:boba] resuming: ${status.processed}/${status.total_cards}`
		);
	} else {
		// Fresh run — count BoBA cards that still need hashing (image_url set,
		// no hash_cache row yet). Both sides paginated to avoid the
		// PostgREST 1k-row implicit cap.
		let cardsWithImages: BobaCard[];
		try {
			cardsWithImages = await fetchAllBobaCardsWithImages(admin);
		} catch (err) {
			throw error(
				500,
				`Count query failed: ${err instanceof Error ? err.message : String(err)}`
			);
		}

		let hashedSet: Set<string>;
		try {
			hashedSet = await fetchAllHashedBobaIds(admin);
		} catch (err) {
			throw error(
				500,
				`Hash count query failed: ${err instanceof Error ? err.message : String(err)}`
			);
		}

		const remaining = cardsWithImages.filter(
			(r) => !hashedSet.has(r.id)
		).length;

		status = {
			started_at: new Date().toISOString(),
			last_batch_at: new Date().toISOString(),
			batch_count: 0,
			total_cards: remaining,
			processed: 0,
			succeeded: 0,
			skipped: 0,
			fetch_failed: 0,
			hash_failed: 0,
			db_failed: 0,
			completed: false,
			admin_id: adminId
		};

		await admin.from('admin_activity_log').insert({
			admin_id: adminId,
			action: 'backfill_boba_hashes_start',
			entity_type: 'hash_cache',
			entity_id: 'boba',
			details: { total_cards: remaining }
		});
	}

	// Load the next batch. Both sides paginated — .limit() alone cannot
	// override PostgREST's implicit 1k-row cap.
	let candidates: BobaCard[];
	try {
		candidates = await fetchAllBobaCardsWithImages(admin);
	} catch (err) {
		throw error(
			500,
			`Batch query failed: ${err instanceof Error ? err.message : String(err)}`
		);
	}

	let alreadyHashedSet: Set<string>;
	try {
		alreadyHashedSet = await fetchAllHashedBobaIds(admin);
	} catch (err) {
		throw error(
			500,
			`Hash query failed: ${err instanceof Error ? err.message : String(err)}`
		);
	}

	const batch = candidates
		.filter((c) => !alreadyHashedSet.has(c.id))
		.slice(0, BATCH_SIZE);

	if (batch.length === 0) {
		status.completed = true;
		status.completed_at = new Date().toISOString();
		await redis.set(MUTEX_KEY, status, { ex: COMPLETED_TTL_SECONDS });

		if (status.admin_id) {
			await admin.from('admin_activity_log').insert({
				admin_id: status.admin_id,
				action: 'backfill_boba_hashes_complete',
				entity_type: 'hash_cache',
				entity_id: 'boba',
				details: {
					succeeded: status.succeeded,
					skipped: status.skipped,
					fetch_failed: status.fetch_failed,
					hash_failed: status.hash_failed,
					db_failed: status.db_failed,
					total_batches: status.batch_count
				}
			});
		}

		return json({ ok: true, done: true, status });
	}

	status.batch_count++;
	status.last_batch_at = new Date().toISOString();

	const adminRef = admin;
	const statusRef = status;

	async function processOne(card: BobaCard): Promise<void> {
		let buffer: Buffer;
		try {
			buffer = await fetchImageBuffer(card.image_url);
			if (buffer.length < MIN_IMAGE_BYTES) {
				statusRef.fetch_failed++;
				console.warn(
					`[backfill:boba] fetch too small for ${card.id}: ${buffer.length} bytes`
				);
				return;
			}
		} catch (err) {
			statusRef.fetch_failed++;
			console.warn(
				`[backfill:boba] fetch failed for ${card.id}: ${
					err instanceof Error ? err.message : String(err)
				}`
			);
			return;
		}

		let dHash: string;
		let pHash256: string;
		try {
			dHash = await computeDHashFromBuffer(buffer);
			pHash256 = await computePHashFromBuffer(buffer);
		} catch (err) {
			statusRef.hash_failed++;
			console.warn(
				`[backfill:boba] hash failed for ${card.id}: ${
					err instanceof Error ? err.message : String(err)
				}`
			);
			return;
		}

		// Read parallel from cards.parallel — source of truth. Defaults to
		// 'Paper' when missing on the row.
		const cardParallel = card.parallel ?? 'Paper';
		const { data: inserted, error: rpcErr } = await adminRef.rpc(
			// Cast around the generated Database type until it catches up
			// with upsert_hash_cache_v2 signature.
			'upsert_hash_cache_v2' as never,
			{
				p_phash: dHash,
				p_card_id: card.id,
				p_phash_256: pHash256,
				p_game_id: 'boba',
				p_parallel: cardParallel,
				p_source: 'ebay_seed',
				p_confidence: 1.0
			} as never
		);

		if (rpcErr) {
			statusRef.db_failed++;
			console.error(
				`[backfill:boba] rpc failed for ${card.id}: ${rpcErr.message}`
			);
			return;
		}

		// RPC returns true when a row was inserted, false when the phash
		// already existed (legitimate collision — same image hashed
		// identically by the harvester or a previous seed run).
		if (inserted === false) {
			statusRef.skipped++;
		} else {
			statusRef.succeeded++;
		}
	}

	for (let i = 0; i < batch.length; i += PARALLELISM) {
		if (Date.now() - startTime > MAX_FUNCTION_MS - SAFETY_MARGIN_MS) {
			console.log(
				`[backfill:boba] time budget reached at processed=${status.processed}`
			);
			break;
		}

		const slice = batch.slice(i, i + PARALLELISM);
		await Promise.all(slice.map(processOne));
		status.processed += slice.length;
	}

	// Defensive early-stop: if everything we've ever processed was a skip
	// (already in hash_cache, RPC returned inserted=false), the antijoin is
	// producing already-hashed candidates and the loop will never naturally
	// terminate. Treat the run as done so the auto-loop exits.
	const allWorkWasSkipped =
		status.processed > 0 &&
		status.succeeded === 0 &&
		status.fetch_failed === 0 &&
		status.hash_failed === 0 &&
		status.db_failed === 0;

	if (allWorkWasSkipped) {
		console.log(
			`[backfill:boba] all ${status.processed} processed cards were skips — marking done`
		);
		status.completed = true;
		status.completed_at = new Date().toISOString();
		await redis.set(MUTEX_KEY, status, { ex: COMPLETED_TTL_SECONDS });
		return json({ ok: true, done: true, status });
	}

	await redis.set(MUTEX_KEY, status, { ex: MUTEX_TTL_SECONDS });

	return json({ ok: true, done: false, status });
};

/**
 * DELETE /api/admin/backfill/boba-hashes
 *
 * Clears the Redis mutex so the next POST starts fresh. Use this when
 * the displayed status has gone stale or wedged.
 */
export const DELETE: RequestHandler = async ({ locals }) => {
	await requireAdmin(locals);
	const redis = getRedis();
	if (!redis) throw error(503, 'Redis not available');
	await redis.del(MUTEX_KEY);
	return json({ ok: true, reset: true });
};
