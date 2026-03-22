/**
 * GET /api/health — Health check / readiness probe
 *
 * Verifies connectivity to Supabase, Redis, and eBay API configuration.
 * Returns component-level status for monitoring and pre-deployment checks.
 */

import { json } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { env as publicEnv } from '$env/dynamic/public';
import { isEbayConfigured } from '$lib/server/ebay-auth';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async () => {
	const checks: Record<string, { status: 'ok' | 'degraded' | 'down'; message?: string }> = {};

	// Supabase connectivity
	const supabaseUrl = publicEnv.PUBLIC_SUPABASE_URL ?? '';
	const supabaseKey = publicEnv.PUBLIC_SUPABASE_ANON_KEY ?? '';
	if (supabaseUrl && supabaseKey) {
		try {
			const res = await fetch(`${supabaseUrl}/rest/v1/`, {
				headers: { apikey: supabaseKey },
				signal: AbortSignal.timeout(3000)
			});
			checks.supabase = res.ok
				? { status: 'ok' }
				: { status: 'degraded', message: `HTTP ${res.status}` };
		} catch (err) {
			checks.supabase = { status: 'down', message: String(err) };
		}
	} else {
		checks.supabase = { status: 'down', message: 'Not configured' };
	}

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
		checks.redis = { status: 'degraded', message: 'Not configured (using in-memory fallback)' };
	}

	// eBay API
	checks.ebay = isEbayConfigured()
		? { status: 'ok' }
		: { status: 'degraded', message: 'Not configured' };

	// Claude API
	const claudeKey = env.ANTHROPIC_API_KEY ?? env.CLAUDE_API_KEY ?? '';
	checks.claude = claudeKey
		? { status: 'ok' }
		: { status: 'down', message: 'No API key configured' };

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
