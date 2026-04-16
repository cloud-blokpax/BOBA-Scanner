/**
 * GET/PUT /api/admin/dragon-points — Manage Dragon Points config
 *
 * Schema (run once in Supabase SQL Editor):
 *
 *   CREATE TABLE dragon_points_config (
 *     config_type TEXT NOT NULL,        -- 'base_table', 'class_multiplier', 'year_bonus', 'bonus_card'
 *     key TEXT NOT NULL,                 -- 'mythic_sf', 'stoneseeker', '2026', 'autograph', etc.
 *     value JSONB NOT NULL,              -- {"points": 500} | {"multiplier": 3.0} | {"bonus_pct": 0.35}
 *     description TEXT,
 *     updated_at TIMESTAMPTZ DEFAULT NOW(),
 *     updated_by UUID REFERENCES auth.users(id),
 *     PRIMARY KEY (config_type, key)
 *   );
 *
 *   ALTER TABLE dragon_points_config ENABLE ROW LEVEL SECURITY;
 *
 *   CREATE POLICY "Admins read dragon_points_config"
 *     ON dragon_points_config FOR SELECT
 *     USING (EXISTS (SELECT 1 FROM users WHERE users.auth_user_id = auth.uid() AND users.is_admin = true));
 *
 *   CREATE POLICY "Admins write dragon_points_config"
 *     ON dragon_points_config FOR ALL
 *     USING (EXISTS (SELECT 1 FROM users WHERE users.auth_user_id = auth.uid() AND users.is_admin = true));
 *
 * GET  → returns all config rows so the client can apply them via setDragonPointsConfig().
 * PUT  → upserts a single config row. Body: { config_type, key, value, description? }
 */

import { json, error } from '@sveltejs/kit';
import { requireAdmin } from '$lib/server/admin-guard';
import type { RequestHandler } from './$types';

interface ConfigRow {
	config_type: string;
	key: string;
	value: Record<string, unknown>;
	description: string | null;
	updated_at: string;
}

export const GET: RequestHandler = async ({ locals }) => {
	await requireAdmin(locals);

	if (!locals.supabase) throw error(503, 'Database not available');

	const { data, error: dbErr } = await (locals.supabase as unknown as {
		from: (t: string) => {
			select: (cols: string) => {
				order: (col: string) => Promise<{ data: ConfigRow[] | null; error: { message: string } | null }>;
			};
		};
	})
		.from('dragon_points_config')
		.select('config_type, key, value, description, updated_at')
		.order('config_type');

	if (dbErr) {
		console.error('[admin/dragon-points] read failed:', dbErr.message);
		// Return empty config rather than 500 — the client will fall back to hardcoded
		// defaults via setDragonPointsConfig(null) when the table is missing.
		return json({ config: [] });
	}

	return json({ config: data || [] });
};

export const PUT: RequestHandler = async ({ request, locals }) => {
	await requireAdmin(locals);

	if (!locals.supabase) throw error(503, 'Database not available');

	let body: Record<string, unknown>;
	try {
		body = await request.json();
	} catch {
		throw error(400, 'Invalid JSON');
	}

	const configType = typeof body.config_type === 'string' ? body.config_type : null;
	const key = typeof body.key === 'string' ? body.key : null;
	const value = body.value as Record<string, unknown> | undefined;
	const description = typeof body.description === 'string' ? body.description : null;

	const VALID_TYPES = new Set(['base_table', 'class_multiplier', 'year_bonus', 'bonus_card']);
	if (!configType || !VALID_TYPES.has(configType)) {
		throw error(400, 'config_type must be base_table, class_multiplier, year_bonus, or bonus_card');
	}
	if (!key || key.length === 0 || key.length > 64) {
		throw error(400, 'key must be a non-empty string ≤ 64 chars');
	}
	if (!value || typeof value !== 'object') {
		throw error(400, 'value must be a JSON object');
	}

	const { user } = await locals.safeGetSession();
	const userId = user?.id ?? null;

	const { error: dbErr } = await (locals.supabase as unknown as {
		from: (t: string) => {
			upsert: (row: Record<string, unknown>, opts: { onConflict: string }) => Promise<{ error: { message: string } | null }>;
		};
	})
		.from('dragon_points_config')
		.upsert(
			{
				config_type: configType,
				key,
				value,
				description,
				updated_by: userId,
				updated_at: new Date().toISOString(),
			},
			{ onConflict: 'config_type,key' }
		);

	if (dbErr) {
		console.error('[admin/dragon-points] upsert failed:', dbErr.message);
		throw error(500, 'Failed to save Dragon Points config');
	}

	return json({ success: true });
};

export const DELETE: RequestHandler = async ({ request, locals }) => {
	await requireAdmin(locals);

	if (!locals.supabase) throw error(503, 'Database not available');

	let body: Record<string, unknown>;
	try {
		body = await request.json();
	} catch {
		throw error(400, 'Invalid JSON');
	}

	const configType = typeof body.config_type === 'string' ? body.config_type : null;
	const key = typeof body.key === 'string' ? body.key : null;
	if (!configType || !key) throw error(400, 'config_type and key required');

	const { error: dbErr } = await (locals.supabase as unknown as {
		from: (t: string) => {
			delete: () => {
				eq: (col: string, val: string) => {
					eq: (col: string, val: string) => Promise<{ error: { message: string } | null }>;
				};
			};
		};
	})
		.from('dragon_points_config')
		.delete()
		.eq('config_type', configType)
		.eq('key', key);

	if (dbErr) {
		console.error('[admin/dragon-points] delete failed:', dbErr.message);
		throw error(500, 'Failed to delete Dragon Points config row');
	}

	return json({ success: true });
};
