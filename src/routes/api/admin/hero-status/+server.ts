/**
 * Admin API for hero × set status tagging.
 *
 * GET    /api/admin/hero-status?set=Griffey%20Edition
 *   List all heroes for a set with current status. If no set param, returns
 *   distinct sets list instead.
 *
 * PUT    /api/admin/hero-status
 *   Body: { hero_name, set_code, status, notes? }
 *   Upserts with source='manual'. Used to flip a hero's status (most often
 *   Non-Featured → Highlighted).
 *
 * DELETE /api/admin/hero-status
 *   Body: { hero_name, set_code }
 *   Removes the manual row, then re-derives status from catalog so the row
 *   is repopulated with source='derived' immediately. Used to undo a manual
 *   tag without waiting for the next derivation sweep.
 *
 * All routes require admin auth and write via service-role client.
 */

import { json, error } from '@sveltejs/kit';
import { requireAdmin } from '$lib/server/admin-guard';
import { parseJsonBody, requireString } from '$lib/server/validate';
import { getAdminClient } from '$lib/server/supabase-admin';
import { checkMutationRateLimit } from '$lib/server/rate-limit';
import type { RequestHandler } from './$types';

type Status = 'Featured' | 'Highlighted' | 'Non-Featured';
const VALID_STATUSES: Status[] = ['Featured', 'Highlighted', 'Non-Featured'];

interface HeroStatusRow {
	hero_name: string;
	set_code: string;
	status: Status;
	source: 'derived' | 'manual';
	notes: string | null;
	updated_at: string;
	card_count: number;
	has_inspired_ink: boolean;
}

/** GET — list sets, or list heroes for a specific set */
export const GET: RequestHandler = async ({ url, locals }) => {
	await requireAdmin(locals);

	const adminClient = getAdminClient();
	if (!adminClient) throw error(503, 'Admin client not configured');

	const setParam = url.searchParams.get('set');

	// No set param → return list of distinct sets with row counts.
	if (!setParam) {
		const { data, error: dbErr } = await adminClient
			.from('hero_set_status')
			.select('set_code')
			.eq('game_id', 'boba');
		if (dbErr) throw error(500, dbErr.message);

		const counts = new Map<string, number>();
		for (const row of data ?? []) {
			counts.set(row.set_code, (counts.get(row.set_code) ?? 0) + 1);
		}
		const sets = [...counts.entries()]
			.map(([set_code, hero_count]) => ({ set_code, hero_count }))
			.sort((a, b) => a.set_code.localeCompare(b.set_code));

		return json({ sets });
	}

	// With set param → return heroes in that set, joined with catalog metadata.
	// We pull catalog info for context: how many cards the hero has, whether
	// they have Inspired Ink (sanity-check vs derived status).
	const { data: statusRows, error: statusErr } = await adminClient
		.from('hero_set_status')
		.select('hero_name, set_code, status, source, notes, updated_at')
		.eq('game_id', 'boba')
		.eq('set_code', setParam);
	if (statusErr) throw error(500, statusErr.message);

	const { data: catalogRows, error: catalogErr } = await adminClient
		.from('cards')
		.select('hero_name, parallel')
		.eq('game_id', 'boba')
		.eq('set_code', setParam);
	if (catalogErr) throw error(500, catalogErr.message);

	const catalogMeta = new Map<string, { count: number; hasInk: boolean }>();
	for (const c of catalogRows ?? []) {
		if (!c.hero_name) continue;
		const meta = catalogMeta.get(c.hero_name) ?? { count: 0, hasInk: false };
		meta.count += 1;
		if (c.parallel?.toLowerCase().includes('inspired ink')) meta.hasInk = true;
		catalogMeta.set(c.hero_name, meta);
	}

	const heroes: HeroStatusRow[] = (statusRows ?? []).map((r) => {
		const meta = catalogMeta.get(r.hero_name) ?? { count: 0, hasInk: false };
		return {
			hero_name: r.hero_name,
			set_code: r.set_code,
			status: r.status as Status,
			source: r.source as 'derived' | 'manual',
			notes: r.notes,
			updated_at: r.updated_at,
			card_count: meta.count,
			has_inspired_ink: meta.hasInk
		};
	});

	heroes.sort((a, b) => a.hero_name.localeCompare(b.hero_name));

	return json({ set_code: setParam, heroes });
};

/** PUT — update a hero's status (always sets source='manual') */
export const PUT: RequestHandler = async ({ request, locals }) => {
	const user = await requireAdmin(locals);

	const rateLimit = await checkMutationRateLimit(user.id);
	if (!rateLimit.success) {
		return json(
			{ error: 'Too many requests' },
			{
				status: 429,
				headers: {
					'X-RateLimit-Limit': String(rateLimit.limit),
					'X-RateLimit-Remaining': String(rateLimit.remaining),
					'X-RateLimit-Reset': String(rateLimit.reset)
				}
			}
		);
	}

	const body = await parseJsonBody(request);
	const hero_name = requireString(body.hero_name, 'hero_name', 100);
	const set_code = requireString(body.set_code, 'set_code', 60);
	const status = requireString(body.status, 'status', 20) as Status;
	const notes = body.notes ? String(body.notes).slice(0, 500) : null;

	if (!VALID_STATUSES.includes(status)) {
		throw error(400, `Invalid status. Must be one of: ${VALID_STATUSES.join(', ')}`);
	}

	const adminClient = getAdminClient();
	if (!adminClient) throw error(503, 'Admin client not configured');

	const { error: dbErr } = await adminClient
		.from('hero_set_status')
		.upsert(
			{
				game_id: 'boba',
				hero_name,
				set_code,
				status,
				source: 'manual',
				notes,
				updated_at: new Date().toISOString()
			},
			{ onConflict: 'game_id,hero_name,set_code' }
		);
	if (dbErr) throw error(500, dbErr.message);

	return json({ ok: true, hero_name, set_code, status, source: 'manual' });
};

/** DELETE — remove manual override and re-derive from catalog */
export const DELETE: RequestHandler = async ({ request, locals }) => {
	const user = await requireAdmin(locals);

	const rateLimit = await checkMutationRateLimit(user.id);
	if (!rateLimit.success) {
		return json({ error: 'Too many requests' }, { status: 429 });
	}

	const body = await parseJsonBody(request);
	const hero_name = requireString(body.hero_name, 'hero_name', 100);
	const set_code = requireString(body.set_code, 'set_code', 60);

	const adminClient = getAdminClient();
	if (!adminClient) throw error(503, 'Admin client not configured');

	// Re-derive: Featured if Inspired Ink exists in this (hero, set), else
	// Non-Featured. We compute the result here rather than deleting and
	// hoping a cron re-runs derivation.
	const { data: inkRows, error: inkErr } = await adminClient
		.from('cards')
		.select('id')
		.eq('game_id', 'boba')
		.eq('hero_name', hero_name)
		.eq('set_code', set_code)
		.ilike('parallel', '%Inspired Ink%')
		.limit(1);
	if (inkErr) throw error(500, inkErr.message);

	const derivedStatus: Status = (inkRows ?? []).length > 0 ? 'Featured' : 'Non-Featured';

	const { error: upsertErr } = await adminClient
		.from('hero_set_status')
		.upsert(
			{
				game_id: 'boba',
				hero_name,
				set_code,
				status: derivedStatus,
				source: 'derived',
				notes: null,
				updated_at: new Date().toISOString()
			},
			{ onConflict: 'game_id,hero_name,set_code' }
		);
	if (upsertErr) throw error(500, upsertErr.message);

	return json({ ok: true, hero_name, set_code, status: derivedStatus, source: 'derived' });
};
