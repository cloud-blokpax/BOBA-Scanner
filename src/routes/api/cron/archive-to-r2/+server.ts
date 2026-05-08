/**
 * GET /api/cron/archive-to-r2 — Daily R2 archive of warm Postgres tables.
 *
 * For each (app_id='card-scanner', source_table) in archive_watermark, exports
 * rows newer than last_archived_date and older than today (UTC) to R2 as
 * gzipped JSONL. Bumps the watermark on success.
 *
 * Layout: tcg-archive/card-scanner/YYYY/MM/DD/{source_table}.jsonl.gz
 *
 * Cost guard: aborts (no writes) if R2 bucket is already over 8 GB.
 *
 * Auth: CRON_SECRET header. Triggered by QStash via
 * /api/cron/qstash-archive-to-r2 (signed → forwarded with secret) at 04:30 UTC.
 */

import { json, error } from '@sveltejs/kit';
import { gzipSync } from 'node:zlib';
import { env } from '$env/dynamic/private';
import { getAdminClient } from '$lib/server/supabase-admin';
import { logEvent } from '$lib/server/diagnostics';
import {
	buildArchiveKey,
	getBucketSizeBytes,
	putObject,
	readR2Config
} from '$lib/server/r2-client';
import type { RequestHandler } from './$types';

export const config = { maxDuration: 300 }; // 5 min — large day catch-up could take a while

// ── Cost guard: hard ceiling on R2 bucket size ─────────────
const BUCKET_SIZE_CEILING_BYTES = 8 * 1024 * 1024 * 1024; // 8 GB
// R2 free tier is 10 GB. 8 GB ceiling = 2 GB head room before any
// dollar charge. If we hit this, the cron aborts with loud failure
// rather than spending money — operator must investigate.

const APP_ID = 'card-scanner';
const PAGE_SIZE = 1000;

interface RunResult {
	source_table: string;
	dates_archived: string[];
	rows_archived: number;
	bytes_written: number;
	skipped_reason?: string;
	error?: string;
}

export const GET: RequestHandler = async ({ request, url }) => {
	const auth = request.headers.get('authorization');
	const cronSecret = env.CRON_SECRET;
	if (!cronSecret || auth !== `Bearer ${cronSecret}`) {
		throw error(401, 'unauthorized');
	}

	// Dry-run mode: read everything, gzip, count bytes, but skip the R2 PUT.
	// Use ?dry=1 the first few times to verify behaviour before going live.
	const dryRun = url.searchParams.get('dry') === '1';

	const admin = getAdminClient();
	if (!admin) {
		return json({ skipped: true, reason: 'admin client unavailable' });
	}

	const r2Config = readR2Config();
	if (!r2Config) {
		void logEvent({
			level: 'error',
			event: 'archive.r2_not_configured',
			error: 'R2 env vars missing'
		});
		return json({ skipped: true, reason: 'R2 not configured' });
	}

	// ── Pre-flight: bucket size guard ──────────────────────
	let bucketSize = 0;
	try {
		bucketSize = await getBucketSizeBytes();
	} catch (err) {
		const msg = err instanceof Error ? err.message : 'unknown';
		void logEvent({
			level: 'error',
			event: 'archive.bucket_size_check_failed',
			error: msg
		});
		return json(
			{ aborted: true, reason: `bucket size check failed: ${msg}` },
			{ status: 500 }
		);
	}

	if (bucketSize > BUCKET_SIZE_CEILING_BYTES) {
		void logEvent({
			level: 'fatal',
			event: 'archive.bucket_size_ceiling_exceeded',
			context: { bucketSize, ceiling: BUCKET_SIZE_CEILING_BYTES }
		});
		return json(
			{
				aborted: true,
				reason: 'bucket over 8 GB ceiling — investigate before resuming',
				bucketSize
			},
			{ status: 503 }
		);
	}

	// ── For each source_table, archive whatever's missing ──
	const startedAt = new Date().toISOString();
	const results: RunResult[] = [];

	const SOURCE_TABLES = [
		{ table: 'ebay_listing_observations', timeColumn: 'observed_at' as const },
		{ table: 'price_harvest_log', timeColumn: 'processed_at' as const }
	];

	for (const { table, timeColumn } of SOURCE_TABLES) {
		try {
			const result = await archiveOneTable({
				admin,
				appId: APP_ID,
				sourceTable: table,
				timeColumn,
				dryRun
			});
			results.push(result);
		} catch (err) {
			const msg = err instanceof Error ? err.message : 'unknown';
			void logEvent({
				level: 'error',
				event: 'archive.table_run_failed',
				error: msg,
				context: { table }
			});
			results.push({
				source_table: table,
				dates_archived: [],
				rows_archived: 0,
				bytes_written: 0,
				error: msg
			});
		}
	}

	const finishedAt = new Date().toISOString();
	const totalRows = results.reduce((s, r) => s + r.rows_archived, 0);
	const totalBytes = results.reduce((s, r) => s + r.bytes_written, 0);

	void logEvent({
		level: 'info',
		event: 'archive.run_completed',
		context: {
			startedAt,
			finishedAt,
			totalRows,
			totalBytes,
			bucketSizeBefore: bucketSize,
			dryRun
		}
	});

	return json({
		ok: results.every((r) => !r.error),
		dryRun,
		startedAt,
		finishedAt,
		bucketSizeBefore: bucketSize,
		bucketSizeCeilingBytes: BUCKET_SIZE_CEILING_BYTES,
		results,
		totalRows,
		totalBytes
	});
};

interface ArchiveTableArgs {
	admin: NonNullable<ReturnType<typeof getAdminClient>>;
	appId: string;
	sourceTable: string;
	timeColumn: 'observed_at' | 'processed_at';
	dryRun: boolean;
}

/**
 * Archive a single source table. Reads watermark, exports each missing
 * day as one gzipped JSONL file, bumps watermark per-day so a mid-run
 * crash leaves us resumable.
 */
async function archiveOneTable(args: ArchiveTableArgs): Promise<RunResult> {
	const { admin, appId, sourceTable, timeColumn, dryRun } = args;

	// Read current watermark
	const { data: wmRow, error: wmErr } = await admin
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		.from('archive_watermark' as any)
		.select('last_archived_date')
		.eq('app_id', appId)
		.eq('source_table', sourceTable)
		.maybeSingle();

	if (wmErr) {
		throw new Error(`watermark read failed: ${wmErr.message}`);
	}
	if (!wmRow) {
		throw new Error(
			`watermark row missing for (${appId}, ${sourceTable}) — seed in migration`
		);
	}

	const lastArchivedDate = (wmRow as unknown as { last_archived_date: string | null })
		.last_archived_date;

	// Determine date range to archive
	const todayUtc = new Date();
	todayUtc.setUTCHours(0, 0, 0, 0);
	// We never archive "today" — it's still being written to. Cutoff is
	// yesterday-23:59:59.999 UTC.
	const cutoffEnd = new Date(todayUtc.getTime() - 1);

	let nextDate: Date;
	if (lastArchivedDate) {
		const last = new Date(lastArchivedDate + 'T00:00:00Z');
		nextDate = new Date(last.getTime() + 24 * 60 * 60 * 1000);
	} else {
		// First run — start from oldest row in the table
		const { data: oldestRow } = await admin
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			.from(sourceTable as any)
			.select(timeColumn)
			.order(timeColumn, { ascending: true })
			.limit(1)
			.maybeSingle();
		const oldestStr =
			(oldestRow as Record<string, string | null> | null)?.[timeColumn] ?? null;
		if (!oldestStr) {
			return {
				source_table: sourceTable,
				dates_archived: [],
				rows_archived: 0,
				bytes_written: 0,
				skipped_reason: 'table is empty'
			};
		}
		nextDate = new Date(oldestStr);
		nextDate.setUTCHours(0, 0, 0, 0);
	}

	if (nextDate.getTime() > cutoffEnd.getTime()) {
		return {
			source_table: sourceTable,
			dates_archived: [],
			rows_archived: 0,
			bytes_written: 0,
			skipped_reason: 'already up to date'
		};
	}

	const datesArchived: string[] = [];
	let totalRows = 0;
	let totalBytes = 0;

	// Iterate one day at a time. Per-day watermark bump means a partial
	// run leaves us resumable.
	while (nextDate.getTime() <= cutoffEnd.getTime()) {
		const dayStart = new Date(nextDate);
		const dayEnd = new Date(nextDate.getTime() + 24 * 60 * 60 * 1000);

		const dayResult = await archiveOneDay({
			admin,
			sourceTable,
			timeColumn,
			dayStart,
			dayEnd,
			appId,
			dryRun
		});

		totalRows += dayResult.rows;
		totalBytes += dayResult.bytes;
		const dateStr = dayStart.toISOString().slice(0, 10);
		datesArchived.push(dateStr);

		// Bump watermark per-day. Crash resumability.
		if (!dryRun) {
			const { error: wmUpdErr } = await admin
				// eslint-disable-next-line @typescript-eslint/no-explicit-any
				.from('archive_watermark' as any)
				.update({
					last_archived_date: dateStr,
					last_run_at: new Date().toISOString(),
					last_run_rows: dayResult.rows,
					last_run_bytes: dayResult.bytes,
					last_run_object_key: dayResult.objectKey,
					last_error_at: null,
					last_error: null
				})
				.eq('app_id', appId)
				.eq('source_table', sourceTable);
			if (wmUpdErr) {
				throw new Error(`watermark bump failed: ${wmUpdErr.message}`);
			}
		}

		nextDate = new Date(dayEnd);
	}

	return {
		source_table: sourceTable,
		dates_archived: datesArchived,
		rows_archived: totalRows,
		bytes_written: totalBytes
	};
}

interface ArchiveDayArgs {
	admin: NonNullable<ReturnType<typeof getAdminClient>>;
	sourceTable: string;
	timeColumn: 'observed_at' | 'processed_at';
	dayStart: Date;
	dayEnd: Date;
	appId: string;
	dryRun: boolean;
}

/**
 * Export one calendar day of one source table to R2.
 *
 * Streams Postgres in 1K-row pages, builds JSONL incrementally, gzips,
 * uploads as one object. Returns row count + final byte count.
 */
async function archiveOneDay(args: ArchiveDayArgs): Promise<{
	rows: number;
	bytes: number;
	objectKey: string;
}> {
	const { admin, sourceTable, timeColumn, dayStart, dayEnd, appId, dryRun } = args;

	const dateStr = dayStart.toISOString().slice(0, 10);
	const objectKey = buildArchiveKey(appId, sourceTable, dayStart);

	// Streaming gzip: build line-buffered JSONL in chunks
	const chunks: string[] = [];
	let totalRows = 0;
	let pageOffset = 0;

	while (true) {
		const { data, error: pageErr } = await admin
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			.from(sourceTable as any)
			.select('*')
			.gte(timeColumn, dayStart.toISOString())
			.lt(timeColumn, dayEnd.toISOString())
			.order(timeColumn, { ascending: true })
			.range(pageOffset, pageOffset + PAGE_SIZE - 1);

		if (pageErr) {
			throw new Error(
				`page read failed (${sourceTable} ${dateStr} offset ${pageOffset}): ${pageErr.message}`
			);
		}
		if (!data || data.length === 0) break;

		// Annotate each row with archive metadata for cross-app forward-compat.
		// These fields make TheVault unification trivially possible later
		// (DuckDB UNION across both apps' archives without column mismatch).
		const rows = data as unknown as Record<string, unknown>[];
		for (const row of rows) {
			const enriched = {
				app_id: appId,
				source_table: sourceTable,
				archive_version: 1,
				...row
			};
			chunks.push(JSON.stringify(enriched));
		}

		totalRows += rows.length;
		if (rows.length < PAGE_SIZE) break;
		pageOffset += PAGE_SIZE;
	}

	if (totalRows === 0) {
		// Empty day — skip R2 write entirely. Return zero-byte result so
		// the watermark can still bump (gap days are common when harvester
		// is paused or starts mid-day).
		return { rows: 0, bytes: 0, objectKey };
	}

	const jsonlBytes = new TextEncoder().encode(chunks.join('\n') + '\n');
	const gzipped = gzipSync(jsonlBytes, { level: 9 });

	if (dryRun) {
		return { rows: totalRows, bytes: gzipped.byteLength, objectKey };
	}

	const { etag, size } = await putObject(
		objectKey,
		gzipped,
		'application/x-ndjson',
		'gzip'
	);

	if (!etag) {
		throw new Error(
			`R2 upload returned empty ETag for ${objectKey} — verify before bumping watermark`
		);
	}

	return { rows: totalRows, bytes: size, objectKey };
}
