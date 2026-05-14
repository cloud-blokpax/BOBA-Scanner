/**
 * GET /api/admin/migrate-images-to-r2 — ONE-TIME migration endpoint.
 *
 * Mirrors scripts/migrate-images-to-r2.ts so the migration can run from
 * Vercel's environment (Supabase service role + R2 creds are already set
 * in Production env vars). Triggered manually with the CRON_SECRET bearer.
 *
 * What it does:
 *   1. Lists every object in Supabase Storage buckets `card-images` and
 *      `wotf-card-images` recursively.
 *   2. For each object missing from R2, downloads from Supabase and PUTs
 *      to R2 under `{bucket-name}/{path}` (preserves the bucket prefix
 *      as the key, matching the script).
 *   3. Rewrites `cards.image_url` from the Supabase public URL to the
 *      equivalent R2 public URL. LIKE filter naturally excludes rows
 *      already on R2/eBay, so reruns are no-ops.
 *   4. HEAD-verifies a 10-row sample of rewritten URLs.
 *
 * Idempotent: re-runs skip objects already present in R2 and skip rows
 * already pointing at R2. Safe to call multiple times if the function
 * times out mid-flight — next call resumes.
 *
 * Auth: `Authorization: Bearer ${CRON_SECRET}`. No query-string fallback —
 * the secret would leak into Vercel access logs.
 *
 * Trigger from a shell:
 *   curl -H "Authorization: Bearer $CRON_SECRET" \
 *     https://boba.cards/api/admin/migrate-images-to-r2
 *
 * TODO: delete this endpoint after a successful migration is confirmed.
 */

import { json, error } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { env as publicEnv } from '$env/dynamic/public';
import { PutObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { getAdminClient } from '$lib/server/supabase-admin';
import { getR2Client } from '$lib/server/r2-client';
import { logEvent } from '$lib/server/diagnostics';
import type { RequestHandler } from './$types';

export const config = { maxDuration: 300 }; // 5 min — Vercel function ceiling

const BATCH_SIZE = 50;
const DB_PAGE_SIZE = 500;
const VERIFY_SAMPLE_SIZE = 10;

interface MigrationStats {
	totalFiles: number;
	uploaded: number;
	skipped: number;
	failed: number;
	updatedRows: number;
}

export const GET: RequestHandler = async ({ request }) => {
	const auth = request.headers.get('authorization');
	const cronSecret = env.CRON_SECRET;
	if (!cronSecret || auth !== `Bearer ${cronSecret}`) {
		throw error(401, 'unauthorized');
	}

	const supabase = getAdminClient();
	if (!supabase) throw error(500, 'supabase admin client unavailable');

	const r2Setup = await getR2Client();
	if (!r2Setup) throw error(500, 'r2 not configured');
	const { client: r2, config: r2Config } = r2Setup;

	const supabaseUrl = publicEnv.PUBLIC_SUPABASE_URL;
	if (!supabaseUrl) throw error(500, 'PUBLIC_SUPABASE_URL missing');

	const sourceUrlPrefix = `${supabaseUrl.replace(/\/+$/, '')}/storage/v1/object/public/`;
	const r2PublicUrl = (
		(env.R2_PUBLIC_URL as string | undefined) ??
		'https://pub-78685ab603724112b3087e75342d59b9.r2.dev'
	).replace(/\/+$/, '');

	const stats: MigrationStats = {
		totalFiles: 0,
		uploaded: 0,
		skipped: 0,
		failed: 0,
		updatedRows: 0
	};

	const startedAt = Date.now();
	const timeBudgetMs = 290_000; // leave a few seconds for the JSON response

	const timeUp = () => Date.now() - startedAt > timeBudgetMs;

	const checkR2FileExists = async (key: string): Promise<boolean> => {
		try {
			await r2.send(new HeadObjectCommand({ Bucket: r2Config.bucket, Key: key }));
			return true;
		} catch {
			return false;
		}
	};

	const uploadOne = async (
		sourceBucket: string,
		sourcePath: string,
		r2Key: string
	): Promise<boolean> => {
		try {
			const { data, error: dlError } = await supabase.storage
				.from(sourceBucket)
				.download(sourcePath);
			if (dlError) throw dlError;

			const buffer = await data.arrayBuffer();
			await r2.send(
				new PutObjectCommand({
					Bucket: r2Config.bucket,
					Key: r2Key,
					Body: Buffer.from(buffer),
					ContentType: data.type
				})
			);
			return true;
		} catch (err) {
			await logEvent({
				level: 'error',
				event: 'migrate_images_to_r2.upload_failed',
				error: err,
				context: { r2Key }
			});
			return false;
		}
	};

	const listAllFiles = async (bucket: string, path = ''): Promise<string[]> => {
		const { data: items, error: listError } = await supabase.storage
			.from(bucket)
			.list(path, { limit: 10000, sortBy: { column: 'name', order: 'asc' } });

		if (listError || !items) return [];

		const allFiles: string[] = [];
		for (const item of items) {
			const itemPath = path ? `${path}/${item.name}` : item.name;
			// Supabase returns folder entries with id === null
			if (item.id === null) {
				const subFiles = await listAllFiles(bucket, itemPath);
				allFiles.push(...subFiles);
			} else {
				allFiles.push(itemPath);
			}
		}
		return allFiles;
	};

	const migrateBucket = async (bucketName: string): Promise<void> => {
		const allFiles = await listAllFiles(bucketName);
		stats.totalFiles += allFiles.length;

		for (let i = 0; i < allFiles.length; i += BATCH_SIZE) {
			if (timeUp()) return;
			const batch = allFiles.slice(i, i + BATCH_SIZE);
			await Promise.all(
				batch.map(async (filePath) => {
					const r2Key = `${bucketName}/${filePath}`;
					if (await checkR2FileExists(r2Key)) {
						stats.skipped++;
						return;
					}
					const ok = await uploadOne(bucketName, filePath, r2Key);
					if (ok) stats.uploaded++;
					else stats.failed++;
				})
			);
		}
	};

	const updateDatabaseUrls = async (): Promise<number> => {
		let totalUpdated = 0;
		while (true) {
			if (timeUp()) break;
			const { data, error: fetchError } = await supabase
				.from('cards')
				.select('id, image_url')
				.like('image_url', `${sourceUrlPrefix}%`)
				.limit(DB_PAGE_SIZE);

			if (fetchError) break;
			if (!data || data.length === 0) break;

			for (const row of data) {
				const oldUrl = row.image_url as string;
				const newUrl = oldUrl.replace(sourceUrlPrefix, `${r2PublicUrl}/`);
				const { error: updateError } = await supabase
					.from('cards')
					.update({ image_url: newUrl })
					.eq('id', row.id);
				if (!updateError) totalUpdated++;
			}

			// Defensive: if the page came back full but nothing was updated, the
			// filter would loop forever. Break out so we don't spin.
			if (data.length < DB_PAGE_SIZE) break;
		}
		return totalUpdated;
	};

	const verifyMigration = async (): Promise<{ verified: number; sample: number }> => {
		const { data: sampleCards } = await supabase
			.from('cards')
			.select('id, image_url')
			.like('image_url', `${r2PublicUrl}/%`)
			.limit(VERIFY_SAMPLE_SIZE);

		if (!sampleCards || sampleCards.length === 0) return { verified: 0, sample: 0 };

		let verified = 0;
		for (const card of sampleCards) {
			try {
				const response = await fetch(card.image_url as string, { method: 'HEAD' });
				if (response.ok) verified++;
			} catch {
				// swallow — counted as not-verified
			}
		}
		return { verified, sample: sampleCards.length };
	};

	try {
		await migrateBucket('card-images');
		if (!timeUp()) await migrateBucket('wotf-card-images');
		if (!timeUp()) stats.updatedRows = await updateDatabaseUrls();
		const verification = timeUp() ? { verified: 0, sample: 0 } : await verifyMigration();

		const success = stats.failed === 0 && !timeUp();
		const truncated = timeUp();

		return json({
			success,
			truncated,
			elapsed_ms: Date.now() - startedAt,
			from: sourceUrlPrefix,
			to: `${r2PublicUrl}/`,
			r2_bucket: r2Config.bucket,
			stats,
			verification,
			next_step: success
				? 'Manually delete Supabase storage buckets after confirming app works.'
				: truncated
					? 'Function hit the 5-min ceiling. Re-run — idempotent skip-on-existing will resume.'
					: 'Some uploads failed. Check diagnostics (app_events) before deleting Supabase storage.'
		});
	} catch (err) {
		await logEvent({
			level: 'error',
			event: 'migrate_images_to_r2.fatal',
			error: err,
			context: { stats }
		});
		throw error(500, err instanceof Error ? err.message : 'migration failed');
	}
};
