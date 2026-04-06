/**
 * /api/admin/changelog — Changelog CRUD
 *
 * GET: List changelog entries
 * POST: Create new entry
 * PUT: Update existing entry
 * DELETE: Delete entry
 */

import { json, error } from '@sveltejs/kit';
import { requireAdmin } from '$lib/server/admin-guard';
import { getAdminClient } from '$lib/server/supabase-admin';
import { parseJsonBody } from '$lib/server/validate';
import { checkMutationRateLimit } from '$lib/server/rate-limit';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals, url }) => {
	await requireAdmin(locals);
	const admin = getAdminClient();
	if (!admin) throw error(503, 'Database not available');

	const limit = Math.max(1, Math.min(Number(url.searchParams.get('limit')) || 50, 200));
	const publishedOnly = url.searchParams.get('published') === 'true';

	let query = admin
		.from('changelog_entries')
		.select('*')
		.order('created_at', { ascending: false })
		.limit(limit);

	if (publishedOnly) {
		query = query.eq('published', true);
	}

	const { data, error: dbError } = await query;
	if (dbError) {
		console.error('[admin/changelog] GET DB error:', dbError.message);
		throw error(500, 'Database operation failed');
	}

	return json({ entries: data || [] });
};

export const POST: RequestHandler = async ({ request, locals }) => {
	const user = await requireAdmin(locals);
	const admin = getAdminClient();
	if (!admin) throw error(503, 'Database not available');

	const rateLimit = await checkMutationRateLimit(user.id);
	if (!rateLimit.success) {
		return json({ error: 'Too many requests' }, { status: 429, headers: { 'X-RateLimit-Limit': String(rateLimit.limit), 'X-RateLimit-Remaining': String(rateLimit.remaining), 'X-RateLimit-Reset': String(rateLimit.reset) } });
	}

	const body = await parseJsonBody<Record<string, unknown>>(request);
	const { title, body: content, is_notification } = body as { title?: string; body?: string; is_notification?: boolean };

	if (!title?.trim()) throw error(400, 'Title is required');

	const { data, error: dbError } = await admin
		.from('changelog_entries')
		.insert({
			title: title.trim(),
			body: content || '',
			is_notification: is_notification === true,
			created_by: user.id,
			created_at: new Date().toISOString(),
			updated_at: new Date().toISOString()
		})
		.select()
		.single();

	if (dbError) {
		console.error('[admin/changelog] POST DB error:', dbError.message);
		throw error(500, 'Database operation failed');
	}

	return json({ entry: data }, { status: 201 });
};

export const PUT: RequestHandler = async ({ request, locals }) => {
	const user = await requireAdmin(locals);
	const admin = getAdminClient();
	if (!admin) throw error(503, 'Database not available');

	const rateLimit = await checkMutationRateLimit(user.id);
	if (!rateLimit.success) {
		return json({ error: 'Too many requests' }, { status: 429, headers: { 'X-RateLimit-Limit': String(rateLimit.limit), 'X-RateLimit-Remaining': String(rateLimit.remaining), 'X-RateLimit-Reset': String(rateLimit.reset) } });
	}

	const body = await parseJsonBody(request);
	const { id, title, body: content, published, is_notification } = body;

	if (!id) throw error(400, 'Entry ID is required');

	const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
	if (title !== undefined) updates.title = title;
	if (content !== undefined) updates.body = content;
	if (published !== undefined) {
		updates.published = published;
		if (published) updates.published_at = new Date().toISOString();
	}
	if (is_notification !== undefined) updates.is_notification = is_notification;

	const { error: dbError } = await admin
		.from('changelog_entries')
		.update(updates)
		.eq('id', id);

	if (dbError) {
		console.error('[admin/changelog] PUT DB error:', dbError.message);
		throw error(500, 'Database operation failed');
	}

	return json({ success: true });
};

export const DELETE: RequestHandler = async ({ request, locals }) => {
	const user = await requireAdmin(locals);
	const admin = getAdminClient();
	if (!admin) throw error(503, 'Database not available');

	const rateLimit = await checkMutationRateLimit(user.id);
	if (!rateLimit.success) {
		return json({ error: 'Too many requests' }, { status: 429, headers: { 'X-RateLimit-Limit': String(rateLimit.limit), 'X-RateLimit-Remaining': String(rateLimit.remaining), 'X-RateLimit-Reset': String(rateLimit.reset) } });
	}

	const { id } = await parseJsonBody(request);
	if (!id) throw error(400, 'Entry ID is required');

	const { error: dbError } = await admin
		.from('changelog_entries')
		.delete()
		.eq('id', id);

	if (dbError) {
		console.error('[admin/changelog] DELETE DB error:', dbError.message);
		throw error(500, 'Database operation failed');
	}

	return json({ success: true });
};
