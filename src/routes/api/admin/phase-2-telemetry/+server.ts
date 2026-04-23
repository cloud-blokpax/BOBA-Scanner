/**
 * GET /api/admin/phase-2-telemetry — Phase 2 pipeline observability
 *
 * Aggregates the queries in docs/phase-2-telemetry.md into a single
 * JSON payload for the AdminPhase2Tab component. Supports a window
 * parameter ('24h' | '7d' | '30d'); caches per-window for 60s via Redis.
 *
 * The window string is mapped to a fixed SQL literal; no user-controlled
 * SQL reaches the database.
 */

import { json, error } from '@sveltejs/kit';
import { requireAdmin } from '$lib/server/admin-guard';
import { getAdminClient } from '$lib/server/supabase-admin';
import { getRedis } from '$lib/server/redis';
import type { RequestHandler } from './$types';

// Parallel query block can exceed 10s on cold start if Supabase is warming up.
export const config = { maxDuration: 30 };

const CACHE_TTL_SECONDS = 60;

type Window = '24h' | '7d' | '30d';
const WINDOW_INTERVAL: Record<Window, string> = {
	'24h': '24 hours',
	'7d': '7 days',
	'30d': '30 days'
};

function parseWindow(raw: string | null): Window {
	if (raw === '24h' || raw === '7d' || raw === '30d') return raw;
	return '7d';
}

interface TierRow { tier: string; n: number; pct: number }
interface SliceRow { game_id: string; capture_source: string; tier: string; n: number }
interface AgreementRow { game_id: string; n_live_reached: number; n_agreed: number; agreed_pct: number | null }
interface BinderRow { n_binder_cells: number; n_haiku: number; n_tier1: number; haiku_pct: number | null }
interface OverrideRow { tier: string; n: number; n_overridden: number; override_pct: number | null }
interface CostRow { tier: string; n: number; total_usd: number; avg_per_scan_usd: number }
interface LatencyRow { tier: string; n: number; p50_ms: number | null; p95_ms: number | null; p99_ms: number | null }
interface QualityFailRow { reason: string; n: number }
interface OutcomeRow { outcome: string; n: number }
interface RecentOverride {
	created_at: string;
	winning_tier: string | null;
	game_id: string | null;
	capture_source: string | null;
	originally_matched: string | null;
	corrected_to: string | null;
	final_confidence: number | null;
}

export interface Phase2TelemetryPayload {
	window: Window;
	timestamp: string;
	pipelineMix: TierRow[];
	sliceByGameAndSource: SliceRow[];
	ocrRegionAgreement: AgreementRow[];
	binderCellFallback: BinderRow;
	overrideRateByTier: OverrideRow[];
	costByTier: CostRow[];
	latencyByTier: LatencyRow[];
	qualityGateFails: QualityFailRow[];
	outcomeDistribution: OutcomeRow[];
	recentOverrides: RecentOverride[];
}

export const GET: RequestHandler = async ({ locals, url }) => {
	await requireAdmin(locals);

	const window = parseWindow(url.searchParams.get('window'));
	const windowInterval = WINDOW_INTERVAL[window];

	const cacheKey = `admin:phase-2-telemetry:${window}`;
	const bypassCache = url.searchParams.get('fresh') === 'true';

	if (!bypassCache) {
		const redis = getRedis();
		if (redis) {
			try {
				const cached = await redis.get<string>(cacheKey);
				if (cached) {
					return json(typeof cached === 'string' ? JSON.parse(cached) : cached);
				}
			} catch (err) {
				console.debug('[admin/phase-2-telemetry] cache read failed:', err);
			}
		}
	}

	const admin = getAdminClient();
	if (!admin) throw error(503, 'Database not available');

	// Single aggregate RPC returns all ten sections as one jsonb payload.
	// If the RPC is absent (fresh env), respond with graceful empty-state
	// JSON so the tab renders "no signal yet" rather than erroring.
	const { data, error: rpcError } = await admin.rpc('phase_2_telemetry', {
		window_interval: windowInterval
	});

	if (rpcError) {
		console.warn('[admin/phase-2-telemetry] RPC error, returning empty payload:', rpcError.message);
		const empty: Phase2TelemetryPayload = {
			window,
			timestamp: new Date().toISOString(),
			pipelineMix: [],
			sliceByGameAndSource: [],
			ocrRegionAgreement: [],
			binderCellFallback: { n_binder_cells: 0, n_haiku: 0, n_tier1: 0, haiku_pct: null },
			overrideRateByTier: [],
			costByTier: [],
			latencyByTier: [],
			qualityGateFails: [],
			outcomeDistribution: [],
			recentOverrides: []
		};
		return json(empty);
	}

	const payload: Phase2TelemetryPayload = {
		window,
		timestamp: new Date().toISOString(),
		...(data as Omit<Phase2TelemetryPayload, 'window' | 'timestamp'>)
	};

	const redis = getRedis();
	if (redis) {
		try {
			await redis.set(cacheKey, JSON.stringify(payload), { ex: CACHE_TTL_SECONDS });
		} catch (err) {
			console.debug('[admin/phase-2-telemetry] cache write failed:', err);
		}
	}

	return json(payload);
};
