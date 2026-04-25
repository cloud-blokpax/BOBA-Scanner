/**
 * GET  /api/admin/triage/[hash] — fingerprint detail (events + history)
 * POST /api/admin/triage/[hash] — update triage status
 */

import { json, error } from '@sveltejs/kit';
import { requireAdmin } from '$lib/server/admin-guard';
import { getAdminClient } from '$lib/server/supabase-admin';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals, params }) => {
	await requireAdmin(locals);

	const admin = getAdminClient();
	if (!admin) throw error(503, 'database_unavailable');

	const hash = params.hash;
	if (!hash || !/^[a-f0-9]{32}$/i.test(hash)) {
		throw error(400, 'invalid_hash');
	}

	const [fp, recentEvents, history] = await Promise.all([
		admin
			.from('event_fingerprints')
			.select('*')
			.eq('fingerprint_hash', hash)
			.maybeSingle(),
		admin
			.from('app_events')
			.select('id, short_code, level, created_at, error_message, context, user_id')
			.eq('fingerprint_hash', hash)
			.order('created_at', { ascending: false })
			.limit(20),
		admin
			.from('event_triage_history')
			.select('*')
			.eq('fingerprint_hash', hash)
			.order('created_at', { ascending: false })
	]);

	if (!fp.data) throw error(404, 'fingerprint_not_found');

	return json({
		fingerprint: fp.data,
		recent_events: recentEvents.data ?? [],
		history: history.data ?? []
	});
};

interface TriageUpdateBody {
	status?: string;
	note?: string | null;
	summary?: string | null;
	duplicate_of_hash?: string | null;
	release_git_sha?: string | null;
}

export const POST: RequestHandler = async ({ locals, params, request }) => {
	await requireAdmin(locals);

	const admin = getAdminClient();
	if (!admin) throw error(503, 'database_unavailable');

	const hash = params.hash;
	if (!hash || !/^[a-f0-9]{32}$/i.test(hash)) {
		throw error(400, 'invalid_hash');
	}

	let body: TriageUpdateBody;
	try {
		body = await request.json();
	} catch {
		throw error(400, 'invalid_json');
	}

	const newStatus = body.status;
	if (typeof newStatus !== 'string' || newStatus.length === 0) {
		throw error(400, 'status_required');
	}

	// Author = 'jimmy' for human admin actions via this endpoint.
	const { data, error: rpcError } = await admin.rpc('triage_fingerprint', {
		p_hash: hash,
		p_new_status: newStatus,
		p_note: body.note ?? null,
		p_author: 'jimmy',
		p_release_git_sha: body.release_git_sha ?? null,
		p_summary: body.summary ?? null,
		p_duplicate_of_hash: body.duplicate_of_hash ?? null
	});

	if (rpcError) {
		console.error('[admin/triage POST] RPC failed:', rpcError);
		throw error(500, rpcError.message);
	}

	return json({ ok: true, fingerprint: data });
};
