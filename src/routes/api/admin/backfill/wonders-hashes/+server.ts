/**
 * POST /api/admin/backfill/wonders-hashes
 *
 * Phase 1 / Session 1.1.1 — Wonders hash backfill, admin-triggered,
 * self-chaining within Vercel's 60-second function budget.
 *
 * Processes a batch of ~100 Wonders cards per call, then fires itself
 * again via fetch() if more cards remain. First call requires admin
 * session; self-chain calls authenticate via CRON_SECRET header.
 *
 * Idempotent: skips cards that already have a hash_cache row for
 * variant='paper'. Safe to re-run. Redis mutex prevents concurrent runs.
 */

import { json, error } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
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

async function authorizeOrThrow(
	request: Request,
	locals: App.Locals
): Promise<{ callerType: 'admin' | 'cron'; adminId: string | null }> {
	const cronSecret = env.CRON_SECRET;
	const auth = request.headers.get('authorization') ?? '';
	if (cronSecret && auth === `Bearer ${cronSecret}`) {
		return { callerType: 'cron', adminId: null };
	}
	const user = await requireAdmin(locals);
	return { callerType: 'admin', adminId: user.id };
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

type AdminClient = NonNullable<ReturnType<typeof getAdminClient>>;

async function getExistingCardIds(admin: AdminClient): Promise<string[]> {
	const { data } = await admin
		.from('hash_cache')
		.select('card_id')
		// Narrow to Wonders paper hashes; columns exist in the live schema even
		// when the generated Database type hasn't caught up yet.
		.eq('game_id' as never, 'wonders')
		.eq('variant' as never, 'paper')
		.is('superseded_at', null);
	return (data ?? []).map((r) => r.card_id);
}

export const POST: RequestHandler = async ({ request, locals, url }) => {
	const startTime = Date.now();
	const { callerType, adminId } = await authorizeOrThrow(request, locals);

	const redis = getRedis();
	if (!redis) throw error(503, 'Redis not available');

	const admin = getAdminClient();
	if (!admin) throw error(503, 'Database not available');

	let status = (await redis.get<BackfillStatus>(MUTEX_KEY)) ?? null;

	if (callerType === 'admin') {
		if (status && !status.completed) {
			return json({ error: 'Backfill already in progress', status }, { status: 409 });
		}

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

		if (adminId) {
			await admin.from('admin_activity_log').insert({
				admin_id: adminId,
				action: 'backfill_wonders_hashes_start',
				entity_type: 'hash_cache',
				entity_id: 'wonders',
				details: { total_cards: count }
			});
		}
	}

	if (!status) {
		throw error(500, 'Self-chain call found no status in Redis — mutex expired?');
	}

	// Antijoin against cards that already have a hash row. PostgREST rejects
	// empty IN clauses, so we branch on whether any cards have been seeded yet.
	// First-ever batch uses the no-antijoin path.
	const existingIds = await getExistingCardIds(admin);

	let batchQuery = admin
		.from('cards')
		.select('id, image_url')
		.eq('game_id', 'wonders')
		.not('image_url', 'is', null)
		.limit(BATCH_SIZE);

	if (existingIds.length > 0) {
		batchQuery = batchQuery.not('id', 'in', '(' + existingIds.join(',') + ')');
	}

	const { data: batch, error: batchErr } = await batchQuery.returns<WondersCard[]>();

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

	status.batch_count++;
	status.last_batch_at = new Date().toISOString();

	for (const card of batch) {
		status.processed++;

		if (Date.now() - startTime > MAX_FUNCTION_MS - SAFETY_MARGIN_MS) {
			console.log(
				`[backfill:wonders] time budget reached mid-batch at ${status.processed}`
			);
			break;
		}

		let buffer: Buffer;
		try {
			buffer = await fetchImageBuffer(card.image_url);
		} catch (err) {
			status.fetch_failed++;
			console.warn(
				`[backfill:wonders] fetch failed for ${card.id}: ${
					err instanceof Error ? err.message : String(err)
				}`
			);
			continue;
		}

		let dHash: string;
		let pHash256: string;
		try {
			dHash = await computeDHashFromBuffer(buffer);
			pHash256 = await computePHashFromBuffer(buffer);
		} catch (err) {
			status.hash_failed++;
			console.warn(
				`[backfill:wonders] hash failed for ${card.id}: ${
					err instanceof Error ? err.message : String(err)
				}`
			);
			continue;
		}

		const { error: upErr } = await admin
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

		if (upErr) {
			status.db_failed++;
			console.error(
				`[backfill:wonders] upsert failed for ${card.id}: ${upErr.message}`
			);
		} else {
			status.succeeded++;
		}
	}

	await redis.set(MUTEX_KEY, status, { ex: MUTEX_TTL_SECONDS });

	// Fire-and-forget self-chain. Awaiting this would stack function lifetimes
	// and blow the 60s budget, so we kick off the next link and return.
	const cronSecret = env.CRON_SECRET;
	if (cronSecret) {
		const selfUrl = `${url.origin}/api/admin/backfill/wonders-hashes`;
		void fetch(selfUrl, {
			method: 'POST',
			headers: {
				Authorization: `Bearer ${cronSecret}`,
				'Content-Type': 'application/json'
			}
		}).catch((err) => {
			console.error(
				`[backfill:wonders] self-chain fetch failed: ${
					err instanceof Error ? err.message : String(err)
				}`
			);
		});
	} else {
		console.error('[backfill:wonders] CRON_SECRET missing — self-chain skipped');
	}

	return json({ ok: true, done: false, status });
};
