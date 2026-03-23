/**
 * Validated environment variables.
 *
 * Fails fast at import time if required variables are missing.
 * Import this module instead of reading from $env/dynamic/private directly.
 */

import { env } from '$env/dynamic/private';
import { env as publicEnv } from '$env/dynamic/public';

function required(value: string | undefined, name: string): string {
	if (!value || value.trim() === '') {
		throw new Error(
			`Missing required environment variable: ${name}. ` +
			`Add it to your .env.local file or Vercel Environment Variables.`
		);
	}
	return value;
}

function optional(value: string | undefined): string | null {
	return value?.trim() || null;
}

/**
 * Server-side environment variables.
 * Required variables throw on import if missing.
 * Optional variables return null when absent.
 */
export const SERVER_ENV = {
	supabaseUrl: required(publicEnv.PUBLIC_SUPABASE_URL, 'PUBLIC_SUPABASE_URL'),
	supabaseAnonKey: required(publicEnv.PUBLIC_SUPABASE_ANON_KEY, 'PUBLIC_SUPABASE_ANON_KEY'),
	anthropicApiKey: required(env.ANTHROPIC_API_KEY ?? env.CLAUDE_API_KEY, 'ANTHROPIC_API_KEY'),

	ebayClientId: optional(env.EBAY_CLIENT_ID),
	ebayClientSecret: optional(env.EBAY_CLIENT_SECRET),
	ebayRuName: optional(env.EBAY_RUNAME),
	redisUrl: optional(env.UPSTASH_REDIS_REST_URL),
	redisToken: optional(env.UPSTASH_REDIS_REST_TOKEN),

	get isEbayConfigured() { return !!(this.ebayClientId && this.ebayClientSecret); },
	get isRedisConfigured() { return !!(this.redisUrl && this.redisToken); },
} as const;
