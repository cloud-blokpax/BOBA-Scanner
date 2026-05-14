/**
 * Migrate card images from Supabase Storage to Cloudflare R2.
 *
 * Source buckets:  card-images, wotf-card-images
 * Destination:     R2 bucket (R2_BUCKET_NAME, default "tcg-archive"),
 *                  preserving the bucket prefix as the key:
 *
 *   card-images/harvested/{uuid}.jpg
 *     -> {R2_PUBLIC_URL}/card-images/harvested/{uuid}.jpg
 *
 *   wotf-card-images/{uuid}.webp
 *     -> {R2_PUBLIC_URL}/wotf-card-images/{uuid}.webp
 *
 * After uploads, rewrites cards.image_url from the Supabase public URL
 * to the equivalent R2 public URL. Idempotent: re-runs skip objects
 * already present in R2 (HEAD check) and a re-rewrite is a no-op
 * because the LIKE filter only matches Supabase-style URLs.
 *
 * Usage: npx tsx scripts/migrate-images-to-r2.ts
 *
 * Required env (see CLAUDE.md):
 *   PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 *   R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY
 *   R2_BUCKET_NAME (optional, default "tcg-archive")
 *   R2_PUBLIC_URL  (optional, default per Vercel config)
 */

import { createClient } from '@supabase/supabase-js';
import { S3Client, PutObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { config } from 'dotenv';

config();

const SUPABASE_URL = process.env.PUBLIC_SUPABASE_URL || '';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const R2_ACCOUNT_ID = process.env.R2_ACCOUNT_ID || '';
const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID || '';
const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY || '';
const R2_BUCKET = process.env.R2_BUCKET_NAME || 'tcg-archive';
const R2_PUBLIC_URL =
	process.env.R2_PUBLIC_URL || 'https://pub-78685ab603724112b3087e75342d59b9.r2.dev';

for (const [name, value] of Object.entries({
	PUBLIC_SUPABASE_URL: SUPABASE_URL,
	SUPABASE_SERVICE_ROLE_KEY: SUPABASE_KEY,
	R2_ACCOUNT_ID,
	R2_ACCESS_KEY_ID,
	R2_SECRET_ACCESS_KEY
})) {
	if (!value) {
		console.error(`Missing required env var: ${name}`);
		process.exit(1);
	}
}

const SOURCE_URL_PREFIX = `${SUPABASE_URL.replace(/\/+$/, '')}/storage/v1/object/public/`;

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const r2 = new S3Client({
	region: 'auto',
	endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
	credentials: {
		accessKeyId: R2_ACCESS_KEY_ID,
		secretAccessKey: R2_SECRET_ACCESS_KEY
	}
});

interface MigrationStats {
	totalFiles: number;
	uploaded: number;
	skipped: number;
	failed: number;
	updatedRows: number;
}

const BATCH_SIZE = 50;
const DB_PAGE_SIZE = 500;

async function checkR2FileExists(key: string): Promise<boolean> {
	try {
		await r2.send(new HeadObjectCommand({ Bucket: R2_BUCKET, Key: key }));
		return true;
	} catch {
		return false;
	}
}

async function uploadToR2(
	sourceBucket: string,
	sourcePath: string,
	r2Key: string
): Promise<boolean> {
	try {
		const { data, error } = await supabase.storage.from(sourceBucket).download(sourcePath);
		if (error) throw error;

		const buffer = await data.arrayBuffer();
		await r2.send(
			new PutObjectCommand({
				Bucket: R2_BUCKET,
				Key: r2Key,
				Body: Buffer.from(buffer),
				ContentType: data.type
			})
		);
		return true;
	} catch (error) {
		console.error(`Failed to upload ${r2Key}:`, error);
		return false;
	}
}

async function listAllFiles(bucket: string, path = ''): Promise<string[]> {
	const { data: items, error } = await supabase.storage
		.from(bucket)
		.list(path, { limit: 10000, sortBy: { column: 'name', order: 'asc' } });

	if (error) {
		console.error(`Error listing ${bucket}/${path}:`, error);
		return [];
	}
	if (!items) return [];

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
}

async function migrateBucket(bucketName: string, stats: MigrationStats): Promise<void> {
	console.log(`\n📦 Migrating bucket: ${bucketName}`);

	const allFiles = await listAllFiles(bucketName);
	console.log(`Found ${allFiles.length} files in ${bucketName}`);
	stats.totalFiles += allFiles.length;

	for (let i = 0; i < allFiles.length; i += BATCH_SIZE) {
		const batch = allFiles.slice(i, i + BATCH_SIZE);

		await Promise.all(
			batch.map(async (filePath) => {
				const r2Key = `${bucketName}/${filePath}`;

				if (await checkR2FileExists(r2Key)) {
					stats.skipped++;
					return;
				}

				const success = await uploadToR2(bucketName, filePath, r2Key);
				if (success) {
					stats.uploaded++;
					if (stats.uploaded % 100 === 0) {
						console.log(`Progress: ${stats.uploaded}/${allFiles.length} uploaded`);
					}
				} else {
					stats.failed++;
				}
			})
		);
	}

	console.log(
		`✅ Completed ${bucketName}: ${stats.uploaded} uploaded, ${stats.skipped} skipped, ${stats.failed} failed`
	);
}

async function updateDatabaseUrls(): Promise<number> {
	console.log('\n🔄 Updating database URLs...');

	let totalUpdated = 0;
	const r2Base = R2_PUBLIC_URL.replace(/\/+$/, '');

	// Page through every card with a Supabase-public image URL and rewrite it.
	// The LIKE filter naturally excludes rows already pointing at R2 or eBay,
	// so reruns are no-ops.
	while (true) {
		const { data, error } = await supabase
			.from('cards')
			.select('id, image_url')
			.like('image_url', `${SOURCE_URL_PREFIX}%`)
			.limit(DB_PAGE_SIZE);

		if (error) {
			console.error('Error fetching cards to rewrite:', error);
			break;
		}
		if (!data || data.length === 0) break;

		for (const row of data) {
			const oldUrl = row.image_url as string;
			const newUrl = oldUrl.replace(SOURCE_URL_PREFIX, `${r2Base}/`);
			const { error: updateError } = await supabase
				.from('cards')
				.update({ image_url: newUrl })
				.eq('id', row.id);

			if (updateError) {
				console.error(`Failed to update card ${row.id}:`, updateError);
			} else {
				totalUpdated++;
			}
		}

		console.log(`Progress: ${totalUpdated} rows rewritten`);

		// Defensive: if the page came back full but nothing was updated, the
		// filter would loop forever. Break out so we don't spin.
		if (data.length < DB_PAGE_SIZE) break;
	}

	console.log(`✅ Updated ${totalUpdated} database rows`);
	return totalUpdated;
}

async function verifyMigration(): Promise<boolean> {
	console.log('\n🔍 Verifying migration...');

	const r2Base = R2_PUBLIC_URL.replace(/\/+$/, '');
	const { data: sampleCards } = await supabase
		.from('cards')
		.select('id, image_url')
		.like('image_url', `${r2Base}/%`)
		.limit(10);

	if (!sampleCards || sampleCards.length === 0) {
		console.error('❌ Could not fetch sample cards with R2 URLs');
		return false;
	}

	let verified = 0;
	for (const card of sampleCards) {
		try {
			const response = await fetch(card.image_url as string, { method: 'HEAD' });
			if (response.ok) {
				verified++;
			} else {
				console.error(`❌ Failed to fetch (${response.status}): ${card.image_url}`);
			}
		} catch (error) {
			console.error(`❌ Error fetching ${card.image_url}:`, error);
		}
	}

	const success = verified === sampleCards.length;
	console.log(`${success ? '✅' : '❌'} Verified ${verified}/${sampleCards.length} sample images`);
	return success;
}

async function main() {
	console.log('🚀 Starting R2 Image Migration\n');
	console.log(`From: ${SOURCE_URL_PREFIX}`);
	console.log(`To:   ${R2_PUBLIC_URL}`);
	console.log(`R2 bucket: ${R2_BUCKET}\n`);

	const stats: MigrationStats = {
		totalFiles: 0,
		uploaded: 0,
		skipped: 0,
		failed: 0,
		updatedRows: 0
	};

	try {
		await migrateBucket('card-images', stats);
		await migrateBucket('wotf-card-images', stats);

		stats.updatedRows = await updateDatabaseUrls();
		const verified = await verifyMigration();

		console.log('\n📊 Migration Summary:');
		console.log(`Total files: ${stats.totalFiles}`);
		console.log(`Uploaded: ${stats.uploaded}`);
		console.log(`Skipped (already exists): ${stats.skipped}`);
		console.log(`Failed: ${stats.failed}`);
		console.log(`Database rows updated: ${stats.updatedRows}`);
		console.log(`Verification: ${verified ? 'PASSED' : 'FAILED'}`);

		if (verified && stats.failed === 0) {
			console.log('\n✅ Migration completed successfully!');
			console.log(
				'\n⚠️  NEXT STEP: Manually delete Supabase storage buckets after confirming app works'
			);
		} else {
			console.log('\n❌ Migration completed with errors - DO NOT delete Supabase storage yet');
			process.exitCode = 1;
		}
	} catch (error) {
		console.error('\n❌ Migration failed:', error);
		process.exit(1);
	}
}

main();
