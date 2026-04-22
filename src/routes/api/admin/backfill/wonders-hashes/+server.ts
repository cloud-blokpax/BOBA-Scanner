/**
 * POST /api/admin/backfill/wonders-hashes
 *
 * Phase 1 / Session 1.1.1b — Wonders hash backfill, admin-triggered.
 * Each tap processes one batch with a 6-wide parallelism pool and
 * returns. The admin UI shows "Continue backfill (N/total)" until done.
 *
 * Idempotent: ON CONFLICT (phash) DO NOTHING. Safe to re-run. Redis
 * mutex persists progress across taps.
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

const MUTEX_KEY = 'backfill:wonders-hashes:lock';
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

type WondersCard = { id: string; image_url: string };

// Auth: admin session only. Self-chain was removed in 1.1.1b, so the only
// caller is the admin UI.
async function authorizeOrThrow(locals: App.Locals): Promise<string> {
	const user = await requireAdmin(locals);
	return user.id;
}

async function fetchImageBuffer(url: string): Promise<Buffer> {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), HTTP_TIMEOUT_MS);
	try {
		const response = await fetch(url, { signal: controller.signal });
		if (!response.ok) throw new Error(`HTTP ${response.status}`);
		return Buffer.from(await response.arrayBuffer());
	} finally {
		clearTimeout(timer);
	}
}

export const POST: RequestHandler = async ({ locals }) => {
	const startTime = Date.now();
	const adminId = await authorizeOrThrow(locals);

	const redis = getRedis();
	if (!redis) throw error(503, 'Redis not available');

	const admin = getAdminClient();
	if (!admin) throw error(503, 'Database not available');

	let status = (await redis.get<BackfillStatus>(MUTEX_KEY)) ?? null;

	// Resume path: if a prior run is in-progress, continue from where it
	// stopped. No 409 — each admin tap is an explicit "continue" action.
	if (status && !status.completed) {
		console.log(
			`[backfill:wonders] resuming: ${status.processed}/${status.total_cards}`
		);
	} else {
		// Fresh run — count total Wonders cards and initialize status.
		const { count, error: countErr } = await admin
			.from('cards')
			.select('id', { count: 'exact', head: true })
			.eq('game_id', 'wonders')
			.not('image_url', 'is', null);

		if (countErr || count == null) {
			throw error(500, `Count query failed: ${countErr?.message ?? 'unknown'}`);
		}

		status = {
			started_at: new Date().toISOString(),
			last_batch_at: new Date().toISOString(),
			batch_count: 0,
			total_cards: count,
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
			action: 'backfill_wonders_hashes_start',
			entity_type: 'hash_cache',
			entity_id: 'wonders',
			details: { total_cards: count }
		});
	}

	// Server-side RPC does the antijoin inside Postgres, avoiding the
	// PostgREST URL-size limit that 500'd the endpoint once ~600 cards
	// were already seeded. The RPC exists in the live schema but the
	// generated Database type hasn't caught up, so we cast around it.
	const rpcCall = (admin.rpc as unknown as (
		fn: string,
		args: Record<string, unknown>
	) => PromiseLike<{ data: WondersCard[] | null; error: { message: string } | null }>)(
		'get_wonders_cards_to_seed',
		{ p_limit: BATCH_SIZE }
	);
	const { data: batch, error: batchErr } = await rpcCall;

	if (batchErr) {
		throw error(500, `Batch query failed: ${batchErr.message}`);
	}

	if (!batch || batch.length === 0) {
		status.completed = true;
		status.completed_at = new Date().toISOString();
		await redis.set(MUTEX_KEY, status, { ex: COMPLETED_TTL_SECONDS });

		if (status.admin_id) {
			await admin.from('admin_activity_log').insert({
				admin_id: status.admin_id,
				action: 'backfill_wonders_hashes_complete',
				entity_type: 'hash_cache',
				entity_id: 'wonders',
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

	// Process this batch with a 6-wide parallelism pool. Most per-card time
	// is the HTTP fetch; parallelism pushes throughput ~4x without
	// overloading Sharp or the Supabase bucket's rate limit.
	status.batch_count++;
	status.last_batch_at = new Date().toISOString();

	const PARALLELISM = 6;
	// Capture non-null refs so the closure below doesn't need `!` assertions.
	const adminRef = admin;
	const statusRef = status;

	async function processOne(card: WondersCard): Promise<void> {
		let buffer: Buffer;
		try {
			buffer = await fetchImageBuffer(card.image_url);
		} catch (err) {
			statusRef.fetch_failed++;
			console.warn(
				`[backfill:wonders] fetch failed for ${card.id}: ${
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
				`[backfill:wonders] hash failed for ${card.id}: ${
					err instanceof Error ? err.message : String(err)
				}`
			);
			return;
		}

		// Read parallel from the matched card row — cards.parallel is the
		// source of truth (defaults to 'Paper' for the Wonders catalog today).
		const cardWithParallel = card as { parallel?: string | null };
		const cardParallel = cardWithParallel.parallel ?? 'Paper';
		const { error: upErr } = await adminRef
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
					parallel: cardParallel,
					source: 'official_seed'
				} as never,
				{ onConflict: 'phash', ignoreDuplicates: true }
			);

		if (upErr) {
			statusRef.db_failed++;
			console.error(
				`[backfill:wonders] upsert failed for ${card.id}: ${upErr.message}`
			);
		} else {
			statusRef.succeeded++;
		}
	}

	// Walk the batch in chunks of PARALLELISM. Check time budget between
	// chunks so we never start a new chunk after the safety margin.
	for (let i = 0; i < batch.length; i += PARALLELISM) {
		if (Date.now() - startTime > MAX_FUNCTION_MS - SAFETY_MARGIN_MS) {
			console.log(
				`[backfill:wonders] time budget reached at processed=${status.processed}`
			);
			break;
		}

		const slice = batch.slice(i, i + PARALLELISM);
		await Promise.all(slice.map(processOne));
		status.processed += slice.length;
	}

	// Persist updated status. Admin UI re-reads it via the status endpoint
	// and prompts the user to tap again if not done.
	await redis.set(MUTEX_KEY, status, { ex: MUTEX_TTL_SECONDS });

	return json({ ok: true, done: false, status });
};
