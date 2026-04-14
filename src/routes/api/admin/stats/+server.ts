/**
 * GET /api/admin/stats — Aggregated admin dashboard metrics
 *
 * Returns all stats needed for the admin dashboard pulse view,
 * including today's counts, trends, alerts, and system health.
 */

import { json, error } from '@sveltejs/kit';
import { requireAdmin } from '$lib/server/admin-guard';
import { getAdminClient } from '$lib/server/supabase-admin';
import type { SupabaseClient } from '@supabase/supabase-js';
import { env } from '$env/dynamic/private';
import { isEbayConfigured } from '$lib/server/ebay-auth';
import { getRedis } from '$lib/server/redis';
import type { RequestHandler } from './$types';

// Health checks + trend RPC + 16 parallel queries can exceed 10s on cold starts
export const config = { maxDuration: 60 };

const STATS_CACHE_KEY = 'admin:dashboard-stats';
const STATS_CACHE_TTL = 60; // 60 seconds — admin data doesn't change faster than this

function todayStart(): string {
	const d = new Date();
	d.setHours(0, 0, 0, 0);
	return d.toISOString();
}

// daysAgo removed — no longer needed after get_daily_trends RPC

export const GET: RequestHandler = async ({ locals, url }) => {
	await requireAdmin(locals);

	const admin = getAdminClient();
	if (!admin) throw error(503, 'Database not available');

	// Return cached dashboard if available (60s TTL) — skip if ?fresh=true
	const bypassCache = url.searchParams.get('fresh') === 'true';
	if (!bypassCache) {
		const redis = getRedis();
		if (redis) {
			try {
				const cached = await redis.get<string>(STATS_CACHE_KEY);
				if (cached) {
					return json(typeof cached === 'string' ? JSON.parse(cached) : cached);
				}
			} catch (err) {
				console.debug('[admin/stats] Redis cache read failed:', err);
			}
		}
	}

	const today = todayStart();
	// fourteenDaysAgo removed — trend date range now handled inside get_daily_trends RPC
	const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString();

	// Run all queries in parallel
	const [
		usersTotal,
		usersToday,
		usersRecent,
		scansToday,
		scansTotalRes,
		apiLogsToday,
		apiLogsErrors,
		cardsTotal,
		scanFlagsPending,
		recentSignups,
		recentLogs,
		featureFlagsRes,
		healthChecks
	] = await Promise.all([
		// Total users
		admin.from('users').select('id', { count: 'exact', head: true }),
		// Users signed up today
		admin.from('users').select('id', { count: 'exact', head: true })
			.gte('created_at', today),
		// Active users (scanned in last 24h) - use api_call_logs as proxy
		admin.from('api_call_logs').select('user_id', { count: 'exact', head: true })
			.gte('created_at', new Date(Date.now() - 86400000).toISOString())
			.not('user_id', 'is', null),
		// Scans today
		admin.from('api_call_logs').select('id', { count: 'exact', head: true })
			.gte('created_at', today)
			.eq('call_type', 'scan'),
		// Total scans from system_settings
		admin.from('system_settings').select('value').eq('key', 'total_scans').maybeSingle(),
		// API calls today (proxy for AI cost)
		admin.from('api_call_logs').select('id', { count: 'exact', head: true })
			.gte('created_at', today),
		// Errors today
		admin.from('api_call_logs').select('id', { count: 'exact', head: true })
			.gte('created_at', today)
			.eq('success', false),
		// Total cards in DB
		admin.from('system_settings').select('value').eq('key', 'total_cards').maybeSingle(),
		// Pending scan flags
		admin.from('scan_flags').select('id', { count: 'exact', head: true })
			.eq('status', 'pending'),
		// Recent signups (last 10)
		admin.from('users').select('id, email, name, created_at')
			.order('created_at', { ascending: false })
			.limit(10),
		// Recent error logs
		admin.from('api_call_logs').select('id, call_type, error_message, success, created_at')
			.eq('success', false)
			.order('created_at', { ascending: false })
			.limit(10),
		// Feature flags
		admin.from('feature_flags').select('feature_key, enabled_globally').limit(200),
		// System health checks
		checkSystemHealth(admin)
	]);

	// Single RPC call replaces three paginated multi-thousand-row fetches.
	// get_daily_trends returns exactly 14 rows with pre-aggregated counts.
	let scanTrend: number[] = new Array(14).fill(0);
	let signupTrend: number[] = new Array(14).fill(0);
	let errorTrend: number[] = new Array(14).fill(0);

	const { data: trendRows, error: trendErr } = await admin.rpc('get_daily_trends', { p_days: 14 });
	if (!trendErr && trendRows) {
		const rows = trendRows as Array<{ trend_date: string; scan_count: number; signup_count: number; error_count: number }>;
		scanTrend = rows.map(r => Number(r.scan_count));
		signupTrend = rows.map(r => Number(r.signup_count));
		errorTrend = rows.map(r => Number(r.error_count));
	}

	// Calculate AI cost estimate ($0.002 per Tier 3 scan)
	const scansCount = scansToday.count || 0;
	const aiCostToday = scansCount * 0.002;

	// MTD cost
	const { count: scansMTD } = await admin
		.from('api_call_logs')
		.select('id', { count: 'exact', head: true })
		.gte('created_at', monthStart)
		.eq('call_type', 'scan');
	const aiCostMTD = (scansMTD || 0) * 0.002;

	// Build alerts
	const alerts = buildAlerts({
		errorsToday: apiLogsErrors.count || 0,
		scanFlagsPending: scanFlagsPending.count || 0,
		aiCostToday,
		usersToday: usersToday.count || 0,
		scansCount
	});

	// eBay API remaining (from cached log)
	const { data: ebayLog } = await admin
		.from('ebay_api_log')
		.select('calls_remaining, calls_limit, reset_at')
		.order('recorded_at', { ascending: false })
		.limit(1)
		.maybeSingle();

	const responseData = {
		metrics: {
			totalUsers: usersTotal.count || 0,
			usersToday: usersToday.count || 0,
			activeUsers: usersRecent.count || 0,
			scansToday: scansCount,
			totalScans: Number(scansTotalRes.data?.value) || 0,
			totalCards: Number(cardsTotal.data?.value) || 0,
			apiCallsToday: apiLogsToday.count || 0,
			errorsToday: apiLogsErrors.count || 0,
			aiCostToday: Math.round(aiCostToday * 100) / 100,
			aiCostMTD: Math.round(aiCostMTD * 100) / 100,
			scanFlagsPending: scanFlagsPending.count || 0,
			ebayRemaining: ebayLog?.calls_remaining ?? null,
			ebayLimit: ebayLog?.calls_limit ?? null,
			ebayResetAt: ebayLog?.reset_at ?? null
		},
		trends: {
			scans: scanTrend,
			signups: signupTrend,
			errors: errorTrend
		},
		alerts,
		recentSignups: (recentSignups.data || []).map((u) => ({
			email: u.email,
			name: u.name,
			created_at: u.created_at
		})),
		recentErrors: (recentLogs.data || []).map((l) => ({
			call_type: l.call_type,
			error_message: l.error_message,
			created_at: l.created_at
		})),
		featureFlags: (featureFlagsRes.data || []).map((f) => ({
			key: f.feature_key,
			enabled: f.enabled_globally
		})),
		health: healthChecks,
		timestamp: new Date().toISOString()
	};

	// Cache the assembled response in Redis (fire-and-forget, non-blocking)
	const redis = getRedis();
	if (redis) {
		redis.set(STATS_CACHE_KEY, JSON.stringify(responseData), { ex: STATS_CACHE_TTL })
			.catch(err => console.debug('[admin/stats] Redis cache write failed:', err));
	}

	return json(responseData);
};

// buildDailyTrend removed — trend aggregation now handled by get_daily_trends RPC

interface AlertInput {
	errorsToday: number;
	scanFlagsPending: number;
	aiCostToday: number;
	usersToday: number;
	scansCount: number;
}

interface Alert {
	id: string;
	severity: 'info' | 'warning' | 'error';
	title: string;
	description: string;
	action?: string;
}

function buildAlerts(input: AlertInput): Alert[] {
	const alerts: Alert[] = [];

	if (input.scanFlagsPending > 0) {
		alerts.push({
			id: 'scan-flags',
			severity: 'warning',
			title: `Card misID flagged (${input.scanFlagsPending}x)`,
			description: 'Users reported incorrect scan results',
			action: 'review'
		});
	}

	if (input.errorsToday > 10) {
		alerts.push({
			id: 'errors-high',
			severity: 'error',
			title: `High error rate: ${input.errorsToday} errors today`,
			description: 'Error count above normal threshold',
			action: 'view-logs'
		});
	}

	if (input.aiCostToday > 5) {
		alerts.push({
			id: 'cost-spike',
			severity: 'warning',
			title: `AI cost spike: $${input.aiCostToday.toFixed(2)} today`,
			description: 'Above normal daily spending',
			action: 'view-scans'
		});
	}

	if (input.usersToday > 5) {
		alerts.push({
			id: 'signup-spike',
			severity: 'info',
			title: `New user spike: ${input.usersToday} today`,
			description: 'Higher than normal signup rate'
		});
	}

	return alerts;
}

async function checkSystemHealth(
	admin: SupabaseClient
): Promise<Record<string, { status: string; message?: string }>> {
	const checks: Record<string, { status: string; message?: string }> = {};

	// Supabase — run an actual lightweight query through the client library
	// This validates the full path: credentials, network, and database availability
	try {
		const { error: dbError } = await admin
			.from('system_settings')
			.select('key')
			.limit(1)
			.maybeSingle();
		checks.supabase = dbError
			? { status: 'degraded', message: dbError.message }
			: { status: 'ok' };
	} catch {
		checks.supabase = { status: 'down', message: 'Connection failed' };
	}

	// Redis
	const redisUrl = env.UPSTASH_REDIS_REST_URL ?? '';
	const redisToken = env.UPSTASH_REDIS_REST_TOKEN ?? '';
	if (redisUrl && redisToken) {
		try {
			const res = await fetch(`${redisUrl}/ping`, {
				headers: { Authorization: `Bearer ${redisToken}` },
				signal: AbortSignal.timeout(3000)
			});
			checks.redis = res.ok ? { status: 'ok' } : { status: 'degraded' };
		} catch {
			checks.redis = { status: 'down' };
		}
	} else {
		checks.redis = { status: 'degraded', message: 'Not configured' };
	}

	// eBay
	checks.ebay = isEbayConfigured()
		? { status: 'ok' }
		: { status: 'degraded', message: 'Not configured' };

	// Claude
	const claudeKey = env.ANTHROPIC_API_KEY ?? env.CLAUDE_API_KEY ?? '';
	checks.claude = claudeKey
		? { status: 'ok' }
		: { status: 'down', message: 'No API key' };

	return checks;
}
