/**
 * Seed card_embeddings from source art.
 *
 * Fetches the image_url for every card matching --game (default: wonders),
 * pipes each image through the DINOv2-base Inference API, and upserts the
 * 768-d L2-normalized vector into public.card_embeddings.
 *
 * Usage:
 *   npm run seed:embeddings              # defaults to --game wonders
 *   npm run seed:embeddings -- --game wonders
 *   npm run seed:embeddings -- --game wonders --resume
 *   npm run seed:embeddings -- --game wonders --limit 50
 *
 * Env:
 *   PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *   HF_INFERENCE_TOKEN
 *
 * HF free tier is rate-limited (~1k req/day); the script paces requests
 * at ~200ms and backs off on 429/503 so a ~1k-card run completes cleanly.
 */

import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';

config();

const SUPABASE_URL = process.env.PUBLIC_SUPABASE_URL || '';
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const HF_TOKEN = process.env.HF_INFERENCE_TOKEN || '';
const HF_ENDPOINT =
	'https://api-inference.huggingface.co/models/facebook/dinov2-base';

if (!SUPABASE_URL || !SERVICE_ROLE) {
	console.error('Missing PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in env');
	process.exit(1);
}
if (!HF_TOKEN) {
	console.error('Missing HF_INFERENCE_TOKEN in env');
	process.exit(1);
}

function argValue(name: string, fallback: string | null = null): string | null {
	const i = process.argv.indexOf(`--${name}`);
	if (i === -1) return fallback;
	const v = process.argv[i + 1];
	return v && !v.startsWith('--') ? v : fallback;
}
function argFlag(name: string): boolean {
	return process.argv.includes(`--${name}`);
}

const game = argValue('game', 'wonders') ?? 'wonders';
const limit = (() => {
	const v = argValue('limit');
	return v ? Math.max(1, parseInt(v, 10)) : null;
})();
const resume = argFlag('resume');

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);

type VectorShape = number[] | number[][] | { feature_vector?: number[] };

function extractVector(result: VectorShape): number[] | null {
	if (Array.isArray(result) && typeof result[0] === 'number') {
		return result as number[];
	}
	if (
		Array.isArray(result) &&
		Array.isArray(result[0]) &&
		typeof (result[0] as number[])[0] === 'number'
	) {
		return (result as number[][])[0];
	}
	if (
		typeof result === 'object' &&
		result !== null &&
		'feature_vector' in result &&
		Array.isArray((result as { feature_vector?: number[] }).feature_vector)
	) {
		return (result as { feature_vector: number[] }).feature_vector;
	}
	return null;
}

async function embedImageUrl(url: string, attempt = 1): Promise<number[]> {
	const imgResp = await fetch(url);
	if (!imgResp.ok) throw new Error(`image fetch ${imgResp.status}`);
	const imgBytes = await imgResp.arrayBuffer();
	const contentType = imgResp.headers.get('content-type') || 'image/webp';

	const hfResp = await fetch(HF_ENDPOINT, {
		method: 'POST',
		headers: { Authorization: `Bearer ${HF_TOKEN}`, 'Content-Type': contentType },
		body: imgBytes
	});

	if (!hfResp.ok) {
		// Cold start / rate limit → back off and retry up to 3 times
		if ((hfResp.status === 503 || hfResp.status === 429) && attempt < 3) {
			const backoff = 2000 * Math.pow(2, attempt - 1);
			console.warn(`  HF ${hfResp.status} — waiting ${backoff}ms before retry ${attempt + 1}`);
			await sleep(backoff);
			return embedImageUrl(url, attempt + 1);
		}
		const text = await hfResp.text().catch(() => '');
		throw new Error(`HF ${hfResp.status}: ${text.slice(0, 200)}`);
	}

	const body = (await hfResp.json()) as VectorShape;
	const vector = extractVector(body);
	if (!vector || vector.length !== 768) {
		throw new Error(`bad embedding shape: len=${vector?.length}`);
	}

	let sumSq = 0;
	for (let i = 0; i < vector.length; i++) sumSq += vector[i] * vector[i];
	const norm = Math.sqrt(sumSq);
	if (norm === 0) throw new Error('zero-norm embedding');
	return vector.map((x) => x / norm);
}

function sleep(ms: number): Promise<void> {
	return new Promise((r) => setTimeout(r, ms));
}

async function main() {
	console.log(`Seeding embeddings for game_id=${game} (resume=${resume}, limit=${limit ?? 'all'})`);

	const { data: cards, error: fetchErr } = await supabase
		.from('cards')
		.select('id, name, image_url')
		.eq('game_id', game)
		.not('image_url', 'is', null);

	if (fetchErr) throw fetchErr;
	if (!cards || cards.length === 0) {
		console.log(`No cards with image_url for game_id=${game}`);
		return;
	}
	console.log(`Found ${cards.length} cards with image_url`);

	let toSeed = cards;
	if (resume) {
		const { data: existing } = await supabase
			.from('card_embeddings')
			.select('card_id')
			.eq('source', 'source_art')
			.eq('model_version', 'dinov2-base-v1');
		const seenIds = new Set((existing ?? []).map((e) => e.card_id));
		toSeed = cards.filter((c) => !seenIds.has(c.id));
		console.log(`--resume: ${seenIds.size} already seeded; ${toSeed.length} remaining`);
	}

	if (limit && toSeed.length > limit) {
		toSeed = toSeed.slice(0, limit);
		console.log(`--limit applied: processing ${toSeed.length}`);
	}

	let success = 0;
	let failed = 0;

	for (let i = 0; i < toSeed.length; i++) {
		const card = toSeed[i];
		const prefix = `  [${i + 1}/${toSeed.length}] ${card.name}`;
		try {
			const embedding = await embedImageUrl(card.image_url!);
			// pgvector accepts the Postgres array literal as a string.
			const literal = `[${embedding.join(',')}]`;
			const { error: insErr } = await supabase.from('card_embeddings').upsert(
				{
					card_id: card.id,
					variant: 'paper',
					embedding: literal,
					source: 'source_art',
					model_version: 'dinov2-base-v1',
					confidence: 1.0
				},
				{ onConflict: 'card_id,variant,source,model_version' }
			);
			if (insErr) throw insErr;
			success++;
			if (i % 25 === 0 || i === toSeed.length - 1) console.log(`${prefix} ✓`);
		} catch (err) {
			failed++;
			console.error(`${prefix} ✗ ${err instanceof Error ? err.message : String(err)}`);
			// Back off a touch on failure so we don't hammer a cold HF instance.
			await sleep(1500);
		}
		// Gentle pace for HF free tier (~5 req/s ceiling).
		await sleep(200);
	}

	console.log(`\nDone. success=${success} failed=${failed}`);
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
