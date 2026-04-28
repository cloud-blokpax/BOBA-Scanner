/**
 * Client-side error capture with crash heuristics.
 *
 * Capture surfaces:
 *   1. window 'error' event             → 'error'
 *   2. 'unhandledrejection' event       → 'unhandledrejection'
 *   3. Heartbeat staleness on next load → 'inferred_crash' (catches OOM, SW reload)
 *   4. flowBreadcrumb() calls           → 'manual_breadcrumb' (rare; usually attached to others)
 *
 * Writes to public.client_errors. RLS allows anon insert.
 *
 * This complements the existing diagnostics-client (which writes to
 * app_events). app_events captures errors that fire INSIDE the JS layer;
 * client_errors adds a heartbeat-based detector that catches process-level
 * kills (iOS Safari OOM, SW reload) where window.onerror never fires.
 *
 * Usage in a flow:
 *   import { startFlow, updateFlowStep, endFlow } from '$lib/services/client-error-logger';
 *
 *   startFlow('whatnot_upload_card', 'file_selected', { size: file.size });
 *   try {
 *     updateFlowStep('paddle_ocr');
 *     await runOcr();
 *     endFlow('success');
 *   } catch (e) {
 *     endFlow('error');
 *     throw e;
 *   }
 */
import { getSupabase } from '$lib/services/supabase';

const HEARTBEAT_KEY = 'cs_active_flow';
const SESSION_KEY = 'cs_session_id';
const BREADCRUMBS_KEY = 'cs_breadcrumbs';
const HEARTBEAT_INTERVAL_MS = 2000;
const STALE_THRESHOLD_MS = 8000; // 4× heartbeat interval = clearly stale, not throttled
const MAX_BREADCRUMBS = 30;

type FlowState = {
	flow: string;
	step: string;
	startedAt: number;
	lastHeartbeatAt: number;
	data?: Record<string, unknown>;
};

type Breadcrumb = {
	ts: number;
	flow: string | null;
	step: string;
	data?: Record<string, unknown>;
};

let sessionId: string;
let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
let initialized = false;

// ---------- session ID (per-tab) ----------

function getSessionId(): string {
	if (sessionId) return sessionId;
	try {
		const existing = sessionStorage.getItem(SESSION_KEY);
		if (existing) {
			sessionId = existing;
			return sessionId;
		}
		sessionId = crypto.randomUUID();
		sessionStorage.setItem(SESSION_KEY, sessionId);
	} catch {
		// sessionStorage unavailable — generate ephemeral
		sessionId = crypto.randomUUID();
	}
	return sessionId;
}

// ---------- breadcrumb ring buffer (sessionStorage) ----------

function readBreadcrumbs(): Breadcrumb[] {
	try {
		const raw = sessionStorage.getItem(BREADCRUMBS_KEY);
		return raw ? JSON.parse(raw) : [];
	} catch {
		return [];
	}
}

function writeBreadcrumbs(crumbs: Breadcrumb[]) {
	try {
		sessionStorage.setItem(
			BREADCRUMBS_KEY,
			JSON.stringify(crumbs.slice(-MAX_BREADCRUMBS))
		);
	} catch {
		// storage full — drop silently rather than crash the logger
	}
}

export function flowBreadcrumb(
	step: string,
	data?: Record<string, unknown>
): void {
	const flow = readFlow()?.flow ?? null;
	const crumbs = readBreadcrumbs();
	crumbs.push({ ts: Date.now(), flow, step, data });
	writeBreadcrumbs(crumbs);
}

// ---------- flow heartbeat (localStorage so it survives reload) ----------

function readFlow(): FlowState | null {
	try {
		const raw = localStorage.getItem(HEARTBEAT_KEY);
		return raw ? JSON.parse(raw) : null;
	} catch {
		return null;
	}
}

function writeFlow(state: FlowState | null): void {
	try {
		if (state) localStorage.setItem(HEARTBEAT_KEY, JSON.stringify(state));
		else localStorage.removeItem(HEARTBEAT_KEY);
	} catch {
		// ignore
	}
}

export function startFlow(
	flow: string,
	step: string,
	data?: Record<string, unknown>
): void {
	const now = Date.now();
	writeFlow({ flow, step, startedAt: now, lastHeartbeatAt: now, data });
	flowBreadcrumb(`flow_start:${flow}`, { step, ...data });

	if (heartbeatTimer !== null) clearInterval(heartbeatTimer);
	heartbeatTimer = setInterval(() => {
		const current = readFlow();
		if (!current || current.flow !== flow) {
			// someone else cleared/changed the flow — stop our timer
			if (heartbeatTimer !== null) clearInterval(heartbeatTimer);
			heartbeatTimer = null;
			return;
		}
		writeFlow({ ...current, lastHeartbeatAt: Date.now() });
	}, HEARTBEAT_INTERVAL_MS);
}

export function updateFlowStep(
	step: string,
	data?: Record<string, unknown>
): void {
	const current = readFlow();
	if (!current) return;
	writeFlow({ ...current, step, lastHeartbeatAt: Date.now(), data });
	flowBreadcrumb(`step:${step}`, data);
}

export function endFlow(
	reason: 'success' | 'cancelled' | 'error' = 'success'
): void {
	const current = readFlow();
	if (current) flowBreadcrumb(`flow_end:${current.flow}`, { reason });
	writeFlow(null);
	if (heartbeatTimer !== null) clearInterval(heartbeatTimer);
	heartbeatTimer = null;
}

// ---------- environment snapshot ----------

function envSnapshot() {
	const mem = (
		performance as unknown as { memory?: { usedJSHeapSize: number } }
	).memory;
	const conn = (
		navigator as unknown as { connection?: { effectiveType?: string } }
	).connection;
	return {
		user_agent: navigator.userAgent,
		url: location.href,
		viewport: {
			w: window.innerWidth,
			h: window.innerHeight,
			dpr: window.devicePixelRatio
		},
		memory_mb: mem
			? Math.round((mem.usedJSHeapSize / 1024 / 1024) * 10) / 10
			: null,
		device_memory_gb:
			(navigator as unknown as { deviceMemory?: number }).deviceMemory ?? null,
		connection_type: conn?.effectiveType ?? null
	};
}

// ---------- Supabase write ----------

type LogPayload = {
	error_type: 'error' | 'unhandledrejection' | 'inferred_crash' | 'manual_breadcrumb';
	message?: string;
	stack?: string;
	source?: string;
	line?: number;
	col?: number;
	flow?: string | null;
	step?: string | null;
	heartbeat_age_ms?: number | null;
};

async function logError(payload: LogPayload) {
	try {
		const client = getSupabase();
		if (!client) return;
		const { data: userResp } = await client.auth.getUser();
		const env = envSnapshot();
		const breadcrumbs = readBreadcrumbs();
		const { error } = await client.from('client_errors').insert({
			user_id: userResp?.user?.id ?? null,
			session_id: getSessionId(),
			breadcrumbs,
			...env,
			...payload
		});
		if (error) console.error('[client-error-logger] insert error', error);
	} catch (err) {
		// never let the logger itself blow up
		console.error('[client-error-logger] insert threw', err);
	}
}

// ---------- inferred-crash detection on init ----------

function checkInferredCrash() {
	const current = readFlow();
	if (!current) return;
	const age = Date.now() - current.lastHeartbeatAt;
	if (age > STALE_THRESHOLD_MS) {
		void logError({
			error_type: 'inferred_crash',
			flow: current.flow,
			step: current.step,
			heartbeat_age_ms: age,
			message: `Inferred crash: heartbeat stale by ${age}ms during flow=${current.flow} step=${current.step}`
		});
		writeFlow(null);
	}
}

// ---------- public init ----------

export function initClientErrorLogger(): void {
	if (initialized || typeof window === 'undefined') return;
	initialized = true;

	getSessionId();

	// 1. detect crash from prior session (the new bit)
	checkInferredCrash();

	// 2. wire window 'error'
	window.addEventListener('error', (event) => {
		const flow = readFlow();
		void logError({
			error_type: 'error',
			message: event.message,
			stack: event.error?.stack,
			source: event.filename,
			line: event.lineno,
			col: event.colno,
			flow: flow?.flow ?? null,
			step: flow?.step ?? null
		});
	});

	// 3. wire 'unhandledrejection'
	window.addEventListener('unhandledrejection', (event) => {
		const flow = readFlow();
		const reason = event.reason as
			| { message?: string; stack?: string }
			| string
			| null;
		let message: string;
		let stack: string | undefined;
		if (typeof reason === 'string') {
			message = reason;
		} else if (reason && typeof reason === 'object') {
			message = reason.message ?? '(no message)';
			stack = reason.stack;
		} else {
			try {
				message = JSON.stringify(reason).slice(0, 500);
			} catch {
				message = '(unserializable rejection)';
			}
		}
		void logError({
			error_type: 'unhandledrejection',
			message,
			stack,
			flow: flow?.flow ?? null,
			step: flow?.step ?? null
		});
	});

	// NOTE: we deliberately do NOT clear the flow on pagehide/beforeunload.
	// Crashes also fire pagehide. A real graceful exit clears the flow via endFlow().
}
