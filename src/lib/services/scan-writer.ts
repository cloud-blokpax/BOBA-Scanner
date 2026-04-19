/**
 * Scan history writer — the SOLE module authorized to persist scan data
 * to Supabase.
 *
 * Every shutter-press produces one scan_sessions row (shared across all
 * scans within a camera-mount), one scans row, and N scan_tier_results
 * rows (one per tier attempt).
 *
 * No other module in the codebase writes to the scan_* tables. If you
 * find yourself wanting a direct INSERT, add a function here instead.
 *
 * All four exported functions swallow errors and return null/void on
 * failure. Persistence must never break a user's scan — the scan
 * completing is worth more than any single telemetry row.
 *
 * Uses the authenticated user's Supabase client (not service_role), so
 * the RLS policies shipped in Phase 0.1 enforce ownership and shape.
 *
 * Database types (src/lib/types/database.ts) still reflect the pre-0.1
 * scans shape and don't include scan_sessions / scan_tier_results. Until
 * Session 0.5 regenerates them, this file uses a narrow untyped client
 * facade (`untyped()`) to bypass the stale typings. The runtime payloads
 * match the new 0.1 schema; only the compile-time types lag.
 */

import { getSupabase } from '$lib/services/supabase';
import { PIPELINE_VERSION } from '$lib/services/pipeline-version';
import { userId } from '$lib/stores/auth.svelte';

// ---------- Public input types ----------

export interface OpenSessionInput {
	gameId?: string;                 // defaults to 'boba'
	deviceModel?: string;
	osName?: string;
	osVersion?: string;
	browserName?: string;
	browserVersion?: string;
	appVersion?: string;
	viewportWidth?: number;
	viewportHeight?: number;
	deviceMemoryGb?: number;
	networkType?: string;
	capabilities?: Record<string, unknown>;
	extras?: Record<string, unknown>;
}

export interface RecordScanInput {
	sessionId: string;
	gameId?: string;
	photoStoragePath?: string | null;
	photoThumbnailPath?: string | null;
	photoBytes?: number | null;
	photoWidth?: number | null;
	photoHeight?: number | null;
	parentScanId?: string | null;
	retakeChainIdx?: number;
	captureContext?: Record<string, unknown>;
	qualitySignals?: Record<string, unknown>;
	captureLatencyMs?: number | null;
	extras?: Record<string, unknown>;
}

export type ScanTier = 'tier1_hash' | 'tier1_embedding' | 'tier2_ocr' | 'tier3_claude';
export type ScanEngine =
	| 'phash' | 'dhash' | 'multicrop_hash'
	| 'mobileclip_v1' | 'dinov2_s14'
	| 'paddleocr_pp_v5' | 'tesseract_v5'
	| 'claude_haiku' | 'claude_sonnet';

export interface RecordTierResultInput {
	scanId: string;
	tier: ScanTier;
	engine: ScanEngine;
	engineVersion: string;
	rawOutput: Record<string, unknown>;
	latencyMs?: number | null;
	costUsd?: number | null;
	errored?: boolean;
	errorMessage?: string | null;
	extras?: Record<string, unknown>;
}

// ---------- Untyped client facade ----------

/**
 * Minimal shape for the tables this writer touches. Removed in Session 0.5
 * when database.ts is regenerated against the current Supabase schema.
 */
interface UntypedBuilder {
	insert(row: Record<string, unknown>): {
		select(cols: string): {
			single(): Promise<{ data: { id: string } | null; error: { message: string } | null }>;
		};
	} & Promise<{ error: { message: string } | null }>;
	update(updates: Record<string, unknown>): {
		eq(column: string, value: string): Promise<{ error: { message: string } | null }>;
	};
}

interface UntypedClient {
	from(table: string): UntypedBuilder;
}

function untyped(): UntypedClient | null {
	const client = getSupabase();
	return client as unknown as UntypedClient | null;
}

// ---------- Module-level session cache ----------

let _activeSessionId: string | null = null;
let _activeSessionOpenedAt = 0;
const SESSION_MAX_AGE_MS = 30 * 60 * 1000; // 30 minutes

/** Reset the cached session. Call on logout or scan-page unmount. */
export function resetActiveSession(): void {
	_activeSessionId = null;
	_activeSessionOpenedAt = 0;
}

// ---------- Helpers ----------

function logFailure(where: string, err: unknown, ctx: Record<string, unknown> = {}): void {
	const message = err instanceof Error ? err.message
		: typeof err === 'object' && err !== null && 'message' in err ? String((err as { message: unknown }).message)
		: String(err);
	console.debug(`[scan-writer] ${where} failed`, { ...ctx, error: message });
}

/**
 * Collect what the browser tells us about the device/session. Safe on SSR
 * (all guarded by typeof window checks).
 */
function collectBrowserCapabilities(): OpenSessionInput {
	if (typeof window === 'undefined') return {};
	const nav = window.navigator;
	// Network Information API — non-standard, present in Chrome/Edge
	const connection = (nav as unknown as {
		connection?: { effectiveType?: string };
	}).connection;
	return {
		browserName: inferBrowserName(nav.userAgent),
		osName: inferOsName(nav.userAgent),
		viewportWidth: window.innerWidth,
		viewportHeight: window.innerHeight,
		deviceMemoryGb: (nav as unknown as { deviceMemory?: number }).deviceMemory,
		networkType: connection?.effectiveType,
		capabilities: {
			hasServiceWorker: 'serviceWorker' in nav,
			hasWebGL: detectWebGL(),
			hasWebGPU: 'gpu' in nav,
			hasWasmSIMD: detectWasmSIMD(),
			hasAccelerometer: 'DeviceMotionEvent' in window,
			userAgent: nav.userAgent
		}
	};
}

function inferBrowserName(ua: string): string {
	if (ua.includes('Edg/')) return 'Edge';
	if (ua.includes('Chrome/')) return 'Chrome';
	if (ua.includes('Safari/') && !ua.includes('Chrome/')) return 'Safari';
	if (ua.includes('Firefox/')) return 'Firefox';
	return 'Unknown';
}

function inferOsName(ua: string): string {
	if (/Android/.test(ua)) return 'Android';
	if (/iPhone|iPad|iPod/.test(ua)) return 'iOS';
	if (/Mac OS X/.test(ua)) return 'macOS';
	if (/Windows/.test(ua)) return 'Windows';
	if (/Linux/.test(ua)) return 'Linux';
	return 'Unknown';
}

function detectWebGL(): boolean {
	try {
		const canvas = document.createElement('canvas');
		return !!(canvas.getContext('webgl2') || canvas.getContext('webgl'));
	} catch { return false; }
}

function detectWasmSIMD(): boolean {
	try {
		// Tiny SIMD-required module; will throw on decode if SIMD unsupported
		return WebAssembly.validate(new Uint8Array([
			0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0,
			10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11
		]));
	} catch { return false; }
}

// ---------- Public API ----------

/**
 * Open a new scan session, or return the cached active one.
 * Call from the scanner on mount / first-scan. Subsequent scans in the
 * same session reuse the ID — no extra round-trip.
 */
export async function getOrOpenActiveSession(
	input: OpenSessionInput = {}
): Promise<string | null> {
	const now = Date.now();
	if (_activeSessionId && now - _activeSessionOpenedAt < SESSION_MAX_AGE_MS) {
		return _activeSessionId;
	}

	const uid = userId();
	if (!uid) return null; // anonymous scans don't persist in Phase 0.3

	const client = untyped();
	if (!client) return null;

	try {
		const browserCaps = collectBrowserCapabilities();
		const { data, error } = await client
			.from('scan_sessions')
			.insert({
				user_id: uid,
				game_id: input.gameId ?? 'boba',
				device_model: input.deviceModel ?? null,
				os_name: input.osName ?? browserCaps.osName ?? null,
				os_version: input.osVersion ?? null,
				browser_name: input.browserName ?? browserCaps.browserName ?? null,
				browser_version: input.browserVersion ?? null,
				app_version: input.appVersion ?? null,
				viewport_width: input.viewportWidth ?? browserCaps.viewportWidth ?? null,
				viewport_height: input.viewportHeight ?? browserCaps.viewportHeight ?? null,
				device_memory_gb: input.deviceMemoryGb ?? browserCaps.deviceMemoryGb ?? null,
				network_type: input.networkType ?? browserCaps.networkType ?? null,
				capabilities: { ...browserCaps.capabilities, ...input.capabilities },
				extras: input.extras ?? {}
			})
			.select('id')
			.single();

		if (error || !data) {
			logFailure('openSession', error ?? new Error('no row returned'), { userId: uid });
			return null;
		}

		_activeSessionId = data.id;
		_activeSessionOpenedAt = now;
		return _activeSessionId;
	} catch (err) {
		logFailure('openSession', err, { userId: uid });
		return null;
	}
}

/**
 * Record a shutter-press. Call once per scan attempt, before any tier runs.
 * Returns the scan_id to pass to recordTierResult.
 * Returns null on any failure — caller should skip tier persistence if null.
 */
export async function recordScan(input: RecordScanInput): Promise<string | null> {
	const uid = userId();
	if (!uid) return null;

	const client = untyped();
	if (!client) return null;

	try {
		const { data, error } = await client
			.from('scans')
			.insert({
				session_id: input.sessionId,
				user_id: uid,
				game_id: input.gameId ?? 'boba',
				photo_storage_path: input.photoStoragePath ?? null,
				photo_thumbnail_path: input.photoThumbnailPath ?? null,
				photo_bytes: input.photoBytes ?? null,
				photo_width: input.photoWidth ?? null,
				photo_height: input.photoHeight ?? null,
				parent_scan_id: input.parentScanId ?? null,
				retake_chain_idx: input.retakeChainIdx ?? 0,
				capture_context: input.captureContext ?? {},
				quality_signals: input.qualitySignals ?? {},
				outcome: 'pending',
				pipeline_version: PIPELINE_VERSION,
				capture_latency_ms: input.captureLatencyMs ?? null,
				extras: input.extras ?? {}
			})
			.select('id')
			.single();

		if (error || !data) {
			logFailure('recordScan', error ?? new Error('no row returned'), {
				userId: uid,
				sessionId: input.sessionId
			});
			return null;
		}
		return data.id;
	} catch (err) {
		logFailure('recordScan', err, { userId: uid, sessionId: input.sessionId });
		return null;
	}
}

/**
 * Record one engine's output for a given scan. Fire-and-forget.
 * Multiple calls per scan_id are expected (one per tier attempt).
 */
export async function recordTierResult(input: RecordTierResultInput): Promise<void> {
	const uid = userId();
	if (!uid) return;

	const client = untyped();
	if (!client) return;

	try {
		const { error } = await client.from('scan_tier_results').insert({
			scan_id: input.scanId,
			user_id: uid,
			tier: input.tier,
			engine: input.engine,
			engine_version: input.engineVersion,
			raw_output: input.rawOutput,
			latency_ms: input.latencyMs ?? null,
			cost_usd: input.costUsd ?? null,
			errored: input.errored ?? false,
			error_message: input.errorMessage ?? null,
			extras: input.extras ?? {}
		});
		if (error) {
			logFailure('recordTierResult', error, {
				scanId: input.scanId,
				tier: input.tier,
				engine: input.engine
			});
		}
	} catch (err) {
		logFailure('recordTierResult', err, {
			scanId: input.scanId,
			tier: input.tier,
			engine: input.engine
		});
	}
}

/** Close the active session (or a specific one). */
export async function closeSession(sessionId?: string): Promise<void> {
	const targetId = sessionId ?? _activeSessionId;
	if (!targetId) return;

	const client = untyped();
	if (!client) return;

	try {
		const { error } = await client
			.from('scan_sessions')
			.update({ ended_at: new Date().toISOString() })
			.eq('id', targetId);
		if (error) logFailure('closeSession', error, { sessionId: targetId });
	} catch (err) {
		logFailure('closeSession', err, { sessionId: targetId });
	}

	if (targetId === _activeSessionId) resetActiveSession();
}
