/**
 * GET /api/health — Health check / readiness probe
 *
 * Returns minimal status for public callers.
 * Detailed component status is only shown to authenticated admin users.
 */

import { json } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { env as publicEnv } from '$env/dynamic/public';
import { isEbayConfigured } from '$lib/server/ebay-auth';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals }) => {
	const { user } = await locals.safeGetSession();

	const checks: Record<string, { status: 'ok' | 'degraded' | 'down'; message?: string }> = {};

	// Supabase connectivity — always checked
	const supabaseUrl = publicEnv.PUBLIC_SUPABASE_URL ?? '';
	const supabaseKey = publicEnv.PUBLIC_SUPABASE_ANON_KEY ?? '';
	if (supabaseUrl && supabaseKey) {
		try {
			const res = await fetch(`${supabaseUrl}/rest/v1/`, {
				headers: { apikey: supabaseKey },
				signal: AbortSignal.timeout(3000)
			});
			checks.supabase = res.ok ? { status: 'ok' } : { status: 'degraded' };
		} catch {
			checks.supabase = { status: 'down' };
		}
	} else {
		checks.supabase = { status: 'down' };
	}

	// Only include detailed diagnostics for admin users
	let isAdmin = false;
	if (user && locals.supabase) {
		const { data: profile } = await locals.supabase
			.from('users')
			.select('is_admin')
			.eq('auth_user_id', user.id)
			.maybeSingle();
		isAdmin = profile?.is_admin === true;
	}

	if (isAdmin) {
		// Redis connectivity
		const redisUrl = env.UPSTASH_REDIS_REST_URL ?? '';
		const redisToken = env.UPSTASH_REDIS_REST_TOKEN ?? '';
		if (redisUrl && redisToken) {
			try {
				const res = await fetch(`${redisUrl}/ping`, {
					headers: { Authorization: `Bearer ${redisToken}` },
					signal: AbortSignal.timeout(3000)
				});
				checks.redis = res.ok
					? { status: 'ok' }
					: { status: 'degraded', message: `HTTP ${res.status}` };
			} catch (err) {
				checks.redis = { status: 'down', message: String(err) };
			}
		} else {
			checks.redis = { status: 'degraded', message: 'Not configured' };
		}

		// eBay API
		checks.ebay = isEbayConfigured()
			? { status: 'ok' }
			: { status: 'degraded', message: 'Not configured' };

		// Claude API
		const claudeKey = env.ANTHROPIC_API_KEY ?? env.CLAUDE_API_KEY ?? '';
		checks.claude = claudeKey
			? { status: 'ok' }
			: { status: 'down', message: 'No API key' };
	}

	const allOk = Object.values(checks).every((c) => c.status === 'ok');
	const anyDown = Object.values(checks).some((c) => c.status === 'down');

	return json(
		{
			status: anyDown ? 'degraded' : allOk ? 'healthy' : 'degraded',
			checks,
			timestamp: new Date().toISOString()
		},
		{
			status: anyDown ? 503 : 200,
			headers: { 'Cache-Control': 'no-store' }
		}
	);
};
