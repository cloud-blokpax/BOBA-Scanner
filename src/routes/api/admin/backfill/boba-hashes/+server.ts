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

type BobaCard = { id: string; image_url: string };

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
		// no hash_cache row yet). Two simple queries + JS antijoin; dataset is
		// ~1,300 rows so payload stays tiny.
		const { data: cardsWithImages, error: cardsErr } = await admin
			.from('cards')
			.select('id')
			.eq('game_id', 'boba')
			.not('image_url', 'is', null);
		if (cardsErr) throw error(500, `Count query failed: ${cardsErr.message}`);

		const { data: hashed, error: hashErr } = await admin
			.from('hash_cache')
			.select('card_id')
			.eq('game_id', 'boba');
		if (hashErr) throw error(500, `Hash count query failed: ${hashErr.message}`);

		const hashedSet = new Set((hashed ?? []).map((r) => r.card_id));
		const remaining = (cardsWithImages ?? []).filter(
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

	// Load the next batch via the same JS antijoin. Both queries remain small
	// enough at ~1.3k rows that we don't need a server-side RPC.
	const { data: candidates, error: candErr } = await admin
		.from('cards')
		.select('id, image_url')
		.eq('game_id', 'boba')
		.not('image_url', 'is', null)
		.order('updated_at', { ascending: false })
		.limit(20_000);
	if (candErr) throw error(500, `Batch query failed: ${candErr.message}`);

	const { data: alreadyHashed, error: hashErr2 } = await admin
		.from('hash_cache')
		.select('card_id')
		.eq('game_id', 'boba');
	if (hashErr2) throw error(500, `Hash query failed: ${hashErr2.message}`);

	const alreadyHashedSet = new Set((alreadyHashed ?? []).map((r) => r.card_id));
	const batch = ((candidates ?? []) as BobaCard[])
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

		const { data: inserted, error: rpcErr } = await adminRef.rpc(
			// Cast around the generated Database type until it catches up
			// with upsert_hash_cache_v2 signature.
			'upsert_hash_cache_v2' as never,
			{
				p_phash: dHash,
				p_card_id: card.id,
				p_phash_256: pHash256,
				p_game_id: 'boba',
				p_variant: 'paper',
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

	await redis.set(MUTEX_KEY, status, { ex: MUTEX_TTL_SECONDS });

	return json({ ok: true, done: false, status });
};
