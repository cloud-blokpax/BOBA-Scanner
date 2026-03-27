/**
 * POST /api/admin/export — Data export (CSV/JSON)
 *
 * Exports various data sets for admin use.
 */

import { error } from '@sveltejs/kit';
import { requireAdmin } from '$lib/server/admin-guard';
import { getAdminClient } from '$lib/server/supabase-admin';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request, locals }) => {
	await requireAdmin(locals);
	const admin = getAdminClient();
	if (!admin) throw error(503, 'Database not available');

	const { type, format = 'json' } = await request.json();

	let data: Record<string, unknown>[] = [];
	let filename = 'export';

	switch (type) {
		case 'users': {
			const { data: rows } = await admin
				.from('users')
				.select('id, email, name, is_admin, is_pro, is_organizer, scan_count, cards_in_collection, created_at')
				.order('created_at', { ascending: false });
			data = rows || [];
			filename = 'users';
			break;
		}
		case 'scans': {
			const { data: rows } = await admin
				.from('api_call_logs')
				.select('*')
				.eq('call_type', 'scan')
				.order('created_at', { ascending: false })
				.limit(5000);
			data = rows || [];
			filename = 'scans';
			break;
		}
		case 'prices': {
			const { data: rows } = await admin
				.from('price_cache')
				.select('*')
				.order('fetched_at', { ascending: false })
				.limit(5000);
			data = rows || [];
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
