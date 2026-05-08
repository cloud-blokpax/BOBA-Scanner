/**
 * R2 client helper.
 *
 * Lazy-initialized S3 client pointed at Cloudflare R2. Only imports the
 * AWS SDK on first use, so endpoints that don't archive don't pay the
 * cold-start cost.
 *
 * Required env vars (set in Vercel Production):
 *   R2_ACCOUNT_ID         — Cloudflare account hex id
 *   R2_ACCESS_KEY_ID      — R2 API token access key
 *   R2_SECRET_ACCESS_KEY  — R2 API token secret
 *   R2_BUCKET             — bucket name (default: tcg-archive)
 */

import { env } from '$env/dynamic/private';

export interface R2Config {
	accountId: string;
	accessKeyId: string;
	secretAccessKey: string;
	bucket: string;
	endpoint: string;
}

export function readR2Config(): R2Config | null {
	const accountId = env.R2_ACCOUNT_ID;
	const accessKeyId = env.R2_ACCESS_KEY_ID;
	const secretAccessKey = env.R2_SECRET_ACCESS_KEY;
	const bucket = env.R2_BUCKET ?? 'tcg-archive';

	if (!accountId || !accessKeyId || !secretAccessKey) return null;

	return {
		accountId,
		accessKeyId,
		secretAccessKey,
		bucket,
		endpoint: `https://${accountId}.r2.cloudflarestorage.com`
	};
}

/**
 * Get an S3Client configured for R2. Lazy-imports the SDK.
 * Returns null if env is not configured.
 */
export async function getR2Client() {
	const config = readR2Config();
	if (!config) return null;

	const { S3Client } = await import('@aws-sdk/client-s3');
	const client = new S3Client({
		region: 'auto',
		endpoint: config.endpoint,
		credentials: {
			accessKeyId: config.accessKeyId,
			secretAccessKey: config.secretAccessKey
		}
	});
	return { client, config };
}

/**
 * Sum the size in bytes of all objects in the bucket. Used by the
 * pre-write guard. Paginates 1000 keys per request.
 */
export async function getBucketSizeBytes(): Promise<number> {
	const setup = await getR2Client();
	if (!setup) throw new Error('R2 not configured');

	const { client, config } = setup;
	const { ListObjectsV2Command } = await import('@aws-sdk/client-s3');
	type ListOutput = import('@aws-sdk/client-s3').ListObjectsV2CommandOutput;

	let total = 0;
	let continuationToken: string | undefined = undefined;
	let pages = 0;
	const MAX_PAGES = 100; // 100K keys ceiling — way more than we'll ever have

	do {
		const cmd = new ListObjectsV2Command({
			Bucket: config.bucket,
			ContinuationToken: continuationToken,
			MaxKeys: 1000
		});
		const res = (await client.send(cmd)) as ListOutput;
		for (const obj of res.Contents ?? []) {
			total += obj.Size ?? 0;
		}
		continuationToken = res.IsTruncated ? res.NextContinuationToken : undefined;
		pages++;
	} while (continuationToken && pages < MAX_PAGES);

	return total;
}

/**
 * Upload a Uint8Array body to R2 at the given key. Overwrites if exists.
 * Returns ETag for verification.
 */
export async function putObject(
	key: string,
	body: Uint8Array,
	contentType: string,
	contentEncoding?: string
): Promise<{ etag: string; size: number }> {
	const setup = await getR2Client();
	if (!setup) throw new Error('R2 not configured');

	const { client, config } = setup;
	const { PutObjectCommand } = await import('@aws-sdk/client-s3');
	type PutOutput = import('@aws-sdk/client-s3').PutObjectCommandOutput;

	const cmd = new PutObjectCommand({
		Bucket: config.bucket,
		Key: key,
		Body: body,
		ContentType: contentType,
		ContentEncoding: contentEncoding,
		Metadata: {
			'archived-by': 'card-scanner',
			'archived-at': new Date().toISOString()
		}
	});
	const res = (await client.send(cmd)) as PutOutput;
	return {
		etag: res.ETag?.replace(/"/g, '') ?? '',
		size: body.byteLength
	};
}

/**
 * Object key builder using Hive-partitioned date layout.
 *
 *   tcg-archive/{app}/YYYY/MM/DD/{table}.jsonl.gz
 *
 * DuckDB-compatible (HIVE_PARTITIONING=1 reads year/month/day
 * automatically from the path).
 */
export function buildArchiveKey(
	app: string,
	sourceTable: string,
	date: Date
): string {
	const yyyy = date.getUTCFullYear();
	const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
	const dd = String(date.getUTCDate()).padStart(2, '0');
	return `${app}/${yyyy}/${mm}/${dd}/${sourceTable}.jsonl.gz`;
}
