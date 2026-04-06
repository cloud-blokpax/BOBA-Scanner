/**
 * GET /api/admin/scan-analytics — Scan metrics for admin Scans tab
 *
 * Returns scan counts, success rates, hourly heatmap, 14-day trend,
 * and recent API call logs. Uses service-role client to bypass RLS.
 */

import { json, error } from '@sveltejs/kit';
import { requireAdmin } from '$lib/server/admin-guard';
import { getAdminClient } from '$lib/server/supabase-admin';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals }) => {
	await requireAdmin(locals);

	const admin = getAdminClient();
	if (!admin) throw error(503, 'Database not available');

	const today = new Date();
	today.setHours(0, 0, 0, 0);
	const todayIso = today.toISOString();

	const weekAgo = new Date();
	weekAgo.setDate(weekAgo.getDate() - 7);

	const monthAgo = new Date();
	monthAgo.setDate(monthAgo.getDate() - 30);

	const fourteenDaysAgo = new Date();
	fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 14);

	const [todayRes, weekRes, monthRes, errorsRes, recentRes, todayAllRes] = await Promise.all([
		admin.from('api_call_logs').select('id', { count: 'exact', head: true })
			.gte('created_at', todayIso).eq('call_type', 'scan'),
		admin.from('api_call_logs').select('id', { count: 'exact', head: true })
			.gte('created_at', weekAgo.toISOString()).eq('call_type', 'scan'),
		admin.from('api_call_logs').select('id', { count: 'exact', head: true })
			.gte('created_at', monthAgo.toISOString()).eq('call_type', 'scan'),
		admin.from('api_call_logs').select('id', { count: 'exact', head: true })
			.gte('created_at', todayIso).eq('success', false),
		admin.from('api_call_logs').select('id, user_id, call_type, error_message, success, created_at')
			.order('created_at', { ascending: false })
			.limit(100),
		// Today's scans — paginated in 1k chunks (Supabase caps at 1,000 rows)
		(async () => {
			const CHUNK = 1000;
			const rows: Array<{ created_at: string; success: boolean }> = [];
			let offset = 0;
			let done = false;
			while (!done) {
				const { data } = await admin.from('api_call_logs')
					.select('created_at, success')
					.gte('created_at', todayIso)
					.eq('call_type', 'scan')
					.range(offset, offset + CHUNK - 1);
				if (!data || data.length === 0) { done = true; }
				else {
					rows.push(...(data as Array<{ created_at: string; success: boolean }>));
					offset += CHUNK;
					if (data.length < CHUNK) done = true;
				}
			}
			return { data: rows };
		})()
	]);

	// Build hourly heatmap from today's scans
	const hourlyData = new Array(24).fill(0);
	let successRate = 0;
	if (todayAllRes.data && todayAllRes.data.length > 0) {
		const total = todayAllRes.data.length;
		const successes = todayAllRes.data.filter((s: { success: boolean }) => s.success).length;
		successRate = Math.round((successes / total) * 100);
		for (const scan of todayAllRes.data) {
			const hour = new Date(scan.created_at).getHours();
			hourlyData[hour]++;
		}
	}

	// Build 14-day trend — paginated in 1k chunks
	const trendRows: Array<{ created_at: string }> = [];
	{
		const CHUNK = 1000;
		let offset = 0;
		let done = false;
		while (!done) {
			const { data } = await admin
				.from('api_call_logs')
				.select('created_at')
				.gte('created_at', fourteenDaysAgo.toISOString())
				.eq('call_type', 'scan')
				.order('created_at', { ascending: true })
				.range(offset, offset + CHUNK - 1);
			if (!data || data.length === 0) { done = true; }
			else {
				trendRows.push(...(data as Array<{ created_at: string }>));
				offset += CHUNK;
				if (data.length < CHUNK) done = true;
			}
		}
	}

	const trendData = new Array(14).fill(0);
	if (trendRows) {
		const now = Date.now();
		for (const row of trendRows) {
			const daysAgoIdx = Math.floor((now - new Date(row.created_at).getTime()) / 86400000);
			const idx = 13 - daysAgoIdx;
			if (idx >= 0 && idx < 14) trendData[idx]++;
		}
	}

	return json({
		metrics: {
			totalToday: todayRes.count || 0,
			totalWeek: weekRes.count || 0,
			totalMonth: monthRes.count || 0,
			errorsToday: errorsRes.count || 0,
			successRate
		},
		hourlyData,
		trendData,
		recentScans: recentRes.data || []
	});
};
