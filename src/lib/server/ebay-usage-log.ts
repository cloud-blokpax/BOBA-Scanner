/**
 * Audit logging for outbound eBay API calls. Every endpoint that calls
 * api.ebay.com on a user's behalf should record a row here so we can
 * investigate suspected token misuse after the fact.
 *
 * Append-only — see migrations/<NNN>_create_ebay_token_usage_log.sql.
 * Service-role write only.
 */

import { getAdminClient } from '$lib/server/supabase-admin';

export interface EbayUsageEntry {
	userId: string;
	endpoint: string; // e.g. 'sell.inventory.create_offer'
	httpMethod: 'GET' | 'POST' | 'PUT' | 'DELETE';
	httpStatus: number | null;
	success: boolean;
	errorMessage?: string | null;
	requestPath: string; // the Card Scanner API route that triggered the call
	ipAddress?: string | null;
	userAgent?: string | null;
	durationMs?: number | null;
}

export async function logEbayUsage(entry: EbayUsageEntry): Promise<void> {
	const admin = getAdminClient();
	if (!admin) return;
	try {
		await admin.from('ebay_token_usage_log').insert({
			user_id: entry.userId,
			endpoint: entry.endpoint,
			http_method: entry.httpMethod,
			http_status: entry.httpStatus,
			success: entry.success,
			error_message: entry.errorMessage ?? null,
			request_path: entry.requestPath,
			ip_address: entry.ipAddress ?? null,
			user_agent: entry.userAgent?.slice(0, 500) ?? null,
			duration_ms: entry.durationMs ?? null
		});
	} catch (err) {
		// Logging failures must never break the actual API call. Just warn.
		console.warn('[ebay-usage-log] Insert failed:', err instanceof Error ? err.message : err);
	}
}
