/**
 * GET /api/admin/triage — list events / fingerprints for the AdminTriageTab.
 * PUT /api/admin/triage — change a fingerprint's status (admin triage action).
 *
 * Views (selected via ?view=...):
 *   active     — fingerprints with status='active' or 'investigating', most recent first
 *   archive    — fingerprints with status='resolved'/'understood'/'ignore'
 *   patterns   — known patterns (status='understood'/'ignore') with 7d firing rate
 *   storage    — diagnostic-table size + retention summary
 *   stream     — raw recent events, optionally filtered by fingerprint_hash
 *   detail     — single fingerprint with its 50 most recent occurrences
 */

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireAdmin } from '$lib/server/admin-guard';
import { getAdminClient } from '$lib/server/supabase-admin';
import { apiError, serviceUnavailable } from '$lib/server/api-response';

const VIEWS = ['active', 'archive', 'patterns', 'storage', 'stream', 'detail'] as const;
type View = (typeof VIEWS)[number];
const STATUSES = ['active', 'investigating', 'understood', 'ignore', 'resolved'] as const;
type Status = (typeof STATUSES)[number];

export const GET: RequestHandler = async ({ url, locals }) => {
	await requireAdmin(locals);
	const admin = getAdminClient();
	if (!admin) return serviceUnavailable('Database');

	const viewParam = url.searchParams.get('view') ?? 'active';
	if (!VIEWS.includes(viewParam as View)) {
		return apiError(`Unknown view: ${viewParam}`, 400, { code: 'UNKNOWN_VIEW' });
	}
	const view = viewParam as View;

	if (view === 'active' || view === 'archive') {
		const statuses: Status[] =
			view === 'active' ? ['active', 'investigating'] : ['resolved', 'understood', 'ignore'];
		const { data, error: dbErr } = await admin
			.from('event_fingerprints')
			.select('*')
			.in('status', statuses)
			.order('last_seen', { ascending: false })
			.limit(200);
		if (dbErr) throw error(500, dbErr.message);
		return json({ view, fingerprints: data ?? [] });
	}

	if (view === 'patterns') {
		const { data, error: rpcErr } = await admin.rpc('event_known_patterns');
		if (rpcErr) throw error(500, rpcErr.message);
		return json({ view, patterns: data ?? [] });
	}

	if (view === 'storage') {
		const { data, error: rpcErr } = await admin.rpc('app_events_storage_summary');
		if (rpcErr) throw error(500, rpcErr.message);
		const row = Array.isArray(data) ? data[0] : data;
		return json({ view, storage: row ?? null });
	}

	if (view === 'stream') {
		const fingerprint = url.searchParams.get('fingerprint');
		const level = url.searchParams.get('level');
		let q = admin
			.from('app_events')
			.select('id, level, event_name, source, fingerprint_hash, summary, error_code, request_path, user_id, created_at')
			.order('created_at', { ascending: false })
			.limit(100);
		if (fingerprint) q = q.eq('fingerprint_hash', fingerprint);
		if (level && ['debug', 'info', 'warn', 'error', 'fatal'].includes(level)) {
			q = q.eq('level', level as 'debug' | 'info' | 'warn' | 'error' | 'fatal');
		}
		const { data, error: dbErr } = await q;
		if (dbErr) throw error(500, dbErr.message);
		return json({ view, events: data ?? [] });
	}

	if (view === 'detail') {
		const fingerprint = url.searchParams.get('fingerprint');
		if (!fingerprint) return apiError('fingerprint param required', 400, { code: 'MISSING_FINGERPRINT' });

		const [fpRes, eventsRes, historyRes] = await Promise.all([
			admin.from('event_fingerprints').select('*').eq('fingerprint_hash', fingerprint).maybeSingle(),
			admin
				.from('app_events')
				.select('*')
				.eq('fingerprint_hash', fingerprint)
				.order('created_at', { ascending: false })
				.limit(50),
			admin
				.from('event_triage_history')
				.select('*')
				.eq('fingerprint_hash', fingerprint)
				.order('created_at', { ascending: false })
				.limit(20)
		]);

		if (fpRes.error) throw error(500, fpRes.error.message);
		if (!fpRes.data) return apiError('Fingerprint not found', 404, { code: 'NOT_FOUND' });

		return json({
			view,
			fingerprint: fpRes.data,
			events: eventsRes.data ?? [],
			history: historyRes.data ?? []
		});
	}

	return apiError('Unhandled view', 400, { code: 'UNHANDLED_VIEW' });
};

interface TriageUpdate {
	fingerprint_hash?: unknown;
	status?: unknown;
	notes?: unknown;
}

export const PUT: RequestHandler = async ({ request, locals }) => {
	const adminUser = await requireAdmin(locals);
	const admin = getAdminClient();
	if (!admin) return serviceUnavailable('Database');

	let body: TriageUpdate;
	try {
		body = (await request.json()) as TriageUpdate;
	} catch {
		return apiError('Invalid JSON body', 400, { code: 'INVALID_JSON' });
	}

	const fingerprint_hash = typeof body.fingerprint_hash === 'string' ? body.fingerprint_hash : null;
	const status = typeof body.status === 'string' ? body.status : null;
	const notes = typeof body.notes === 'string' ? body.notes : null;

	if (!fingerprint_hash) return apiError('fingerprint_hash required', 400, { code: 'MISSING_FINGERPRINT' });
	if (status && !STATUSES.includes(status as Status)) {
		return apiError(`Invalid status: ${status}`, 400, { code: 'INVALID_STATUS' });
	}

	const { data: existing, error: fetchErr } = await admin
		.from('event_fingerprints')
		.select('status, notes')
		.eq('fingerprint_hash', fingerprint_hash)
		.maybeSingle();
	if (fetchErr) throw error(500, fetchErr.message);
	if (!existing) return apiError('Fingerprint not found', 404, { code: 'NOT_FOUND' });

	const updates: { status?: Status; notes?: string | null; last_triaged_by?: string; last_triaged_at?: string } = {
		last_triaged_by: adminUser.id,
		last_triaged_at: new Date().toISOString()
	};
	if (status) updates.status = status as Status;
	if (notes !== null) updates.notes = notes;

	const { error: updErr } = await admin
		.from('event_fingerprints')
		.update(updates)
		.eq('fingerprint_hash', fingerprint_hash);
	if (updErr) throw error(500, updErr.message);

	// Audit trail
	if (status && status !== existing.status) {
		await admin.from('event_triage_history').insert({
			fingerprint_hash,
			admin_id: adminUser.id,
			action: 'status_changed',
			old_status: existing.status,
			new_status: status,
			notes
		});
	} else if (notes && notes !== existing.notes) {
		await admin.from('event_triage_history').insert({
			fingerprint_hash,
			admin_id: adminUser.id,
			action: 'noted',
			old_status: existing.status,
			new_status: existing.status,
			notes
		});
	}

	return json({ ok: true });
};
