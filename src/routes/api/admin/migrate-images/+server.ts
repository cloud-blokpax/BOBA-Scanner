/**
 * POST /api/admin/migrate-images — Fetch Carde.io images → Supabase Storage
 *
 * Admin-only. All-in-one: fetches card data from Carde.io API, downloads
 * images from GCS, uploads to Supabase Storage, and updates image_url.
 *
 * Each call processes a batch of unique hero+weapon images.
 * Call repeatedly until response shows done:true.
 *
 * Query params:
 *   ?batch=20        Unique images per call (default 20)
 *   ?dryRun=true     Preview without uploading
 */

import { json, error } from '@sveltejs/kit';
import { env as publicEnv } from '$env/dynamic/public';
import { requireAdmin } from '$lib/server/admin-guard';
import { getAdminClient } from '$lib/server/supabase-admin';
import type { RequestHandler } from './$types';

export const config = { maxDuration: 60 };

const STORAGE_BUCKET = 'scans';
const STORAGE_PREFIX = 'card-images';

// ── Carde.io API ─────────────────────────────────────────────────
const GAME_ID = '651f3b0e5f72a5fca3f6fe34';
const API_BASE = 'https://play-api.carde.io/v1/cards';
const PAGE_SIZE = 50;

// ── Carde.io element → weapon_type ───────────────────────────────
const ELEMENT_TO_WEAPON: Record<string, string | null> = {
	'Steel': 'Steel', 'Fire': 'Fire', 'Ice': 'Ice', 'Glow': 'Glow',
	'Hex': 'Hex', 'Gum': 'Gum', 'SUPER': 'Super',
	'ALT': null, 'None': null,
};

interface CardeCard {
	name: string;
	slug: string;
	imageUrl: string;
	cardType: { name: string };
	element: { name: string };
}

interface UniqueImage {
	heroName: string;
	weaponType: string | null;
	imageUrl: string;
	slug: string;
}

// ── Fetch all cards from Carde.io ────────────────────────────────
async function fetchCardeCards(): Promise<CardeCard[]> {
	const all: CardeCard[] = [];
	let page = 1;

	while (true) {
		const url = `${API_BASE}/${GAME_ID}?limit=${PAGE_SIZE}&page=${page}`;
		const res = await fetch(url);
		if (!res.ok) break;

		const data = await res.json();
		if (!data.data || data.data.length === 0) break;

		all.push(...data.data);
		if (page >= data.pagination.totalPages) break;
		page++;
	}

	return all;
}

// ── Extract slug prefix ──────────────────────────────────────────
function getSlugPrefix(slug: string): string {
	const match = slug.match(/^(.*?)(\d+)$/);
	return match ? match[1].replace(/-$/, '') : slug;
}

// Slug prefixes that represent base/paper cards (best image quality)
const PRIORITY_PREFIXES = [
	'alphaedition-sets-basepaper',
	'alphaedition-sets-basebattlefoils',
	'alphaedition-sets-headlines',
	'alphaedition-sets-rad',
	'alphaedition-sets-linoleum',
	'alphaedition-sets-blizzard',
	'alphaedition-sets-invertedbattlefoils',
	'alphaedition-sets-superfoils',
	'alphaedition-sets-bubblegum',
	'alphaedition-autos-only-setorder',
	'alphaedition-dogs-brandi-bopromo',
	'2024-national-show-starter-set',
	'2024-world-champions',
	'sandstorm',
	'sandstorm-auto',
];

// ── Build unique image map from Carde.io data ────────────────────
function buildUniqueImages(cardeCards: CardeCard[]): UniqueImage[] {
	const heroCards = cardeCards.filter(c => c.cardType?.name === 'Hero');
	const imageMap = new Map<string, UniqueImage>();

	// Process in priority order so best images win
	for (const prefix of PRIORITY_PREFIXES) {
		for (const card of heroCards) {
			if (getSlugPrefix(card.slug) !== prefix) continue;
			const weapon = ELEMENT_TO_WEAPON[card.element?.name] ?? null;
			const key = `${card.name.toLowerCase()}|${weapon || 'null'}`;
			if (!imageMap.has(key)) {
				imageMap.set(key, {
					heroName: card.name,
					weaponType: weapon,
					imageUrl: card.imageUrl,
					slug: card.slug,
				});
			}
		}
	}

	// Catch any remaining
	for (const card of heroCards) {
		const weapon = ELEMENT_TO_WEAPON[card.element?.name] ?? null;
		const key = `${card.name.toLowerCase()}|${weapon || 'null'}`;
		if (!imageMap.has(key)) {
			imageMap.set(key, {
				heroName: card.name,
				weaponType: weapon,
				imageUrl: card.imageUrl,
				slug: card.slug,
			});
		}
	}

	return Array.from(imageMap.values());
}

export const POST: RequestHandler = async ({ locals, url }) => {
	await requireAdmin(locals);

	const admin = getAdminClient();
	if (!admin) throw error(503, 'Admin client not configured');

	const batchSize = Math.min(Number(url.searchParams.get('batch')) || 20, 50);
	const dryRun = url.searchParams.get('dryRun') === 'true';
	const supabaseUrl = publicEnv.PUBLIC_SUPABASE_URL || '';

	// 1. Fetch Carde.io data
	const cardeCards = await fetchCardeCards();
	if (cardeCards.length === 0) {
		return json({ error: 'Failed to fetch Carde.io data' }, { status: 502 });
	}

	// 2. Build unique image list
	const allImages = buildUniqueImages(cardeCards);

	// 3. Find which hero+weapon combos still need images
	// Query cards that still have NULL image_url, get distinct hero_name+weapon_type
	const { data: nullCards, error: queryErr } = await admin
		.from('cards')
		.select('hero_name, weapon_type')
		.is('image_url', null)
		.limit(5000);

	if (queryErr) throw error(500, `Query failed: ${queryErr.message}`);

	// Build set of hero+weapon combos that need images
	const needsImage = new Set<string>();
	for (const card of nullCards || []) {
		const key = `${(card.hero_name || '').toLowerCase()}|${card.weapon_type || 'null'}`;
		needsImage.add(key);
	}

	// Filter to only images that match cards needing updates
	const pending = allImages.filter(img => {
		const key = `${img.heroName.toLowerCase()}|${img.weaponType || 'null'}`;
		return needsImage.has(key);
	});

	if (pending.length === 0) {
		// Also try name-only fallback for remaining NULL cards
		const nameOnlyNeeds = new Set<string>();
		for (const card of nullCards || []) {
			nameOnlyNeeds.add((card.hero_name || '').toLowerCase());
		}

		const nameOnlyPending = allImages.filter(img =>
			nameOnlyNeeds.has(img.heroName.toLowerCase())
		);

		if (nameOnlyPending.length === 0) {
			const { count } = await admin
				.from('cards')
				.select('id', { count: 'exact', head: true })
				.is('image_url', null);

			return json({
				done: true,
				processed: 0,
				remaining: count || 0,
				totalCardeImages: allImages.length,
				message: count ? `${count} cards still without images (no Carde.io match)` : 'All cards have images!',
			});
		}

		// Process name-only batch
		const batch = nameOnlyPending.slice(0, batchSize);
		let uploaded = 0, failed = 0;
		const failures: { name: string; error: string }[] = [];

		for (const img of batch) {
			const result = await processImage(img, admin, supabaseUrl, dryRun);
			if (result.success) {
				// Update by hero_name only (fallback)
				if (!dryRun) {
					await admin
						.from('cards')
						.update({ image_url: result.supabaseUrl })
						.ilike('hero_name', img.heroName)
						.is('image_url', null);
				}
				uploaded++;
			} else {
				failed++;
				failures.push({ name: img.heroName, error: result.error || 'unknown' });
			}
		}

		return json({
			done: false, phase: 'name-fallback', processed: batch.length,
			uploaded, failed, remaining: nameOnlyPending.length - uploaded,
			failures: failures.length ? failures : undefined, dryRun,
		});
	}

	// 4. Process batch
	const batch = pending.slice(0, batchSize);
	let uploaded = 0, failed = 0;
	const failures: { name: string; error: string }[] = [];

	for (const img of batch) {
		const result = await processImage(img, admin, supabaseUrl, dryRun);

		if (result.success) {
			// Update all cards matching this hero+weapon
			if (!dryRun) {
				const weaponFilter = img.weaponType
					? admin.from('cards').update({ image_url: result.supabaseUrl })
						.ilike('hero_name', img.heroName)
						.eq('weapon_type', img.weaponType)
						.is('image_url', null)
					: admin.from('cards').update({ image_url: result.supabaseUrl })
						.ilike('hero_name', img.heroName)
						.is('weapon_type', null)
						.is('image_url', null);

				await weaponFilter;
			}
			uploaded++;
		} else {
			failed++;
			failures.push({ name: `${img.heroName} (${img.weaponType})`, error: result.error || 'unknown' });
		}
	}

	return json({
		done: false, phase: 'hero-weapon', processed: batch.length,
		uploaded, failed, remaining: pending.length - uploaded,
		totalNeedImage: needsImage.size, totalCardeImages: allImages.length,
		failures: failures.length ? failures : undefined, dryRun,
	});
};

// ── Download from GCS → Upload to Supabase Storage ───────────────
async function processImage(
	img: UniqueImage,
	admin: ReturnType<typeof getAdminClient>,
	supabaseUrl: string,
	dryRun: boolean,
): Promise<{ success: boolean; supabaseUrl?: string; error?: string }> {
	const storagePath = `${STORAGE_PREFIX}/${img.slug}.webp`;
	const targetUrl = `${supabaseUrl}/storage/v1/object/public/${STORAGE_BUCKET}/${storagePath}`;

	if (dryRun) return { success: true, supabaseUrl: targetUrl };

	try {
		const response = await fetch(img.imageUrl);
		if (!response.ok) {
			return { success: false, error: `GCS ${response.status}` };
		}

		const buffer = Buffer.from(await response.arrayBuffer());

		const { error: uploadErr } = await admin!.storage
			.from(STORAGE_BUCKET)
			.upload(storagePath, buffer, { contentType: 'image/webp', upsert: true });

		if (uploadErr) {
			return { success: false, error: uploadErr.message };
		}

		return { success: true, supabaseUrl: targetUrl };
	} catch (err) {
		return { success: false, error: String(err) };
	}
}
