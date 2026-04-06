/**
 * POST /api/admin/export — Data export (CSV/JSON)
 *
 * Exports various data sets for admin use.
 */

import { json, error } from '@sveltejs/kit';
import { requireAdmin } from '$lib/server/admin-guard';
import { getAdminClient } from '$lib/server/supabase-admin';
import { parseJsonBody } from '$lib/server/validate';
import { checkMutationRateLimit } from '$lib/server/rate-limit';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request, locals }) => {
	const user = await requireAdmin(locals);

	const rateLimit = await checkMutationRateLimit(user.id);
	if (!rateLimit.success) {
		return json({ error: 'Too many requests' }, { status: 429, headers: { 'X-RateLimit-Limit': String(rateLimit.limit), 'X-RateLimit-Remaining': String(rateLimit.remaining), 'X-RateLimit-Reset': String(rateLimit.reset) } });
	}

	const admin = getAdminClient();
	if (!admin) throw error(503, 'Database not available');

	const body = await parseJsonBody(request);
	const { type, format = 'json' } = body as { type: string; format?: string };

	let data: Record<string, unknown>[] = [];
	let filename = 'export';

	// Supabase/PostgREST caps at 1,000 rows — paginate large tables in chunks
	const CHUNK = 1000;

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	async function fetchAllRows(buildQuery: () => any): Promise<Record<string, unknown>[]> {
		const rows: Record<string, unknown>[] = [];
		let offset = 0;
		let done = false;
		while (!done) {
			const { data } = await buildQuery().range(offset, offset + CHUNK - 1);
			if (!data || data.length === 0) { done = true; }
			else {
				rows.push(...data);
				offset += CHUNK;
				if (data.length < CHUNK) done = true;
			}
		}
		return rows;
	}

	switch (type) {
		case 'users': {
			data = await fetchAllRows(() =>
				admin.from('users')
					.select('id, email, name, is_admin, is_pro, is_organizer, scan_count, cards_in_collection, created_at')
					.order('created_at', { ascending: false })
			);
			filename = 'users';
			break;
		}
		case 'scans': {
			data = await fetchAllRows(() =>
				admin.from('api_call_logs')
					.select('*')
					.eq('call_type', 'scan')
					.order('created_at', { ascending: false })
			);
			filename = 'scans';
			break;
		}
		case 'prices': {
			data = await fetchAllRows(() =>
				admin.from('price_cache')
					.select('*')
					.order('fetched_at', { ascending: false })
			);
			filename = 'prices';
			break;
		}
		case 'changelog': {
			const { data: rows } = await admin
				.from('changelog_entries')
				.select('*')
				.order('created_at', { ascending: false });
			data = rows || [];
			filename = 'changelog';
			break;
		}
		case 'feature-flags': {
			const { data: rows } = await admin
				.from('feature_flags')
				.select('*');
			data = rows || [];
			filename = 'feature-flags';
			break;
		}
		default:
			throw error(400, `Unknown export type: ${type}`);
	}

	if (format === 'csv') {
		if (data.length === 0) {
			return new Response('', {
				headers: {
					'Content-Type': 'text/csv',
					'Content-Disposition': `attachment; filename="${filename}.csv"`
				}
			});
		}
		const headers = Object.keys(data[0]);
		const csvRows = [
			headers.join(','),
			...data.map((row) =>
				headers.map((h) => {
					const val = row[h];
					const str = val === null || val === undefined ? '' : String(val);
					return str.includes(',') || str.includes('"') || str.includes('\n')
						? `"${str.replace(/"/g, '""')}"`
						: str;
				}).join(',')
			)
		];
		return new Response(csvRows.join('\n'), {
			headers: {
				'Content-Type': 'text/csv',
				'Content-Disposition': `attachment; filename="${filename}.csv"`
			}
		});
	}

	return new Response(JSON.stringify(data, null, 2), {
		headers: {
			'Content-Type': 'application/json',
			'Content-Disposition': `attachment; filename="${filename}.json"`
		}
	});
};
